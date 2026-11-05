# dsh-default-tuner — 技术契约

## 这是什么

宿主半体 + 浏览器半体的双面插件：宿主侧用官方 `ctx.configEditor` 读写当前 profile 的补丁文件，浏览器侧在设置里注册一个 `settings.section` 分区（`order: 120`，排在 DSH 自带项之后；同 slot 的连续分配见根 `AGENTS.md`）。

结构：

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口、HTTP 路由（status / action）、守卫、错误翻译 |
| `lib/overrides.js` | 可覆盖项白名单 + 纯计算（候选配置、校验、可用性判定） |
| `client.js` | 设置分区 UI（单文件 bundle，无构建） |
| `cordis.patch.yml` | bundle patch：把 `dsh-default-tuner` 条目插进组合 |

## 兼容发布线与版本门（2026-10-01 补，2026-10-10 跨到 0.2.1，2026-10-29 跨到 0.2.2）

兼容线 `>=0.2.2-alpha.2 <0.2.3`，逐版本核对清单 `0.2.2-alpha.2 0.2.2-rc.1`（跨线当轮的逐包证据见 [`docs/compat-log.md`](../docs/compat-log.md) 的 M1 轮次）。

**声明必须四处同源**：`package.json#dshCompatibility.range`（+ `engines.dsh`）⟷ `lib/index.js` 的 `DSH_COMPATIBILITY_RANGE` / `VERIFIED_DSH_VERSIONS`（发布线与下界从 `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` 派生）⟷ `install.sh` 的五个常量 `DSH_COMPATIBILITY_RANGE` / `DSH_VERIFIED_VERSIONS` / `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR_CHANNEL` / `DSH_RELEASE_FLOOR_SEQUENCE`（**多版本用空格分隔**，脚本按词分割消费）+ 一份等价的 `prerelease_rank()` ⟷ 本文件与 `README.md` 的兼容段。`test/manifest.test.js` 的「四处同源」用例按行解析这些赋值逐字比对（并且把 range 反推回发布线与下界），加版本时必须四边一起改。

**跨线只改常量，判定逻辑不动**：`classifyDshVersion()` 从发布线 + 下界派生，五个常量都是普通字面量（**不要 `Object.freeze`、不要 `Set`**，形状与 8 个已跨线插件一致）。同线内的 prerelease 必须靠 **channel 优先级比较**挡住——旧写法 `channel !== 'alpha' || seq >= N` 只能表达"下界是 alpha"，换成 rc 后会静默放行 `0.2.0-alpha.9`。2026-10-10 下界从 `rc.2` 换成 `alpha.2` 后这个比较方向反过来，**两条判据都要在矩阵里有档**：`0.2.2-beta.1`/`0.2.2-rc.1` 必须放行、`0.2.2-alpha.1` 必须挡住。

**范围外必须 inert**：`applyForEntry()` 从 DSH CLI 入口 realpath 后向上 ≤4 层定位 `@deepseek-ai/dsh/package.json` 读真实版本，`applyForVersion()` 判定超出范围就只打一条 error 日志并返回——不注册路由、不读 profile、不写任何文件。线内未逐条核对的版本继续运行但打 warn（能力探测仍是权威判定）。

这条不是保守习惯，是**写错就救不回来**：本插件整块改写 profile 补丁里的 `config`，写错的后果是目标条目因 `required` 校验失败而加载失败（`fiber.state = 3`），此时 `configEditor` 会拒绝服务（"Configuration plugin is no longer active"），只能手改文件救回来。

**2026-10-01 的真实缺陷**：在此之前上面两段全是空话——`package.json`、`install.sh`、README 都声明了范围与清单，运行时的 `apply()` 却只有一句 `ctx.inject([...])`，从不判定版本。于是本机 DSH 升到 `0.2.0-rc.2` 后它照常注册路由、照常可写 profile，而 9 个兄弟插件里另外 8 个都按版本门退成了 inert。补上后新增 `test/version-gate.test.js`（7 个用例：纯函数判定矩阵、范围外零注册 + error 日志、已核对版本装配与不告警、同线未核对版本告警、入口定位失败 inert、`readDshPackage` 的包根探测与拒绝、常量同源）与 `manifest.test.js` 的四处同源守卫。

