# dsh-chat-archive-manager 技术说明

## 边界

负责“设置”弹窗内的“归档管理”页面 UI、按工作区分组浏览、批量归档、恢复与永久删除，不创建归档专用 Workspace，也不添加侧边栏一级入口。不得修改 DSH 源码、profile 用户 patch、其他 Workspace 的业务数据或已安装的 `@deepseek-ai/*` 包。

### 兼容发布线（工作区规则）

兼容发布线 `>=0.2.1-alpha.2 <0.2.2`：**一个插件版本只服务它逐包核对过契约的那一条 DSH 发布线**，不为同一个版本维护跨线实现，也不把版本号当"能力开关"：

- 范围外（`0.2.0` 一线与 `0.2.2` 起，含 `0.2.2` 的 prerelease）保持 **inert**：不注册路由、不碰 registry、不做 legacy 迁移；`install.sh` 同样拒绝安装。上一线用户应留在上一线的插件版本。
- 线内后续 prerelease（`0.2.1-alpha.|beta.|rc.N` 里够到或高于 `alpha.2` 的那些，以及 `0.2.1` 正式版）带警告运行，能力探测仍是权威判定：探测不到的能力各自 fail closed（501/503）并在页面上写明原因，其余功能照常——**绝不因为版本号让整页 404**。
- 支持新版本 DSH 的正确做法：重新读源码核对契约差异 → 补适配与回归测试 → 同步四处同源声明（`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 的 `DSH_COMPATIBILITY_RANGE`/`DSH_VERIFIED_VERSIONS`、本文档）→ 发新版本。`test/manifest.test.js`、`test/install.test.js`、`test/host.test.js` 有同源与范围断言守卫。
- 运行时的版本分类（`classifyDshVersion`）与 `install.sh` 的 `is_compatible_dsh_version()` 语义逐字对应，且都从**发布线 + 下界**派生：`lib/index.js` 是 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`，`install.sh` 是同样的常量加一份 `prerelease_rank()`。`0.2.1` 与 `0.2.1-{alpha,beta,rc}.N` 里够到或高于 `alpha.2` 的版本在范围内，其余不在。status 里回传 `dshVersion`/`dshVersionVerified` 供页面提示。
  **下界不是 alpha 时不能沿用旧的写法**：`channel !== 'alpha' || seq >= 1` 会把 `0.2.0-alpha.9`/`0.2.0-beta.9`/`0.2.0-rc.1` 全判成兼容，必须做 channel 优先级比较。反过来**下界是 alpha 时同样不能把下界写进正则**：`0.2.1-alpha.0`/`0.2.1-alpha.1` 低于 `alpha.2` 必须被挡住，而同线内的 `beta`/`rc`（如 `0.2.1-rc.1`）都高于 alpha 下界、必须在门内——只有"发布线 + `{channel, sequence}` 下界"这一组常量能同时表达这两边。

### DSH `0.1.7-alpha.1` 契约差异（2026-09-22 逐包核对，`verifiedVersions` 已含该版本）

- **会话格式 v3 → v4**：`SESSION_FORMAT_VERSION = 4`（`dsh-session/lib/types/types.js:54`）、`dsh-session-format-catalog/lib/types/generated.js:14` 的 `currentVersion: 4`；`locate()` 仍 generation-blind，迁移后**保留**源文件（本机实测 4 个目录 v3+v4 并存）。
- **Workspace state 新增 `pinnedSessionIds`**（默认 `[]`）与 `defaultWorkspaceId`（可选），domain version 仍是 2；`WorkspaceRegistry` 另新增 `archiveSession(id, {stopActivity})` 与 `workspace/session-activity` 水线（本插件不用，但归档与 pin 因此互斥）。
- **`generationFormat` 去掉 `createRestore`**（只剩 `currentVersion`/`encodeHeader`/`encodeEvent`/`isUnsupportedMigrationError`）——本插件不读它，将来加形状校验也不得要求该键。
- **历史会话的 `revision` 变成全语料哈希**（`historicalCorpusRevision`）：只对仍未迁移（`sourceVersion < 4`）的会话生效，而这类会话在本插件里会在 `lstatCurrentGenerationArtifact()` 阶段先被拒（当前 generation 文件不存在），所以删除路径的 revision 严格相等判定不受影响。
- **`list()` 静默跳过 `SessionPersistenceCorruptionError`**、zstd header 损坏改抛该类：损坏会话可能「从列表里消失」而不是报错。
- 其余全部兼容（逐行比对 + 实测）：`WorkspaceRegistry`/`SessionStore`/`AgentRegistry` 的类名、`enqueueOperation`/`requireState`/`setState`/`unarchiveSession`（幂等 no-op 语义未变）、三个 `Map` 缓存、`store instanceof Map`、`detachEntered`、`ReactLoopAgent` 的 `phase.kind`/`status`/`inbox.hasPending`/`cancel({kind:'disposed'})`/`whenIdle`/`scope.dispose`、六个注入名、`connection.requestRejection`（`undefined|401|403`）、`storageDomain` 整包零差异、agent factory 的 dispose 顺序与写租约生命周期。
- **内置 `settings.section` 变成 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20**（原生 `archived-sessions` 被 DSH 删除）；插件分区仍 ≥ 100。

### DSH `0.1.7-rc.2` 逐版本核对记录（2026-09-28，`verifiedVersions` 已含该版本）

`0.1.7-alpha.1 → 0.1.7-rc.2` 是一轮全仓版本提升。本轮用 `npm pack` 拉回 alpha.1 的契约包逐文件比对，再在隔离宿主（独立 `DSH_HOME`、只读复制的会话、跑完即删）上真机跑了一遍 HTTP 路由。**结论：无需适配**，只需订正一处文档并扩展验证清单。

- **私有 ABI 形状未变（服务级 + 实例级）**：`dsh-agent/lib/index.js` 与 alpha.1 **逐字相同**（`store = new Map()`、`detachEntered(entry)`、`enter()` 里的 `agent.id !== agent.session.id` 断言都在原处）；`dsh-session/lib/index.js` 只多了两处 `ToolHistoryProjection`/`Session.toolHistory()`，两个 hunk 都在 `SessionStore`（`:1556`）**之前**，`SessionStore` 与 `detachEntered` 逐字未动；`dsh-agent-loop` 有 6 个 hunk（`buildRequest()` 新增 `developer/message` 的 tool-addition/removal 投影、请求里加 `toolHistory`），**但 factory 的 dispose 序列（`cancel({kind:'disposed'})` → `whenIdle()` → `scope.dispose()` → `handle?.close()` → 两个 `detachEntered`）逐行未变**，插件复刻的顺序仍成立。`ReactLoopAgent` 的 `id`/`session`/`scope`/`inbox`/`phase`、`get status()`（仍只返回 `idle`/`running`）、`cancel`/`whenIdle`、`ReactLoopInbox.hasPending`（getter → boolean）全部原位。真机 `GET /status` 回 `sessionQuiescenceSupported: true`，即 `detectSessionQuiescence()` 的服务级探测在 rc.2 上通过。
- **会话格式仍是 v4**：`SESSION_FORMAT_VERSION = 4`（`dsh-session:56`）、`currentVersion: 4`；`locate()` 仍 generation-blind，`logPath()` 拼出的规范 basename 仍是 `session.v4.jsonl[.zstd]`。真机删"仅 v3"会话返回 501，文案里的 generation 是**运行期反解出的 v4**，证明 `generationOf()` 没被写死；v3+v4 并存目录仍整目录搬移。
- **恢复路径未变**：`unarchiveSession()` 仍是 `enqueueOperation` 内"不在归档集合就 `return`"的幂等 no-op；真机 200 / 重复 409 与 alpha.1 一致。
- **删除事务三条持久化安全 ABI 未变**：journal 路径、trash 路径、以及"witness 文件名允许属于上一代 generation"。真机把 witness 写成 `session.v3.jsonl.zstd`（当前 generation 是 v4）后重启，宿主正确进入 `deletion-recovery-required` quarantine，且**目录 inode 未变、trash 未创建、journal 保留**，`delete`/`restore` 都回落 503。`assertDeletionRuntime()` 依赖的字段逐个核对仍在：`JsonlSessionPersistence` 的 `name`/`root`/`compression`/`coldLogMemo`/`migrationPreparations`、`JsonlBackendTracker` 的 `openHandles`(Set)/`writers`(Map)/`pending`(Map)/`hasPending`/`pendingEntries`、`WorkspaceRegistry` 三个 Map 缓存与 `Workspace.detachSession()`。`dsh-session-persistence-jsonl` 的 `lib/index.js` 与 alpha.1 **逐字相同**（该包只改了 `lib/worker.cjs`，内容是 LLM 请求投影，与文件事务无关）。
- **客户端契约未变**：`SessionListState` 仍是 `ids`/`byId`/`phase`/`projectionsBySession`；`(row.retainedBy.mainView ?? 0) > 0` 的写法在 layout / session / workspace / settings-general 里逐字相同；`navIcon()` 映射表与"未知 id 回落 `IconSettingsOutlineMedium`"两版**逐项一致**（`archived-sessions` 分支仍在，插件的 `archived-chats` 依旧不在白名单里，所以 DOM 补丁仍是唯一手段），导航仍是 `<nav>` → `navList` → 按钮（只多了 `tabIndex`/`data-modal-autofocus`），`settings.section` 的 slot 仍只读 `id`/`order`/`label`。图标侧 `tools/dsh-icons/check.js` 报无漂移（188 个图标，Medium/Regular 各 94），`verify-nav-icon.js --measure` 六项全过。
- **真机隔离宿主实测（rc.2）**：status（未认证 401 / 认证 200，三布尔全 true，`dshVersion: "0.1.7-rc.2"`）；`POST /restore` v4 → 200 且 `storages/workspace.json` 同步收缩，重复 → 409；`POST /delete` 纯 v4 → 200（目录消失、trash 清空、journal 归 `null`）、v3+v4 并存 → 200（两份日志连同 `session.lock` 整目录消失）、仅 v3 → 501、v0 legacy（无 `vN` 的 `session.jsonl.zstd`）→ 501，两者都不写 journal、不动文件、status 仍 `deletionSupported: true`；未归档 → 409、归档集合内但存储缺失 → 404、缺 `x-dsh-chat-archive-manager-client` 或跨源 `Origin` → 403。插件的 client bundle 在 `__DSH_BOOT__` 的 combo URL 里被广告，按该 URL 取回的内容与源码只差尾部追加的 `sourceMappingURL`。
- **`quiesceSession()` 端到端已由用户在真实 GUI 补验（2026-09-28）**：打开一个本进程 resume 过的归档会话 → 走红色「永久删除」→ 确认后该聊天从侧边栏与存储中消失（真机 200）。无头环境触发不了 DSH 自身"打开会话 + 归档"的交互，所以这一条永远是"离线证据 + 真机补验"的组合：形状与 dispose 顺序走源码比对，执行走单测（`fakeLiveRuntime()`），能力开关走 `sessionQuiescenceSupported`，最终实删必须真机确认（`lsof` 是否仍持有 `session.lock` 未单独核对）。
- **已决策（2026-09-28，用户选择"保持现状"）：单条永久删除不加额外文字反馈。** 现状是"确认弹窗关闭 + 该行从列表消失 + 计数减少"，`confirmDelete()` 成功分支只做 `setConfirmTarget(null)`（失败才显示 `.dac-error`）——**这是设计，不是故障**；批量删除另有 `batchOutcomeText` 结果文案。用户真机删除后曾出现"是否真的删掉了"的疑问，评估后仍决定不加提示（行消失 + 计数减少已构成反馈）。**后续不要再自动补 toast/页内提示**；若将来重开这个讨论，先看 DSH 壳层自己对行操作的方案（`shell.overlay` 里注册的 `workspace.row-toast`，`dsh-client-ui-workspace:4379`；插件目前没有接任何全局提示渠道）。

