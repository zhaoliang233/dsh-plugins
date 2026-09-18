# dsh-chat-archive-manager 技术说明

## 边界

负责“设置”弹窗内的“归档管理”页面 UI、按工作区分组浏览、批量归档、恢复与永久删除，不创建归档专用 Workspace，也不添加侧边栏一级入口。不得修改 DSH 源码、profile 用户 patch、其他 Workspace 的业务数据或已安装的 `@deepseek-ai/*` 包。

兼容发布线 `>=0.1.6-alpha.1 <0.1.7`（`0.1.6-alpha.1` 已逐版本验证）；同线后续版本可带警告运行，但必须继续通过结构与能力检查，跨发布线前重新读源码并同步 manifest、安装脚本、文档和测试。`package.json#engines.dsh` 与同一 range 同源，`test/manifest.test.js` 有同源断言守卫。Host 在任何 legacy 迁移、私有 ABI 初始化或路由注册前从真实 CLI package 执行运行时版本门，范围外或版本来源不可验证时保持零副作用。

## Host

- `lib/index.js` 入口；`lib/archive-deletion.js` 删除事务；`lib/archive-restoration.js` 恢复事务。
- 旧版迁移路径：`$DSH_HOME/workspaces/archived`。
- `GET /dsh-chat-archive-manager/status`；`POST /delete`、`POST /restore`，body 均为 `{ "sessionId": "..." }`。
- 三个接口都先调 `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界；两个 mutation 再附加同源、`x-dsh-chat-archive-manager-client: 1` 与 `application/json` 校验。固定 header 不是认证凭据，status 也不得向未认证请求暴露 quarantine 路径或运行时诊断。
- 恢复只调公开的 `registry.unarchiveSession()`。DSH 0.1.6 另自带原生“已归档会话”设置页（section id `archived-sessions`）也做恢复，两者操作同一份 registry 归档集合、语义一致；本插件分区 id 是 `archived-chats`，定位与图标补丁不受影响。
- `removeLegacyArchiveWorkspace()` 只注销路径、标题均匹配且 `sessionIds` 为空的旧版空壳 Workspace；同路径同标题但仍有会话的碰撞必须保留。DSH 的 `registry.delete()` 保留目录和所有会话日志，迁移不得改写 `archivedSessionIds`。

### 恢复

走公开 API `WorkspaceRegistry.unarchiveSession(sessionId)`（0.1.6 起在 `dsh-workspace/lib/types/index.d.ts` 公开）：它自己 `enqueueOperation` 串行写 registry state，只从归档集合里摘掉目标 id，保留 Workspace 记账席位与顺序——原 Workspace 仍存在时保留其 `sessionIds` 席位和顺序，已删除时不重建，恢复后由 DSH 归入未分组。本插件**不再自己 `setState`**，也不再把 registry 的私有状态 writer 当作前置条件。仍然保留的 fail-closed 约束：缺 `unarchiveSession()` 直接 501；恢复与永久删除共用同一个 `runExclusive` 串行队列（删除事务进行中恢复必须排队，测试 `serializes restore behind a destructive transaction` 守着）；未归档保持 409 `session-not-archived`（`unarchiveSession()` 对未归档 id 是**幂等 no-op**，不先读集合判定就会把“没归档”吞成成功）；存在未完成的删除 journal 时整体禁用恢复并沿用 status 文案。

### 永久删除（私有 ABI 兼容层）

`assertDeletionRuntime()` 必须保持 fail closed，至少验证 registry caches、JSONL backend `root/compression/locate/stat/list`、`JsonlBackendTracker` 的 open handles/writers/pending，以及 migration preparation 与 cold-log cache；面向用户的失败信息不得硬编码已经过期的 DSH 版本号。

journal：`$DSH_HOME/dsh-archived-chats/deletions.json`——该旧命名是重命名前就已存在的持久化安全 ABI，必须继续读取，避免漏掉未完成事务并绕过 quarantine。阶段：`prepared`（durable journal 已写，尚未移动 artifact）→ `clearing`（artifact 已移入 trash，正在清核心记账）→ `committed`（核心记账已清，正在清派生状态与 trash）。

trash 必须严格等于 `<dirname(persistence.root)>/.dsh-archived-chats-trash/<transaction UUID>`，保持在 JSONL 扫描根之外；首次事务先 durable 创建 journal/trash 目录并验证 source 与 trash 的 `st_dev` 相同，确保后续 rename 可原子完成。只接受 0.1.6-alpha.1 当前 v3 generation 的 `session.v3.jsonl(.zstd)`，更早 generation 必须先由 DSH 自身迁移。正常请求在 source、trash 和最终 rm 前分别核对 JSONL header、目录 inode、日志 inode/size；未压缩 header 用 `O_NOFOLLOW` 直接读，zstd header 必须经 backend 的 `list()` 与 `stat(id)` 稳定解码，并把两次 snapshot revision、size 与前后物理 inode/size 绑定。journal 永远视为不可信持久输入：启动发现非空 transaction 时只进入 `deletion-recovery-required` quarantine，绝不自动 rename、回滚、前滚或 rm。

**`JsonlSessionPersistence.locate(meta)` 是 generation-blind 的**：只用 `cwd`+`id` 算出**当前 generation** 的路径，从不检查磁盘上实际存在哪个 generation。所以 record 里是 v3 header、目录里却只有旧 generation 文件时，`locate()` 返回的路径并不存在。`validateArtifact()` 必须先做 generation 感知探测（`lstatCurrentGenerationArtifact()`）：缺失时扫描同目录 canonical generation 名——命中旧 generation 抛非 quarantine 的 `unsupported-artifact`(501) 并给出迁移操作指引，命中更高 generation 抛格式过新的拒绝，目录里确实什么都没有才抛 `session-not-found`(404)。**禁止**让此处裸 `lstat()` 的 `ENOENT` 冒到路由层：`preflight()` 位于 quarantine `try` 之外，裸错误会被 `lib/index.js` 兜成 500 `archive-delete-incomplete`（“请重启 dsh web 后重试”），而重启永远解决不了旧 generation。

v0→v3 迁移只在 DSH **以 write 方式打开**会话时发布（`publishStoredMigration`），只读浏览只在内存里 prepare；因此旧 generation 的归档聊天必须先恢复并继续一次对话才会迁移。测试 fixture 的 `locate()` 必须复刻真实 backend 的 generation-blind 行为（由 Session 目录 + `id` 推导 v3 路径）——让 fixture 返回 `header.path` 会掩盖这条回归；旧 generation 用例须同时覆盖未压缩与 zstd 两种 artifact。

删除准入拒绝：未归档或不存在；live 且正在运行或有排队输入的 Session/Agent（`session-busy`）；tracker 中存在 open handle、writer 或 pending materialization，或存在 migration preparation；存在持久化或 live 后代；backend、artifact、符号链接或路径不符合已验证结构。任何 prepared 之后的失败都保留 journal 和现场并进入 quarantine，不自动重试或回滚；派生 sidecar/query 清理是 best effort，不阻断正常成功路径；内容寻址附件不删除。

### 空闲 live 会话的安全卸载（`detectSessionQuiescence` / `planSessionQuiescence` / `quiesceSession`）

DSH 会保留**本进程 resume 过的每一个会话**直到进程退出：agent factory 的 lifecycle `ctx.effect` 挂在 `AgentRegistry` 自己的进程级 ctx 上（`dsh-agent-loop` 的 `prepare()`），JSONL 写租约随该 handle 一直打开，而唯一的 teardown 闭包只在 `agents.resume()` 返回的私有 handle 上——`dsh-api-session-controller` 取走 `.agent` 后丢弃它，Remote 方法表里也没有 close/release。所以只在本进程打开过一次的归档聊天永远过不了 `ensureCold()`，旧行为只能让用户重启 `dsh web`。插件改为在删除前**复刻 factory 自己的卸载顺序**卸载这一个空闲会话：

- 能力探测必须 fail closed 且**不牵连冷会话删除**：`detectSessionQuiescence()` 在**服务级**校验 `agents.constructor.name === 'AgentRegistry'`、`sessions.constructor.name === 'SessionStore'`、两者的 `detachEntered` 与 `store instanceof Map`；任何一项不符返回 `undefined`，live 会话退回原来的 `session-live`（重启）拒绝，冷会话删除不受影响。**agent 实例级**形状（`ReactLoopAgent` 的 `id`/`session.id`/`phase.kind`/`status`/`inbox.hasPending`/`cancel`/`whenIdle`/`scope.dispose`）由 `assertIdleAgent()` 校验，不符抛 `unsupported-runtime`(501)——重启解决不了结构不匹配，所以此处**不**回落成重启建议。`status` 只接受 `'idle'`/`'running'`，`inbox.hasPending` 必须是 boolean：缺失即结构不符，不得被当成“忙”。
- 只有**完全空闲**才卸载：`phase.kind === 'idle'`、`status === 'idle'`、`inbox.hasPending === false`；否则抛 `session-busy`(409)。`whenIdle()` 有 30s 上限（`QUIESCE_TIMEOUT_MS`），超时只放弃本次删除，不进入半卸载状态。
- 顺序固定为 factory 的 `dispose()`：`cancel({kind:'disposed'})` → `await whenIdle()` → `scope.dispose()` → 关闭 tracker 里该 id 的写句柄（`handle.close()` 自身幂等）→ `agents.detachEntered(entry)` → `sessions.detachEntered(entry)`（两者都幂等，factory 之后真正的 teardown 因此是安全 no-op）。
- **卸载必须发生在所有只读校验之后**：`preflight()` 先只做 `planSessionQuiescence()`（零副作用），只有在归档集合、唯一 snapshot、后代、artifact/witness 全部通过后才调用 `quiesceSession()`；执行前**重新**断言一次空闲，防止校验期间落进来的 prompt 被误杀。失败一律停留在 preflight 阶段，不写 journal、不进入 quarantine。
- 依赖字段名（`store`/`detachEntered`/`phase`/`status`/`inbox`/`cancel`/`whenIdle`/`scope`）是 0.1.6-alpha.1 的私有契约，跨发布线前必须重新核对；禁止在结构不匹配时猜测执行。
- factory 自己的 `dispose()` 闭包**不可达**（只在 `agents.resume()` 的 handle 上，而 `dsh-api-session-controller` 取走 `.agent` 后丢弃它），所以这里复刻它的步骤而不调用它。该闭包仍留在 `FactoryOwnership.liveAgents` 中，将来在进程/插件卸载时执行一次：`cancel`/`whenIdle`/`scope.dispose`/`handle.close`/两个 `detachEntered` 全部幂等，因此那次执行是安全 no-op（代价是每次卸载在 ownership 里残留一个已 teardown 的闭包，仅存活到进程退出）。**禁止**改成自己调用 `handle.close()` 之外的任何“补一次清理”逻辑，那会破坏这个幂等前提。

删除与恢复必须共用一个 mutation coordinator，整个 registry operation 串行，不能只各自单飞。Persistence tombstone wrapper 必须覆盖 0.1.6-alpha.1 的 `create/open/stat/list` 入口、记录每个 ID 与全局 listing 已准入的 in-flight Promise，并在 tombstone 后 drain 再 rename；新调用必须 fail closed。恢复 exact own descriptor，原方法来自 prototype 时清理 instance wrapper，且只在当前成员仍归本插件所有时恢复。disposer 先关闭新请求、等待 operation tail，再撤 patch；它不根据 journal 做文件恢复。

## Client

- bundle：`client.js`。注入的 `<style>` 必须打 `data-plugin="dsh-chat-archive-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删）；每次 apply 重写 `textContent`，disposer 按 `dataset.references` 引用计数清理。
- 不投影 synthetic session，不改写 Workspace/session service，也不替换任何 list snapshot；管理器直接从 `workspaces.list.archivedSessionIds` 和 `sessions.list.byId` 读取权威归档集合与摘要。
- “当前打开的会话”（批量排除项之一）**不能**再读 `sessions.list.current`：DSH `0.1.6-alpha.2` 删除了该字段（视图选择移出 Session Controller，`SessionListState` 只剩 `ids`/`byId`/`phase`/`subagentsByParent`/`jobsBySession`），同一事实改由每行的本地保留计数 `byId[id].retainedBy.mainView > 0` 表达——官方 `dsh-client-ui-layout`、`-sidebar`、`-workspace`、`-settings-general` 与 `dsh-client-ui-session` 都按 `Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)` 读。解析只允许走 `currentSessionId()` 一处，且**按键是否存在**分代：alpha.1 有 `current` 键就用它（含刻意的 `undefined`，表示台上没有会话），alpha.2 无该键才回落 mainView 保留。alpha.1 的 `SessionSummary` 没有 `retainedBy`，所以“值为空即回落 mainView”在 alpha.1 上其实等价（`dsh-sticky-user-bubble` 就是这么写的）；这里仍按键存在性分代，是为了让两代语义各自成一条直线，而不是依赖“alpha.1 的行恰好没有该字段”。`ClientSessions.publishRetention()` 会把 retainedBy 写回 list snapshot 并通知订阅者，所以继续用既有的 `sessions.list` + `useSyncExternalStore` 即可，**禁止**为此新增 `retainInfo(id)` 订阅或把 list 行整表拷进 state。
- `workspaces.list` 在 DSH `0.1.6-alpha.1` 中仍是依赖接收者的 class store；传给 `useSyncExternalStore()` 的 `subscribe/getSnapshot` 必须经稳定 wrapper 调用，不能裸传方法引用。测试 Store 也必须依赖 `this`，防止该回归再次被闭包式 fixture 掩盖。
- 每行操作按红色永久删除、恢复的顺序排列；恢复成功后依赖 Host follow stream 更新快照，仅在对应 client service 仍暴露 `refresh()` 时额外主动刷新。DSH 原生 grouped/flat/search 继续隐藏尚未恢复的归档会话。
- 注册到 list slot `settings.section`：ID `archived-chats`、order `30`、导航标签 `SECTION_TITLE`（“归档管理”，与页面标题同源常量）；client manifest 依赖 `dsh-client-ui-settings-general`，确保 section slot 已声明。
- 0.1.6-alpha.1 的 section contract 不接受 icon，Settings shell 对未知 ID 固定回落齿轮。插件在 `settings.action` 注册不可见的 `dsh-chat-archive-manager.nav-icon` helper，用官方 `IconArchiveOutline20` 生成 mask，只给标签严格等于 `SECTION_TITLE` 的 nav button 加带引用计数的 `data-dac-archive-nav` 标记（标题改名时此处必须同步，否则图标补丁静默失效）；不得替换 React 管理的 SVG/子节点，关闭 Settings 或卸载时必须恢复。

