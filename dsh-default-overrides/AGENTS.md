# dsh-default-overrides — 技术契约

## 这是什么

宿主半体 + 浏览器半体的双面插件：宿主侧用官方 `ctx.configEditor` 读写当前 profile 的补丁文件，浏览器侧在设置里注册一个 `settings.section` 分区（`order: 110`，排在 DSH 自带项之后）。

结构：

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口、HTTP 路由（status / action）、守卫、错误翻译 |
| `lib/overrides.js` | 可覆盖项白名单 + 纯计算（候选配置、校验、可用性判定） |
| `client.js` | 设置分区 UI（单文件 bundle，无构建） |
| `cordis.patch.yml` | bundle patch：把 `dsh-default-overrides` 条目插进组合 |

## 兼容发布线与版本门（2026-10-01 补）

兼容线 `>=0.1.7-alpha.1 <0.1.8`，逐版本核对清单 `0.1.7-rc.2`。

**声明必须四处同源**：`package.json#dshCompatibility.range`（+ `engines.dsh`）⟷ `lib/index.js` 的 `DSH_COMPATIBILITY_RANGE` / `VERIFIED_DSH_VERSIONS` ⟷ `install.sh` 的 `DSH_COMPATIBILITY_RANGE` / `DSH_VERIFIED_VERSIONS`（**多版本用空格分隔**，脚本按词分割消费）⟷ 本文件与 `README.md` 的兼容段。`test/manifest.test.js` 的「四处同源」用例按行解析这些赋值逐字比对，加版本时必须四边一起改。

**范围外必须 inert**：`applyForEntry()` 从 DSH CLI 入口 realpath 后向上 ≤4 层定位 `@deepseek-ai/dsh/package.json` 读真实版本，`applyForVersion()` 判定超出范围就只打一条 error 日志并返回——不注册路由、不读 profile、不写任何文件。线内未逐条核对的版本继续运行但打 warn（能力探测仍是权威判定）。

这条不是保守习惯，是**写错就救不回来**：本插件整块改写 profile 补丁里的 `config`，写错的后果是目标条目因 `required` 校验失败而加载失败（`fiber.state = 3`），此时 `configEditor` 会拒绝服务（"Configuration plugin is no longer active"），只能手改文件救回来。

**2026-10-01 的真实缺陷**：在此之前上面两段全是空话——`package.json`、`install.sh`、README 都声明了范围与清单，运行时的 `apply()` 却只有一句 `ctx.inject([...])`，从不判定版本。于是本机 DSH 升到 `0.2.0-rc.2` 后它照常注册路由、照常可写 profile，而 9 个兄弟插件里另外 8 个都按版本门退成了 inert。补上后新增 `test/version-gate.test.js`（7 个用例：纯函数判定矩阵、范围外零注册 + error 日志、已核对版本装配与不告警、同线未核对版本告警、入口定位失败 inert、`readDshPackage` 的包根探测与拒绝、常量同源）与 `manifest.test.js` 的四处同源守卫。

**客户端在 inert 下的表现**：宿主没注册路由时 `/dsh-default-overrides/status` 是空 body 的 404，`response.json()` 会抛 `SyntaxError`，页面只剩「读取状态失败：Unexpected end of JSON input」。`client.js` 因此显式识别 404 并给出可读文案，并单独捕获非 JSON 响应——这是「探测不到的能力各自降级，不要让整页 404」的落地。

## 为什么不是"把清单存进插件自己的配置"

最初设想的方案是"插件自己的条目存覆盖清单，宿主对账后落盘"。放弃它是因为会出现**两份状态**：清单一份、目标条目在补丁里的覆盖一份，用户手写覆盖后两者必然分叉，恢复默认还要额外记 `managed` 集合。

现在的方案让 **profile 补丁本身成为唯一真相**：页面读 `configEditor.configuration()`（继承层 / 覆盖层 / 生效值），写入直接调 `configEditor.edit()`。没有同步逻辑，也没有第二份状态。

## 机制契约（2026-09-28 隔离探针实测）