**客户端在 inert 下的表现**：宿主没注册路由时 `/dsh-default-tuner/status` 是空 body 的 404，`response.json()` 会抛 `SyntaxError`，页面只剩「读取状态失败：Unexpected end of JSON input」。`client.js` 因此显式识别 404 并给出可读文案，并单独捕获非 JSON 响应——这是「探测不到的能力各自降级，不要让整页 404」的落地。

## 逐版本核对记录

**两条跨轮有效的教训**（不管换到哪条线都成立）：

- **官方默认值是「随时会调」的数据**：跨线时必须重读 `dsh-base/cordis.patch.yml` 与目标条目的 Config schema，别信自己上一轮的记录（`maxOutputTokens` 曾被官方从 64 调到 4096，本插件的提示文案与 README 表格都得跟着改）。
- **`engines.dsh` 是有执法权的字段**：`dsh-app-boot` 的 `evaluatePluginCompatibility()` 以它优先且单方面决定（有它时完全忽略 peerDependencies），不满足时 bundle 进 `skippedBundles`、条目 `disabled`。写错不再是文档问题，而是插件不加载。

逐版本逐包核对记录（`0.1.7-rc.2` 起 4 轮，含两次发布的完整流水账与注入缺陷验证）见 [`docs/compat-log.md`](../docs/compat-log.md)。

**0.2.2 跨线的一条新事实（2026-10-29，M1）**：`dsh-session-title` 把 `titleInput` 投影改成 `Service.init` 里 await 注册并保留 handle，`sessionProjections.stateOf(session, key)` 被标 deprecated（legacy 路径仍保留、0.2.2 隔离宿主实测可用）。本插件 `readTitleInputState()` 仍走旧路径；若未来官方移除 legacy 路径，应改读 `ctx.sessionTitle` 的域服务或自己保存注册 handle。其余契约（`configEditor`、`refresh()`、目标条目字段与默认值）逐项复核后全部成立，业务代码一行未改。

**`0.2.2-rc.1`（2026-11-05，同线例行）**：`dsh-config-editor`、`dsh-session-title`、`dsh-session-title-first-prompt-llm`、`dsh-experimental-session-titles-bundle` 逐字相同；`dsh-base` 只在 `tool-fs` 加 `applyPatch: false`、默认禁用 `fs-observation-policy`，`session-title-llm` 的 5 个默认值未漂移；`dsh-settings.configure()` 只把 owner 归一成 `owner.ctx.fiber`。隔离宿主实测 `/status` 200、`documentPath` 指向 profile 补丁、设置分区渲染、0 控制台报错。

## 为什么不是"把清单存进插件自己的配置"

最初设想的方案是"插件自己的条目存覆盖清单，宿主对账后落盘"。放弃它是因为会出现**两份状态**：清单一份、目标条目在补丁里的覆盖一份，用户手写覆盖后两者必然分叉，恢复默认还要额外记 `managed` 集合。

现在的方案让 **profile 补丁本身成为唯一真相**：页面读 `configEditor.configuration()`（继承层 / 覆盖层 / 生效值），写入直接调 `configEditor.edit()`。没有同步逻辑，也没有第二份状态。

## 机制契约（2026-09-28 隔离探针实测）