### 屏蔽原生「已归档会话」页（纯客户端 DOM 补丁 + 通用设置开关）

- 开关落点是 `settings.general.item`（list slot，id `dsh-chat-archive-manager.native-archived-sessions`、order 90），组件是标题 + 描述 + **官方 primitives 的 `Switch`**，行样式逐条复刻壳层自己的通用行（`.dac-general-row`：`padding:16px 0`、`border-bottom:.5px solid var(--dsw-alias-border-l2)`、标题 14px/22px `label-primary`、描述 12px/18px `label-tertiary`、`rowText` 右侧 `padding-right:48px`）。
- 偏好存在 `localStorage['dsh-chat-archive-manager.hideNativeArchivedSessions']`（`'true'`/`'false'`，**默认 `true`**），多标签用 `storage` 事件同步；它是浏览器阅读偏好，不写 Host、profile 或 registry，因此 Host 半体与 HTTP 接口完全不变。
- **不能从 slot 里真正移除**：`SlotRegistry` 只回传自己 `register()` 的 disposer，没有公开的 unregister；`dsh-client-ui-settings-general` 的 rows 走 `ctx.slots.entries('settings.section')`（**未过滤 abdicated 的原始视图**），shadow/priority 也影响不到它。因此**禁止**改写 `ctx.slots`、它的 `entries()` 或别人的 entry 对象，屏蔽只落在 DOM 层：打 `data-dac-native-archive-hidden` 属性 + 插件自己的 `[data-dac-native-archive-hidden]{display:none!important}`（`display:none` 同时移出无障碍树与 tab 顺序）。**禁止** `remove()` 节点——那是 Settings shell 的 React 子树，外部删除会让它自己的清理抛错。
- 定位分两步，**都不读文案**：`settingsNavListButtons(nav)` 先取 nav 的**最后一个含 button 的直接子元素**（`SettingsRoot` 先渲染标题座位、再渲染 section 列表），得到 section 按钮列表；`resolveNativeArchiveNavButton()` 再把 slot 条目顺序与它 join——Settings shell 每渲染一条 `settings.section` entry 就渲染一个按钮，所以第 i 个按钮对应 `entries[i]`。守卫必须全部 fail closed：native entry 仍存在；按钮数严格等于 entry 数；label 非空；本插件自己的「归档管理」永不被隐藏。面板用 `[role="dialog"][aria-modal="true"] nav` 定位（`SettingsRoot` 固定这两个属性），不依赖哈希类名。
- 取"最后一个含按钮的直接子元素"而不是 `nav.querySelectorAll('button')`，是因为**第三方插件可以替换 `settings.header`**（single slot，用更低 priority 生效）并把按钮放进标题座位；那种按钮不属于 section 列表，不能计入按钮数，否则屏蔽会整体停用。
- **别人的环境差异不影响定位**（位置 join 与文案、语言、菜单数量都无关），已实测：第三方多注册两个 section 并插在 `archived-sessions` 前后、把 `settings.header` 换成自己的按钮、把界面切成英文——三种情况下原生行都仍被正确隐藏，且第三方菜单项与标题按钮都不被触碰。
- 屏蔽在 `apply()` 时安装（不等 Settings 打开）：`MutationObserver(childList+subtree)` 在 React 提交后的微任务里同步标记，打开设置不会看到闪烁；卸载时 `ctx.effect` 断开 observer、退订 store、移除 `storage` 监听并清掉自己打过的标记。标记带引用计数（`data-dac-native-archive-hidden-references`），一次 HMR 卸载不会恢复另一个存活 bundle 仍在屏蔽的行。
- **降级必须可见**：installer 每次 `sync()` 都向 store 写 `applied`（`true`=已隐藏、`false`=开关开着但定位不到、`null`=开关关着/未安装），开关行的 `getApplied` 订阅它，在 `suppressed && applied === false` 时于描述下方渲染 `NATIVE_SUPPRESS_UNAVAILABLE`（`.dac-general-row-note`，`--dsw-alias-state-warn-label`，`role="status"`）。**禁止**让开关显示"已开启"却什么都没发生。
- 依赖的原生契约（0.1.6-alpha.1）：section id `archived-sessions`（order 25，文案「已归档会话」/`Archived sessions`，仅用于人工核对）；nav 必须是"标题座位 + section 列表"的直接子元素结构。结构不可读、按钮数与条目数不符、或原生 entry 消失时屏蔽整体停用并显示降级提示（绝不误隐藏别的菜单项），升级 DSH 后必须用真实 GUI 重新核对本节。
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
- 候选筛选规则（`batchCandidates()`）：排除归档集合成员；子代理会话始终排除；运行中/等待交互、空白、当前打开的会话默认排除但可由用户显式勾选包含；时间条件为严格早于 cutoff（`updatedAt < cutoff`）。cutoff 来自滚动预设（24 小时 / 7 / 15 / 30 / 90 天）、“1 天前”（**包含昨天以及更早**，即本地今天 00:00；与滚动 24 小时刻意不同）或自定义日期的本地 00:00；无效日期解析为 `undefined`，此时候选为空。边界回归见 `test/client.test.js` 的 `treats 24 小时前 as a rolling window and 1 天前 as yesterday and earlier`。
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

