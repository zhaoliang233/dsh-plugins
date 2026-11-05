# dsh-chat-archive-manager 技术说明

## 边界

负责“设置”弹窗内的“归档管理”页面 UI、按工作区分组浏览、批量归档、恢复与永久删除，不创建归档专用 Workspace，也不添加侧边栏一级入口。不得修改 DSH 源码、profile 用户 patch、其他 Workspace 的业务数据或已安装的 `@deepseek-ai/*` 包。

### 兼容发布线（工作区规则）

兼容发布线 `>=0.2.2-alpha.2 <0.2.3`：**一个插件版本只服务它逐包核对过契约的那一条 DSH 发布线**，不为同一个版本维护跨线实现，也不把版本号当"能力开关"：

- 范围外（`0.2.1` 一线与 `0.2.3` 起，含 `0.2.3` 的 prerelease）保持 **inert**：不注册路由、不碰 registry、不做 legacy 迁移；`install.sh` 同样拒绝安装。上一线用户应留在上一线的插件版本。
- 线内后续 prerelease（`0.2.2-alpha.|beta.|rc.N` 里够到或高于 `alpha.2` 的那些，以及 `0.2.2` 正式版）带警告运行，能力探测仍是权威判定：探测不到的能力各自 fail closed（501/503）并在页面上写明原因，其余功能照常——**绝不因为版本号让整页 404**。
- **`0.2.2-alpha.2`（2026-10-28，跨线，最小兼容修复）**：逐包规范化 diff 后，`dsh-workspace`、`dsh-api-workspace-controller`、`dsh-atomic-write` 与 0.2.1-rc.4 **逐字相同**；`dsh-session-persistence-jsonl` 只在 `list()` 结果里新增 `location` 字段；`dsh-agent-loop` 的 factory 卸载顺序与 0.2.1 同构（cancel 多一个 `keepInbox` 选项，插件调用只传 reason 仍合法）；`dsh-session` 新增的「announce 完成前只读」约束不在这条删除链路上。隔离 `DSH_HOME` + 0.2.2-alpha.2 宿主实测：`/dsh-chat-archive-manager/status` 返回 200，`deletionSupported:true`、`sessionQuiescenceSupported:true`、`restorationSupported:true`，说明 `SessionStore instanceof Map`、`detachEntered`、`inbox.hasPending`、`whenIdle`、`scope.dispose`、`handle.close` 这组私有探针全部在新版成立；设置页「归档管理」分区真实渲染、0 控制台报错。**业务代码未改**，本轮只换版本门与清单。**随后用户反馈设置菜单图标空白**（2026-10-29）：0.2.2 的图标是 sprite 壳，组件 `outerHTML` 只有 `<use href="#…">`，直接作 mask 会引用独立文档里不存在的符号；已改为优先从 `primitives.ICON_SYMBOLS` 还原自包含 SVG（`selfContainedNavIcon()`），旧线无该导出时退回 `outerHTML`。
- 支持新版本 DSH 的正确做法：重新读源码核对契约差异 → 补适配与回归测试 → 同步四处同源声明（`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 的 `DSH_COMPATIBILITY_RANGE`/`DSH_VERIFIED_VERSIONS`、本文档）→ 发新版本。`test/manifest.test.js`、`test/install.test.js`、`test/host.test.js` 有同源与范围断言守卫。
- 运行时的版本分类（`classifyDshVersion`）与 `install.sh` 的 `is_compatible_dsh_version()` 语义逐字对应，且都从**发布线 + 下界**派生：`lib/index.js` 是 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`，`install.sh` 是同样的常量加一份 `prerelease_rank()`。`0.2.2` 与 `0.2.2-{alpha,beta,rc}.N` 里够到或高于 `alpha.2` 的版本在范围内，其余不在。status 里回传 `dshVersion`/`dshVersionVerified` 供页面提示。
  **下界不是 alpha 时不能沿用旧的写法**：`channel !== 'alpha' || seq >= 1` 会把 `0.2.1-alpha.9`/`0.2.1-beta.9`/`0.2.1-rc.1` 全判成兼容，必须做 channel 优先级比较。反过来**下界是 alpha 时同样不能把下界写进正则**：`0.2.2-alpha.0`/`0.2.2-alpha.1` 低于 `alpha.2` 必须被挡住，而同线内的 `beta`/`rc`（如 `0.2.2-rc.1`）都高于 alpha 下界、必须在门内——只有"发布线 + `{channel, sequence}` 下界"这一组常量能同时表达这两边。

### 跨版本必须成立的契约

这几条不随 DSH 版本变化，改契约判断前先按此处核对（逐轮逐包证据见 `docs/compat-log.md`）：

