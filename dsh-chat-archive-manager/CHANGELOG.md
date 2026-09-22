# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.8] - 2026-09-22

### 修复

- **DSH `0.1.7-alpha.1` 下归档管理页取不到数据（HTTP 404）**：旧的兼容发布线停在 0.1.6，宿主半体在 0.1.7 上按设计保持 inert，于是客户端那一行菜单还在、页面却打不开。本版本把发布线推进到 `>=0.1.7-alpha.1 <0.1.8`（`0.1.7-alpha.1` 逐包核对契约），0.1.7 上线内正常挂载并注册路由。
- **永久删除在 `0.1.7-alpha.1` 上 100% 失败（501 `unsupported-artifact`）**：`0.1.7` 把会话日志从 v3 升到 v4（`session.v4.jsonl[.zstd]`），而代码里写死了 v3 白名单。现在日志 generation 从 `persistence.locate()` 返回的规范路径反解，跟随运行中的 DSH 实际写的 generation；同目录里 v3 与 v4 并存（DSH 迁移后保留源文件）也被正确接受，整段会话目录一起搬移。
- **图标全部渲染为空白**：`0.1.7` 把官方图标从数字档位改名成档位词（`IconSearchOutline16` → `IconSearchOutlineMedium`，`…Medium`/`…Regular` 同几何），旧名字在 0.1.7 构建里不存在、`require` 回来是 `undefined`。现在按候选顺序取第一个存在的导出，一个都取不到时退化成空组件，不影响 bundle 加载。

### 变更

- 兼容发布线推进到 `>=0.1.7-alpha.1 <0.1.8`（`verifiedVersions = ["0.1.7-alpha.1"]`），四处同源更新：manifest、`engines.dsh`、`install.sh` 的版本门与已核对清单、插件文档；范围外（0.1.6 及更早、0.1.8 起）保持 inert。
- 永久删除顺带清掉 `0.1.7` 新增的 `pinnedSessionIds` 席位（pin 与 archive 互斥），避免侧栏为已删除的会话补出置顶成员；该字段不存在时不改动 state 形状。

### 移除

- **「屏蔽自带归档页」通用设置**：`0.1.7` 起 DSH 自己删掉了原生「已归档会话」设置页，这个开关已经没有可屏蔽的对象，连同它的 DOM 补丁、`localStorage` 偏好与相关测试一并移除。需要隐藏原生页的旧 DSH 用户请继续使用上一个插件版本。

## [0.1.7] - 2026-09-19

### 新增

- 批量归档与批量删除的时间条件新增「所有时间」（下拉第一项）：不做时间过滤，所选范围里的全部聊天都参与候选，用于一次性清理所有时间的对话。原有滚动预设最多只到 90 天，表达不了“不过滤”。
- 选中后时间条件标题变为「时间条件（不做时间过滤）」，批量弹窗内的时间口径说明同步补充。

### 说明

- 「所有时间」由 `resolveCutoff()` 返回 `Number.POSITIVE_INFINITY` 表达，两个候选筛选函数的守卫相应从 `Number.isFinite` 改为只拒绝缺失/`NaN`——否则 `+Infinity` 会被当成非法值，选项会静默变成“匹配 0 条”。
- 默认时间条件仍是「30 天前」，只有显式选择才不做时间过滤；子代理会话、运行中/空白、当前打开会话的默认排除都不变。

## [0.1.6] - 2026-09-18

### 修复

- 修复 DSH `0.1.6-alpha.2` 下「批量归档 / 批量删除」不再排除**当前打开的会话**：alpha.2 删除了 `sessions.list.current`（视图选择移出 Session Controller），同一事实改由每行的本地保留计数 `retainedBy.mainView` 表达。现在按键是否存在分代解析：alpha.1 仍用 `current`（含刻意表示"台上没有会话"的 `undefined`），alpha.2 回落 `mainView` 保留——与壳层 layout/sidebar/workspace/设置页的同源读法一致，两代行为相同。
- 同步测试：候选筛选夹具改用 alpha.2 的 list 形状（删除 `current`、改用 `retainedBy.mainView`），永久删除用例补上"已归档且在当前会话上"的行让该排除真正被断言，并新增"当前会话默认排除、显式勾选后纳入并归档"的端到端流程用例与两代解析单测。