| 问题 | 实测结论 |
|---|---|
| 写入形态 | `edit()` 写入的是**完整 config 块**。目标条目在补丁里已存在 → 就地替换 `config` 节点、位置不变；不存在 → 追加到数组末尾。 |
| 能否只写一个字段 | **不能，也不该**。补丁是整块替换：手写部分字段会让目标插件因 `required` 校验失败而**加载失败**（`fiber.state = 3`），此时 `edit()` 直接拒绝服务（"Configuration plugin is no longer active"），只能手改文件救回来。 |
| 注释与 `!!js` | 块**外**的注释、`!!js` 表达式完整保留；`config` 块**内部**的行内注释会随该块被替换而丢失。**一个例外（2026-10-10 实测补记）**：注释被删到**数组变空**时会一起消失——`yaml` 把「注释 + 条目」解析成**注释挂在第一个条目上**（不只是空数组时挂在 `contents.commentBefore`），而 `edit()` 每次都重新解析文件，所以当补丁里**只有这一个条目**时，「恢复默认」（或清除整块覆盖）删掉它就会把顶部注释一起删掉、文件只剩 `[]`。补丁里还有别的条目时注释仍在。这是官方 `configEditor.edit()` + `yaml` 的既有行为（`dsh-config-editor` 与 `yaml@2.9.1` 两版逐字相同，与 DSH 版本无关），插件不自己写文件、无法干预。 |
| 热生效 | 是。`await edit()` 返回时 Loader 已完成 reconcile，`entry.options.config` 同步变成新值。 |
| 恢复默认 | 候选值等于继承层时，`edit()` 会自动删掉该条目的 `config`（只剩 id/name 时连行一起删）。恢复单个字段时**不能整块退回继承层**，否则会顺手抹掉用户手写的其它字段——必须"只把该字段设回继承值"（`planFieldReset`）。 |
| 更高层覆盖 | 该条目被 home patch 或命令行 `--patch` 覆盖时抛 `Configuration for "X" is overridden by a home patch or command-line overlay`，文件不被改动。 |
| 就绪时机 | 等 Loader 用 `ctx.root.loader.await()`；`edit()` 要求目标条目 `fiber.state === 2`，且**每次都要重新从 `entries()` 取 entry**（旧对象会因条目重建而失效）。 |

## 条目被别的 bundle 替换：候选跟随（当前规则）

**机制**：白名单条目可带 `fallbacks: [...]`。`resolveEntry()` / `resolveEntryRow()` 按优先级取第一个可写条目；都不可写时取第一个存在的用于诊断；全不存在走 missing。首选可写时仍用首选——两个 provider 同时在组合里时不会被实验条目抢走。

**改动面**：`describeEntryFields(row, definition)` 必须显式传 definition；回执带 `activeId`（实际写入的条目 id）与 `followed`（是否跟随替代条目）；`applyField`/`resetField`/`resetEntry` 统一走 `resolveWritableEntry()`，不可写抛 `entry-failed`(409)；`readTitleInputLimit` 也用 `resolveEntryRow()`，否则预检读的是被禁用条目的旧上限。

**失效覆盖诊断**：`topLevelPatchEntryIds()` 取补丁顶层 `- id:`（`insert:` 下的缩进条目与注释不算）；`staleOverrideIds(text, liveIds)` 找顶层有、组合里没有的条目（去重、保序）。只读展示，不替用户删除；诊断范围仅 `configEditor.documentPath` 那份补丁。

**验证与历史证据**：见 `docs/compat-log.md` 的 M1 / J 轮次；守卫测试在 `test/overrides.test.js`（候选列表、`resolveEntry` 四种分支、`followed`/`activeId`、全不可写、全不存在、stale overrides、注入缺陷）。

## HTTP 契约

两个同源端点，路径常量在 `lib/overrides.js`：