客户端测试职责：`test/client.test.js`（29 例）覆盖 slot 注册、渲染结构、核心 service 未被改写，以及所有纯函数（分组、排序、cutoff 边界、两种候选筛选、`currentSessionId()` 的 alpha.1/alpha.2 两代解析、三个批处理执行器），其中六个用例守着原生页屏蔽：偏好默认值与 `localStorage` 往返（含被拒写降级）、`resolveNativeArchiveNavButton()` 的每个 fail-closed 分支（含"别人的环境"三态：多 section 顺序不同、英文文案）、`settingsNavListButtons()` 只取 section 列表而忽略被替换的标题座位、屏蔽/恢复/卸载清理与重新渲染后补标记、两个并存 bundle 的引用计数、以及定位不到时 `applied=false` 与降级提示；`test/client-batch-flow.test.js`（12 例）用自建迷你 hook 运行时真实驱动“条件→预览→执行→撤销”、“当前会话默认排除、勾选后纳入并归档”的端到端流程、50 条确认闸门、“批量删除→逐条确认→执行→结果无撤销”、“通用设置开关 → 导航行隐藏/恢复 → 卸载恢复”的端到端流程，以及“本布局里没有原生归档页时开关行如实提示”的降级流程，覆盖 React 接线、冻结清单和 store 刷新；`test/client-interoperability.test.js` 用同一套 stub 校验 bundle 与核心契约的互操作。新增流程分支时必须补到流程测试，不要用结构断言替代流程断言。另有 `test/interoperability.test.js`、`test/install.test.js` 覆盖 Host 侧互操作与安装脚本。

