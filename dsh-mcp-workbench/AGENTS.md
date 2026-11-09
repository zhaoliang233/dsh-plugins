# dsh-mcp-workbench — 技术说明（AGENTS.md）

> 面向在本工作区继续开发/排查的 agent；用户文档见 `README.md`。
> 目标 DSH `0.2.2`，兼容线 `>=0.2.2-alpha.2 <0.2.3`；`0.2.2-alpha.2` 做过完整验证（单测 104 项 + 真机 GUI 52/52 + 鉴权/CSRF + 动态挂载与凭据链实测 + 导航图标六项）；`0.2.2-rc.1`（2026-11-05）做的是同线例行核对：逐包 diff + 隔离宿主路由/启动图/设置面板实测，**未重跑真机 GUI 52 项**。上一线 `0.2.1` 的用户留在上一线的插件版本。

**`0.2.2-rc.1`（2026-11-05，同线例行）**：`dsh-mcp-client`（Config/`createMcpToolDefinition`/超时默认值）与 `dsh-client-connection`（`requestRejection` 三段判据）逐字相同；`dsh-web-app` 只新增 `ui-file-actions`/`ui-context-menu` 两个客户端条目；`cordis` 4.1 的 `fiber.store` → `committed`/`provisions`、`entry.fiber` 改存 wrapper（`config`/`state`/`dispose` 走原型链，读取不受影响）都不改本包用法；`dsh-settings.configure()` 的 owner 归一化同样不影响传 `ctx.fiber`。隔离宿主实测 `/status` 200 `runtime:ready`、启动图含本包。未覆盖：真机 GUI 52 项与真实 MCP 端点长连接。

## 一句话

把「MCP 服务器清单」做成设置页可维护的数据（**本插件在 profile 里的条目配置**），并在 host 面把它投影成真正运行的 `@deepseek-ai/dsh-mcp-client` 实例——不改用户手写的组合层条目，不需要重启宿主。

## 已核对的契约（不是猜测）

| 事实 | 来源 |
|---|---|
| `@deepseek-ai/dsh-mcp-client` 是「命名导出、无 default」的 ESM 模块：`{ Config, apply, createMcpToolDefinition, inject, name }`，`inject = ['tools']` | `dsh-mcp-client/lib/index.js:761-763,835` |
| **官方已有动态挂载先例**：`dsh-acp` 用 `import * as McpClient from '@deepseek-ai/dsh-mcp-client'` + `agentCtx.plugin(McpClient, config)` 逐台挂载会话级 MCP | `dsh-acp/lib/index.js:12,218` |
| Cordis `plugin()` 接受「带 `apply` 的对象」，并从同一对象读 `Config` 与 `inject` | `cordis/lib/index.js:1445-1447,1618-1634` |
| `serverName` 在「注册作用域」内互斥，无 scope 时锚在 `ctx.root` → 与 profile 里手写的 MCP 行共享同一套名字空间 | `dsh-mcp-client/lib/index.js:812-820` |
| `fiber.dispose()` 会关 transport、停重连、注销工具与 resource provider、释放 serverName 预留 | `dsh-mcp-client/lib/index.js:700-715,825-830` |
| `serverName` 语法 `/^[A-Za-z0-9_-]{1,32}$/`；`toolCallTimeoutMs` 默认 60000；`failOnStartupError` 默认 false | `dsh-mcp-client/lib/index.js:767,774-800` |
| 工具表**每个 step** 由 system prompt 组装时重新收集（`assemble()` → `orderTools(collected…)`），`toolsChanged()` 会开新一轮请求 | `dsh-system-prompt/lib/index.js:287-352`；`dsh-agent-loop/lib/index.js:890,1020-1030` |
| `ctx.loader.import(name)` 以 profile 目录为解析锚点（源码 `link:` 安装也能解析内部包）；`createRequire(<DSH 安装>/package.json)` 是兜底 | `cordis-plugin-loader/lib/index.js:269-283,746-751`；`dsh-app-boot/lib/index.js:2551` |
| 凭据：`ctx.credentials.resolve/describe/set/unset`；`credentialRef` 的 brand 在运行期是空操作（普通字符串即可）；优先级「进程环境 > .credentials.yaml > .env（只读兜底）」 | `dsh-credentials/lib/index.js:21-24`；`dsh-brand/lib/index.js`；`dsh-credentials-local/lib/index.js:473-519` |
| 浏览器侧凭据数据面是生成式 remote：`ctx.remote.credentials.describe([ref])` / `.set(ref, value)` / `.unset(ref)`，返回 `{ok,value,error}`，value 是 `{configured,writable,source}` | `dsh-api-settings-controller/lib/index.js:146-180`；`typert.remote-client.js:112-175`；官方用法见 `dsh-client-ui-settings-plugins/lib/client.js:1507,1547` |
| 设置**就是条目 config**（0.1.7 起）：插件在模块作用域导出 schemastery `Config`，loader 在 `plugin()` 时读 `plugin.Config`；`settings.describe()` 的 `ns` = 条目 id，客户端 `ctx.configForms.get(id)` → `{getSnapshot,subscribe,mutate,set,unset}`；0.1.6 的 `settings.register(ns, schema)` 与客户端 `settingsScope` 都已不存在 | `dsh-settings/lib/index.js` 的 `describe/update/replace/mutate`；`dsh-config-editor/lib/index.js` 的 `documentPath/edit`；`dsh-client-ui-settings/lib/client.js` 的 `configForms` 服务与 `lib/types/client/config-form-types.d.ts` |
| **字段声明 `.volatile()` 才免重启**：loader 在「只有 volatile 字段变化」时就地更新运行中 fiber 的引用（`_commitVolatile`）并发出 `loader/volatile-update`（payload 是变化字段路径）；schema 解析结果里 volatile 字段是 cosmokit 引用对象，读实时值靠 `ref.get()` | `cordis-plugin-loader/lib/index.js:365-425` |
| 官方设置写入的落盘位置就是 profile 的 patch（`profileContext.patchPath`）：`withFileLock(package.json)` + YAML Document 保注释 + `!!js` tag 还原，只改**自己条目**的 `config`，写后 `reconcileProfilePatches` | `dsh-config-editor/lib/index.js:85-125` |
| 设置条目要在 `settings.describe()` 里出现，才可写（否则客户端快照 `status:'unavailable'`、动作控件禁用）；`settings.configure({auto:false}, fiber)` 用来声明「本实例自带设置页」 | `dsh-settings/lib/index.js` 的 `describe/configure` |
| 设置页导航图标：`settings.section` 没有 `icon` 选项；0.2.2-alpha.3 起壳层另有 `settings.section.icon`（list/root/inline），并把 fallback 图标包进 `span.navIcon[aria-hidden=true]`。本包为兼容 alpha.2 仍做 DOM 补丁，CSS 需同时隐藏直接 `svg` 与新包装层/内部 svg | `dsh-client-ui-settings-general/lib/client.js` 的 `SettingsPanel`/`navIcon`；完整手法见 `dsh-extra-context/AGENTS.md`「实现事实 4」 |
| `ctx.webServer.register({kind,path,handler})` 重复路径 throw；浏览器边界要先过 `connection.requestRejection`，再 loopback/同源/固定客户端头。**`connection` 必须用 `ctx.inject` 等就绪，不能 `ctx.get('connection')` 抓一次**：cordis 的 `get(name, strict)` 在服务 fiber 未 active 时返回 undefined（2026-10-29 在 0.2.2 上实测到，路由因此跳过了连接层鉴权） | `dsh-host-webserver/lib/index.js:171-183`；`dsh-local-plugin-manager/AGENTS.md`「安全」；M2 |
| Loader 条目暴露 `entry.options.{id,name,config}` 与 `entry.fiber.state`（`entry.disabled` 表示未启用） | `cordis-plugin-loader/lib/index.js:154-176`；`dsh-host-plugin-inventory/lib/index.js:110-117` |