### DSH `0.2.0-rc.2` 逐版本核对记录（2026-10-01，`verifiedVersions` 已含该版本）

`0.1.7-rc.2 → 0.2.0-rc.2` 的运行时改动集中在「失败步骤的工具结果恢复」。本轮用 0.1.7-rc.2 全树（284 个包）与运行安装逐文件 diff，再在隔离宿主上跑了两轮端到端（61 + 39 项）。**结论：业务代码无需适配**，只换版本门与验证清单。

- **本轮真正的变化只有两处，而两处都不在删除事务的路径上**——这是 L3 跨线唯一不能靠"包名没变"推断的一条：
  - `dsh-session`：`openTurnClosers()` 重构出 `ToolCallRecovery` 类（新增导出），把「未答复的工具请求」从 `Map<callId,{step}>` 改成 `Map<callId,{turn,step}>`，且 `tool/result` 只在 `surfaceOp === 'append'` 且 turn/step 匹配时才解除 pending（替换型结果不再误清）。**只影响崩溃恢复与 fork seed 的合成 closer 事件。**
  - `dsh-agent-loop`：`run()` 在 step 前订阅 `session/event` 建立跟踪，step 抛错时先补发合成 `tool/result` 再 rethrow，`finally` 里 `stopRecovery()` 之后才 `session.append('step/end', …)`。**新增的是订阅与补发，事件类型与 shape 一个都没变。**
  - 插件**完全不接触 session 事件追加语义**：`session/event`、`append(`、`surfaceOp`、`tool/result`、`step/end`、`interruptedTurnClosers` 在 `lib/*.js` 与 `client.js` 里 **0 命中**；它只读 `persistence.locate()/stat()/list()` 与 snapshot 的 `header`/`revision`。所以这两处改动对本插件的影响面为零。
- **私有 ABI 形状逐项复核（读安装包，不靠 CHANGELOG）**：
  - `dsh-agent`：`lib/index.js` 与 0.1.7-rc.2 **逐字相同**（只有 `package.json` 的 version 变）→ `store = new Map()`（`:323`）、`detachEntered(entry)`（`:538`）、`enter()` 的 `agent.id !== agent.session.id` 断言（`:512`）全在原处。
  - `dsh-agent-loop`：全文件 5 个 hunk / 31 行，**factory 的 dispose 序列（`:1687-1702`：`cancel({kind:'disposed'})` → `whenIdle()` → `scope.dispose()` → `handle?.close()` → `detachAgent?.()` / `detachSession?.()`）逐行未变**；`ReactLoopAgent` 的 `id`/`session`/`inbox`/`phase`/`scope`、`get status()`（`:790`，仍只返回 `idle`/`running`）、`cancel(cause, options)`（`:815`）、`whenIdle()`（`:870`）、`ReactLoopInbox.hasPending`（`:88`，getter → boolean）全部原位。`status` 的语义细节：`maintenance` 阶段也报 `idle`，插件靠**同时要求 `phase.kind === 'idle'`** 保持保守判定，两者一起读才不会把维护中的会话当成空闲。
  - `dsh-session`：`SESSION_FORMAT_VERSION = 4`（`:56`）、`SessionStore` 的 `store = new Map()`（`:1596`）+ `get`/`list`/`detachEntered`（`:1861`/`:1868`/`:1767`）原位；两个 hunk 分别在 `SessionStore` 之前与 `openTurnClosers` 内部。
  - `dsh-session-persistence-jsonl`：**`lib/index.js` 与 0.1.7-rc.2 的 sha256 完全相同**（`0845707017acc2b4…c1e31b`）；该包只改了 `lib/worker.cjs` 一行（`hasIntrinsicConstructor()` 的 native-code 指纹比较，属 LLM 请求投影）。`JsonlSessionPersistence` 的 `name`/`root`/`compression`/`coldLogMemo`/`migrationPreparations`、`JsonlBackendTracker` 的 `openHandles`(Set)/`writers`(Map)/`pending`(Map)/`hasPending(id)`/`pendingEntries()`、`locate()` 的 `{kind:'jsonl', path}` 形状全部未变。
  - **逐字相同（仅 version 变）**：`dsh-workspace`、`dsh-session-persistence`、`dsh-session-format`、`dsh-session-format-catalog`、`dsh-storage-domain`、`dsh-client-connection`、`dsh-client-modules`、`dsh-client-ui-settings`、`dsh-host-webserver`。`WorkspaceRegistry` 三个 Map 缓存（`:360-362`）、`enqueueOperation`/`requireState`/`setState`、`unarchiveSession()` 的幂等 no-op（`:551-560`）、`Workspace.detachSession()`（`:148`）、`connection.requestRejection()`（`undefined|401|403`，`:586`）全部原位。
  - 客户端：`SessionListState` 仍是 `ids`/`byId`/`phase`/`projectionsBySession`（唯一的构造点 `dsh-api-session-controller/lib/client.js:3570`）；`(row.retainedBy.mainView ?? 0) > 0` 在 layout / workspace / session 里逐字相同；`navIcon()` 映射表与"未知 id 回落 `IconSettingsOutlineMedium`"**逐项一致**（`archived-chats` 仍不在白名单，DOM 补丁仍是唯一手段）；`settings.section` 仍是 `{kind:'list', scope:'root'}`、注册选项仍无 `icon`、内置分区上限仍是 **20**（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20）。
  - `dsh-client-ui-settings-general/lib/client.js` 有 8 个 hunk，**全部与本插件无关**：Settings 面板的 `--dsh-frame-top-clearance` 改名成 `--dsh-frame-chrome-top`/`--dsh-frame-overlay-top`、桌面更新状态文案、`general.currentVersion` 里的版本号、快捷键 `Comma` 加 `alt`。nav 结构与 `settings.section` 渲染未动（几何由 `verify-nav-icon.js --measure` 独立钉住）。