- `GET /dsh-default-tuner/status` → `{ ok, available, csrfToken, documentPath, groups, entries, advanced, staleOverrides, totalEntries, managedEntries, sessions, sessionsAvailable, sessionsReason, sessionsTotal, sessionsNeedRetitle }`
  - `staleOverrides` = 补丁顶层有、当前组合里没有的条目（`[{ id }]`，只读诊断，见「条目被别的 bundle 替换：候选跟随（当前规则）」的失效覆盖诊断）。
  - `entries[].id` 是**白名单的逻辑 id**（页面展示与 action 提交都用它）；`entries[].activeId` 是这次读写实际落到的条目 id（首选不可用时是替代条目），`followed: true` 表示已跟随替代条目。
  - `entries[].fields[]` 每项给 `default`（继承层）、`override`（补丁覆盖）、`effective`（生效值）；`undefined` 的键在 JSON 里会被省略，客户端按缺键处理。
  - `entries[].availability` = `{ writable, reason: active|missing|inactive|failed, message }`。
  - `sessions[]` **只列需要重算标题的活跃会话**：`{ id, shortId, cwd, title, sourceKind, sourceLabel, overwritesManual, updatedAt, inputBytes, inputLimit, overLimit, suggestedLimit }`，按最近活动排序、最多 20 行；`sessionsTotal` / `sessionsNeedRetitle` / `sessionsOverLimit` 是完整口径（活跃总数 / 需要重算数 / 其中首条消息已超限数），页面用它解释"为什么只看到这些"。标题快照只存在于内存，所以列不出没打开的会话。
  - `inputBytes` 是**按官方口径预检**出来的"标题模型输入字节数"（`titleInput` 投影取首条用户消息 → `TITLE_INPUT_PREFIX + JSON.stringify([{seq,text}])`，逐字对齐官方 `frameMessages()`）；`overLimit` 为真时 `suggestedLimit` 给出"调到够用"的建议值（向上取整到 1 KB）。上限拿不到（条目缺失）时 `overLimit` 恒为 false——宁可不提示，也不要把能重算的会话误标成超限。
  - **口径实测**：拿线上那条真实报错会话来核对，预检 4697 字节与 provider 报的 `input is 4697 bytes` 完全一致（注意 JSON 必须用 JS 的紧凑分隔符；Python 侧用 `separators=(',', ':')` 复刻，带空格会多算 3 字节）。
- `POST /dsh-default-tuner/action` → `{ action: 'apply', entryId, path, value }` / `{ action: 'reset', entryId, path }` / `{ action: 'reset-entry', entryId }` / `{ action: 'retitle', sessionId }`，成功回执带最新的 `entries`、`advanced`、`sessions` 与两个统计字段。

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

守卫分两级：**status 只校验请求来源**（`clientRequestRejection`：连接层认证 + 同源 + `x-dsh-default-tuner-client: 1`），因为 CSRF 令牌正是它下发的；**action 追加令牌比对**（`x-dsh-default-tuner-csrf`，令牌取自 status 响应）。这个不对称是必需的——最初把两级写在一起，导致页面第一次请求就拿不到令牌（403），只能在浏览器里才暴露。

错误码：`invalid-value` / `entry-missing` / `entry-not-managed` / `higher-layer-override` / `entry-failed` / `entry-unavailable` / `session-not-live` / `retitle-unavailable` / `retitle-failed` / `title-input-over-limit` / `csrf-rejected` / `request-rejected` / `editor-missing`。

会话标题重算走官方 `ctx.sessionTitle.refresh(session)`：它要求 `sessions.get(id) === session`（必须是这个进程里的 live 会话），成功后 append 新的 `session/title`（source: provider）。官方 UI 一直没有暴露这个能力，这里补的是入口，不是新机制。

## 设置页 UI 结构（2026-09-28 改造）