## 隔离环境里的实机验证（机制层，已做）

用独立 `DSH_HOME=/tmp/dsh-mcp-spike/home` + 从 web 模板新建的 `mcpspike` profile，挂一个临时探针插件，自建最小 stdio MCP 服务器（换行分帧，帧格式依据 `@modelcontextprotocol/client/dist/src-D_zzAWoS.mjs` 的 `serializeMessage` / `ReadBuffer`）：

| 步骤 | 实测结果 |
|---|---|
| 模块加载 | 落地策略 `loader-import`（`ctx.loader.import`），导出 `[Config, apply, createMcpToolDefinition, inject, name]` |
| 首次挂载 stdio | `knownNames` 从 `[]` → `['mcp__spike__spike_echo']` |
| `fiber.dispose()` | 工具回到 `[]`，子进程被回收 |
| 再挂载同一 serverName | 又能挂上（预留已释放）→ 启停可反复 |
| 动态挂载 streamable-http（真实 Figma MCP 端点） | 挂载后拿到 `mcp__figma__get_design_context` 等 6 个工具，dispose 后全部消失 |

结论：动态挂载/卸载、两种传输、与 host 全局工具层的关系都已证实。**这份探针不在交付包里**（在 `/tmp/dsh-mcp-spike/`），但它证明了 README 里「不需要重启」的说法。（这张表是 0.1.6 线做的；0.1.7 线的等价路径由下面那张表和真机 GUI 验收覆盖。）

## 验收判据

在隔离宿主上四项全过才算通过：`/status` 未认证 401、认证后 200；boot graph 中 `dsh-mcp-workbench` 出现 4 处（id/url/rev/inject）；`npm run gui:check` 52/52；凭据走 `credentials`、明文 0 次进入 profile 配置或请求载荷。

同线的其它 prerelease 带警告运行、能力探测仍是权威判定；`0.2.2` 正式版按判据在门内，发布后把它加进 `VERIFIED_DSH_VERSIONS` 与 `install.sh` 清单。

逐轮实测记录（`0.1.7-alpha.2` / `0.1.7-rc.2` / `0.2.0-rc.2` / `0.2.1-alpha.2` / `0.2.1-rc.2` / `0.2.2-alpha.2`）见 [`docs/compat-log.md`](../docs/compat-log.md)。