## [0.1.5] - 2026-09-17

### 新增

- “设置 → 通用”新增「屏蔽自带归档页」开关（默认开启）：隐藏 DSH 自带的「已归档会话」设置页，设置菜单里只保留本插件的「归档管理」；关闭开关后原生页立即恢复显示。
- 偏好（`hideNativeArchivedSessions`）保存在浏览器本地 `localStorage`，多标签页自动同步；不写 Host 配置、profile 或 registry，因此 Host 半体与 HTTP 接口没有任何变化。

### 说明

- 屏蔽是**客户端 DOM 补丁**（DSH 的 slot 系统没有公开的 unregister，原生页必须留在 slot 里）：按 `settings.section` 的 slot 顺序定位那一行导航按钮，打上 `data-dac-native-archive-hidden` 标记后用插件自己的 `display:none` 规则隐藏，卸载时全部还原。
- 定位只认位置：先取设置面板导航里那段 section 列表（忽略被第三方插件替换过的标题区），再按 slot 条目顺序对齐，**不比对菜单文案**。因此别人多装几个设置页、菜单顺序不同、界面切成英文，屏蔽都照常生效（已用探针插件逐项实测）。
- 所有守卫 fail closed：原生分区已不存在、section 列表按钮数与 slot 条目数不一致、按钮标签为空，或目标恰好是本插件自己的「归档管理」时，屏蔽整体停用并保留原生页，不会误隐藏别的菜单项。
- 屏蔽无法生效时，开关行下方会显示「未能定位 DSH 自带的「已归档会话」菜单项，原生页保持显示」——开关不会显示“已开启”却什么都没发生。

## [0.1.4] - 2026-09-17

### 修复

- 修正 `package.json#description`：设置入口与页面标题在 0.1.2 已改名为「归档管理」，包描述此前仍写着「已归档」聊天管理——该文案会出现在 npm 页面与本地插件列表里。

## [0.1.3] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「功能 → 要求 → 安装与卸载 → 使用 → 永久删除的语义 → 注意事项」，只描述当前行为。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-chat-archive-manager`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- 沿革（候选改名、名称可用性核对、发布前元数据要求）移入 `AGENTS.md` 与历史条目。

## [0.1.2] - 2026-09-17

首个公开发布到 npm registry 的版本。

### 变更

- 恢复改走公开的 `WorkspaceRegistry.unarchiveSession()`，不再直接写 registry state：私有 writer 不再是前置条件，恢复继续排在破坏性事务之后，未归档 id 仍返回 409 `session-not-archived`。
- 每行都改成与 DSH 自带归档页同形的卡片：无分隔线、8px 圆角、hover 出现底色、标题 13px、副标题 12px 弱化。hover 用 `--dsw-alias-interactive-bg-hover`，而不是原生页的 `--dsw-alias-bg-layer-1`（后者在浅色主题下就是面板底色，等于没有 hover 效果）。
- 用相对最近更新（`20 天`、`1 个月`）取代绝对时间戳，并从副标题里去掉恢复位置与目录名；工作区名只在单列表中作为开头。
- 工作区分组之间改用间距区分，去掉嵌套组的竖直引导线，只靠组头表达工作区。
- 设置入口与页面标题由 `已归档` 改名为 `归档管理`（导航标签、页面标题与图标补丁共用同一个 `SECTION_TITLE` 常量）。
- 页面说明段移到标题正下方、控件（搜索/视图/排序）移到说明之下，页面顺序固定为 标题 → 说明 → 控件 → 操作 → 列表。
- `批量归档` 从工具栏移到列表正上方唯一一行的最左端，`展开全部/折叠全部` 留在最右端；该行始终渲染，只有折叠按钮是条件渲染。
- 搜索框改用外壳自带的搜索图标（绝对定位在框内，输入区左侧留出 36px）。

### 新增