- **会话格式**：`SESSION_FORMAT_VERSION = 4`，`locate()` generation-blind，删「仅旧 generation」会话一律 fail closed（501）。
- **Workspace state**：`pinnedSessionIds`（默认 `[]`）与可选 `defaultWorkspaceId`，因此归档与 pin 互斥。
- **`generationFormat`**：只剩 `currentVersion`/`encodeHeader`/`encodeEvent`/`isUnsupportedMigrationError`——本插件不读它，形状校验也不得要求 `createRestore`。
- **`revision`**：历史会话用全语料哈希（`historicalCorpusRevision`），只对未迁移会话生效；本插件在 `lstatCurrentGenerationArtifact()` 阶段先拒，删除路径的严格相等判定不受影响。
- **`list()`**：静默跳过 `SessionPersistenceCorruptionError`、zstd header 损坏改抛该类——损坏会话可能从列表消失而不是报错。

逐版本逐包核对记录（`0.1.7-alpha.1` 起 6 轮）见 [`docs/compat-log.md`](../docs/compat-log.md)。

### 造隔离会话数据的硬约束

再造测试数据时先读这几条，否则会话会「文件里在、列表里没有」，且宿主报错指向不到这里：

- **同一 root 下所有 artifact 压缩方式一致**（`checkRootEncoding`）：混放 `.jsonl` 与 `.jsonl.zstd` 会让 `workspace` 服务在启动时抛 `encodingMismatch`，连带 `workspaceRegistry` 不可用、后续条目全部 pending。
- **历史 generation 的 artifact 必须带能解码的合法 header**：`listArtifacts()` 走 `resolveGenerationInDirectory()` + `readGenerationHeader()`，解不开的历史 generation 被静默跳过。
- **改完会话文件要同时删 `storages/session_projcache`**，否则投影缓存会让会话不显示。

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
- 依赖字段名（`store`/`detachEntered`/`phase`/`status`/`inbox`/`cancel`/`whenIdle`/`scope`）是私有契约，`0.2.2-alpha.2` 已重新核对（形状未变；factory 的 dispose 顺序仍是 cancel → whenIdle → scope.dispose → handle.close → detach，`0.2.2` 只是把 `handle.close` 改成可选链并把 `detachAgent/detachSession` 收进同一个 `try` 块）；禁止在结构不匹配时猜测执行。
- factory 自己的 `dispose()` 闭包**不可达**（只在 `agents.resume()` 的 handle 上，而 `dsh-api-session-controller` 取走 `.agent` 后丢弃它），所以这里复刻它的步骤而不调用它。该闭包仍留在 `FactoryOwnership.liveAgents` 中，将来在进程/插件卸载时执行一次：`cancel`/`whenIdle`/`scope.dispose`/`handle.close`/两个 `detachEntered` 全部幂等，因此那次执行是安全 no-op（代价是每次卸载在 ownership 里残留一个已 teardown 的闭包，仅存活到进程退出）。**禁止**改成自己调用 `handle.close()` 之外的任何“补一次清理”逻辑，那会破坏这个幂等前提。

删除与恢复必须共用一个 mutation coordinator，整个 registry operation 串行，不能只各自单飞。Persistence tombstone wrapper 必须覆盖 `create/open/stat/list` 入口（两代签名与返回键集相同）、记录每个 ID 与全局 listing 已准入的 in-flight Promise，并在 tombstone 后 drain 再 rename；新调用必须 fail closed。恢复 exact own descriptor，原方法来自 prototype 时清理 instance wrapper，且只在当前成员仍归本插件所有时恢复。disposer 先关闭新请求、等待 operation tail，再撤 patch；它不根据 journal 做文件恢复。

## Client