| 问题 | 实测结论 |
|---|---|
| 写入形态 | `edit()` 写入的是**完整 config 块**。目标条目在补丁里已存在 → 就地替换 `config` 节点、位置不变；不存在 → 追加到数组末尾。 |
| 能否只写一个字段 | **不能，也不该**。补丁是整块替换：手写部分字段会让目标插件因 `required` 校验失败而**加载失败**（`fiber.state = 3`），此时 `edit()` 直接拒绝服务（"Configuration plugin is no longer active"），只能手改文件救回来。 |
| 注释与 `!!js` | 块**外**的注释、`!!js` 表达式完整保留；`config` 块**内部**的行内注释会随该块被替换而丢失。 |
| 热生效 | 是。`await edit()` 返回时 Loader 已完成 reconcile，`entry.options.config` 同步变成新值。 |
| 恢复默认 | 候选值等于继承层时，`edit()` 会自动删掉该条目的 `config`（只剩 id/name 时连行一起删）。恢复单个字段时**不能整块退回继承层**，否则会顺手抹掉用户手写的其它字段——必须"只把该字段设回继承值"（`planFieldReset`）。 |
| 更高层覆盖 | 该条目被 home patch 或命令行 `--patch` 覆盖时抛 `Configuration for "X" is overridden by a home patch or command-line overlay`，文件不被改动。 |
| 就绪时机 | 等 Loader 用 `ctx.root.loader.await()`；`edit()` 要求目标条目 `fiber.state === 2`，且**每次都要重新从 `entries()` 取 entry**（旧对象会因条目重建而失效）。 |

## HTTP 契约

两个同源端点，路径常量在 `lib/overrides.js`：

- `GET /dsh-default-overrides/status` → `{ ok, available, csrfToken, documentPath, groups, entries, advanced, totalEntries, managedEntries, sessions, sessionsAvailable, sessionsReason, sessionsTotal, sessionsNeedRetitle }`
  - `entries[].fields[]` 每项给 `default`（继承层）、`override`（补丁覆盖）、`effective`（生效值）；`undefined` 的键在 JSON 里会被省略，客户端按缺键处理。
  - `entries[].availability` = `{ writable, reason: active|missing|inactive|failed, message }`。
  - `sessions[]` **只列需要重算标题的活跃会话**：`{ id, shortId, cwd, title, sourceKind, sourceLabel, overwritesManual, updatedAt, inputBytes, inputLimit, overLimit, suggestedLimit }`，按最近活动排序、最多 20 行；`sessionsTotal` / `sessionsNeedRetitle` / `sessionsOverLimit` 是完整口径（活跃总数 / 需要重算数 / 其中首条消息已超限数），页面用它解释"为什么只看到这些"。标题快照只存在于内存，所以列不出没打开的会话。
  - `inputBytes` 是**按官方口径预检**出来的"标题模型输入字节数"（`titleInput` 投影取首条用户消息 → `TITLE_INPUT_PREFIX + JSON.stringify([{seq,text}])`，逐字对齐官方 `frameMessages()`）；`overLimit` 为真时 `suggestedLimit` 给出"调到够用"的建议值（向上取整到 1 KB）。上限拿不到（条目缺失）时 `overLimit` 恒为 false——宁可不提示，也不要把能重算的会话误标成超限。
  - **口径实测**：拿线上那条真实报错会话来核对，预检 4697 字节与 provider 报的 `input is 4697 bytes` 完全一致（注意 JSON 必须用 JS 的紧凑分隔符；Python 侧用 `separators=(',', ':')` 复刻，带空格会多算 3 字节）。
- `POST /dsh-default-overrides/action` → `{ action: 'apply', entryId, path, value }` / `{ action: 'reset', entryId, path }` / `{ action: 'reset-entry', entryId }` / `{ action: 'retitle', sessionId }`，成功回执带最新的 `entries`、`advanced`、`sessions` 与两个统计字段。

### 标题重算列表的口径（用户 2026-09-28 定）

列表按标题来源过滤，只有 `fallback`（兜底截断：模型命名失败 / 输入超限 / 无凭证留下的半句话标题）进列表：

| 来源 | 行为 |
|---|---|
| `provider`（模型成功命名） | 不进列表 |
| `user`（用户手动命名） | 不进列表 |
| `fallback` | 进列表，可重算 |
| 无标题（`none`） | 不进列表：没有首条消息时重算无事可做 |