- **隔离宿主实测（`DSH_HOME=/tmp/dsh-cam-020`、端口 5942；用户的 3080 全程未触碰，验证后按端口拿 PID 停止）**：数据是本轮**自己造**的（只含 header 行的合法 v4/v3/v0 artifact，**零用户会话数据**；v4 用 `zlib.zstdCompressSync` 压，与 DSH 解码器同一实现）。轮次 A **61 项全过**、轮次 B **39 项全过**。

  | 判据 | 结果 |
  |---|---|
  | 跨线前基线 | 三个路由全 404 —— 范围外确实 inert、零副作用 |
  | status / 能力布尔 | 未认证 401；认证 200，`deletionSupported`/`sessionQuiescenceSupported`/`restorationSupported` 全 true，`dshVersion: "0.2.0-rc.2"`、`dshVersionVerified: true` |
  | 恢复往返 | `POST /restore` v4 → 200，归档集合 6→5，仍保留 W2 的 `sessionIds` 席位，存储未动；重复 → 409 `session-not-archived` |
  | 请求边界 | 缺 client 头 / 跨源 403、非 JSON 415、坏 JSON 400、GET 405、未认证 401、缺 sessionId 400 |
  | 准入拒绝 | 未归档 409、归档但存储缺失 404，均零副作用 |
  | 旧 generation fail closed | 仅 v3 → 501、v0 legacy → 501，文案里的 generation 是**运行期反解**的（v3 / v0 各不相同，证明没写死）；目录未动、**连 journal 文件都没创建**、status 仍 `deletionSupported: true` |
  | 实删 | v3+v4 并存目录整段消失 → 200；v4 zstd → 200；两者 trash 都清空、journal 归 `null`、`archivedSessionIds` 与 W1 席位同步收缩 |
  | 中途中断 | 让 trash 根不可写后 `POST /delete` → 500 `archive-delete-quarantined`；journal 停在 `phase: "prepared"` 且带完整 witness，source 目录与 artifact 都在，trash 0 项，核心记账未动 |
  | quarantine 降级 | 三布尔全 false，`deletionCode: archive-delete-quarantined` / `restorationCode: deletion-recovery-required`；该会话与**其它**归档会话的 delete / restore 全 503 |
  | 冷启动 | 目录 inode、日志 inode/size、journal sha 逐项与中断前**完全一致**，trash 仍空，仍 quarantine（503 + `deletion-recovery-required`） |
  | 升级遗留事务 | 手工把 witness 写成上一代 `session.v3.jsonl.zstd` 后冷启动 → 仍被认出（delete / restore 503），目录 inode 与 journal sha 未变，trash 未创建 |
  | 可恢复性 | 人工清空事务 → 重启 → 三布尔恢复 true，重试删除 → 200，目录消失、trash 清空、journal 归 `null` |
  | boot graph | `__DSH_BOOT__` 广告 `plugins/??dsh-chat-archive-manager/client.js&rev=…` 且 inject 三条；取回内容以源码**逐字节开头**、仅尾部 `;\n//# sourceMappingURL=…`；裸 `/plugins/<包名>/client.js` 仍 404 |

- **两个跨轮有效的新事实（都是造隔离数据时踩出来的）**：
  - JSONL backend 要求**同一个 root 下所有 artifact 的压缩方式一致**（`checkRootEncoding`）：隔离数据里混放 `.jsonl`（none）与 `.jsonl.zstd` 会让 `workspace` 服务在启动时抛 `encodingMismatch`，连带 `workspaceRegistry` 不可用、后续条目全部 pending。造数据必须按 profile 的 `session-persistence-jsonl` 配置统一压缩（本机是 zstd）。副作用：**未压缩 header 的 `O_NOFOLLOW` 路径在默认部署里跑不到**，它只由单测覆盖。
  - 历史 generation 的 artifact 必须带**能解码的合法 header**：`listArtifacts()` 走 `resolveGenerationInDirectory()` + `readGenerationHeader()`，解不开的历史 generation 会被**静默跳过**（`SessionFormatUnsupportedError` / `SessionPersistenceCorruptionError` → `continue`），于是 `preflight()` 在 `list()` 阶段就以 `session-not-found`(404) 结束，永远走不到 `lstatCurrentGenerationArtifact()` 的 501 分支。要测「旧 generation fail closed」必须用合法历史 header：**v3 与 v4 的字段集完全相同，只差 `version`**；v0 没有 `isSeeded`、可带 `parentSession`/`origin`。

### DSH `0.2.1-alpha.2` 逐版本核对记录（2026-10-10，`verifiedVersions` 已含该版本）

`0.2.0-rc.2 → 0.2.1-alpha.2` 又是一轮全仓版本提升（顶层组件清单 91 项里 90 项版本号变化，另有 9 个实验包新增、6 个被移除）。本轮把 296 个 `@deepseek-ai/*` 包两版逐文件 sha256 比对（old 侧按 lockfile 定版本 `npm pack` 拉回，new 侧先自证与运行安装逐包一致），**再在隔离宿主上跑了三轮共 138 项**（基线 5 + 轮次 A 68 + 轮次 B 65）。**结论：业务代码无需适配**，改动只有版本门、三条测试守卫、一句 `client.js` 注释与文档。

- **与本插件同一条链沾边的运行时改动只有 4 个包**，其余全是文档 / 类型 / `package.json` / 无关模块。逐个有证据：

  | 契约 | `0.2.1-alpha.2` 证据 |
  |---|---|
  | `dsh-workspace` | `lib/*.js` 与 0.2.0-rc.2 **逐字相同**（sha256 全等）；`WorkspaceRegistry` 三个 Map 缓存 `headers`/`sessionPaths`/`invalidSessionPaths`（`:360-362`）、`unarchiveSession()` 的幂等 no-op（`:551`）、`Workspace.detachSession()`（`:148`）全在原处。该包只删掉了 `lib/invariant.js` 与 `./invariant` 导出（插件从不引用，`lib/index.js` 也未变） |
  | `dsh-agent` | `lib/index.js` **逐字相同**：`store = new Map()`（`:323`）、`detachEntered(entry)`（`:538`）、`enter()` 的 id 断言（`:510-533`）；同样只删了 `lib/invariant.js` |
  | `dsh-session-format` / `dsh-session-format-catalog` / `dsh-session-persistence` | `lib/*.js` **全部逐字相同**（sha256 全等）。`dsh-session-format` 的唯一差异是 `lib/types/types.d.ts` 的一句注释 + README + package.json；`dsh-session-persistence` 只在类型层新增可选 `formatStatus?: 'current' \| 'migration-required'` |
  | `dsh-session` | lib 只有 8 个 hunk：`SESSION_FORMAT_VERSION = 4` **未变**（`:39-56` 只是注释重写）；新增 `appendPluginRecord`/`pluginRecordOf`（实验性 plugin record）与 `PLUGIN_RECORD_TYPE` 语法；`Session.append()` 把「取 attachments + 重入检查」抽成 `publicationEntry()`、把提交流程抽成 `commit(event, entry)`（同一检查、同一顺序，语义不变）；`SessionStore` 区域的两处改动是**注释**（`:1939`）与导出表（`:2047` 新增两个导出）——`store = new Map()`（`:1713`）、`detachEntered`（`:1883`）原位 |
  | `dsh-agent-loop` | 全文件 9 个 hunk / 92 行。**`ReactLoopAgent` 的 `id`/`session`/`inbox`/`phase`/`scope` 与 `get status()`（`:790`）/`cancel`（`:815`）/`whenIdle`（`:870`）/`ReactLoopInbox.hasPending`（`:88`）全部原位**；factory dispose 的**成功路径顺序未变**（`:1714-1735`：`cancel({kind:'disposed'})` → `whenIdle()` → `scope.dispose()` → `handle?.close()` → `detachAgent?.()`/`detachSession?.()`）。唯一结构性变化是**错误处理**：`scope.dispose()` 从「与 `cancel`/`whenIdle` 同一个 `try` 块」移进**独立的 `try/catch`**（旧版两者之一抛错就跳过 `scope.dispose()`，新版尽力清完再抛 `AggregateError`）。插件在 `whenIdle()` 超时/失败时**放弃删除并停在 preflight**（不写 journal、不进 quarantine），因此仍是新版行为的更保守子集；`dispose()` 被拆成 `teardown()` + 外层 `unfollow*`，但插件从不调用 factory 的闭包，只用实例方法复刻步骤 |
  | `dsh-session-persistence-jsonl` | lib 只有 4 个 hunk：① `runVerificationWorker` 改为等 worker **自然退出**（migration verifier 生命周期，插件不调用）；② `readGenerationHeader()` 的 `return header` 变成 `return { header, formatStatus: result.status }`（**只包装返回值，内部逻辑逐行未变**）；③ `stat()` 返回值成为 `{...metadata, revision, sizeBytes}`；④ `list()` 的 snapshot 多一个 `formatStatus` 键。插件的读取面 `snapshot.header`/`revision`/`sizeBytes` 与 `locate()` 的 `{kind:'jsonl', path}` **全未变**，新增键是纯附加；`JsonlSessionPersistence` 的 `name`/`root`/`compression`/`coldLogMemo`（`:2392`）/`migrationPreparations`（`:2394`）/`locate`（`:2416`）与 `JsonlBackendTracker` 的 `openHandles`(Set)/`writers`(Map)/`pending`(Map)/`hasPending`（`:337`）/`pendingEntries`（`:344`）逐个核对仍在 |
  | `dsh-storage-domain` | lib 唯一改动是一句注释；`DomainFacility.get()` 与 `table('sessions').delete` 未变 |
  | `dsh-host-webserver` | lib 有 270 行改动，但 **`register(route)` 函数体逐字相同**（exact/prefix 表、重复路径 throw、返回 disposer，`:298`）；改动集中在 HTTPS/TLS 监听、压缩中间件与文档 |
  | `dsh-client-connection` | `requestRejection(request)` 的**签名与返回值域（`undefined\|401\|403`）未变**，实现多一行 carrier：把 `webServer` 的 `host`/`protocol` 传进 `isTrustedApiRequest()` 与 `isAuthenticated()`（HTTPS 支持，`:639-641`）。插件只依赖「返回 undefined/401/403」，隔离宿主上六类边界（未认证 401、跨源/缺头 403 等）与 0.2.0-rc.2 逐项一致 |
  | 客户端 | `SessionListState` 的唯一构造点 `this.list.set({ ids, byId, phase, projectionsBySession })` 与 0.2.0-rc.2 **逐字相同**（`dsh-api-session-controller/lib/client.js:4216`）；`(row.retainedBy.mainView ?? 0) > 0` 在 layout/session/workspace/settings-general 四处**逐字相同**（各 1/2/6/1 处）；`dsh-client-ui-settings`/`dsh-client-store`/`dsh-client-ui-slots`/`dsh-api-workspace-controller` 的 lib **逐字相同**；内置 `settings.section` 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（上限 20，插件 120 安全），`settings.action` 内置项仍只有 `open-document`(0)；`check.js` 报图标无漂移（188 个，Medium/Regular 各 94），`verify-nav-icon.js --measure` 六项全过。`dsh-client-ui-settings-general/lib/client.js` 的唯一改动是 `general.currentVersion` 的版本号字面量 |
  | 与本插件无关的改动 | `dsh-app-boot`/`dsh-plugin-manager` 的改动在**启动期 profile/bundle 解析与补丁层**（`createRuntimeResolution` 改返回记忆输入的 `ProfileRuntimeResolution`、`normalizeShippedProfile` 增加写回 `writeProfileManifest`、新增 official-bundles 目录、`parseInstallSpec`/`readPolicy`/`writePluginEnabled`/官方安装目标解析）：插件在运行期**完全不引用**这两个包（`lib/*.js` 与 `client.js` 里 `app-boot`/`plugin-manager`/`pluginManager` 0 命中，也不注入它们提供的服务），删除事务只经过 `workspaceRegistry`/`sessionPersistence`/`sessions`/`agents`/`storageDomain`/`connection`/`webServer` |