- bundle：`client.js`。注入的 `<style>` 必须打 `data-plugin="dsh-chat-archive-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删）；每次 apply 重写 `textContent`，disposer 按 `dataset.references` 引用计数清理。
- 不投影 synthetic session，不改写 Workspace/session service，也不替换任何 list snapshot；管理器直接从 `workspaces.list.archivedSessionIds` 和 `sessions.list.byId` 读取权威归档集合与摘要。
- “当前打开的会话”（批量排除项之一）**不能**再读 `sessions.list.current`：本发布线的 `SessionListState` 只有 `ids`/`byId`/`phase`/`projectionsBySession`（`0.1.7-alpha.1` 与 `0.1.7-rc.2` 都是这四个键，构造点是 `dsh-api-session-controller` 里唯一的 `this.list.set({ ids, byId, phase, projectionsBySession })`；`current` 键不存在。**本文档早期写的 `subagentsByParent`/`jobsBySession` 是记错的字段名**——这两个名字在整棵 DSH 安装树里 0 命中，而插件只读 `byId`/`ids`，所以运行从未受影响），同一事实由每行的本地保留计数 `byId[id].retainedBy.mainView > 0` 表达——官方 `dsh-client-ui-layout`、`-sidebar`、`-workspace`、`-settings-general` 与 `dsh-client-ui-session` 都按 `Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)` 读。`currentSessionId()` 里的“有 `current` 键就用它”分支是 0.1.6-alpha.1 遗留的**直读兜底**（不是跨线承诺）：本进程的 list 没有该键时一律走高保真路径，测试同时钉住两种形状，防止将来某个字段回来时静默改变语义。`ClientSessions.publishRetention()` 会把 retainedBy 写回 list snapshot 并通知订阅者，所以继续用既有的 `sessions.list` + `useSyncExternalStore` 即可，**禁止**为此新增 `retainInfo(id)` 订阅或把 list 行整表拷进 state。
- `workspaces.list` 在本发布线中仍是依赖接收者的 class store；传给 `useSyncExternalStore()` 的 `subscribe/getSnapshot` 必须经稳定 wrapper 调用，不能裸传方法引用。测试 Store 也必须依赖 `this`，防止该回归再次被闭包式 fixture 掩盖。
- 每行操作按红色永久删除、恢复的顺序排列；恢复成功后依赖 Host follow stream 更新快照，仅在对应 client service 仍暴露 `refresh()` 时额外主动刷新。DSH 原生 grouped/flat/search 继续隐藏尚未恢复的归档会话。
- 注册到 list slot `settings.section`：ID `archived-chats`、order `140`（插件分区一律 ≥ 100，排在 DSH 自带分区之后。本发布线的内置分区是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20，最大的内置项是 agent-presets 20；同 slot 的连续分配见根 `AGENTS.md`，本包排最后）、导航标签 `SECTION_TITLE`（“归档管理”，与页面标题同源常量）；client manifest 依赖 `dsh-client-ui-settings-general`，确保 section slot 已声明。导航图标 helper 与分区同号。**0.2.2-alpha.3 起壳层把 fallback 图标包进 `span.navIcon[aria-hidden=true]`**；本包为兼容 alpha.2 仍用「原 svg 透明 + ::before 绝对定位」补丁，新结构下必须同时把包装层里的内部 svg 设为 `opacity:0`，否则齿轮会和自定义图标并排。
- **图标名不要写死成一个名字，且档位词 Regular 优先**：`0.1.7` 把官方图标从数字档位改名成档位词（`IconArchiveOutline20`→`IconArchiveOutlineRegular`、`IconFolderOpen16`→`IconFolderOpenRegular`、`IconTriangleRightFill14`→`IconTriangleRightFillRegular`），旧数字名在本版本构建里**不存在**，`require` 回来是 `undefined`、图标静默变空白。bundle 顶部用 `iconOf('…Regular', '…Medium', '…16')` 逐名取第一个存在的导出，全缺时退化成空组件（不让整个 bundle 挂掉）。
  **为什么 Regular 排第一**：`…Medium` 与 `…Regular` 是同一基础组件的两个包装器，几何完全一样，只差 `strokeWidth`（0.1.7 构建里 `Medium` 传 `1.3`、`Regular` 传 `1.0`），而官方客户端各处用的是 Regular——排错顺序插件图标会比相邻壳层图标重约 30%。`test/client.test.js` 的 `both-tier-words` 模式（两档并存时断言挑 Regular）钉住这条，`check.js` 只看「链上至少有一个名字存在」，不看顺序。
- 本发布线的 section contract 不接受 icon，Settings shell 对未知 ID 固定回落齿轮。插件在 `settings.action` 注册不可见的 `dsh-chat-archive-manager.nav-icon` helper，用官方归档图标生成 mask（**0.2.2 起必须优先从 `ICON_SYMBOLS` 还原自包含 SVG**：组件 `outerHTML` 只有 `<use>`，直接作 mask 会空白），只给标签严格等于 `SECTION_TITLE` 的 nav button 加带引用计数的 `data-dac-archive-nav` 标记（标题改名时此处必须同步，否则图标补丁静默失效）；不得替换 React 管理的 SVG/子节点，关闭 Settings 或卸载时必须恢复。

- 页面顺序固定为标题行 → 说明段 → 工具栏 → 操作行 → 列表（说明紧跟标题，交互控件在说明之下）；标题是无图标单行 `h2`，可见计数以 8px 间距紧跟标题，`0..99` 原样显示、超过 99 统一显示 `99+ 条聊天`。只有永久删除继续使用显式二次确认 Modal。不得重新注册 `sidebar.footer.action` 或修改 Cordis 底部入口。

### 分组与批量操作（纯客户端）

- 分组复刻 DSH 侧边栏：每工作区一组、按 `workspaces.list.items` 顺序、只渲染非空组，其余归“未分组”；默认全部折叠，搜索命中强制展开。
- 组头与侧边栏工作区行同形（treeitem、整行可点、Enter/Space、16×20 图标槽、计数）；会话行是无边框卡片，hover 用 `--dsw-alias-interactive-bg-hover`，标题 13px、meta 12px；组间 12px、组内 2px，禁止横线分隔；会话行左侧缩进 20px，使文字与组头标题对齐；meta 只显示相对时间（分组不带工作区，单列表带“工作区 · N 天”）。
- 表单控件：所有 select/日期输入必须包在 `.dac-select-field` 内，由插件自绘指示器；mask 用的 `--dac-*-glyph` 变量必须定义在控件自身（Modal portal 后祖先变量不继承），SVG data URI 整体 `encodeURIComponent`。
- 工具栏只放搜索框、视图选择、排序选择；搜索框自绘官方 `IconSearchOutline16`。列表正上方唯一一行固定「批量归档」→「批量删除」，折叠按钮贴最右；批量删除用危险色，`deletionSupported !== true` 时禁用。
- 页面说明是单段合并文案、紧跟标题、在工具栏之上；恢复回到原 Workspace，原 Workspace 已删除才进未分组；永久删除移除会话日志但不删共享附件。`capabilityNote` 按能力分支装配。
- 排序：`最近更新`（updatedAt 降序、id tiebreak）/ `归档先后`（archivedSessionIds 追加序）。视图：分组 / 单列表。`buildArchivedRows()` 必须报告读不到摘要的 id 数。
- 批量归档只用 `workspaces.archiveSession()`，顺序执行、每条 durable；`typeof workspaces.archiveSession !== 'function'` 时整条入口禁用。候选：排除归档、子代理；运行中/等待交互/空白/当前会话默认排除但可显式勾选；时间条件严格早于 cutoff（24h/7/15/30/90 天、1 天前=本地今天 00:00、自定义、所有时间=+Infinity）。
- 三步流程：条件（实时匹配/排除计数）→ 预览（冻结候选、逐条取消、≥50 条必须勾选）→ 执行（串行、i/N、中止、结果、撤销本次归档）。按钮计数用半角括号紧跟文字。
- 弹窗布局：动作按钮走 `Modal.footer`，标题栏常驻，只有内部清单滚动；批量弹窗 `dac-content-batch`，`.dac-batch` 内部滚动链打通到 DSH `.content`/`.body`。
- 批量删除复用同一套三步弹窗，候选宇宙只能是 `archivedSessionIds`；第 2 步无论条数都必须勾选确认，执行按钮危险色，第 3 步不提供撤销；`session-not-archived` 视为跳过。
- `exports.__internals` 是测试专用出口，不构成对外契约。
- UI 历史取舍见 `CHANGELOG.md`；当前规则由 `test/client.test.js` 与 `test/client-batch-flow.test.js` 守住。

## 验证

```bash
npm run publish:check
npm publish --dry-run
./install.sh
```

最近一次完整 E2E 在 `0.2.1-alpha.2`（2026-10-10，隔离 HOME；轮次 A 38/38 + 轮次 B 20/20）；`0.2.2-alpha.2`（2026-10-28）只做了隔离宿主路由与 GUI 渲染复核：`/status` 200、三能力 true、设置页分区渲染、0 控制台报错。完整 E2E 表与逐步数据见 `docs/compat-log.md` 的 J3 / 隔离宿主轮次。

- 客户端测试：`test/client.test.js`（25 例）覆盖 slot 注册、渲染结构、核心 service 不被改写、分组/排序/cutoff 边界（含「所有时间」无界 cutoff）、两种候选筛选、`currentSessionId()` 两代解析、三个批处理执行器；`test/client-batch-flow.test.js`（11 例）覆盖条件→预览→执行→撤销、所有时间、当前会话排除/勾选纳入、50 条确认闸门、批量删除无撤销；`test/client-interoperability.test.js` 校验 bundle 与核心契约互操作。
- Host 测试：`test/archive-deletion.test.js`（23 例）守护空闲 live 会话按 factory 顺序卸载、忙时零副作用、只读校验被拒时不卸载、校验末尾空闲复核；generation 回归三条（跟随运行代、v3+v4 整目录搬移、旧 journal 仍 quarantine）。
- 真实 GUI 必须覆盖：状态/boot graph、旧 archive Workspace 已移除、Settings 分区与图标、页面标题/计数、分组/排序/搜索/折叠、批量归档与批量删除三步流程、50 条确认闸门、执行进度/中止/结果、恢复与永久删除确认、窄视口弹窗。视觉项以真机为准；纯逻辑项由上面的单测覆盖。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-chat-archive-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 改动删除事务或新增已验证 DSH 版本的发布，按 `PUBLISHING.md` 的破坏性能力清单逐项核对。