- 面板自上而下：**面板标题「默认设置覆盖」** → 一句说明 → 当前 profile 补丁路径 → 操作提示条 → 每个白名单条目一个模块 → 会话标题重算模块 → 高级模式。
- **没有分组层**：早期版本有「会话标题」分组标题与描述，会让整块面板看起来只服务一个功能，已删除（`GROUPS` 常量、`entries[].group` 字段、`status.groups` 一并移除）。
- **模块默认收起**：`open` 状态存在组件里、未设置的 key 即收起；收起时只显示标题与右侧状态标签，展开才渲染字段与说明。长面板因此不会一屏铺开。
- **状态类文案一律用 Tag**（`.ddt-tag` + accent/muted/warn/error 四档）：模块级的 `默认值` / `已覆盖 N 项` / `条目不存在` / `暂时不可写` / `N 条待重算`，字段级的 `已覆盖` / `随整块写入`，会话行的 `兜底截断`。
- 高级模式每行都要有 Tag，且标签要说明**用户能做什么**而不是内部术语：白名单条目 → `可在上方调整`（有对应模块、覆盖能逐字段改），其它条目 → `只能整块清除`。早先这里只给白名单行贴一个「白名单」、其它行没有标签，用户第一反应是"这是什么意思？前面没有这个啊"——只描述系统内部状态、还时有时无的标签，等于没写。
- **长文本 + 按钮同排时必须约束收缩**：`.ddt-item-text { flex: 1 1 auto; min-width: 0 }` 让文本先换行，`.ddt-button { flex: none; white-space: nowrap }` 让按钮保持单行。只做前者不做后者，按钮会被压成两行（截图中「清除覆盖」曾变成「清除覆/盖」）。
- **界面控件一律取官方 `@deepseek-ai/dsh-client-ui-primitives`，不自绘**（工作区根 `AGENTS.md`「双面插件」「Slot 系统」两节的既有实践，`dsh-extra-context` 是范例）：
  - 折叠箭头 = `IconTriangleRightFill*` 图标（通过 `exportOf(...)` 按能力探测导出名，兼容命名法变更），容器 `.ddt-chevron` 在 `details[open]` 时 `rotate(90deg)`；
  - 状态标签 = 官方 `Tag`（`tone` 映射：accent→info、muted→neutral、warn→warning、error→danger），悬停说明挂在外层 span 上（官方 Tag 只收 tone/className/children）；
  - 按钮 = 官方 `Button`（`variant: primary|outline`、`size: 'sm'`，实测 28px），输入框 = 官方 `Input`（外层自带 wrap span）；
  - 本地 CSS 只留布局约束（宽度、`flex: none`、`nowrap`），外观一律交给官方组件，避免"尺寸/配色/过渡必然与壳层不一致"。
  - **踩坑三轮**：①自绘 `▸` 字符 + CSS 旋转（和官方图标显然不是一套，原生 details 还没 hover）；②改成浏览器原生 marker（与 DSH 自带图标又不一致）；③关掉 marker 换官方图标时，**只处理了走 `Module` 的模块，漏掉手写的 `<details>`，高级模式整行没了箭头**。根因都是没先复用官方组件 + 折叠出口不唯一。
  - 因此折叠结构**只有一个出口**（`Module` 组件），高级模式也走它；`test/manifest.test.js` 断言 `React.createElement('details'` 全文件只出现一次，再有手写就会当场失败。
- 折叠结构保留原生 `<details>` / `<summary>`（键盘与无障碍免费），只关掉浏览器 marker：`list-style: none` + `::-webkit-details-marker { display: none }` + `::marker { content: '' }`；hover 背景写在 `.ddt-module > summary:hover`。
- `<details>` 不传受控 `open`：展开状态由浏览器持有，React 重渲染（例如 apply 后刷新数据）不会把用户展开的模块收回去。
- `package.json#dsh.client.inject` 必须声明 `@deepseek-ai/dsh-client-ui-primitives`；`test/manifest.test.js` 里有回归守卫（断言 require 了 primitives、用了官方图标与控件、且不再出现 `React.createElement('button'/'input')` 与自绘三角字符）。

## 加一项可覆盖的默认值

只改 `lib/overrides.js` 的 `ENTRIES`：加条目 id、字段名、label、单位、下限、提示语。两端校验与页面渲染都由这份白名单驱动，客户端不用动。

约束：字段必须是**顶层字段**，且目标条目的 Config schema 要求这些字段（否则整块写入会因缺 required 项而让目标插件加载失败）。加字段前先用 `dsh --profile web --dump-config` 确认该条目的默认值与字段名。