- **三轮实测（全部隔离宿主，用户的 3080 未触碰）**：
  - 数据仍是**本轮自造**的（canonical 路径的合法 header artifact，零用户会话数据；v4/v3/v0 三种 generation，统一 zstd 压缩）。
  - **范围外基线 5 项**：把插件换回 HEAD 的旧门（0.2.0 线）后 `GET /status` → 404、`POST /delete` 与 `POST /restore` → **405**（壳层 fallback 的方法拒绝，不是插件路由——POST 到未注册路径不会得到 404；这条订正了 B5 表格里"三个路由全 404"的记法）、随机路径 404、boot 仍广告 client bundle（版本门只管 Host 半体）。
  - **轮次 A 68 项**：status（未认证 401 / 认证 200，三布尔全 true，`dshVersion: "0.2.1-alpha.2"`、`dshVersionVerified: true`、range 已换线）；restore 往返 8→7 且 W2 席位保留；请求边界 403/403/415/400/405/401/400；准入拒绝 409/404；仅 v3 → 501、v0 legacy → 501（文案里的 generation 是运行期反解的 v3/v0，且**连 journal 文件都没创建**）；v3+v4 并存目录整段搬移实删 200、纯 v4 zstd 实删 200（目录消失、trash 清空、journal 归 `null`、归档集合与 W1 席位同步收缩）；boot graph 的 combo URL + `inject` 三条 + 取回内容以源码逐字节开头（仅尾部 `sourceMappingURL`）+ 裸路径 404。
  - **轮次 B 65 项**：trash 根不可写注入 → `POST /delete` → 500 `archive-delete-quarantined`，journal 停在 `phase:"prepared"` 且 witness（目录 inode、日志 inode/size、文件名、header.id）完整；S8 目录 inode 与日志 size 未变、trash 0 项、归档集合与 W2 席位未动；运行期降级三布尔 false + `deletionCode: archive-delete-quarantined` / `restorationCode: deletion-recovery-required`，该会话与**其它**归档会话的 delete/restore 全 503；冷启动后 journal sha、目录 inode、日志 inode/size 逐项一致、trash 仍空（此时 `deletionCode` 是 `deletion-recovery-required`——冷启动走 `initialize()` 失败分支，与运行期的 code 不同，两者都是 quarantine）；把 witness 改写成上一代 `session.v3.jsonl.zstd` 后冷启动仍被认出（503）、journal sha 与目录 inode 未变、trash 未创建；人工清空事务 → 重启 → 三布尔恢复 true、重试删除 200、目录消失、trash 清空、journal 归 `null`。
- 本轮顺带核对：`settings.section` 内置 order 与 0.2.0-rc.2 完全一致（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），`client.js` 里那句版本号已同步成 `0.2.1-alpha.2`。
- **造隔离数据的第三条硬约束（本轮实测补上）**：历史 generation 的 header 还必须带 `delegationDepth`——它自 v2 起是必需字段，缺了会让 `readHeader()` 返回 `malformed`（`released v2 physical header lacks delegationDepth`），而 `readGenerationHeader()` 对 `malformed` 返回 `undefined` → 该 artifact 同样在 `list()` 阶段被静默跳过、测出 404 而不是 501。另外 **macOS 上必须用 canonical 路径**：`/tmp/...` 与 `/private/tmp/...` 混用会让 `WorkspaceRegistry` 的席位校验（id + canonical cwd membership）把 `sessionIds` prune 掉，`bootstrap()` 也会另建一个 `/private/tmp/...` 的工作区——造数据与断言都要用 `realpath` 形式。

### Host