`retitle` 动作支持 `raiseLimit: true`：先按 `suggestedMaxInputBytes(inputBytes)` 把 `session-title-llm.maxInputBytes` 写进补丁（复用白名单写入路径），再重算——一次请求完成"抬上限 + 重算"。没有预检到但 provider 仍报超限时，错误统一翻译成 `title-input-over-limit`（409），并带 `detail: { inputBytes, inputLimit, suggestedLimit }`，页面据此渲染「把上限调到 N 并重试」按钮。

为什么超限会话**不过滤掉、而是单独列出**：直接隐藏会让用户以为"我的会话不见了"，而真实原因是它注定失败；列出来并标出 `首条消息 4.6 KB / 上限 4.0 KB`，才能一眼看懂。

重算成功后来源变成 `provider`，因此**自动从列表消失且之后不再出现**——不需要额外的"已处理"状态。实现是纯函数 `selectRetitleCandidates` + `summarizeSessions`，接在 `describeLiveSessions` 里；过滤在宿主侧做，响应体也跟着变小。

**同样的过滤在客户端再做一遍**（`client.js` 里按 `sourceKind === 'fallback'` 筛），统计字段缺失时用返回行数回退计算。这不是冗余：宿主代码改动要重启才生效，而客户端 bundle 刷新页面就更新，两者会出现版本不同步的窗口期——2026-09-28 就踩到了：用户刷新后拿到新页面、宿主还是旧进程，旧宿主返回全部活跃会话且没有统计字段，于是页面显示"0 个活跃会话"却列出一堆行、点完也不消失。客户端兜底过滤 + 统计回退把这种窗口期也兜住。

守卫分两级：**status 只校验请求来源**（`clientRequestRejection`：连接层认证 + 同源 + `x-dsh-default-overrides-client: 1`），因为 CSRF 令牌正是它下发的；**action 追加令牌比对**（`x-dsh-default-overrides-csrf`，令牌取自 status 响应）。这个不对称是必需的——最初把两级写在一起，导致页面第一次请求就拿不到令牌（403），只能在浏览器里才暴露。

错误码：`invalid-value` / `entry-missing` / `entry-not-managed` / `higher-layer-override` / `entry-failed` / `entry-unavailable` / `session-not-live` / `retitle-unavailable` / `retitle-failed` / `title-input-over-limit` / `csrf-rejected` / `request-rejected` / `editor-missing`。

会话标题重算走官方 `ctx.sessionTitle.refresh(session)`：它要求 `sessions.get(id) === session`（必须是这个进程里的 live 会话），成功后 append 新的 `session/title`（source: provider）。官方 UI 一直没有暴露这个能力，这里补的是入口，不是新机制。

## 设置页 UI 结构（2026-09-28 改造）

