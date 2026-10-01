# 插件兼容性检查 — 历史与证据

> 本文件是**历史档案**，不是指令。根 `AGENTS.md` 只保留「怎么做」（分级判据、固定动作、汇报格式、当前归属），每一轮的**结论、证据、踩坑**记在这里。
> 需要回顾某一轮做了什么、为什么这么判断、哪些结论已经被实测证伪时读它；执行一次例行的「检查插件的兼容性」**不需要**读它。
> 记录按时间倒序。新的一轮写完后，请只把**跨轮有效的规则**提炼进根 `AGENTS.md`，其余留在本文件。

## 目录

| 轮次 | 版本 | 结论 |
|---|---|---|
| B2（2026-10-01） | `0.2.0-rc.2` | L2 两个插件跨线完成：契约逐行有证据、隔离宿主端到端跑通 |
| B1（2026-10-01） | `0.2.0-rc.2` | L1 两个插件跨线完成，已实机验证 |
| A1–A3（2026-10-01） | `0.1.7-rc.2 → 0.2.0-rc.2` | 只做侦察 + 补一个缺失的版本门 |
| 例行（2026-09-28） | `0.1.7-alpha.2 → 0.1.7-rc.2` | L1 两个插件推进；L2/L3 交接 |

---

## B2：L2 跨线 `dsh-auto-load-history` + `dsh-local-plugin-manager`（2026-10-01）

两个插件从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。

**为什么按 L2 而不是升成 L3**：A1–A3 的启发式「L2 命中它依赖的包就升 L3」只是"你还没看过"的替代品——`dsh-auto-load-history` 的契约包 `dsh-api-session-controller` 确实变了，但本轮把 `loadThrough`/`loadOlder`/`SessionSnapshot` 三处逐个在安装包里读了一遍，改动全在「失败步骤的工具结果恢复」等与分页无关的地方，**上下文逐字相同**，所以 L2 成立、两个插件同一轮做完。

### 逐项复核（读的是实际安装包，不是 CHANGELOG）

`dsh-auto-load-history` 契约表 10 行全部成立。行号在 0.2.0-rc.2 上普遍位移，文档已按新行号订正：`session.d.ts:127`（`loadOlder`）/`:140`（`loadThrough`）、`session.js:313`/`:338`/`:392`、`snapshot.d.ts:68-72`、`service.d.ts:76-83`、conversation 的 slot 声明 `:18268` 与渲染 `:16502`、`[data-conversation-scroll]` 在 `:16338`、客户端按钮条件 `hasMore && …` 在 `ui-chat:5271`、服务端 `paginate` 的 `cut > 0` 在 `history.js:425`（0.1.7 时是 `:445`）。renderer 的 `bindInjectSources`（`:424`）与 `locale` 座位（`:724`）逐字未变。

`dsh-local-plugin-manager` 契约表 7 项全部成立：`dsh-plugin-manager`/`dsh-atomic-write`/`dsh-hmr` 与 0.1.7-rc.2 逐字相同（只有 `version` 变），`dsh-app-boot` 只多了 `OPTIONAL_BUNDLES` 里的一项。锁路径/mode/`waitMs`、`writePluginEnabled` 的四条覆盖项语义、`include:<rowId>`（含 `EntryTree.sep === ':'`）、hmr 的 `reconcileProfilePatches`、`settings.section`/`settings.action` 的声明、`requestRejection`、`webServer.register` 全部逐字或语义等价；peerDependencies 预检仍在但不门禁本包（本工作区插件都没声明它）。

### 两个新事实（都是"文档写错了"而不是"DSH 变了"）