- `lib/index.js` 入口；`lib/archive-deletion.js` 删除事务；`lib/archive-restoration.js` 恢复事务。
- 旧版迁移路径：`$DSH_HOME/workspaces/archived`。
- `GET /dsh-chat-archive-manager/status`；`POST /delete`、`POST /restore`，body 均为 `{ "sessionId": "..." }`。
- 三个接口都先调 `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界；两个 mutation 再附加同源、`x-dsh-chat-archive-manager-client: 1` 与 `application/json` 校验。固定 header 不是认证凭据，status 也不得向未认证请求暴露 quarantine 路径或运行时诊断。
- 恢复只调公开的 `registry.unarchiveSession()`。DSH `0.1.7` 起自带「已归档会话」设置页已被 DSH 删除（0.1.6 曾有），归档恢复改由侧栏视图筛选与搜索结果承担；两条入口操作同一份 registry 归档集合、语义一致，本插件分区 id 是 `archived-chats`，图标补丁不受影响。
- `removeLegacyArchiveWorkspace()` 只注销路径、标题均匹配且 `sessionIds` 为空的旧版空壳 Workspace；同路径同标题但仍有会话的碰撞必须保留。DSH 的 `registry.delete()` 保留目录和所有会话日志，迁移不得改写 `archivedSessionIds`。

### 恢复

走公开 API `WorkspaceRegistry.unarchiveSession(sessionId)`（0.1.6 起在 `dsh-workspace/lib/types/index.d.ts` 公开）：它自己 `enqueueOperation` 串行写 registry state，只从归档集合里摘掉目标 id，保留 Workspace 记账席位与顺序——原 Workspace 仍存在时保留其 `sessionIds` 席位和顺序，已删除时不重建，恢复后由 DSH 归入未分组。本插件**不再自己 `setState`**，也不再把 registry 的私有状态 writer 当作前置条件。仍然保留的 fail-closed 约束：缺 `unarchiveSession()` 直接 501；恢复与永久删除共用同一个 `runExclusive` 串行队列（删除事务进行中恢复必须排队，测试 `serializes restore behind a destructive transaction` 守着）；未归档保持 409 `session-not-archived`（`unarchiveSession()` 对未归档 id 是**幂等 no-op**，不先读集合判定就会把“没归档”吞成成功）；存在未完成的删除 journal 时整体禁用恢复并沿用 status 文案。

### 永久删除（私有 ABI 兼容层）

`assertDeletionRuntime()` 必须保持 fail closed，至少验证 registry caches、JSONL backend `root/compression/locate/stat/list`、`JsonlBackendTracker` 的 open handles/writers/pending，以及 migration preparation 与 cold-log cache；面向用户的失败信息不得硬编码已经过期的 DSH 版本号。

journal：`$DSH_HOME/dsh-archived-chats/deletions.json`——该旧命名是重命名前就已存在的持久化安全 ABI，必须继续读取，避免漏掉未完成事务并绕过 quarantine。阶段：`prepared`（durable journal 已写，尚未移动 artifact）→ `clearing`（artifact 已移入 trash，正在清核心记账）→ `committed`（核心记账已清，正在清派生状态与 trash）。

trash 必须严格等于 `<dirname(persistence.root)>/.dsh-archived-chats-trash/<transaction UUID>`，保持在 JSONL 扫描根之外；首次事务先 durable 创建 journal/trash 目录并验证 source 与 trash 的 `st_dev` 相同，确保后续 rename 可原子完成。**日志 generation 不是常量**：`0.1.6-alpha.1` 写 v3（`session.v3.jsonl(.zstd)`）、`0.1.7-alpha.1` 写 v4（`session.v4.jsonl(.zstd)`），插件从 `persistence.locate(header)` 返回的规范 basename 反解出本进程的当前 generation（`generationOf()` + `CANONICAL_LOG_PATTERN`），再用它组装白名单与用户文案；**禁止**把 3/4 这类数字写回源码，也禁止 import `@deepseek-ai/dsh-session-format*`（profile 的 `node_modules` 下没有 `@deepseek-ai` 目录，且这些包不在根导出里给 `currentVersion`；`generated.js` 里的 `historicalSessionFormatCatalog` 故意钉在 3，更不能当当前版本用）。DSH 发布迁移时**保留源文件**，同一目录里 v3 与 v4 可以并存（本机实测 4 例），所以搬移对象始终是整段会话目录。更早 generation 必须先由 DSH 自身迁移。正常请求在 source、trash 和最终 rm 前分别核对 JSONL header、目录 inode、日志 inode/size；未压缩 header 用 `O_NOFOLLOW` 直接读，zstd header 必须经 backend 的 `list()` 与 `stat(id)` 稳定解码，并把两次 snapshot revision、size 与前后物理 inode/size 绑定。journal 永远视为不可信持久输入：启动发现非空 transaction 时只进入 `deletion-recovery-required` quarantine，绝不自动 rename、回滚、前滚或 rm。journal 的 witness 文件名可能属于**上一个 generation**（升级 DSH 时留下的未完成事务），所以 `validWitness()`/`assertStaticLogLocation()` 只要求 canonical 形状（`session[.vN].jsonl[.zstd]`），不要求等于当前 generation——否则升级会把旧 journal 误判成「没有事务」而绕过 quarantine（见测试 `still recognises a deletion journal recorded under the previous generation`）。

**`JsonlSessionPersistence.locate(meta)` 是 generation-blind 的**：只用 `cwd`+`id` 算出**当前 generation** 的路径，从不检查磁盘上实际存在哪个 generation。所以 record 里是 v3 header、目录里却只有旧 generation 文件时，`locate()` 返回的路径并不存在。`validateArtifact()` 必须先做 generation 感知探测（`lstatCurrentGenerationArtifact()`）：缺失时扫描同目录 canonical generation 名——命中旧 generation 抛非 quarantine 的 `unsupported-artifact`(501) 并给出迁移操作指引，命中更高 generation 抛格式过新的拒绝，目录里确实什么都没有才抛 `session-not-found`(404)。**禁止**让此处裸 `lstat()` 的 `ENOENT` 冒到路由层：`preflight()` 位于 quarantine `try` 之外，裸错误会被 `lib/index.js` 兜成 500 `archive-delete-incomplete`（“请重启 dsh web 后重试”），而重启永远解决不了旧 generation。

旧 generation → 当前 generation 的迁移只在 DSH **以 write 方式打开**会话时发布（`publishStoredMigration` / `publishPreparedMigration`，两代同名同语义），只读浏览只在内存里 prepare；因此旧 generation 的归档聊天必须先恢复并继续一次对话才会迁移。测试 fixture 的 `locate()` 必须复刻真实 backend 的 generation-blind 行为（由 Session 目录 + `id` 推导**当前 generation** 路径，默认 `generation = 4` 并可按用例改）——让 fixture 返回 `header.path` 会掩盖这条回归；旧 generation 用例须同时覆盖未压缩与 zstd 两种 artifact。

删除准入拒绝：未归档或不存在；live 且正在运行或有排队输入的 Session/Agent（`session-busy`）；tracker 中存在 open handle、writer 或 pending materialization，或存在 migration preparation；存在持久化或 live 后代；backend、artifact、符号链接或路径不符合已验证结构。任何 prepared 之后的失败都保留 journal 和现场并进入 quarantine，不自动重试或回滚；派生 sidecar/query 清理是 best effort，不阻断正常成功路径；内容寻址附件不删除。

### 空闲 live 会话的安全卸载（`detectSessionQuiescence` / `planSessionQuiescence` / `quiesceSession`）

DSH 会保留**本进程 resume 过的每一个会话**直到进程退出：agent factory 的 lifecycle `ctx.effect` 挂在 `AgentRegistry` 自己的进程级 ctx 上（`dsh-agent-loop` 的 `prepare()`），JSONL 写租约随该 handle 一直打开，而唯一的 teardown 闭包只在 `agents.resume()` 返回的私有 handle 上——`dsh-api-session-controller` 取走 `.agent` 后丢弃它，Remote 方法表里也没有 close/release。所以只在本进程打开过一次的归档聊天永远过不了 `ensureCold()`，旧行为只能让用户重启 `dsh web`。插件改为在删除前**复刻 factory 自己的卸载顺序**卸载这一个空闲会话：

- 能力探测必须 fail closed 且**不牵连冷会话删除**：`detectSessionQuiescence()` 在**服务级**校验 `agents.constructor.name === 'AgentRegistry'`、`sessions.constructor.name === 'SessionStore'`、两者的 `detachEntered` 与 `store instanceof Map`；任何一项不符返回 `undefined`，live 会话退回原来的 `session-live`（重启）拒绝，冷会话删除不受影响。**agent 实例级**形状（`ReactLoopAgent` 的 `id`/`session.id`/`phase.kind`/`status`/`inbox.hasPending`/`cancel`/`whenIdle`/`scope.dispose`）由 `assertIdleAgent()` 校验，不符抛 `unsupported-runtime`(501)——重启解决不了结构不匹配，所以此处**不**回落成重启建议。`status` 只接受 `'idle'`/`'running'`，`inbox.hasPending` 必须是 boolean：缺失即结构不符，不得被当成“忙”。
- 只有**完全空闲**才卸载：`phase.kind === 'idle'`、`status === 'idle'`、`inbox.hasPending === false`；否则抛 `session-busy`(409)。`whenIdle()` 有 30s 上限（`QUIESCE_TIMEOUT_MS`），超时只放弃本次删除，不进入半卸载状态。
- 顺序固定为 factory 的 `dispose()`：`cancel({kind:'disposed'})` → `await whenIdle()` → `scope.dispose()` → 关闭 tracker 里该 id 的写句柄（`handle.close()` 自身幂等）→ `agents.detachEntered(entry)` → `sessions.detachEntered(entry)`（两者都幂等，factory 之后真正的 teardown 因此是安全 no-op）。
- **卸载必须发生在所有只读校验之后**：`preflight()` 先只做 `planSessionQuiescence()`（零副作用），只有在归档集合、唯一 snapshot、后代、artifact/witness 全部通过后才调用 `quiesceSession()`；执行前**重新**断言一次空闲，防止校验期间落进来的 prompt 被误杀。失败一律停留在 preflight 阶段，不写 journal、不进入 quarantine。
- 依赖字段名（`store`/`detachEntered`/`phase`/`status`/`inbox`/`cancel`/`whenIdle`/`scope`）是私有契约，`0.2.1-alpha.2` 已重新核对（形状未变，factory 的 dispose **成功路径顺序**逐行相同；唯一变化是 `scope.dispose()` 挪进独立 `try/catch`，插件出错即停在 preflight，仍是更保守的子集）；禁止在结构不匹配时猜测执行。
- factory 自己的 `dispose()` 闭包**不可达**（只在 `agents.resume()` 的 handle 上，而 `dsh-api-session-controller` 取走 `.agent` 后丢弃它），所以这里复刻它的步骤而不调用它。该闭包仍留在 `FactoryOwnership.liveAgents` 中，将来在进程/插件卸载时执行一次：`cancel`/`whenIdle`/`scope.dispose`/`handle.close`/两个 `detachEntered` 全部幂等，因此那次执行是安全 no-op（代价是每次卸载在 ownership 里残留一个已 teardown 的闭包，仅存活到进程退出）。**禁止**改成自己调用 `handle.close()` 之外的任何“补一次清理”逻辑，那会破坏这个幂等前提。

删除与恢复必须共用一个 mutation coordinator，整个 registry operation 串行，不能只各自单飞。Persistence tombstone wrapper 必须覆盖 `create/open/stat/list` 入口（两代签名与返回键集相同）、记录每个 ID 与全局 listing 已准入的 in-flight Promise，并在 tombstone 后 drain 再 rename；新调用必须 fail closed。恢复 exact own descriptor，原方法来自 prototype 时清理 instance wrapper，且只在当前成员仍归本插件所有时恢复。disposer 先关闭新请求、等待 operation tail，再撤 patch；它不根据 journal 做文件恢复。

## Client

- bundle：`client.js`。注入的 `<style>` 必须打 `data-plugin="dsh-chat-archive-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删）；每次 apply 重写 `textContent`，disposer 按 `dataset.references` 引用计数清理。
- 不投影 synthetic session，不改写 Workspace/session service，也不替换任何 list snapshot；管理器直接从 `workspaces.list.archivedSessionIds` 和 `sessions.list.byId` 读取权威归档集合与摘要。
- “当前打开的会话”（批量排除项之一）**不能**再读 `sessions.list.current`：本发布线的 `SessionListState` 只有 `ids`/`byId`/`phase`/`projectionsBySession`（`0.1.7-alpha.1` 与 `0.1.7-rc.2` 都是这四个键，构造点是 `dsh-api-session-controller` 里唯一的 `this.list.set({ ids, byId, phase, projectionsBySession })`；`current` 键不存在。**本文档早期写的 `subagentsByParent`/`jobsBySession` 是记错的字段名**——这两个名字在整棵 DSH 安装树里 0 命中，而插件只读 `byId`/`ids`，所以运行从未受影响），同一事实由每行的本地保留计数 `byId[id].retainedBy.mainView > 0` 表达——官方 `dsh-client-ui-layout`、`-sidebar`、`-workspace`、`-settings-general` 与 `dsh-client-ui-session` 都按 `Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)` 读。`currentSessionId()` 里的“有 `current` 键就用它”分支是 0.1.6-alpha.1 遗留的**直读兜底**（不是跨线承诺）：本进程的 list 没有该键时一律走高保真路径，测试同时钉住两种形状，防止将来某个字段回来时静默改变语义。`ClientSessions.publishRetention()` 会把 retainedBy 写回 list snapshot 并通知订阅者，所以继续用既有的 `sessions.list` + `useSyncExternalStore` 即可，**禁止**为此新增 `retainInfo(id)` 订阅或把 list 行整表拷进 state。
- `workspaces.list` 在本发布线中仍是依赖接收者的 class store；传给 `useSyncExternalStore()` 的 `subscribe/getSnapshot` 必须经稳定 wrapper 调用，不能裸传方法引用。测试 Store 也必须依赖 `this`，防止该回归再次被闭包式 fixture 掩盖。
- 每行操作按红色永久删除、恢复的顺序排列；恢复成功后依赖 Host follow stream 更新快照，仅在对应 client service 仍暴露 `refresh()` 时额外主动刷新。DSH 原生 grouped/flat/search 继续隐藏尚未恢复的归档会话。
- 注册到 list slot `settings.section`：ID `archived-chats`、order `120`（插件分区一律 ≥ 100，排在 DSH 自带分区之后。本发布线的内置分区是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20，最大的内置项是 agent-presets 20）、导航标签 `SECTION_TITLE`（“归档管理”，与页面标题同源常量）；client manifest 依赖 `dsh-client-ui-settings-general`，确保 section slot 已声明。导航图标 helper 与分区同号。
- **图标名不要写死成一个名字，且档位词 Regular 优先**：`0.1.7` 把官方图标从数字档位改名成档位词（`IconArchiveOutline20`→`IconArchiveOutlineRegular`、`IconFolderOpen16`→`IconFolderOpenRegular`、`IconTriangleRightFill14`→`IconTriangleRightFillRegular`），旧数字名在本版本构建里**不存在**，`require` 回来是 `undefined`、图标静默变空白。bundle 顶部用 `iconOf('…Regular', '…Medium', '…16')` 逐名取第一个存在的导出，全缺时退化成空组件（不让整个 bundle 挂掉）。
  **为什么 Regular 排第一**：`…Medium` 与 `…Regular` 是同一基础组件的两个包装器，几何完全一样，只差 `strokeWidth`（0.1.7 构建里 `Medium` 传 `1.3`、`Regular` 传 `1.0`），而官方客户端各处用的是 Regular——排错顺序插件图标会比相邻壳层图标重约 30%。`test/client.test.js` 的 `both-tier-words` 模式（两档并存时断言挑 Regular）钉住这条，`check.js` 只看「链上至少有一个名字存在」，不看顺序。