- 列表正上方一行增加 `批量删除`：与批量归档同一套三步弹窗，但作用于归档聊天本身并以永久删除结束；与单行「永久删除」同款危险色，与 `批量归档` 保持 8px 间距，宿主无可用删除能力时整体禁用，无论几条都必须勾选确认，逐条串行并支持进度与中止，结果页没有撤销。
- 按工作区分组浏览：只渲染非空组，其余进入唯一的“未分组”桶，每组带计数；归档聊天保留原 Workspace 的席位，恢复时回到原位置。
- 搜索框（标题 / 目录 / 工作区）、`按工作区分组`/`单列表` 视图切换，以及 `最近更新`/`归档先后` 排序（归档顺序取自 `archivedSessionIds` 的追加序，因为 DSH 不记录归档时间戳）。
- 批量归档的三步流程：范围（全部 / 某个工作区 / 未分组）加时间条件（24 小时、1/7/15/30/90 天，或自定义日期的本地 00:00）、冻结预览、执行进度与中止、逐条失败报告，以及针对刚归档批次的「撤销本次归档」。范围只在弹窗内选择，页面不再重复提供按工作区的入口。
- 批量入口文案固定为不带省略号的 `批量归档`（避免被读成正在执行）；`1 天前` 取本地今天 00:00，刻意不与滚动 24 小时重复。
- 弹窗标题与操作按钮常驻：动作按钮放进 Modal 的 `footer`，只有聊天列表滚动。
- 组头渲染成 DSH 自己的工作区行：随展开状态切换的文件夹图标、hover 时替换为并随展开旋转的箭头、标题与弱化计数，34px 一行、整行可点。
- 所有工作区分组默认折叠，`展开全部/折叠全部` 是列表上方一行里的紧凑按钮。
- 自绘下拉与日期指示器（不依赖浏览器原生箭头），日期字段与下拉同款，图标用主题色、点击控件任意位置都能打开日历。
- 把 mask 变量定义在控件自身并对 SVG 数据 URI 做百分号编码，修掉批量弹窗（portal 到 `document.body`）里继承不到变量时出现的实心方块指示器。
- 预览默认全选（内部存的是被取消勾选的 id），`全选/全不选` 是汇总行里的 26px 紧凑按钮；取消到 0 条时汇总文案会说明并禁用归档按钮。
- 批量候选默认排除运行中/等待交互、空白、当前打开以及全部子代理聊天；每个排除项都是显式勾选框，并实时显示可用与排除条数。
- 预览与执行之间出现新活动的聊天会被跳过并列出；超过 50 条需要显式勾选确认。
- 读不到摘要的归档 id 会被报告，而不是静默丢弃。

### 修复

- 注入的样式表补打 `data-plugin="dsh-chat-archive-manager"`，避免未打标签的样式被别的 bundle 认领、升级后残留，导致页面继续使用上一代规则直到手动刷新。
- 本进程打开过、当前已空闲的归档聊天现在可以直接永久删除，不再一律要求重启 `dsh web`：在所有只读校验通过后，按 agent factory 自己的卸载顺序卸载这一个空闲会话（取消 driver、等待活动结束、dispose agent scope、释放 JSONL 写租约、摘除两个 registry 条目），并在真正卸载前重新确认空闲。运行中或有排队输入的会话仍返回 `session-busy`；私有结构与已验证形状不符时保持原有的 fail-closed 拒绝。
- 永久删除确认弹窗会说明：仍开在当前 `dsh web` 的聊天会先关闭其会话再删除。

### 说明

- 两组批量功能都是纯客户端改动：归档使用 DSH 自带的 `workspaces.archiveSession()` 客户端命令，因此没有新增宿主路由、私有 ABI 访问或 Workspace 记账改写；批量归档每条一次 durable 宿主操作，串行执行。
- 客户端 controller 未暴露 `archiveSession` 时批量归档与撤销自动禁用；撤销还需要宿主恢复路由可用；两种情况下列表分组都仍然可用。

## [0.1.1] - 本地候选

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对 Host、客户端、Web 认证、Settings slot、Workspace registry、Session controller 与 JSONL 持久化契约：JSONL backend 只在 `Session.fromRestore` 上新增了消息投影参数，fail-closed 的删除运行时仍可解析，隔离宿主报告 `deletionSupported`/`restorationSupported` 为 true。兼容线移到 `>=0.1.6-alpha.1 <0.1.7`，仅 `0.1.6-alpha.1` 逐版本验证。
- 兼容线收窄为 `>=0.1.5-alpha.1 <0.1.6`，仅 `0.1.5-alpha.1` 逐版本验证；另核对本地运行的 `0.1.5-rc.1` 的删除 ABI，但**不**把它列入已验证清单（没有做过完整端到端删除/恢复）。