- **`settings.general.item` 的内置 order 上限已经不是 20**：0.2.0-rc.2 上是 `settings-session-log` 90、`current-version` 100（此外 `link-opening` 17、`performance-usage` 30、`shortcuts` 16）。`dsh-auto-load-history` 的 `order: 110` 仍排在全部内置项之后，**无并列冲突**——但插件 AGENTS.md 里那句「内置行最大是 composer-enter 20」已作废，已订正。`settings.section` 的内置上限**仍是 20**（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），所以 `dsh-local-plugin-manager` 的 100 不受影响。
- `settings.section` 的注册选项仍无 `icon`，壳层 `navIcon(id)` 白名单是 account/models/agent-presets/plugins/archived-sessions——DOM 补丁依旧必要。

### 版本门从常量派生（照抄 B1 的 `dsh-extra-context`）

lib 侧 `DSH_RELEASE_LINE='0.2.0'` + `DSH_RELEASE_FLOOR={channel:'rc',sequence:2}` + `PRERELEASE_CHANNELS`，`install.sh` 有一份等价的 shell 版（含 `prerelease_rank()`）。下界是 rc 时，同线内的 alpha/beta/更低 rc 必须靠 channel 优先级比较挡住——旧的 `channel !== 'alpha' || seq >= 1` 写法会把 `0.2.0-alpha.9` 判成兼容。两个插件的 `test/manifest.test.js` 各新增一条守卫：把 range 反推回发布线与下界、并核对 `install.sh` 的五个常量。`dsh-local-plugin-manager` 的运行时依赖 `@deepseek-ai/dsh-atomic-write` 同时由 `~0.1.7-alpha.1` 升到 `~0.2.0-rc.2`（两版逐字相同，升它只是让写锁与宿主用同一条线的实现）。

### 隔离宿主实机（`DSH_HOME=/tmp/dsh-020-home`、端口 5911、headless Chrome 153/CDP 9344；用户的 3080 全程未触碰，验证后按 `lsof -nP -iTCP:<端口> -sTCP:LISTEN -t` 拿 PID 停止）

`dsh-auto-load-history`（脚本在 `/tmp/dsh-alh-020/`，非发布物）：

| 判据 | 结果 |
|---|---|
| 补齐到 `hasMore === false` | 大会话 `f8e6ec6b` 5 批（+4514 / +6035 / +19446 / +28264 / +13334 px）→ 4350 行 / 71704px，顶部按钮消失 |
| 反向对照（偏好 `false`） | 停在 200 行 / 5307px，按钮常驻 27.6 秒 |
| 锚点零漂移 | 只钉一次视口：同一 `data-chat-anchor-key` 行停留 2524 帧、top 恒 −226（跨度 0、相邻帧位移 0） |
| defer 让位 | 4 秒 `wheel` 突发（19 次）窗口内 **0 批**，停手后 **1470ms** 恢复 |
| 会话切换 A→B→A | `920768ca`（250 行）↔ 切回 A 重新分页到 4350 行 |
| 视图切换 | Chat ↔ Trajectory：slot 全程 4167 帧不重挂，切回后 4350 行保持 |
| console | 本插件 0 个 error/warning/exception |

`dsh-local-plugin-manager`：`npm run verify` **45 项全过**；`npm run gui:check` **20 项全过**；「与官方插件管理并存」双向往返——管理器禁用 → 官方详情页读到 `aria-checked=false` → 官方就地启用 → patch 里**同一条覆盖项**被改写为 `disabled: false`（条目数恒为 1）→ 管理器再读为已启用，反向亦然；运行态用 boot graph 判据：禁用后该包的 client bundle 消失、重新启用后回来。

### 踩坑与可复用技巧