- 本发布线的 section contract 不接受 icon，Settings shell 对未知 ID 固定回落齿轮。插件在 `settings.action` 注册不可见的 `dsh-chat-archive-manager.nav-icon` helper，用官方归档图标生成 mask，只给标签严格等于 `SECTION_TITLE` 的 nav button 加带引用计数的 `data-dac-archive-nav` 标记（标题改名时此处必须同步，否则图标补丁静默失效）；不得替换 React 管理的 SVG/子节点，关闭 Settings 或卸载时必须恢复。

- 页面顺序固定为标题行 → 说明段 → 工具栏 → 操作行 → 列表（说明紧跟标题，交互控件在说明之下）；标题是无图标单行 `h2`，可见计数以 8px 间距紧跟标题，`0..99` 原样显示、超过 99 统一显示 `99+ 条聊天`。只有永久删除继续使用显式二次确认 Modal。不得重新注册 `sidebar.footer.action` 或修改 Cordis 底部入口。

### 分组与批量操作（纯客户端）

- 分组语义复刻 DSH 侧边栏：每个工作区一组、按 `workspaces.list.items` 的 Host 顺序，**只渲染非空组**，其余归入唯一的“未分组”桶（不按 `cwd` 造伪分组）；**默认全部折叠**（内部状态存已展开的 key），搜索命中时强制展开。
- 组头与 DSH 侧边栏工作区行同形：`.dac-group-row`（`role=treeitem`、`aria-expanded`、整行可点、Enter/Space 切换）+ 16×20 图标槽（展开态给 `IconFolderOpen16`/`IconFolderClose16`，hover 时整个槽换成 `IconTriangleRightFill14`，展开时加 `dac-group-arrow-open` 旋转 90°）+ 标题（14px/500/`label-primary`）+ 右侧弱化计数；行高 34px、圆角 8px、`padding:0 8px`、hover `interactive-bg-hover`。图标一律取官方 primitives，不要自绘。
- 会话行与 DSH 自带“已归档会话”页同形的卡片：`.dac-row`（`display:grid`、`grid-template-columns:minmax(0,1fr) auto`、`gap:12px`、`padding:8px 10px`、`border-radius:8px`、无 `border-*`），hover 才给 `--dsw-alias-interactive-bg-hover`（**刻意不用原生页的 `--dsw-alias-bg-layer-1`**：浅色主题下它是 `#fff`、与设置面板底色相同，原生页的 hover 在浅色下其实看不见；此处必须与组头 hover 同 token）；标题 13px/20px，meta 12px/18px 且用 `--dsw-alias-label-tertiary`。**禁止**再用横线区分列表（`.dac-list`/`.dac-groups` 不得有 `border-top`，`.dac-row` 不得有 `border-bottom`，`.dac-group+.dac-group` 不得有分隔线）：组头本身就是区分依据，组间用 `.dac-groups{gap:12px}`、组内用 `.dac-group{gap:2px}`。
- 会话行缩进在 `.dac-group-body`（`padding-left:20px`，**无**引导竖线），使卡片文字（20px 缩进 + 10px 卡片内边距）与组标题（8px 行内边距 + 16px 图标 + 6px 间距 = 30px）严格对齐。`rowMeta()` 以 `withWorkspace` 为唯一开关：默认输出“工作区 · 20 天”（未分组显示“未分组”），分组视图传 `withWorkspace:false` 时只输出“20 天”（组头已表达工作区）；`relativeTimeLabel()` 复刻官方 primitives 的 `relativeTime` 阈值（<1 分钟“刚刚”、分钟、小时、天、30 天月、365 天年，`updatedAt <= 0` 视为未知、整段省略），调用方每次渲染传入同一个 `now`。**禁止**再显示绝对时间戳、恢复原位 `#N` 或目录名（原生页都没有，`summaryRows()` 也不再计算 `position`）。
- 表单控件是硬约束：所有 `<select>` 与自定义日期输入都必须包在 `.dac-select-field` 内，由插件自绘指示器（`::after` + alpha mask + `background:currentColor`，`appearance:none`、`padding:0 30px 0 10px`），使左侧文字内边距（10px）与右侧指示器内边距（9px）对称；禁止依赖浏览器原生下拉箭头。日期输入用 `.dac-date` 并把 `::-webkit-calendar-picker-indicator` 设为铺满控件的透明层，点击控件任意位置即可打开日历；`selectField()`/`field()` 是唯一入口，不要在别处手写 class。**mask 用的 `--dac-*-glyph` 变量必须定义在控件自身**（`.dac-select-field`），不能定义在 `.dac-section` 之类的祖先上：批量弹窗经 `Modal` portal 到 `document.body`，祖先变量不会继承，取不到值时 mask 失效会退化成实心方块（已踩过此坑）。SVG 数据 URI 必须整体 `encodeURIComponent`，禁止裸空格/引号/`#`。
- 工具栏只放搜索框、视图选择、排序选择；搜索框必须由插件自绘官方 `IconSearchOutline16`（`.dac-search` 为 `position:relative` 容器，`>svg{position:absolute;left:12px;pointer-events:none}`，input 用 `padding:0 12px 0 36px`），不得依赖浏览器原生 search 装饰。列表正上方唯一一行 `.dac-list-actions` 从左到右固定为**「批量归档」→「批量删除」**，折叠按钮 `.dac-list-toggle`（`margin-left:auto`）贴这一行最右；三个按钮都是 `dac-button dac-button-small`（26px），行内 `gap:8px` 提供两个批量按钮之间的间距（**禁止**用 `justify-content:space-between` 排三个按钮：它会把中间那个推到正中央）。这一行**始终渲染**，只有组数 ≤1 或处于单列表时不渲染右侧折叠按钮；默认折叠时文案“展开全部”，有任一展开时“折叠全部”。
- **「批量删除」必须是 `dac-button dac-button-small danger`**（实心 `--dsw-alias-state-error-primary`，与单行“永久删除”同一套危险色），不得与「批量归档」同色；`deletionSupported !== true` 时禁用并沿用 status 的 `deletionUnavailable` 文案（fail closed）。
- 页面文案是硬约束：说明段必须是**单段合并文案**、紧跟标题、位于工具栏之上，顺序为“两种视图 + 批量归档 → 恢复 → 永久删除”。可用态固定为：`按工作区分组或单列表浏览归档聊天；批量归档支持按时间条件筛选。恢复会回到原来的工作区，原 Workspace 已删除时进入未分组；永久删除会移除会话日志，但不删除共享附件。`（批量不可用时第一句换成“当前 DSH 客户端不支持批量归档”；恢复/删除不可用时各自独立成句；`capabilityNote` 必须按能力分支装配而不是无脑拼接。）**禁止**写“由你手动发起”这类赘述，**禁止**把恢复说成“回到普通列表”（实际回到原 Workspace 原位置，已删除才进未分组），**禁止**“可按时间条件挑选一段时间没有活动的聊天”这类冗长表述（条件细节归批量弹窗）。`.dac-note` 是弱化提示样式，用于批量弹窗内的说明/进度/提示（匹配条数、时间口径、取消勾选、预览与进度）以及页面的“读不到摘要”异常提示；页面级能力说明段走 `.dac-description`，不占用 `.dac-note`。
- 排序模式：`最近更新`（默认，`updatedAt` 降序、id 升序 tiebreak）与 `归档先后`（`archivedSessionIds` 追加序，即 DSH 唯一可得的归档时序；DSH 不记录归档时间戳）。视图模式：`按工作区分组` / `单列表`。
- `buildArchivedRows()` 必须报告读不到摘要的归档 id 数（unreadable），不得静默丢弃；子代理摘要按原生语义过滤。
- 批量归档**只用**原生客户端命令 `workspaces.archiveSession(sessionId)`，顺序执行、每条各自 durable。禁止为此新增宿主 HTTP 路由、`registry.setState` 等私有 ABI 或批量写入；`typeof workspaces.archiveSession !== 'function'` 时整条入口禁用（fail closed），分组仍可用。
- 候选筛选规则（`batchCandidates()`）：排除归档集合成员；子代理会话始终排除；运行中/等待交互、空白、当前打开的会话默认排除但可由用户显式勾选包含；时间条件为严格早于 cutoff（`updatedAt < cutoff`）。cutoff 来自滚动预设（24 小时 / 7 / 15 / 30 / 90 天）、“1 天前”（**包含昨天以及更早**，即本地今天 00:00；与滚动 24 小时刻意不同）、“自定义日期”的本地 00:00，或「所有时间」；「所有时间」（`BATCH_PRESETS` 第一项，`unbounded: true`）由 `resolveCutoff()` 返回 `Number.POSITIVE_INFINITY` 表达——**它不是非法值**：两个候选函数的守卫只拒绝缺失或 `NaN` 的 cutoff，`+Infinity` 必须放行（若沿用 `Number.isFinite` 判定，选项会静默变成“匹配 0 条”），`updatedAt < +Infinity` 对包括未知时间（缺 `updatedAt` 按 0）在内的所有行成立，因此删除侧也就能删掉刚归档不久的聊天。无效日期解析为 `undefined`，此时候选为空。默认条件仍是 `30d`，只有用户显式选择才不做时间过滤。边界回归见 `test/client.test.js` 的 `treats 24 小时前 as a rolling window and 1 天前 as yesterday and earlier` 与 `treats 所有时间 as no time filter instead of an empty candidate set`。
- 范围（全部会话 / 单个工作区 / 未分组）**只在批量归档弹窗内选择**；页面不再提供按工作区的批量入口（避免与分组视图重复）。唯一的批量入口是操作行左侧按钮，标签固定为“批量归档”且**不带省略号**（省略号会被误读成正在归档），弹窗内的“自定义日期”同样不带省略号。
- 三步流程：①条件（范围/时间/排除项，实时显示“匹配 n 条”与“另有 k 条因排除项未计入”）→ ②预览（进入即**冻结**候选；逐条可取消；`>= BATCH_CONFIRM_THRESHOLD`(50) 时必须勾选确认）→ ③执行（串行 + `i/N` 进度 + 中止；完成后 `已归档 n 条、跳过 k 条、失败 m 条`，并保留「撤销本次归档(n)」）。按钮上带计数的括号一律用**半角括号且紧跟文字**（`开始归档(3)`、`撤销本次归档(3)`），不用全角 `（）`。
- 弹窗布局是硬约束：`Modal` 的 `footer` slot 渲染在 `.content` **之外**，所有动作按钮必须走 `footer` prop，绝不放进 children；标题栏常驻，只有内部滚动容器滚动。批量弹窗的 `contentClassName` 固定为 `dac-content-batch`（不叠加会滚动的 `dac-content`），由 `.dac-batch`/`.dac-batch-scroll`/`.dac-preview` 承担内部滚动（`flex:1 1 auto;min-height:0` 链一路打通到 DSH 的 `.content`/`.body`，并用 `>:first-child`/`:last-child` 收紧 header padding 与 `.body{margin-top:20px}`，不依赖 DSH 的哈希类名）。
- 预览的选中状态存**被取消勾选**的 id（`deselected`），所以新预览天然是“全选”，不存在丢失的选中态；“全选/全不选”是汇总行内的紧凑按钮（`dac-button dac-button-small`，高度 26px），不单独占一行；取消到 0 条时汇总文案改为“尚未勾选任何聊天”并禁用“开始归档”。
- 执行期正确性：每轮从最新快照读取归档集合（`isArchived`）与 `updatedAt`（`latestActivity`）；已在归档集合中或预览后有了新活动的条目**跳过并列出**；失败逐条记录且不中断整批；中止只阻止未开始的条目，已归档的不回滚（归档本身靠恢复撤销，不做回滚）。撤销逐条走既有 `RESTORE_PATH`，并识别宿主的 `session-not-archived`(409) 为跳过而非失败；撤销依赖宿主 restore 路由，因此删除事务 quarantine 时必须整体禁用并沿用 status 文案。
- **批量删除复用同一套三步弹窗**，只是 `openBatch(scope, 'delete')` 把 `batch.mode` 置为 `delete`：`deletionCandidates()` 的候选宇宙**只能是 `archivedSessionIds`**（页面上的每一条本来就已归档），范围/时间条件/排除项与批量归档完全同构；执行走既有宿主 `DELETE_PATH`，逐条串行 `runDeletionBatch()`，**禁用** `mutateArchivedSession` 的单条刷新（`{refresh:false}`）并在整批结束后统一 `refreshCoreSnapshots()` + `loadStatus(true)`（删除失败会留下 journal 并进入 quarantine，必须立刻反映到页面上）。破坏性是硬约束：第 2 步**无论条数多少都必须勾选确认**（`batchDeleting || >= BATCH_CONFIRM_THRESHOLD`），执行按钮用 `dac-button danger`、文案 `开始删除(n)`；第 3 步**不提供撤销**（永久删除无法回滚，只有归档才有「撤销本次归档」）；候选在预览时冻结，已离开归档集合或预览后有了新活动的条目跳过并列出，`session-not-archived` 视为跳过而非失败。
- `exports.__internals` 是测试专用出口（纯函数与三个批处理执行器），不构成对外契约，不得被其他包依赖。