### 修复

- 对 DSH 尚未迁移到当前 v3 generation 的日志（`session.jsonl[.zstd]`、`session.vN.jsonl[.zstd]`）返回明确的 `unsupported-artifact` 迁移提示。`JsonlSessionPersistence.locate()` 是 generation-blind 的，此前会探测一个不存在的 v3 路径并抛出裸 `ENOENT`，最终变成“请重启 dsh web 后重试”这种永远不可能成功的失败。
- 在列举与校验之间消失的 artifact 返回 `session-not-found`(404)，而不是内部错误。
- 测试 fixture 改为复刻真实的 generation-blind `locate()` 契约，旧 generation 回归同时覆盖未压缩与 zstd 两种 artifact。
- 永久删除从已移除的 coordinator 与直接持久化调用迁移到 `0.1.5-alpha.1` 的 `create/open/stat/list` handle 模型。
- 增加对 `JsonlBackendTracker`、open writers/handles、pending materialization、迁移准备、压缩模式与 cold-log cache 形状的 fail-closed 探测。
- 把未压缩与 zstd 两种删除 witness 绑定到匹配的 `list()`/`stat()` revision、backend 解码的 header 与物理 inode/size 观测。
- tombstone 守卫在 rename 前先 drain 已准入的单会话操作与全局列举，之后拒绝 create/open/stat，并在卸载时恢复精确 descriptor。

## [0.1.0] - 本地候选

### 新增

- 直接以 DSH 权威的 `archivedSessionIds` 为数据源的设置页归档管理。
- 一键恢复走串行宿主路由，保留既有记账或回落到“未分组”。
- 明确的永久删除确认，以及不产生重复 Workspace 分组的归档计数。
- 在 DSH `>=0.1.2-alpha.3 <0.1.3` 兼容线上支持未压缩与 zstd JSONL 删除，alpha.3 与 alpha.4 逐版本验证。
- 同文件系统的 durable 删除事务，带 source/trash identity witness 与 fail-closed quarantine。
- 对冷会话、coordinator cache、后代、路径、符号链接与 journal 的校验。
- 尽力清理派生状态，同时保留内容寻址附件。
- Node.js 20/22 CI、manifest 检查、精确打包内容校验与本地发布清单。

### 变更

- 包名与插件身份从冲突的本地候选 `dsh-archived-chats` 改为 `dsh-chat-archive-manager`。
- 归档管理从侧边栏底部一级入口移到“设置”导航，DSH 自带的动态 Cordis 插件入口保持独立。
- 设置导航复用归档图标，紧凑计数紧跟单行标题，并封顶为 `99+ 条聊天`。
- 增加行级红色永久删除样式，恢复操作紧随其后。
- 移除 synthetic 的分组视图归档投影，以及所有 Host/浏览器的 Workspace 命令拦截器。
- 升级时注销 `$DSH_HOME/workspaces/archived` 这一旧版空壳 Workspace 注册，保留其目录、会话日志、原 Workspace 记账与归档集合。

### 修复

- React 订阅时保留 DSH alpha.3/alpha.4 Workspace class store 的接收者，避免归档设置页渲染成空白。
- 用当前的 Session 与 Workspace controller 包替换已移除的 `dsh-client-runtime` manifest 依赖。
- 声明有界兼容线与 alpha.3/alpha.4 验证清单；本地安装与 Host 启动在任何迁移、私有 ABI 初始化或路由注册前拒绝范围外的 DSH。
- 非对象 JSON 根作为客户端错误返回，不再冒成内部失败。

### 安全

- 非空删除 journal 永不触发自动重命名、回滚、前滚或递归删除。
- 运行时私有的删除能力在校验的 backend、registry、coordinator 或 cache ABI 不匹配时自动关闭。
- 恢复与删除复用 DSH `connection.requestRejection()` 的 trusted-host 与签名浏览器 cookie 认证，随后要求同源且带标记的 JSON 请求作为额外 CSRF 防线。