- **隔离 `DSH_HOME` 不能直接 `cp -a` 用户 profile**：profile 的 `node_modules/<包名>` 是**相对**符号链接（`../../../../Documents/dsh-plugins/<包名>`），复制到 `/tmp` 后全部解析失败，宿主启动时把 9 个 link 插件逐个 skip 掉。修法是在隔离 profile 的 `node_modules/` 里把这些链接重建为绝对路径（或改用官方 `dsh plugin add link:`）。症状很好认：启动日志里一串 `skipping profile bundle ... cannot resolve`。
- **官方插件页的行级开关必须"进详情"才能点**：同一页里 `aria-label="启用 <包名>"`（列表上的 **bundle 选择**，`setBundleEnabled`）与 `aria-label="启用组件 <包名>"`（详情里的行级 `setPluginEnabled`）会同时存在，按前者定位会点到错的那个。
- **侧边栏的 workspace 行是 toggle**：点一次展开该 workspace 的会话列表、再点一次折叠。脚本里"先无脑点一次 workspace"会在列表已展开时把它折叠掉，于是"找不到会话行"。要先判断目标行是否已可见，再决定点不点。
- **`gui-check.mjs` 的一条断言在多插件环境里必然失败**：「本分区排在 DSH 自带项之后」原写成 `indexOf === length - 1`（要求它是**最后一行**），而别的插件同样贡献 ≥100 的 `settings.section`（extra-context 100、default-overrides/mcp-manager 110、chat-archive-manager 120）。已改为按内置 label 白名单定位最后一个自带项再比较——**断言要度量契约，别度量环境巧合**。
- **锚点漂移的两种测法要分清**：只钉一次视口（读者不干预）时 top 恒定、跨度 0；若每帧强推 `scrollTop`（defer 场景必须这样做，否则插件按 fail-open 继续补齐），同一锚点行的 top 会在 17px 内摆动——那是「插件补偿」与「外部每帧重新定位」的合成结果，不是补偿漂移。写断言前先确认自己测的是哪一种。
- **`npm test` 偶发一项失败**：本轮有 1 次在与另一个 npm 任务并行、CPU 繁忙时出现 1 项失败，随后串行连跑 8 次（含 5 次完整 `publish:check`）全绿。`test/client.test.js` 用真实定时器（`BATCH_GAP_MS=32`、`READER_IDLE_MS=1000`），高负载下的时序敏感是可疑点；没有复现证据，先记为观察项。

### 仍未覆盖

- 两个插件的主观流畅度与真实输入手感（滚轮/触控板连续滚动、真机触控）——按各自 README/AGENTS.md 的 GUI 验证清单请用户在 3080 上看一眼。
- `dsh-local-plugin-manager` 的**卸载**路径（真机 `dsh plugin remove` + 墓碑清理）本轮没跑：它会在隔离 profile 里真删依赖，属于可破坏操作，留待需要时单独做。
- 0.2.0 **正式版**尚未发布，本轮的下界 `0.2.0-rc.2` 是线内最低已核对版本；正式版发布后按判据它在门内、但会打「未逐版本验证」的警告，届时把清单加一个版本即可。

---

## B1：L1 跨线 `dsh-extra-context` + `dsh-default-workspace`（2026-10-01）

两个插件从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**。

**静态逐项复核结论**：契约面**全部保持**——`dsh-system-prompt`/`dsh-settings`/`cordis-plugin-loader`/`schemastery`/`dsh-workspace`/`dsh-client-ui-slots`/`dsh-client-ui-settings` 逐字相同；`dsh-agent-loop`/`dsh-session` 只改了失败步骤的工具结果恢复（`renderPrompt`/`assertSystemHeadRewrite`/`applySurfacePlan` 上下文逐字相同）；`dsh-client-ui-workspace` 的 11 处 hunk 全在会话改名/分叉/快捷键/未命名标题；`dsh-api-workspace-controller` 只给 Documents 目录探测的 shell 调用加了 `"hidden"` 参数。因此**两个插件的业务代码一字未改**，改动只有版本门本身。

**实机验证**（隔离 `DSH_HOME=/tmp/dsh-b1-home`、独立端口、验证后停止，全程未碰用户的 3080）：两个插件的 `/dsh-…/status` 都返回 200（`writable:true` 证明 `Config` schema 装载成功；受管 Workspace 路径与标题正确）→ 写探针分段触发 profile 热重载 → `rendered` 字段给出完整注入口径 → `dsh headless` 发出的真实请求里 system prompt 带着探针文本；两个 client bundle 都进了页面启动图。