## 验证

```bash
npm run publish:check
npm publish --dry-run
./install.sh
```

**隔离进程的无头端到端验证**（不用碰用户的 3080，也不需要真实 GUI；`0.1.7-alpha.1`、`0.1.7-rc.2`、`0.2.0-rc.2` 与 `0.2.1-alpha.2` 上都跑通过，最近一次是 2026-10-10 的 `0.2.1-alpha.2`）：

```bash
ISO=/private/tmp/dsh-cam-021-home             # 独立 DSH_HOME，绝不动 ~/.dsh；用 realpath 形式
mkdir -p "$ISO/profiles" && cp -a ~/.dsh/profiles/web "$ISO/profiles/web"
cp -p ~/.dsh/.credentials.yaml ~/.dsh/.env "$ISO/"     # 浏览器认证 secret
# 复制过去的 profile 里，link: 插件的相对 symlink 会解析失败（启动日志里一串
# "skipping profile bundle … cannot resolve"），要逐个改写成绝对路径：
for l in "$ISO"/profiles/web/node_modules/dsh-*; do
  [ -L "$l" ] && { t=$(readlink "$l"); case "$t" in /*) ;; *) tgt="/Users/zhaoliang/Documents/dsh-plugins/$(basename "$l")"; [ -d "$tgt" ] && ln -sfn "$tgt" "$l" ;; esac; }
done
# 会话数据：合法 header 的 artifact + 把 id 写进 global.archivedSessionIds（只改隔离副本）。
# 三条硬约束见上面「两个跨轮有效的新事实」与 0.2.1 记录的第三条：压缩方式必须与 profile 配置一致；
# 历史 generation 必须能解码（v2 起还必须带 delegationDepth）；macOS 上路径必须用 realpath 形式。
DSH_HOME="$ISO" dsh --profile web --port 5947 --no-open  # 记下打印的 URL（含 token）
# 用 token 换 cookie（curl -c jar "http://127.0.0.1:5947/?token=<token>"），然后：
#   GET  /dsh-chat-archive-manager/status   → {"ok":true,"deletionSupported":true,"sessionQuiescenceSupported":true,
#                                              "restorationSupported":true,"dshVersion":"0.2.1-alpha.2",…}
#   POST /delete （带 x-dsh-chat-archive-manager-client: 1 + Origin）→ 200，会话目录消失、trash 清空、journal 归 null
# 结束后只 kill 这个端口上的 PID（`lsof -nP -iTCP:5947 -sTCP:LISTEN -t`，先核对它命令行含
# `--port 5947` 与 `ps -Eww` 里的 `DSH_HOME` 再杀），再删掉 $ISO。
```