- 面板自上而下：**面板标题「默认设置覆盖」** → 一句说明 → 当前 profile 补丁路径 → 操作提示条 → 每个白名单条目一个模块 → 会话标题重算模块 → 高级模式。
- **没有分组层**：早期版本有「会话标题」分组标题与描述，会让整块面板看起来只服务一个功能，已删除（`GROUPS` 常量、`entries[].group` 字段、`status.groups` 一并移除）。
- **模块默认收起**：`open` 状态存在组件里、未设置的 key 即收起；收起时只显示标题与右侧状态标签，展开才渲染字段与说明。长面板因此不会一屏铺开。
- **状态类文案一律用 Tag**（`.ddo-tag` + accent/muted/warn/error 四档）：模块级的 `默认值` / `已覆盖 N 项` / `条目不存在` / `暂时不可写` / `N 条待重算`，字段级的 `已覆盖` / `随整块写入`，会话行的 `兜底截断`。
- 高级模式每行都要有 Tag，且标签要说明**用户能做什么**而不是内部术语：白名单条目 → `可在上方调整`（有对应模块、覆盖能逐字段改），其它条目 → `只能整块清除`。早先这里只给白名单行贴一个「白名单」、其它行没有标签，用户第一反应是"这是什么意思？前面没有这个啊"——只描述系统内部状态、还时有时无的标签，等于没写。
- **长文本 + 按钮同排时必须约束收缩**：`.ddo-item-text { flex: 1 1 auto; min-width: 0 }` 让文本先换行，`.ddo-button { flex: none; white-space: nowrap }` 让按钮保持单行。只做前者不做后者，按钮会被压成两行（截图中「清除覆盖」曾变成「清除覆/盖」）。
- **界面控件一律取官方 `@deepseek-ai/dsh-client-ui-primitives`，不自绘**（工作区根 `AGENTS.md`「双面插件」「Slot 系统」两节的既有实践，`dsh-extra-context` 是范例）：
  - 折叠箭头 = `IconTriangleRightFill*` 图标（通过 `exportOf(...)` 按能力探测导出名，兼容命名法变更），容器 `.ddo-chevron` 在 `details[open]` 时 `rotate(90deg)`；
  - 状态标签 = 官方 `Tag`（`tone` 映射：accent→info、muted→neutral、warn→warning、error→danger），悬停说明挂在外层 span 上（官方 Tag 只收 tone/className/children）；
  - 按钮 = 官方 `Button`（`variant: primary|outline`、`size: 'sm'`，实测 28px），输入框 = 官方 `Input`（外层自带 wrap span）；
  - 本地 CSS 只留布局约束（宽度、`flex: none`、`nowrap`），外观一律交给官方组件，避免"尺寸/配色/过渡必然与壳层不一致"。
  - **踩坑三轮**：①自绘 `▸` 字符 + CSS 旋转（和官方图标显然不是一套，原生 details 还没 hover）；②改成浏览器原生 marker（与 DSH 自带图标又不一致）；③关掉 marker 换官方图标时，**只处理了走 `Module` 的模块，漏掉手写的 `<details>`，高级模式整行没了箭头**。根因都是没先复用官方组件 + 折叠出口不唯一。
  - 因此折叠结构**只有一个出口**（`Module` 组件），高级模式也走它；`test/manifest.test.js` 断言 `React.createElement('details'` 全文件只出现一次，再有手写就会当场失败。
- 折叠结构保留原生 `<details>` / `<summary>`（键盘与无障碍免费），只关掉浏览器 marker：`list-style: none` + `::-webkit-details-marker { display: none }` + `::marker { content: '' }`；hover 背景写在 `.ddo-module > summary:hover`。
- `<details>` 不传受控 `open`：展开状态由浏览器持有，React 重渲染（例如 apply 后刷新数据）不会把用户展开的模块收回去。
- `package.json#dsh.client.inject` 必须声明 `@deepseek-ai/dsh-client-ui-primitives`；`test/manifest.test.js` 里有回归守卫（断言 require 了 primitives、用了官方图标与控件、且不再出现 `React.createElement('button'/'input')` 与自绘三角字符）。

## 加一项可覆盖的默认值

只改 `lib/overrides.js` 的 `GROUPS` / `ENTRIES`：加条目 id、字段名、label、单位、下限、提示语。两端校验与页面渲染都由这份白名单驱动，客户端不用动。

约束：字段必须是**顶层字段**，且目标条目的 Config schema 要求这些字段（否则整块写入会因缺 required 项而让目标插件加载失败）。加字段前先用 `dsh --profile web --dump-config` 确认该条目的默认值与字段名。

## 已验证 / 未验证

已验证（隔离 `DSH_HOME` + 独立端口 + 本会话专属无头 Chrome，2026-09-28）：