Host 测试职责：`test/archive-deletion.test.js` 用 `fakeLiveRuntime()`/`trackWriteHandle()` 复刻真实私有形状，守着卸载路径的四条边界——空闲 live 会话按 factory 顺序卸载后实删（断言 `cancel({kind:'disposed'})`、`whenIdle`、`scope.dispose`、写句柄 close、两个 store 条目摘除）、运行中或有排队输入返回 `session-busy` 且零副作用、**早先的只读校验被拒时不得卸载**（旧 generation 用例同时覆盖未压缩与 zstd）、以及校验末尾空闲复核（`persistence.stat` 里翻成 running 后必须拒绝）。运行时结构不匹配（`constructor.name` 不符）必须仍走 `session-live` 重启拒绝。

真实 GUI 验证至少覆盖：status/boot graph、旧版 archive Workspace 注册已移除、普通分组中不出现归档专用 Workspace、侧边栏一级“已归档”入口不存在、Settings 左侧“归档管理”菜单使用归档图标、页面标题无图标且计数以 8px 间距紧跟（含 99/100 边界）、红色删除按钮与确认 Modal、恢复到现有 Workspace / Workspace 已删除时进入未分组、live/cached delete 拒绝（运行中或有排队输入的 live 会话返回 `session-busy`；**本进程打开过的空闲 live 会话不再要求重启 `dsh web`，卸载后直接实删**，且删完 `lsof` 不再持有该会话的 `session.lock`）、隔离 profile 的 cold JSONL 实删；分组顺序与侧边栏一致、空组不显示、未分组桶、搜索过滤与强制展开、折叠状态、`归档先后` 排序、“匹配 n 条”与排除项提示、范围下拉（全部/各工作区/未分组）、预设档位与“1 天前”的日历边界、预览逐条取消、50 条确认闸门、执行进度与中止、结果清单（跳过/失败）、「撤销本次归档」、归档后列表计数即时更新；说明段紧跟标题且工具栏在其下方、搜索框左侧是官方搜索图标、批量归档在列表上方一行最左且“展开全部”在最右（无省略号）、按钮计数为半角括号；组头为原生工作区行形态（hover 换三角箭头、整行点击展开、默认折叠）、会话行为无边框卡片（hover 出现底色、无横线、无竖引导线、文字与组标题对齐）、meta 只显示相对时间（分组“20 天”/单列表“工作区 · 20 天”，都不含原位与目录）；批量删除按钮紧跟批量归档、同为 26px、间隔 8px、底色为危险色、`deletionSupported=false` 时禁用，删除弹窗第 2 步必须勾选确认才能执行、结果页没有撤销按钮、执行后页面计数即时减少；以及**批量弹窗在 33 条候选与窄视口下标题栏与底部按钮始终可见、只有清单滚动**；原生页屏蔽：默认时设置菜单只剩「归档管理」这一个归档入口（原生行 `display:none` 且带 `data-dac-native-archive-hidden`）、通用设置最下方的「屏蔽自带归档页」行与壳层原生行同形（16px 纵向内边距、官方 `Switch` 36×20、标题/描述字号一致）、关闭开关后原生行立即恢复且原生页可选中并正常渲染、`localStorage` 记为 `'false'`、刷新后偏好保持、重新打开开关再次隐藏，以及插件卸载/热更后行与菜单全部恢复；另外用探针插件复现"别人的环境"：多注册两个 `settings.section` 并插在原生项前后、把 `settings.header` 座位替换成自己的按钮、把界面切成英文——三种情形下原生行都仍被正确隐藏，第三方菜单项与标题按钮都不被触碰。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-chat-archive-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-chat-archive-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。
- 改动删除事务或新增已验证 DSH 版本的发布，按 `PUBLISHING.md` 的破坏性能力清单逐项核对。