2026-10-10 的 `0.2.1-alpha.2` 那一轮把这套流程**脚本化**了（`/tmp/dsh-cam-021-verify/`：`prep-data.mjs` + `lib.mjs` + `run-a.mjs` / `run-b.mjs` / `run-baseline.mjs`），三项可复用的做法：① 造数据用**独立的准备脚本**（含 `projectKey()` 复刻），断言脚本不碰文件布局；② 宿主由脚本 `spawn`、按 `child.kill()` 停止（归属天然可证明），端口固定且每轮先 `lsof` 检查；③ 就绪判据用**首页**（未认证 401/认证 200），不能用插件路由——范围外基线里它必须是 404。

该隔离实例还会广告插件的 client bundle（`__DSH_BOOT__` 里能看到 combo URL 与 `inject`），所以"宿主路由 + boot graph"两段都能在无头环境里验证；剩下的视觉部分（设置页导航行与页面渲染）仍需真实 GUI。**取 bundle 时必须走 combo 前缀** `/plugins/??<包名>/client.js&rev=<rev>`（单包也不能省 `??`），直接取 `/plugins/<包名>/client.js` 是 404；服务端返回的是源码 + 尾部追加的 `sourceMappingURL`。

在真实进程上已逐条跑过的用例（最近一次是 2026-10-10 的 `0.2.1-alpha.2`，基线 5 + 轮次 A 68 + 轮次 B 65 项全过；全是隔离 HOME、只读复制或自造会话、跑完即删）：

| 场景 | 期望 | `0.1.7-alpha.1`（2026-09-22） | `0.1.7-rc.2`（2026-09-28） | `0.2.0-rc.2`（2026-10-01） |
|---|---|---|---|---|
| `GET /status` | 三个能力布尔 + 版本字段 | 三布尔全 true，`dshVersion: 0.1.7-alpha.1` | 三布尔全 true，`dshVersion: "0.1.7-rc.2"`、`dshVersionVerified: true` | 未认证 401；认证 200，三布尔全 true，`dshVersion: "0.2.0-rc.2"`、`dshVersionVerified: true` |
| `POST /restore`（v4 会话） | 200，归档集合收缩 | 200，与 `storages/workspace.json` 同步更新 | 200，同步更新 | 200，6→5，保留 W2 席位、存储未动 |
| 重复 `POST /restore` | 409 `session-not-archived` | 409 | 409 | 409 |
| `POST /delete`（v4 / v3+v4 并存） | 200，整目录搬移后 trash 清空、journal 归 `null` | 200，两条都通过 | 200，两条都通过（并存目录连 `session.lock` 一起消失） | 200，两条都通过（v4 用自造 zstd artifact） |
| `POST /delete`（仅 v3 未迁移 / v0 legacy） | 501 `unsupported-artifact`，文案含派生出的 generation，**不写 journal、不动文件、不 quarantine** | 501，原文「仍是旧格式（v3），DSH 尚未把它迁移为 v4…」 | 同左；v0 legacy（无 `vN` 的 `session.jsonl.zstd`）同样 501 | 同左；两次拒绝后 **journal 文件根本不存在**，status 仍三布尔 true |
| `POST /delete`（未归档 / 存储缺失 / 缺 header / 跨源） | 409 / 404 / 403 / 403 | （未逐条记录） | 409 / 404 / 403 / 403 | 同左，另加 415（非 JSON）、400（坏 JSON / 缺 id）、405（GET）、401（未认证） |
| 非空 journal（witness 属于**上一代** generation）冷启动 | 只进 quarantine，零自动处理 | 由单测覆盖 | 503 `deletion-recovery-required`；目录 inode、trash、journal 全部原样，`delete` 与 `restore` 都 503 | 同左，且**运行期注入**的中断也走同一条路：500 → 重启后 503 → 人工清事务后恢复 200 |

客户端测试职责：`test/client.test.js`（25 例，含 `resolves official icons across both DSH naming schemes and degrades without them`）覆盖 slot 注册、渲染结构、核心 service 未被改写，以及所有纯函数（分组、排序、cutoff 边界（含「所有时间」的无界 cutoff，以及仍然 fail closed 的无效日期/未知预设）、两种候选筛选、`currentSessionId()` 的 alpha.1/alpha.2 两代解析、三个批处理执行器）；`test/client-batch-flow.test.js`（11 例）用自建迷你 hook 运行时真实驱动“条件→预览→执行→撤销”、“所有时间”把滚动预设够不到的较新聊天纳入归档与永久删除两批候选、“当前会话默认排除、勾选后纳入并归档”的端到端流程、50 条确认闸门、“批量删除→逐条确认→执行→结果无撤销”，覆盖 React 接线、冻结清单和 store 刷新；`test/client-interoperability.test.js` 用同一套 stub 校验 bundle 与核心契约的互操作。新增流程分支时必须补到流程测试，不要用结构断言替代流程断言。另有 `test/interoperability.test.js`、`test/install.test.js` 覆盖 Host 侧互操作与安装脚本。

Host 测试职责：`test/archive-deletion.test.js`（23 例）用 `fakeLiveRuntime()`/`trackWriteHandle()` 复刻真实私有形状，守着卸载路径的四条边界——空闲 live 会话按 factory 顺序卸载后实删（断言 `cancel({kind:'disposed'})`、`whenIdle`、`scope.dispose`、写句柄 close、两个 store 条目摘除）、运行中或有排队输入返回 `session-busy` 且零副作用、**早先的只读校验被拒时不得卸载**（旧 generation 用例同时覆盖未压缩与 zstd）、以及校验末尾空闲复核（`persistence.stat` 里翻成 running 后必须拒绝）。运行时结构不匹配（`constructor.name` 不符）必须仍走 `session-live` 重启拒绝。generation 相关回归另有三条：`follows whatever generation the running DSH writes instead of a pinned literal`（v4/v5 都能删）、`moves the whole session directory when an unmigrated older log sits beside the current one`（v3+v4 并存时整目录搬移）、`still recognises a deletion journal recorded under the previous generation`（升级后旧 journal 仍进 quarantine，不被当成没有事务）；`pinnedSessionIds` 清理与「0.1.6 不凭空多出键」各有一条用例。

真实 GUI 验证至少覆盖（这一整段**只有在真实 GUI 里才算跑过**。`0.1.7-rc.2` 这一轮的进度：无头隔离宿主代跑了 status/boot graph 与 cold 删除；**用户真机已确认「打开归档会话 → 永久删除 → 聊天消失」**，并且删完确认弹窗关闭、该行从列表消失——这条 live 卸载路径已通过。**仍未确认**的是下面这些纯视觉项）：status/boot graph、旧版 archive Workspace 注册已移除、普通分组中不出现归档专用 Workspace、侧边栏一级“已归档”入口不存在、Settings 左侧“归档管理”菜单使用归档图标、页面标题无图标且计数以 8px 间距紧跟（含 99/100 边界）、红色删除按钮与确认 Modal、恢复到现有 Workspace / Workspace 已删除时进入未分组、live/cached delete 拒绝（运行中或有排队输入的 live 会话返回 `session-busy`；**本进程打开过的空闲 live 会话不再要求重启 `dsh web`，卸载后直接实删**——2026-09-28 真机通过）、隔离 profile 的 cold JSONL 实删；分组顺序与侧边栏一致、空组不显示、未分组桶、搜索过滤与强制展开、折叠状态、`归档先后` 排序、“匹配 n 条”与排除项提示、范围下拉（全部/各工作区/未分组）、预设档位与“1 天前”的日历边界、「所有时间」不做时间过滤且较新聊天也进入候选（归档与删除两侧）、预览逐条取消、50 条确认闸门、执行进度与中止、结果清单（跳过/失败）、「撤销本次归档」、归档后列表计数即时更新；说明段紧跟标题且工具栏在其下方、搜索框左侧是官方搜索图标、批量归档在列表上方一行最左且“展开全部”在最右（无省略号）、按钮计数为半角括号；组头为原生工作区行形态（hover 换三角箭头、整行点击展开、默认折叠）、会话行为无边框卡片（hover 出现底色、无横线、无竖引导线、文字与组标题对齐）、meta 只显示相对时间（分组“20 天”/单列表“工作区 · 20 天”，都不含原位与目录）；批量删除按钮紧跟批量归档、同为 26px、间隔 8px、底色为危险色、`deletionSupported=false` 时禁用，删除弹窗第 2 步必须勾选确认才能执行、结果页没有撤销按钮、执行后页面计数即时减少；以及**批量弹窗在 33 条候选与窄视口下标题栏与底部按钮始终可见、只有清单滚动**。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-chat-archive-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-chat-archive-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。
- 改动删除事务或新增已验证 DSH 版本的发布，按 `PUBLISHING.md` 的破坏性能力清单逐项核对。