**未覆盖**：设置页与侧边栏按钮的目视确认（导航图标补丁已由 `verify-nav-icon.js` 离线量过六项全过）；受管 Workspace 的改名/删除保护与独立入口按钮的实机点击（`headless` profile 没有 workspace 服务，插件在那里按设计保持 pending）；压缩摘要补充指令在 0.2.0 上的真实路由 A/B。

### 可复用技巧（跨轮有效）

- **`range` 的下界可以是 prerelease**：`>=0.2.0-rc.2 <0.2.1` 的语义就是「同线内 `>= 0.2.0-rc.2` 且 `< 0.2.1`」，所以 `rc.1`/`beta.*`/`alpha.*` 全在门外，而 `0.2.0` 正式版在门内。旧的写法 `channel !== 'alpha' || seq >= N` 只能表达「下界是 alpha」，下界换成 rc 时必须改成 channel 优先级比较（实现见两个插件的 `lib/index.js`：`DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`，`install.sh` 里有一份等价的 shell 版）。
- **隔离宿主启动要指定 profile**：`dsh headless "<任务>"` 引导的是 `headless` profile，**不是** `web`。把插件与探针配在 `web` 上再跑 `headless`，得到的「探针没进 prompt、`baseURL` 不生效」全是**假阴性**。要在 CLI 里跑真实会话，就把插件装进对应的那个 profile。
- **抓真实模型请求的方法**：给 profile patch 写 `- id: llm-deepseek` + `config: { baseURL: http://127.0.0.1:<port> }`，起一个记录请求体的桩 HTTP 服务，然后 `DEEPSEEK_API_KEY=dummy DSH_HOME=<隔离> dsh headless "<探针>"`。请求是 Anthropic 风格的 `POST /v1/messages`（system prompt 在顶层 `system` 字段），桩服务不必返回正确格式——请求体已经拿到了。
- **验证「插件是否 inert」不用起宿主**：直接调用插件自己导出的 `classifyDshVersion('<版本>')`。旁证是运行中 Host 的 `/dsh-<插件>/status`：门内注册路由的返回 401、路由只在兼容分支注册的返回 404。

---

## A1–A3：`0.1.7-rc.2 → 0.2.0-rc.2` 侦察轮（2026-10-01）

用户升级 DSH 到 `0.2.0-rc.2` 后说「检查插件的兼容性」。固定动作走完第 1–4 步，第 5 步**故意停住**：`0.2.0` 已跨出全部 9 个插件的声明范围，第 1 条明写「范围外不要动」，所以本轮**没有扩大任何范围**。

**版本关系**：运行 `0.2.0-rc.2` / 上一验证版本 `0.1.7-rc.2` / 工作区线当时是 `>=0.1.7-alpha.1 <0.1.8`。**8 个插件按版本门保持 inert**（用各自导出的 `classifyDshVersion('0.2.0-rc.2')` 逐个实调 + 运行中 Host 的状态路由旁证）；第 9 个 `dsh-default-overrides` 当时**根本没有运行时门**，是唯一在未核对地基上照常运行的插件——该缺陷已同日补上（见其 `AGENTS.md`）。

**逐包 diff**（`npm install @deepseek-ai/dsh@0.1.7-rc.2` 到临时目录，与运行安装全树逐文件 sha256 比对）：共同包 283 个，0.2.0 新增 5 个（`dsh-otel`、`dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`、`dsh-experimental-schedule-bundle`、`dsh-client-ui-settings-session-log`）；文件级逐字相同 4638 / 变化 681 / 新增 35 / 移除 88；**72 个包有运行时 JS 变化**。