## 验证判据

发布闸门 `npm run publish:check`（= `check` + `test` + `pack:check`，`prepublishOnly` 与 `install.sh` 都跑它）；`scripts/check-pack.js` 断言发布物恰好 8 个文件，`scripts/` 不随发布物出去。

**守卫必须能变红**——四处同源与版本门的断言，按下面七处注入缺陷后各自必须失败（这是判据，不是历史）：①`classifyDshVersion` 恒真；②lib 的 `VERIFIED_DSH_VERSIONS` 改掉；③`install.sh` 的 `DSH_VERIFIED_VERSIONS` 改掉；④`DSH_RELEASE_FLOOR_SEQUENCE` 改掉；⑤`install.sh` 的 range 上界改掉；⑥本文兼容段改掉；⑦`README.md` 兼容段改掉。⑥⑦要按行解析「兼容线」/「逐版本验证」那一行并核对 range + 清单——只断言「版本号在全文任意处出现」会因清单版本号恰是 range 下界子串而漏判。

**隔离验证的四条判别码**：路由侧未认证 401 / 认证 200 / 门外 404（与随机路径同码）；`globalThis.__DSH_BOOT__` 里本插件出现 4 处（id/url/rev/inject）；`dsh --profile web --dump-config` 独立核对写入值与生效值；reset 后补丁文件与写入前逐字节一致。

**无头环境造不出、需真机补验的两条**：标题兜底 `fallback` 会话进重算列表——composer 是自定义 contenteditable，`execCommand("insertText")` 与 CDP `Input.insertText` 都不被接受，探针直写 `session.append("user/message", …)` 也被 surface 契约拦下；模型成功命名同理（无凭证）。两条由 `selectRetitleCandidates` / `summarizeSessions` 的单测覆盖。

逐轮实测数据（`0.1.7-rc.2` 起 4 轮，含两次发布的三件判据与七处注入验证的实测结果）见 [`docs/compat-log.md`](../docs/compat-log.md)。

### 「随整块写入」标记从哪来

补丁整块替换，所以应用一个字段会把该条目的全部字段一起写进补丁。`describeEntryFields` 用 `frozenSameAsDefault`（override 存在且等于继承值）把"用户改过的"与"只是被一起写进去的"分开，客户端据此显示「已覆盖 / 随整块写入」。恢复某个字段时，若整块恰好等于继承层，configEditor 会删掉整个 `config`——这就是"解除冻结"的路径。

## 待办

- ~~发版前必须先改名~~ → **2026-10-08 已改名**：旧名 `dsh-default-overrides` 在 npm registry 上被第三方占用（当时是 0.3.6、维护者 `chenwei116057`、描述 "Configurable Bash and PowerShell overrides for the DSH standard preset"，与本插件无关），新名 `dsh-default-tuner` 同日实测未被占用。改名同步了 `package.json#name`、`cordis.patch.yml` 的行 id/name、客户端 bundle 注册名、`lib/overrides.js` 的 `PLUGIN_NAME` / `SECTION_ID` / 两条 HTTP 路由 / 两个固定头名，以及内部短前缀（CSS 类名 `ddo-*` → `ddt-*`）；**功能一行未改**。~~发版前仍要配 trusted publisher~~ → **2026-10-10 已配好并完成首发**（见「逐版本核对记录」的发布段；首发的三步做法也在那里）。
- ~~registry 上残留的占位版本 `0.0.1`~~ → 可选清理：`npm unpublish dsh-default-tuner@0.0.1`（72 小时窗口内可撤；留着也无害，`latest` 已指向正式版）。
- 白名单扩展（压缩阈值、subagent 并发、Web 搜索等），按同一张表加。
- 高级模式目前只支持"清除整块覆盖"；若以后要支持任意字段编辑，需要先解决"非白名单字段写坏组合"的风险（二次确认 + 组合校验 + 一键回滚）。