## 结构

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口：**模块作用域**导出 schemastery `Config`、版本门、异步装配（加载 mcp-client）、`loader/volatile-update` → 对账、状态/动作路由、HTTP 安全细节 |
| `lib/dsh.js` | DSH 安装定位、版本门分类、`loader.import` → 安装绝对路径的两级模块加载、插件对象解包 |
| `lib/store.js` | 纯逻辑：规范化、校验、`credential:KEY` 占位符、`mountConfigFor`（生成 mcp-client Config）、状态投影（不回显值） |
| `lib/plan.js` | 纯逻辑：设置与已挂载实例的对账计划（挂/卸/拦/不变） |
| `lib/mount-manager.js` | 运行态：`ctx.plugin` 挂载、`fiber.dispose` 卸载、凭据解析、`ctx.tools.view()` 取工具名、捕获 mcp-client 日志 |
| `lib/targets.js` | 纯逻辑：把 loader 里的 MCP 行投影成只读视图（脱敏：URL 去查询串、stdio 只给可执行文件名与参数个数、env/header 只给键名） |
| `client.js` | 单文件 CJS 惰性 bundle：设置分区（`settings.section` order 130 = 插件设置入口一律 ≥ 100、排在 DSH 自带分区之后；同 slot 的连续分配见根 `AGENTS.md`）、经 `configForms.get('dsh-mcp-workbench')` 读写条目配置、编辑器、凭据区、只读的配置文件条目、导航图标补丁、样式注入 |
| `test/harness.js` | 测试用的小 React 运行时（可渲染、可点击），守住"接线"这一类缺陷 |
| `scripts/gui-flow.mjs` | 真机 GUI 验收（CDP + 无头 Chrome），不进发布物 |
| `scripts/fixture-mcp-server.mjs` | 自检用的最小 stdio MCP 服务器（只服务 dev 脚本，不进发布物） |

## 关键实现事实

1. **条目 config（= 设置）是唯一真相，运行态是它的投影。** 0.1.7 里这份真相由 loader 的 volatile 引用承载：写入 → `loader/volatile-update` → `reconcile('settings')`；任何写入都只产生一份对账计划（`plan.js`），由挂载管理器执行，组件不直接挂载东西。对账幂等：配置指纹（`canonicalJson(config)`）相同就不动。
2. **"验证前置"是配置层不变量，别把它简化掉**：客户端里唯一能写 `servers` 内容的路径是 `saveDraft()`，它在 `verification.status !== 'ok'` 时直接 return；宿主侧 `verify` 又先跑 `validateServer` + serverName 冲突检查再探针，所以"验证通过"⇒"校验通过"。其余写路径只动 `enabled`（开关）或整体删除。**结论：正常使用下，托管清单里不可能出现"配置不完整"的条目**。它仍可能来自三种外部情况——旧版本（验证前置之前）存下的条目、手工编辑 profile 配置里本插件的 `servers`、别的进程写同一段配置——此时界面如实显示"被拦 + 原因 + 铅笔可改"，而不是替用户删数据。

3. **被拦下的条目刻意不进 `wantedIds`。** 否则「把已挂载的条目改坏」会留下旧实例继续跑，界面显示新配置、实际跑旧配置（`test/plan.test.js` 有守卫）。
4. **改配置走「先卸后挂」**，不做原地 restart：中间态可解释，失败也不会留下半个连接。
5. **凭据占位符在挂载时才替换成明文**：`mountConfigFor(server, substitute)`；缺失即拦下不挂载（而不是把占位符当字面值发出去）。
6. **状态接口不回显值**：`describeServer()` 只给 `envKeys`/`headerKeys`/`credentialRefs`，`targets.js` 对组合层条目额外做 URL 去查询串与 stdio 参数计数处理（组合层 `!!js` 求值后可能已经是明文）。
7. **`serverName` 不做静默清洗**：非法字符必须由校验报出来，否则界面上的名字与实际挂载用的名字会不一致（`normalizeServer` 只 trim，`validateServer` 负责报错）。
8. **样式由插件（`apply`）持有，不是组件**：按 `data-plugin` + `data-owner` 打标、引用计数清理，元素存活但文本过期时重写文本（HMR 先卸旧 fiber 再挂新 fiber，组件级注入会漏，见 `dsh-extra-context` 的同类踩坑）。
9. **导航图标补丁三处必须同源**：`dataset.dmwNavIcon`、CSS 选择器 `[data-dmw-nav-icon]`、CSS 变量 `--dmw-nav-icon-mask`；引用计数落在按钮 dataset 上，按钮被壳层重建后由 `MutationObserver` 补回（`test/client.test.js` 有守护）。**0.2.2 起图标是 sprite 壳**：组件 `outerHTML` 只有 `<use href="#…">`，直接作 mask 会空白；`navIconSymbolSource()` 优先从 `primitives.ICON_SYMBOLS` 还原自包含 SVG，旧线无该导出时退回 `outerHTML`。**0.2.2-alpha.3 起壳层把 fallback 图标包进 `span.navIcon[aria-hidden=true]`**：CSS 必须同时隐藏直接 `svg`、该包装层和内部 svg，否则会出现「自定义图标 + 齿轮」两个。
10. **`failOnStartupError` 默认关闭**（跟随 mcp-client 组合默认）：连不上仍挂载并自动重连，状态行显示最近日志；勾选后失败即记 `failed`。
11. **写设置用一次原子 `mutate`**：`servers` 与 `enabled` 一起提交（`{op:'set', path:[...]}`），而不是两次 `set`——两次会有两个 revision 栅栏，中途失败就留下半套配置。