**逐字相同的契约包**（只有 `version` 字段变）：`dsh-client-ui-slots`、`dsh-client-store`、`dsh-client-ui-settings`、`dsh-settings`、`dsh-system-prompt`、`dsh-plugin-manager`、`dsh-atomic-write`、`dsh-hmr`、`dsh-client-modules`、`dsh-client-hmr`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-mcp-client`、`dsh-credentials`、`dsh-session-persistence`、`dsh-storage-domain`、`dsh-agent`、`dsh-compaction-basic`、`dsh-workspace`、`dsh-tools`。

**真的动了、且插件依赖的**只有四处，及其结论：

| 包 | 改动 | 对插件的影响 |
|---|---|---|
| `dsh-config-editor/lib/index.js` | `configuration()` 由「每条目重新全量合成」改成「一次合成 + 记忆化」，并加了 `overridden` 分支 | **已证伪为等价重构**（见下）。`dsh-extra-context`/`dsh-default-overrides`/`dsh-local-plugin-manager` 不受影响 |
| `dsh-app-boot/lib/index.js` | 只给 `OPTIONAL_BUNDLES` 追加 `@deepseek-ai/dsh-experimental-schedule-bundle` | 插件兼容预检逻辑**一行未改**，`dsh-local-plugin-manager` 不受影响 |
| `dsh-session` + `dsh-agent-loop` | 失败步骤的工具结果恢复重写（新增 `ToolCallRecovery`，所有权从 scheduler 交给 owning step） | `renderPrompt`、`assertSystemHeadRewrite`、`applySurfacePlan`、全部 `system/message` 处理点上下文逐字相同 |
| 各 `dsh-client-ui-*` 打包产物 | 随版本重建 | 逐个标记探针：所有插件关注的 DOM 标记在**全部出现位置**上上下文逐字相同；dockkit 那组在 `dsh-web-frontend` 里因压缩改名上下文不同，但出现次数完全一致 |

**`configuration()` 等价重构的证明**：用一个合成 profile（假 bundle 层 + 用户补丁层，覆盖「有 config 的用户行 / 只有 disabled 的行 / 完全没有用户行 / 同 id 两行 / insert 进来的行 / 从未碰过的行 / 空 config 对象 / group 行」8 个场景）直接调用两个版本真实的 `ConfigEditor.prototype.configuration()`，输出逐字相同。可证明：id 在 `overridden` 里时两边都走 `inherited()`；不在时配置剥离是空操作，两边都等于 `flatten(composeEntries(...)).find(id).config`。真实动机是把 O(n) 次全量合成降成一次。

**同轮新增的两个事实**：

- `dsh-client-ui-settings-general` 的 `navIcon` 白名单函数与 0.1.7-rc.2 **逐字相同**；`settings.section` 内置 order 未变（上限仍 20），但 `settings.general.item` 重排了并新增一条 90——插件侧全部 ≥100，**无并列冲突**。
- 客户端 DOM 标记存活清单：`data-conversation-scroll`、`data-composer-seat`、`data-dockkit-strip(-chrome)`、`data-dockkit-tab-close`、`data-shell-overlay`、`data-sidebar-right-expand`/`-toggle`。符号探针仍命中的清单见下（含 `requestRejection`、`loadThrough`、`loadOlder`、`SessionSnapshot`、`AgentRegistry`、`detachEntered`、`setBundleEnabled`、`writePluginEnabled`、`commitVolatile`）。

**离线网**：9 个插件 `npm test` 共 438 项全过；`tools/dsh-icons` 在 0.2.0 上**没有坏**（188 个图标无漂移），只是快照元数据与 `usedBy` 归属随版本更新（已重跑 `build.js`，`icons.json`/`preview.html` 因此有改动）；4 个带导航图标补丁的插件六项几何全过。

---

## 例行：`0.1.7-alpha.2 → 0.1.7-rc.2`（2026-09-28）

rc.2 是**全仓版本提升**（72 个组件改版本号，新增 `@deepseek-ai/dsh-experimental-auto-review`）。插件真正依赖的面里，`dsh-settings`、`dsh-config-editor`、`dsh-system-prompt`、`dsh-llm`、`dsh-compaction-basic`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-client-store`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-mcp-client`、`dsh-credentials`、`dsh-session-persistence`、`dsh-storage-domain`、`dsh-session-format*` 逐字相同。

**rc.2 带来的两个机制**（跨轮有效）：

- `dsh-app-boot` 自带**插件兼容预检**：读 bundle 的 `peerDependencies`（`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`），不满足就**在 profile 装配时抛错**，除非 profile 目录下的 `compatibility.json` 里有精确版本豁免（`dsh plugin allow-version`）。本工作区插件**都没声明 `peerDependencies`**，所以不受它门禁；将来要接入先读 `dsh-app-boot/lib/types/plugin-compatibility.d.ts` 与 `profile-compatibility.d.ts`。
- `dsh-base/cordis.patch.yml` 把 `llm-deepseek` 换成 `llm-deepseek-api-key` 并新增 `llm-deepseek-account` 行（部署组成变化，与插件无关）。

**本轮结果**：图标集无删名（188 个），4 个带导航图标补丁的插件六项几何全过；修复 `tools/dsh-icons` 两个缺陷（见该工具 README）；L1 两个插件把 `0.1.7-rc.2` 加入验证清单，`publish:check` 全过。

**其余插件的处置**：

- `dsh-auto-load-history`：`0.1.7-rc.2` 上隔离宿主 + 无头 Chromium 半离线回归全过（补齐到 `hasMore === false`、锚点零漂移、defer 生效、会话/视图切换无报错），代码无需适配，仅把版本加入四处清单并订正文档里的页大小描述（rc.2 已把 `loadOlder`/`loadThrough` 的固定 50/200 改成 turn 对齐区间）。
- `dsh-local-plugin-manager`：rc.2 的 `dsh-atomic-write`/`dsh-plugin-manager`/`dsh-app-boot` 改动逐项核对后**无需适配**（写锁路径/mode/waitMs 未变、`writePluginEnabled` 四条语义全在、`include:<rowId>` 仍成立、`settings.section` 内置 order 上限仍是 20）；隔离宿主上 `npm run verify`（44）与 `npm run gui:check`（21）全过，并额外跑通「与官方插件管理并存」的真 GUI 双向往返。**两条跨轮有效的结论**：热重载的真源是 `dsh-hmr` 的 profile 配置监听，**不是** profile 里的 `patchReload` 字段（写入后约 3 秒生效）；官方插件页列表上的「启用 <包名>」开关是 bundle 选择（`setBundleEnabled`），行级启停要点进「查看 <包名>」详情页用「启用组件 <包名>」。
- `dsh-sticky-user-bubble`：chat/conversation/layout/primitives 改动逐项核对后**无需适配**——行标记齐全（user 行三键同值、`groupPart` 只在 assistant-step 拆分行上）、`[data-conversation-scroll]` 仍是 scrollport 且内层 padding 仍 16px、`[data-composer-seat]` 仍是直接子元素且 sticky、overlay 层与 `retainedBy.mainView` 未变；唯一新事实是 `.EvIC1a_root` 多了 `overflow:visible clip`（实测不改变绘制边界）。隔离宿主 + 无头 Chrome 量到：出现阈值 = scrollport clip 边 76（不是阅读线 92）、让位清距恒 16px 且 `clip-path = inset(push − 16)`、三行折叠 = 3×22 + 20 = 86px、展开上限随下一张卡收到 `incomingTop − 16`、展开不越过 composer seat（685）。
- **本轮仍未实机验证**（交接给后续 L2/L3 会话）：`dsh-default-workspace` 的受管 Workspace 行为（B1 已补）、`dsh-chat-archive-manager` 的删除事务、`dsh-mcp-manager` 的 GUI 验收。