- `npm run check` + `npm test`（42 个用例：白名单、候选配置计算、可用性、标题来源标签、会话行整理与排序、冻结标记、重算候选过滤与统计、JSON 回执形状、版本门与四处同源）。
- 宿主端到端（curl 走真实路由，带 cookie 认证 + CSRF）：status 读取、apply 写 8192、reset 还原——reset 后补丁文件与原始配置**逐字节一致**。
- 错误路径：非法值（400 `invalid-value`）、白名单外字段（400）、缺 CSRF（403）、无覆盖时恢复默认、重算未知会话（404 `session-not-live`）。
- 浏览器端到端（CDP 驱动无头 Chrome，缓存已禁用）：设置面板打开 →「默认设置覆盖」分区渲染出 8 个输入框 → 点「应用」写入 32768（提示「已写入 session-title-llm.maxInputBytes = 32768。」、实际生效同步、「已覆盖」1 个 +「随整块写入」4 个）→ 高级模式展开列出 10 个带覆盖条目 → 会话标题重算卡片列出活跃会话、点「重新生成」得到「已请求重算标题（原：无）。」→ 点「恢复默认」回到 4096、标记清零。
- 过滤口径（重启实例后复验）：实例里那个无标题的活跃会话**不再出现**在列表里，卡片显示「当前 1 个活跃会话，其中 0 个需要重算」——这正是修掉的"每打开一个对话就多一行"的来源。
- 版本不同步窗口（用"旧宿主 + 新客户端"专门复现）：把插件副本的宿主过滤临时改回"返回全部会话、不带统计字段"，页面仍显示「当前 1 个活跃会话，其中 0 个需要重算」且列表 0 行——证明客户端兜底过滤与统计回退都生效。
- 真机（用户 `127.0.0.1:3080`，重启后）：`/dsh-default-overrides/status` 返回 401 而随机路径 404（路由已注册）；用户点「应用」后补丁新增 8 行整块 config（`maxInputBytes: 32768`），注释 16→16、`!!js` 2→2 未丢；点「重新生成」后本会话多出一条 `provider` 标题记录（官方 UI 无此入口，只可能来自本插件）。
- 客户端 bundle 已进入页面启动图（`dsh-default-overrides/client.js&rev=…` 出现在 `/` 的 HTML 里）。

版本门（2026-10-01，本机 DSH `0.2.0-rc.2`）：

- **真机宿主验证**：`applyForEntry()` 用真实 DSH 入口（`realpath "$(command -v dsh)"` → `…/dsh/lib/bin.js`）探测到版本 `0.2.0-rc.2`，`ctx.inject` 调用次数 **0**，日志为 `dsh-default-overrides: unsupported DSH 0.2.0-rc.2; expected >=0.1.7-alpha.1 <0.1.8. Plugin stays inert.`——即范围外完全 inert。
- **守卫注入缺陷验证**（在副本上做，四处各自必须变红）：①把 `classifyDshVersion` 的判定换成恒真 → `version-gate.test.js` 2 个用例红；②只改 `lib` 的 `VERIFIED_DSH_VERSIONS` → `manifest.test.js` 红；③只改 `install.sh` 的 `DSH_VERIFIED_VERSIONS` → 红；④把 `AGENTS.md` 里的版本号改掉 → 红。四处同源不是纸面约定。
- **未覆盖**：客户端在 inert 下的可读文案只做了代码路径与单测层面的确认，**没有在隔离宿主上真的打开设置页目视**（宿主已 inert，需要先把版本门临时放宽才能造出该场景）。

未验证 / 踩到的墙：

- **"兜底会话出现在列表里"这条正向路径没能在隔离环境里造出来**：无头浏览器里 composer 是自定义 contenteditable，`execCommand('insertText')` 与 CDP `Input.insertText` 都不被接受（发送按钮始终 disabled），改用探针直接 `session.append('user/message', …)` 则被 surface 契约拦下（`session event "user/message" is surface-eligible and requires a surfaceOp marker`）。该路径由单测覆盖（`selectRetitleCandidates` / `summarizeSessions`），真机确认请打开一条标题是半句话的旧会话。
- 隔离实例里模型成功命名那条路径同理（无凭证）。

### 「随整块写入」标记从哪来

补丁整块替换，所以应用一个字段会把该条目的全部字段一起写进补丁。`describeEntryFields` 用 `frozenSameAsDefault`（override 存在且等于继承值）把"用户改过的"与"只是被一起写进去的"分开，客户端据此显示「已覆盖 / 随整块写入」。恢复某个字段时，若整块恰好等于继承层，configEditor 会删掉整个 `config`——这就是"解除冻结"的路径。

## 待办

- 白名单扩展（压缩阈值、subagent 并发、Web 搜索等），按同一张表加。
- 高级模式目前只支持"清除整块覆盖"；若以后要支持任意字段编辑，需要先解决"非白名单字段写坏组合"的风险（二次确认 + 组合校验 + 一键回滚）。