12. **写后刷新要等对账追上**：客户端所有写路径调 `refreshAfterWrite()`（带写入时刻重读，直到 `lastReconcile.at >= since`）。见「已知边界」里第 2 个真机发现的缺陷。

12.5 **`credential:键名` 在界面上不可见但仍是存储格式**：`splitCredential()`/`joinCredential()` 负责「前缀 + 键名 + 后缀」与占位符互转（空键名也算凭据形态，用户刚点开开关时要能继续输入；键名非法则原文留在后缀里并给提示，绝不吞输入）。

13. **新增/编辑走弹窗；「保存」= 自动验证 + 落盘**：`ServerDialog` 用官方 `Modal`（props：`open`/`onClose`/`title`/`closeLabel`/`description`/`className`/`footer`），表单本体 `ServerEditor` 两个入口共用。用户要求去掉单独的「验证」按钮（"过于繁琐"）：`saveDraft()` 里先 `postAction({action:'verify'})`，**通过才写盘**，失败就把原因留在弹窗里、不落盘。宿主不支持 verify（缺 `actions` 或回 400）时保存按钮直接禁用并提示重启。点「+」**不再**直接落条目（早先的版本会留下一条永远连不上的空配置）。

14. **验证 = 宿主侧一次性探针**（`mountManager.probe()`）：用独立的临时 `serverName`（`probe<随机>`）挂载一份配置，`failOnStartupError: true` 让"连不上"变成确定失败，20 秒超时兜住慢服务器，拿到 `ctx.tools.view()` 里该前缀的工具名后**立刻 dispose**（失败路径也 dispose）。临时名不会发给对端（`serverName` 只是本地命名空间），因此既不与已挂载实例抢预留，也不会在"编辑时保持原名"时撞上自己。

15. **客户端与宿主做动作能力握手**：状态载荷带 `actions`（`['reconcile','verify']`）。客户端在 `actions` **缺失或不含 verify** 时，直接禁用「验证」并在弹窗里提示"宿主进程还是旧版本，去重启 dsh web"——这正是"客户端刷新即新、宿主半体必须重启"这个部署特性造成的中间态（用户实测反馈过：点验证一律报错，看起来像配置坏了）。点击时若仍收到 `400 unknown action`，再兜一层同样的提示（`postAction` 的 catch 里按 `/unknown action/` 识别）。该字段与 `verify` 同时引入，所以"没有该字段"等价于"宿主没有 verify"。

15.5 **两处能力判定要看不同的东西**：`actions` 判断"宿主半体是否够新"（上面那条）；`settingsAvailable` 判断"本条目能不能写"（= `Config` 构造成功 + settings 服务在，见 `statusPayload`），客户端据此显示"改动无法持久化"的红条、快照 `status:'unavailable'` 时也会给出原因。**读实时值只认 volatile 引用**（`readField` 里 `typeof value.get === 'function'` 才调用），因为测试桩给的是普通值。

16. **改 `lib/*.js` 要重启宿主，改 `client.js` 只需刷新页面**：`link:` 安装不复制文件，但宿主半体是启动时加载的模块（profile 的 HMR 根是空数组，不会热更宿主代码），浏览器侧 bundle 每次页面加载都从磁盘重新取。这个差异会让"新客户端 + 旧宿主"短暂并存，见上一条的握手。

17. **导入读 `entry.fiber.config`，不是 `entry.options.config`**：后者存的是**未求值**的 `!!js` 表达式对象（`{ __jsExpr: … }`），求值发生在插件构造时（cordis 的 `internal/config` 瀑布 → `interpolate()`），结果只落在 `fiber.config`（`_resolveConfig()` 的产物，含 Config schema 默认值）。用 `options.config` 导入会静默丢字段——本插件实测踩到：导 jira 时 URL 与 `Authorization` 全没了，因为那个值不是字符串而是表达式对象，被 `typeof value !== 'string'` 过滤掉了。没有运行实例（禁用/加载失败的条目）时读不到实际取值，此时明确报错而不是导入一份残缺配置。

18. **动作路由必须整体兜底**：`handler` 里统包一层 try/catch，任何异常都返回可读 JSON。少这一层时，未捕获的拒绝会让 node:http 直接回一个**空 body 的 400**，页面上只显示"宿主拒绝了该操作"，完全无法排查（本次实测踩到，根因是路由里误用了 `apply()` 的闭包变量 `settingsView`——路由只能通过 `hooks` 拿）。

19. **完整导入的形态**：`importDraftFromConfig()` 把 loader 里的配置拆成「普通字段照抄 + 敏感字段转 `credential:键名`」，宿主再把明文写进凭据库（`importFromProfileEntry()`，不返回明文）。敏感判定 = 键名匹配 `/KEY|TOKEN|SECRET|PASSWORD|AUTH/i`、值形如 `Bearer|Basic xxx`、或 URL 带凭据（查询串里 `token|key|secret|password|sig|api-key` 参数 / userinfo）——URL 命中时整条 URL 进凭据库（它没法只替换一段），因此 `mountConfigFor()` 现在也会对 URL 做凭据替换（客户端 `credentialRefsOf` 同样要把 URL 算进去）。

20. **凭据占位符有四个落点，必须同源**（`credential:<KEY>` 是**本插件自己的语法**，不是 DSH 核心约定：`dsh-mcp-client` 只收最终明文，别的插件也没有这个写法）。四个落点是：① `mount-manager.credentialSubstituter()` 预解析键（**URL 也要算**）；② `store.mountConfigFor()` 对 env/headers/**url** 做替换；③ `store.describeServer().credentialRefs` 回给状态页；④ 客户端 `credentialRefsOf` 决定弹窗凭据区给不给输入框。**2026-09-18 修过一次真实裂缝**：①③④ 原本只看 env/headers，于是 URL 里的 `credential:KEY` 表现为"挂载认识它、却永远报缺凭据、界面也没地方填"——四处补齐后 URL 占位符才算能用（`test/mount-manager.test.js`、`test/store.test.js`、`test/client.test.js` 各有一条守卫）。`args`/`cwd`/`serverName` 不做替换，占位符写在那里只会当字面值发出去。

21. **键名没有语义**：`KEY` 只是 credentials 存储的名字（`/^[A-Za-z_][A-Za-z0-9_]*$/`），用户随便取，同一个键可被多条服务器复用、也能命中已有环境变量。导入时 `credentialKeyFor()` 生成 `MCP_<SERVERNAME>_<FIELD>_<KEY>`（如 `MCP_JIRA_HEADERS_AUTHORIZATION`）**纯粹是自动命名**，代码里没有任何 jira/atlassian 专有分支（用户专门问过这点，别再让他误会）。

22. **模块解析两级**：`ctx.loader.import` 优先（profile 锚点，源码与 registry 安装都行），失败再按 DSH 安装绝对路径 `createRequire().resolve()`；两级都失败则 `runtime = 'mcp-client-unavailable'`，此时只提供状态页、不挂载任何东西（fail closed，且不影响宿主启动）。

23. **路由鉴权必须以连接层为准，且连接层不可用时 fail closed**（2026-10-29，M2）：0.2.2 隔离宿主上实测 `/status` 无 cookie 也回 200。根因是 `registerRoutes` 在 `ctx.inject(['webServer'])` 回调里 `webCtx.get('connection')` 抓一次，而 `webServer` 与 `connection` 是兄弟服务、谁先 active 没有保证——抓到的 `connection` 是 `undefined`，`clientRequestRejection` 于是只走了同源 + 固定头。修复：`ctx.inject(['webServer', 'connection'])` 等两者就绪，`clientRequestRejection` 在连接层缺失时直接 401（不再放行）。`scripts/gui-flow.mjs` 的交叉核对改用带 token 的 URL 换一份会话 cookie（Node fetch 不共享浏览器 HttpOnly cookie），状态接口非 200 时直接报可读错误。**以后新增任何宿主路由都照这个形状写，别用 `ctx.get` 探测鉴权服务。**

## 凭据写入这条链（2026-09-18 修过一个"点了没反应"的缺陷）

用户实测："凭据的保存按钮似乎没有作用，点了保存没反应，状态还是未配置"。**根因是客户端注入声明少了 `remote.credentials`**：

- 客户端的 Cordis 里**带点号的命名空间本身就是服务名**，只注入 `remote` 时读 `ctx.remote.credentials` 会**同步抛**
  `cannot get property "remote.credentials" without inject`（官方同一套数据面的写法：`dsh-client-ui-settings-plugins/lib/client.js` 的 inject 里同时写了 `"remote"` 与 `"remote.credentials"`）。
- 那个异常发生在 `save()` 的 `setBusyRef` **之前**，`ctx?.remote?.credentials` 这种可选链**拦不住**（属性访问本身就是抛点），于是界面表现是"点了完全没反应"；`CredentialBox.load()` 同样被拒，状态一直停在 `未配置`。
- 修法两处：① inject 补上 `'remote.credentials'`；② 取服务改成 `credentialsApi()`（内部 try/catch），拿不到服务时把 `凭据服务不可用：<原话>` 写在凭据区里，按钮保持可用但点了会说明原因（`test/client.test.js` 有守卫：inject 数组必须含 `remote.credentials`，且抛错场景要显示原因而不是静默）。
- **验收缺口**：`scripts/gui-flow.mjs` 之前只断言"凭据区出现了、按钮尺寸对"，**从没点过一次真正的保存**——所以这个缺陷漏到了用户手里。现在补了 3 条：填值后按钮可用、点保存后状态变成「已配置 · file」、页面上不出现明文（隔离宿主上的 `.credentials.yaml` 里确实多了这条记录）。
- 顺带修掉一个交互坑：凭据区以前只统计"有名字的行"里的引用，用户点「凭据」但还没给行起名字时看不到凭据区；现在按行的**值**统计（名字为空的行仍在保存时被丢掉）。

## 表单与布局（当前规则）

- 弹窗 680px、三段卡片（基本信息 / 连接方式 / 环境变量或请求头）；高级项 `<details>` 默认收起；验证状态在 footer `.dmw-verify`，`dmw-dialog-footer` / `dmw-form` / `.dmw-field` 等选择器保留。
- 传输方式是分段控件，底层仍是两个原生 radio；测试与 GUI 按 `input[type=radio]` 顺序操作。
- 新增时 `serverName` 留空用占位符，label 里的 `(工具前缀为 mcp__<名字>__)` 随输入实时更新；必填项带 `*`，非必填不写“（可空）”。
- 校验只在宿主 `verify` 做；「保存」= 先验证、通过才落盘；`FooterStatus` 负责 idle / running / ok / failed / stale。
- 凭据不是手写占位符：环境变量/请求头用结构化行 + 「凭据」开关 + 键名输入；存储格式仍是 `[前缀]credential:键名[后缀]`。凭据区只列当前草稿引用，值不回显；候选键来自其它托管条目，减去当前草稿已用键。
- 请求头一行是多行卡片：第一行名字 + 「凭据」+ 删除；下面每行一个字段（`值` 或 `前缀` + `凭据键名` + 可选 `后缀`）。`FieldLine` 是唯一字段行结构，URL 复用。`PrefixField` 提供「不加前缀 / Bearer / Basic / 其它…」，自定义值留在组件本地，不写进设置。
- 下拉箭头自绘：`.dmw-select{appearance:none;height:34px;padding:0 30px 0 10px}` + 官方 `IconChevronDownOutlineMedium`；键名候选用「用过的键」芯片，不用原生 `datalist`。
- `.dmw-fields` 用 grid + `.dmw-field-line{display:contents}` 共享标签列，保证标签同宽、输入框左缘对齐（只能真机量）。
- 尺寸：`.dmw-btn-sm` 28px 高，行尾图标按钮 26px；输入框 34px；同一行判据是垂直中心对齐 + 纵向重叠，不是 top 相等。
- 状态只在列表行显示一次：带底色 chip（ok/warn/error/停用），完整原因在 `title` 与编辑弹窗。列表一行：左开关 / 中名称+命名空间+状态 tag / 右编辑+删除。
- 工具清单放在「已连接 · N 个工具」的官方 `Tooltip`：宽 ≤ min(360, 面板宽-32)，高 ≤ 面板可见高且不超过锚点侧剩余空间；内边距由 `.dmw-tip-content` 补；滚轮从锚点转发给清单；只有已连接且有工具才挂。
- 凭据提示保留一句：密钥点「凭据」，值存进凭据库、界面不回显、可复用；直接填写的值会明文存进设置文件。
- `rowsToRecord()` 丢掉名字为空的行；`recordToRows()` 反向回显；不做文本往返，避免吞掉未写完的行。
- UI 历史取舍见 `CHANGELOG.md`；当前规则由 `test/client.test.js` 与 `scripts/gui-flow.mjs` 的接线/几何断言守住。

## 已知边界

- **只写自己那一条，不改写用户手写的行**：`cordis.patch.yml` 里可能有手写注释与 `!!js` 表达式；组合层的 MCP 行只读展示 + 导入，不改写（与 `dsh-local-plugin-manager` 的受管区块策略不同——这里没有必须落盘的持久层，官方设置通道会写本插件自己条目的 `config`，那是官方 `configEditor` 的行为，不是本插件在编辑 YAML）。
- **别人条目的变化不会触发对账，但会即时提示**：运行期往 patch 里加一条与托管条目同名的行时，状态接口每次读取都会给出 `conflictNote`（纯读，不产生挂载动作）；真正把它列入 `blocked` 并停掉托管实例要等下一次对账（本插件条目 config 变化、凭据写入或手动「重新对账」）。中间这段时间里，配置文件那一条会自己报 `serverName already in use` 而加载失败。
- **被拦条目每轮对账都会重算，这是"能从被拦恢复"的前提**：`planReconcile` 里被拦的条目**不进** `unchanged`，所以"缺凭据 → 补上凭据 → 再对账即挂载"这条路是通的（代价是它每轮都会被重试一次）。注意 `lastReconcile.mounted` 是**本轮候选**而不是"挂上了"：凭据缺失是在 `mount-manager.reconcile` 里、`mount()` 之前才补进 `blocked` 的（`plan.js` 是同步纯函数，凭据 `resolve()` 是异步的，判定只能放在后面），而 `mounted` 直接由 `plan.mount` 映射而来——所以同一轮里一个条目**可以同时出现在 `mounted` 和 `blocked`**。判断真实结果只看状态接口的 `live.state`。
- **在 profile 的 `cordis.patch.yml` 里加"新条目"必须用 `- insert:` 形态**：该文件是 patch 层，顶层裸 `- id: …` 只表示"改一条**已存在**的条目"，写新 id 时 DSH 只打印 `patch: entry "…" not found`（不报错、不新增，很容易误以为"写进去了"）。本插件自己的 `cordis.patch.yml` 用的就是 `- insert:`，照抄即可。
- **`~/.dsh/.env` 里的 token 仍需重启**才能被 `!!js process.env.X` 看到——那是进程启动快照，与本插件无关；托管条目 + `credential:KEY` 才是免重启路线。
- **凭据来源为进程环境时只读**：`describe()` 返回 `writable:false`，界面会禁用输入。
- 删除托管条目不会删除已写入的 `.credentials.yaml` 记录（凭据可能被别的条目共用）。
- **升级中间态**：改了 `lib/*.js` 之后、用户重启之前，弹窗会提示"宿主还是旧版本"并禁用「保存」；这是设计行为，不是故障。
- **没有常驻的「验证」按钮**：验证是 `saveDraft()` 内部的一步（点了保存才发生），已保存条目的真实状态由列表行承担。
- **验证不通过就存不下来**：这是刻意的（用户明确要求"验证没问题才保存"）。因此服务器暂时连不上时也无法先存下配置——需要把服务器起起来再保存，或临时改成一个能连上的配置。**如果用户要的是"验证失败也照样存下来"（便于先把离线服务器登记好），改动很小：`saveDraft()` 里把失败分支的 `return` 去掉即可**，但要同步改这条边界说明与测试。

## 验证现状

```bash
npm run check
npm test
npm run pack:check
npm run publish:check
npm run gui:check -- --url '<带 token 的隔离宿主 URL>' --cdp-port 9333
```

当前判据：`/status` 未认证 401 / 认证 200；boot graph 中 `dsh-mcp-workbench` 出现 4 处；`npm test` 104/104；`gui:check` 52/52；凭据走 `credentials`、明文 0 次进入 profile 配置或请求载荷。历史逐轮数据（0.1.7-alpha.2 起）见 `docs/compat-log.md` 的 B3 / G2 / M2。

- `gui:check` 用隔离宿主（`DSH_HOME=/tmp/... dsh --profile web --port <非 3080> --no-open`），不要 `--port 0`；先关首启引导弹层，定位弹窗用 `.dmw-dialog`；0.2.2 起先用带 token 的 URL 换会话 cookie，否则状态接口 401。
- 导入断言约定：profile 第 1 行是带 `Authorization` 的 URL 条目、服务器名 `patchy2`；换隔离环境时同步改脚本期望名。新增条目必须 `- insert:`。
- `test/client.test.js` 在 `node:vm` 里加载 bundle，用 `test/harness.js` 的可渲染 React 桩；接线守卫覆盖「点 + 只开弹窗」「保存先 verify」「缺 actions / unknown action 提示重启」「写完等对账追上」。
- 导航图标几何用 `verify-nav-icon.js --plugin dsh-mcp-workbench --label 'MCP 服务器' --icon IconLinkOutlineMedium --measure` 离线量；样式注入先注入再登记 `ctx.effect`。
- `scripts/gui-flow.mjs` 必须能报死：请求 id 当场捕获、连接 close 时 reject 在途请求、5 分钟看门狗 + 步骤名。

## 发布与安装路线

> **已于 2026-11-09 首发 `0.1.0`**：原名 `dsh-mcp-console` 被第三方 `dakuo <coderkuo@gmail.com>` 占用（`0.1.11`，2026-10-14 发布，描述与我们的功能几乎逐字雷同），因此改名为 `dsh-mcp-workbench`（`npm view` 实测 `E404`）；按下面「改名时要同步的落点」改完八处并重跑闸门后，按根 `AGENTS.md`「新包首次发布」三步走（占位 `0.0.1` → trusted publisher → tag 触发 OIDC）。registry 上的 `dsh-mcp-console@0.1.11` 属于第三方，不是我们的版本。
> 历史：2026-10-08 旧名 `dsh-mcp-manager` 撞名后改到 `dsh-mcp-console`；完整改名证据见 `docs/compat-log.md` 的 E1 / E3。
> 后续发版直接走根 `AGENTS.md` 的常规发布流程：改 `package.json#version` → CHANGELOG → `npm run publish:check` → 打 `<包名>-v<版本>` tag → push，由 `release.yml` 经 OIDC 发布并三项判据核对。

### 改名时要同步的落点

| # | 落点 | 说明 |
|---|---|---|
| 1 | `package.json#name` | 包名本体：profile 依赖键、`dsh plugin add` 的参数、npm trusted publisher 配置都是它 |
| 2 | `cordis.patch.yml` 的 `- id:` 与 `name:` | profile 里的 loader 条目 id 与模块名，**两行都要改**且 id 必须等于包名 |
| 3 | `client.js` 顶部的 `window.__ModuleLoader__.load({ id: … })` | 就是 `dsh.client` 那半体在浏览器 boot graph 里的注册名；与包名不一致时 bundle 不会被加载（页面毫无反应） |
| 4 | `lib/store.js` 的 `PLUGIN_NAME` 与 `SETTINGS_ENTRY` | 「两处常量」。后者是设置条目 id（= 包名），客户端 `configForms.get()` 与宿主 `settings.describe()` 的 `ns` 都靠它 |
| 5 | `client.js` 内部的 `PLUGIN_ID` / `SETTINGS_ENTRY` 字面量 | 客户端 bundle 是 CJS 单文件、读不到宿主常量，必须手改 |
| 6 | 路由与固定头名（可选，但**两处必须同源**） | `lib/index.js` 与 `client.js` 各有一份 `STATUS_PATH` / `ACTION_PATH` / `CLIENT_HEADER` / `CSRF_HEADER` |
| 7 | `uninstall.sh` 的 `remove <包名>`、两个脚本的提示文案、README / AGENTS.md / CHANGELOG / `docs/compat-log.md` 里的包名 | 脚本与文档 |
| 8 | 测试与验收脚本里的字面量 | `test/host.test.js`（`SETTINGS_ENTRY`、`CLIENT_HEADER`/`CSRF_HEADER`）、`test/client.test.js`、`scripts/gui-flow.mjs` 的状态接口头 |

**只改其中一处不会报错**，症状分别是「设置页没有分区」（条目 id 与客户端 `configForms.get()` 对不上）或「插件进了 profile 但页面毫无反应」（bundle 注册名 ≠ 包名）——`test/manifest.test.js` 的第一条用例（包名/条目 id/bundle id 四处同源）就是为这个加的，改名前先让它变绿再改。

改完必须重跑：`npm run publish:check`（含改名守卫）、`node tools/dsh-icons/verify-nav-icon.js --plugin <新包名> --measure`（六项）、以及 `npm run gui:check` 一次——客户端 bundle 的注册名变了，这一轮最容易漏。

> **2026-10-08 已按上表执行过一轮**：`dsh-mcp-manager` → `dsh-mcp-console`。八处落点全改：包名、`cordis.patch.yml` 的 id/name、bundle 注册名、`PLUGIN_NAME`/`SETTINGS_ENTRY`/`SECTION_ID`、路由与两个固定头名、测试与验收脚本字面量、文档；内部短前缀 `dmm` → `dmc`（CSS 类名 + 导航补丁的 dataset/CSS 选择器/CSS 变量三处同源），目录随包名一起改。**当时记下的一条教训：旧名目录改名后 `dsh plugin remove <旧名>` 会失败**（`node_modules` 里的 `link:` 符号链接已悬空 → `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`，且它可能已先把依赖删掉、只留下 bundle 列表里的旧项），需要手工清理。
>
> **2026-11-09 再执行一轮（同一张表）**：`dsh-mcp-console` → `dsh-mcp-workbench`（旧名被第三方占用，见上一节）。八处落点全改，内部短前缀 `dmc` → `dmw`——顺带消除了与 `dsh-mobile-compat` 的 `dmc` 前缀撞车（那个插件用 `.dmc-*` / `--dmc-*`），目录用 `git mv` 随包名改。本机 profile 这次按正确顺序迁移：**先** `dsh plugin remove dsh-mcp-console`（此时目录还在、link 未悬空）→ 再改目录与源码 → 再 `add link:` 新目录，并把 profile patch 里的 `- id:` 改成新 id。闸门：`npm run publish:check` **104/104**、打包 12 个文件、`tools/dsh-icons/build.js` 重建快照且 `check.js` 无漂移、`verify-nav-icon.js --plugin dsh-mcp-workbench --measure` **六项全过**。真机 GUI 52 项本轮未重跑（bundle 注册名变了，首次安装后按「验证现状」跑一轮）。

### 其余

- 用户路线：`dsh plugin --profile web add <包名>`（升级必须显式写 `@<版本>`）；`./install.sh` 只服务源码 `link:` 开发路线，它会先跑 `npm run publish:check` 再调用官方 `dsh plugin add`。
- 本包**没有运行时依赖**（`dependencies` 为空），因此 release 工作流不需要为它装依赖。
- 发布：`npm run publish:check` 是唯一闸门（语法 + 测试 + 打包白名单），`prepublishOnly` 已绑定；改名之后由根仓库 `.github/workflows/release.yml` 收到 `<新包名>-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（tag 名要跟着新包名走）。
- 兼容线四处同源：`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 的版本门、本文件与 `lib/dsh.js` 的 `DSH_COMPATIBILITY_RANGE`。

## 排查顺序

1. 设置页没有「MCP 服务器」分区 → 确认 profile bundle 列表已包含 `dsh-mcp-workbench`（需重启），并看宿主日志里的 `dsh-mcp-workbench:` 前缀告警。
2. 页面顶部红条说「无法加载 @deepseek-ai/dsh-mcp-client」→ 看状态接口返回的 `mcpModule.errors`（两级解析都失败）。
3. 条目显示被拦 → 读 `blockedReason`：校验未过 / 与配置文件重名 / 凭据未配置。
4. 保存成功但没有工具 → 看该行的最近日志（重连、tools/list 失败），以及服务器是否本来就无工具能力。
5. 弹窗里写着"宿主进程还是旧版本"、保存按钮是灰的 → 宿主半体是旧的：请用户重启 `dsh web`（客户端刷新即新，宿主必须重启才加载）。
6. 设置页红条说"宿主这一条没有可写的设置 schema"、写入被拒 → 状态接口看 `settingsAvailable`：为 `false` 说明 `Config` 没构造出来（schemastery 定位失败，宿主日志有 `dsh-mcp-workbench:` 前缀告警）或条目不在 `settings.describe()` 里（profile 组成里没有这一条）。
7. 想确认宿主真实状态与支持的动作 → 先用带 token 的 URL 换会话 cookie（`curl -c /tmp/mcp-cookie.txt 'http://127.0.0.1:3080/?token=<token>'`），再 `curl -s -b /tmp/mcp-cookie.txt -H 'x-dsh-mcp-workbench-client: 1' http://127.0.0.1:3080/dsh-mcp-workbench/status | python3 -m json.tool`（同源 + loopback + 会话才放行；没有 cookie 是 401，`actions` 字段就是宿主的能力清单）。
8. 判断"到底是客户端新还是宿主新" → 比一下宿主进程启动时间与 `lib/*.js` 的修改时间：
   `ps -o lstart= -p <pid>` vs `ls -l lib/*.js`。
