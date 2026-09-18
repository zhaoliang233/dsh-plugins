# dsh-mcp-manager — 技术说明（AGENTS.md）

> 面向在本工作区继续开发/排查的 agent；用户文档见 `README.md`。
> 目标 DSH `0.1.6-alpha.1`，兼容线 `>=0.1.6-alpha.1 <0.1.7`；逐版本验证过 `0.1.6-alpha.1` 与 `0.1.6-alpha.2`（后者跑过完整单测 + 真机 GUI 验收）。

## 一句话

把「MCP 服务器清单」做成设置页可维护的数据（settings 命名空间 `mcp-manager`），并在 host 面把它投影成真正运行的 `@deepseek-ai/dsh-mcp-client` 实例——不改用户的 profile patch，不需要重启宿主。

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
| 设置命名空间：`settings.register(ns, schema, {applies:'live'})` → `{get,watch,update,replace}`；客户端 `settingsScope.bind({namespace, decode})` → `{getSnapshot,subscribe,set,unset,mutate}`，写入带 revision 栅栏 | `dsh-settings/lib/types/index.d.ts`；`dsh-client-ui-settings/lib/client.js:1015-1044,1169-1179` |
| 设置页导航图标只能做 DOM 补丁：壳层 `navIcon(id)` 只白名单 4 个官方 id，`settings.section` 没有 `icon` 选项 | `dsh-client-ui-settings-general/lib/client.js` 的 `rows`/`navIcon`；完整手法见 `dsh-extra-context/AGENTS.md`「实现事实 4」 |
| `ctx.webServer.register({kind,path,handler})` 重复路径 throw；浏览器边界要先过 `connection.requestRejection`，再 loopback/同源/固定客户端头 | `dsh-host-webserver/lib/index.js:171-183`；`dsh-local-plugin-manager/AGENTS.md`「安全」 |
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

结论：动态挂载/卸载、两种传输、与 host 全局工具层的关系都已证实。**这份探针不在交付包里**（在 `/tmp/dsh-mcp-spike/`），但它证明了 README 里「不需要重启」的说法。

## 本插件在隔离宿主上的端到端实测（已做）

再用独立 `DSH_HOME=/tmp/dsh-mcp-spike/home2` + `mcpcheck` profile 装**本插件自己**（`link:`）并启动宿主，逐项核对用户可见承诺：

| 场景 | 实测结果 |
|---|---|
| 启动装配 | `runtime=ready`、`settingsAvailable=true`、`mcpModule.strategy=loader-import`、启动对账已跑 |
| 往 `settings.yaml` 写一条 stdio 服务器 | 对账 `reason=settings` → `mounted:["spike"]`，状态里出现 `mcp__spike__spike_echo`——**改设置即挂载，没重启** |
| http 条目引用未配置凭据 | 被拦下并说明缺哪个键，不挂载 |
| 随后写入 `.credentials.yaml` | 对账 `reason=credentials` → 自动挂载，拿到 6 个 Figma 工具；凭据明文**不在**状态载荷里 |
| 条目 `enabled: false` / 直接被删除 | 分别 `unmounted:["figma"]` / `unmounted:["spike"]`，`servers` 归零 |
| 组合层手写一行 MCP | `profileTargets` 显示 `include:mcp-patchy`，`endpoint` 去掉了查询串里的 token，只给 header 键名 |
| 运行期改 profile patch | 4 秒内热加载生效（`patchy` → `patchy2`），刷新页面即可看到 |
| 托管条目与组合层重名 | 对账把它列入 `blocked`，状态接口另给一条纯读的 `conflictNote` |

## 结构

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口：版本门、异步装配（加载 mcp-client + schemastery）、settings 命名空间注册与 watch、状态/动作路由、HTTP 安全细节 |
| `lib/dsh.js` | DSH 安装定位、版本门分类、`loader.import` → 安装绝对路径的两级模块加载、插件对象解包 |
| `lib/store.js` | 纯逻辑：规范化、校验、`credential:KEY` 占位符、`mountConfigFor`（生成 mcp-client Config）、状态投影（不回显值） |
| `lib/plan.js` | 纯逻辑：设置与已挂载实例的对账计划（挂/卸/拦/不变） |
| `lib/mount-manager.js` | 运行态：`ctx.plugin` 挂载、`fiber.dispose` 卸载、凭据解析、`ctx.tools.view()` 取工具名、捕获 mcp-client 日志 |
| `lib/targets.js` | 纯逻辑：把 loader 里的 MCP 行投影成只读视图（脱敏：URL 去查询串、stdio 只给可执行文件名与参数个数、env/header 只给键名） |
| `client.js` | 单文件 CJS 惰性 bundle：设置分区、编辑器、凭据区、只读的配置文件条目、导航图标补丁、样式注入 |
| `test/harness.js` | 测试用的小 React 运行时（可渲染、可点击），守住"接线"这一类缺陷 |
| `scripts/gui-flow.mjs` | 真机 GUI 验收（CDP + 无头 Chrome），不进发布物 |
| `scripts/fixture-mcp-server.mjs` | 自检用的最小 stdio MCP 服务器（只服务 dev 脚本，不进发布物） |

## 关键实现事实

1. **settings 是唯一真相，运行态是它的投影。** 任何写入都只产生一份对账计划（`plan.js`），由挂载管理器执行；组件不直接挂载东西。对账幂等：配置指纹（`canonicalJson(config)`）相同就不动。
2. **"验证前置"是配置层不变量，别把它简化掉**：客户端里唯一能写 `servers` 内容的路径是 `saveDraft()`，它在 `verification.status !== 'ok'` 时直接 return；宿主侧 `verify` 又先跑 `validateServer` + serverName 冲突检查再探针，所以"验证通过"⇒"校验通过"。其余写路径只动 `enabled`（开关）或整体删除。**结论：正常使用下，托管清单里不可能出现"配置不完整"的条目**。它仍可能来自三种外部情况——旧版本（验证前置之前）存下的条目、手工编辑 `~/.dsh/settings.yaml`、别的进程写同一命名空间——此时界面如实显示"被拦 + 原因 + 铅笔可改"，而不是替用户删数据。

3. **被拦下的条目刻意不进 `wantedIds`。** 否则「把已挂载的条目改坏」会留下旧实例继续跑，界面显示新配置、实际跑旧配置（`test/plan.test.js` 有守卫）。
4. **改配置走「先卸后挂」**，不做原地 restart：中间态可解释，失败也不会留下半个连接。
5. **凭据占位符在挂载时才替换成明文**：`mountConfigFor(server, substitute)`；缺失即拦下不挂载（而不是把占位符当字面值发出去）。
6. **状态接口不回显值**：`describeServer()` 只给 `envKeys`/`headerKeys`/`credentialRefs`，`targets.js` 对组合层条目额外做 URL 去查询串与 stdio 参数计数处理（组合层 `!!js` 求值后可能已经是明文）。
7. **`serverName` 不做静默清洗**：非法字符必须由校验报出来，否则界面上的名字与实际挂载用的名字会不一致（`normalizeServer` 只 trim，`validateServer` 负责报错）。
8. **样式由插件（`apply`）持有，不是组件**：按 `data-plugin` + `data-owner` 打标、引用计数清理，元素存活但文本过期时重写文本（HMR 先卸旧 fiber 再挂新 fiber，组件级注入会漏，见 `dsh-extra-context` 的同类踩坑）。
9. **导航图标补丁三处必须同源**：`dataset.dmmNavIcon`、CSS 选择器 `[data-dmm-nav-icon]`、CSS 变量 `--dmm-nav-icon-mask`；引用计数落在按钮 dataset 上，按钮被壳层重建后由 `MutationObserver` 补回（`test/client.test.js` 有守护）。
10. **`failOnStartupError` 默认关闭**（跟随 mcp-client 组合默认）：连不上仍挂载并自动重连，状态行显示最近日志；勾选后失败即记 `failed`。
11. **写设置用一次原子 `mutate`**：`servers` 与 `enabled` 一起提交（`{op:'set', path:[...]}`），而不是两次 `set`——两次会有两个 revision 栅栏，中途失败就留下半套配置。

12. **写后刷新要等对账追上**：客户端所有写路径调 `refreshAfterWrite()`（带写入时刻重读，直到 `lastReconcile.at >= since`）。见「已知边界」里第 2 个真机发现的缺陷。

12.5 **`credential:键名` 在界面上不可见但仍是存储格式**：`splitCredential()`/`joinCredential()` 负责「前缀 + 键名 + 后缀」与占位符互转（空键名也算凭据形态，用户刚点开开关时要能继续输入；键名非法则原文留在后缀里并给提示，绝不吞输入）。

13. **新增/编辑走弹窗；「保存」= 自动验证 + 落盘**：`ServerDialog` 用官方 `Modal`（props：`open`/`onClose`/`title`/`closeLabel`/`description`/`className`/`footer`），表单本体 `ServerEditor` 两个入口共用。用户要求去掉单独的「验证」按钮（"过于繁琐"）：`saveDraft()` 里先 `postAction({action:'verify'})`，**通过才写盘**，失败就把原因留在弹窗里、不落盘。宿主不支持 verify（缺 `actions` 或回 400）时保存按钮直接禁用并提示重启。点「+」**不再**直接落条目（早先的版本会留下一条永远连不上的空配置）。

14. **验证 = 宿主侧一次性探针**（`mountManager.probe()`）：用独立的临时 `serverName`（`probe<随机>`）挂载一份配置，`failOnStartupError: true` 让"连不上"变成确定失败，20 秒超时兜住慢服务器，拿到 `ctx.tools.view()` 里该前缀的工具名后**立刻 dispose**（失败路径也 dispose）。临时名不会发给对端（`serverName` 只是本地命名空间），因此既不与已挂载实例抢预留，也不会在"编辑时保持原名"时撞上自己。

15. **客户端与宿主做动作能力握手**：状态载荷带 `actions`（`['reconcile','verify']`）。客户端在 `actions` **缺失或不含 verify** 时，直接禁用「验证」并在弹窗里提示"宿主进程还是旧版本，去重启 dsh web"——这正是"客户端刷新即新、宿主半体必须重启"这个部署特性造成的中间态（用户实测反馈过：点验证一律报错，看起来像配置坏了）。点击时若仍收到 `400 unknown action`，再兜一层同样的提示（`postAction` 的 catch 里按 `/unknown action/` 识别）。该字段与 `verify` 同时引入，所以"没有该字段"等价于"宿主没有 verify"。

16. **改 `lib/*.js` 要重启宿主，改 `client.js` 只需刷新页面**：`link:` 安装不复制文件，但宿主半体是启动时加载的模块（profile 的 HMR 根是空数组，不会热更宿主代码），浏览器侧 bundle 每次页面加载都从磁盘重新取。这个差异会让"新客户端 + 旧宿主"短暂并存，见上一条的握手。

17. **导入读 `entry.fiber.config`，不是 `entry.options.config`**：后者存的是**未求值**的 `!!js` 表达式对象（`{ __jsExpr: … }`），求值发生在插件构造时（cordis 的 `internal/config` 瀑布 → `interpolate()`），结果只落在 `fiber.config`（`_resolveConfig()` 的产物，含 Config schema 默认值）。用 `options.config` 导入会静默丢字段——本插件实测踩到：导 jira 时 URL 与 `Authorization` 全没了，因为那个值不是字符串而是表达式对象，被 `typeof value !== 'string'` 过滤掉了。没有运行实例（禁用/加载失败的条目）时读不到实际取值，此时明确报错而不是导入一份残缺配置。

18. **动作路由必须整体兜底**：`handler` 里统包一层 try/catch，任何异常都返回可读 JSON。少这一层时，未捕获的拒绝会让 node:http 直接回一个**空 body 的 400**，页面上只显示"宿主拒绝了该操作"，完全无法排查（本次实测踩到，根因是路由里误用了 `apply()` 的闭包变量 `settingsView`——路由只能通过 `hooks` 拿）。

19. **完整导入的形态**：`importDraftFromConfig()` 把 loader 里的配置拆成「普通字段照抄 + 敏感字段转 `credential:键名`」，宿主再把明文写进凭据库（`importFromProfileEntry()`，不返回明文）。敏感判定 = 键名匹配 `/KEY|TOKEN|SECRET|PASSWORD|AUTH/i`、值形如 `Bearer|Basic xxx`、或 URL 带凭据（查询串里 `token|key|secret|password|sig|api-key` 参数 / userinfo）——URL 命中时整条 URL 进凭据库（它没法只替换一段），因此 `mountConfigFor()` 现在也会对 URL 做凭据替换（客户端 `credentialRefsOf` 同样要把 URL 算进去）。

20. **凭据占位符有四个落点，必须同源**（`credential:<KEY>` 是**本插件自己的语法**，不是 DSH 核心约定：`dsh-mcp-client` 只收最终明文，别的插件也没有这个写法）。四个落点是：① `mount-manager.credentialSubstituter()` 预解析键（**URL 也要算**）；② `store.mountConfigFor()` 对 env/headers/**url** 做替换；③ `store.describeServer().credentialRefs` 回给状态页；④ 客户端 `credentialRefsOf` 决定弹窗凭据区给不给输入框。**2026-09-18 修过一次真实裂缝**：①③④ 原本只看 env/headers，于是 URL 里的 `credential:KEY` 表现为"挂载认识它、却永远报缺凭据、界面也没地方填"——四处补齐后 URL 占位符才算能用（`test/mount-manager.test.js`、`test/store.test.js`、`test/client.test.js` 各有一条守卫）。`args`/`cwd`/`serverName` 不做替换，占位符写在那里只会当字面值发出去。

21. **键名没有语义**：`KEY` 只是 credentials 存储的名字（`/^[A-Za-z_][A-Za-z0-9_]*$/`），用户随便取，同一个键可被多条服务器复用、也能命中已有环境变量。导入时 `credentialKeyFor()` 生成 `MCP_<SERVERNAME>_<FIELD>_<KEY>`（如 `MCP_JIRA_HEADERS_AUTHORIZATION`）**纯粹是自动命名**，代码里没有任何 jira/atlassian 专有分支（用户专门问过这点，别再让他误会）。

22. **模块解析两级**：`ctx.loader.import` 优先（profile 锚点，源码与 registry 安装都行），失败再按 DSH 安装绝对路径 `createRequire().resolve()`；两级都失败则 `runtime = 'mcp-client-unavailable'`，此时只提供状态页、不挂载任何东西（fail closed，且不影响宿主启动）。

## 凭据写入这条链（2026-09-18 修过一个"点了没反应"的缺陷）

用户实测："凭据的保存按钮似乎没有作用，点了保存没反应，状态还是未配置"。**根因是客户端注入声明少了 `remote.credentials`**：

- 客户端的 Cordis 里**带点号的命名空间本身就是服务名**，只注入 `remote` 时读 `ctx.remote.credentials` 会**同步抛**
  `cannot get property "remote.credentials" without inject`（官方同一套数据面的写法：`dsh-client-ui-settings-plugins/lib/client.js` 的 inject 里同时写了 `"remote"` 与 `"remote.credentials"`）。
- 那个异常发生在 `save()` 的 `setBusyRef` **之前**，`ctx?.remote?.credentials` 这种可选链**拦不住**（属性访问本身就是抛点），于是界面表现是"点了完全没反应"；`CredentialBox.load()` 同样被拒，状态一直停在 `未配置`。
- 修法两处：① inject 补上 `'remote.credentials'`；② 取服务改成 `credentialsApi()`（内部 try/catch），拿不到服务时把 `凭据服务不可用：<原话>` 写在凭据区里，按钮保持可用但点了会说明原因（`test/client.test.js` 有守卫：inject 数组必须含 `remote.credentials`，且抛错场景要显示原因而不是静默）。
- **验收缺口**：`scripts/gui-flow.mjs` 之前只断言"凭据区出现了、按钮尺寸对"，**从没点过一次真正的保存**——所以这个缺陷漏到了用户手里。现在补了 3 条：填值后按钮可用、点保存后状态变成「已配置 · file」、页面上不出现明文（隔离宿主上的 `.credentials.yaml` 里确实多了这条记录）。
- 顺带修掉一个交互坑：凭据区以前只统计"有名字的行"里的引用，用户点「凭据」但还没给行起名字时看不到凭据区；现在按行的**值**统计（名字为空的行仍在保存时被丢掉）。

## 表单文案与布局的取舍（用户反馈过两次）

- **凭据不是"教用户写占位符"，而是给一个开关 + 键名输入框**（用户反馈过"必须手写 `credential:xxx` 才能触发凭据配置，这交互很垃圾"）。现在环境变量/请求头都是**结构化行**（细节见下面几条：多行卡片、前缀档位、键名候选芯片），地址栏也有同样的开关。凭据区照旧只列当前草稿引用到的键、值不回显。**存储格式没变**：settings 里仍是 `[前缀]credential:键名[后缀]`，所以校验、挂载、导入、迁移全都不用动；界面上只是不再暴露这个写法（手打进去也会被识别并自动切成凭据形态）。候选键只来自**其它托管条目**（见下面"不再用原生 datalist"那条的规则）——凭据服务没有"列出所有引用"的接口（`dsh-credentials` 的类型注释写明引用那一半靠设置发现，`listRecords` 只覆盖 record 那一半），所以 `~/.dsh/.credentials.yaml` 里没人用的键不会出现在候选里，得自己敲名字。
- **请求头的一行是"多行卡片"**（用户第三轮截图反馈：五个输入框挤一行，长键名看不全、箭头不居中）。现在第一行 = 名字 + 「凭据」+ 删除，下面每行一个带小标题的字段：`值` 或（`前缀` + `凭据键名` + 必要时 `后缀`）。实测凭据键名输入框 425px 宽（原来被挤到 ~110px 截断）。`FieldLine` 是唯一的字段行结构，URL 也复用（`地址` / `地址（密钥之前的部分）` + `凭据键名`）。
- **前缀是"可选档位 + 可选自定义"**：`PrefixField` 的下拉是「不加前缀 / Bearer / Basic / 其它…」，选「其它」时自由输入框出现在同一字段行、占满剩余宽度（实测 347px，早先被挤到 20px 根本没法输入）。哨兵值只活在组件本地 `forced` state 里，绝不写进设置。
- **下拉箭头自绘**：原生 `select` 的箭头又小又贴边，和原生 `datalist` 的箭头还互不统一（用户截图指出两次）。现在 `.dmm-select{appearance:none;height:34px;padding:0 30px 0 10px}` + 官方 `IconChevronDownOutline14` 绝对定位在右侧（`caretCentered` 实测 0px 偏差），高度与普通输入框一致（都 34px）。
- **不再用原生 `datalist` 选键名**：它的箭头在深色主题里同样不居中。改成输入框下方一行「用过的键：」+ 可点的小芯片（`aria-label="使用键名 X"`，点一下填进输入框），既能选也能手打新键名。候选 = 其它托管条目用过的键 **减去当前草稿已经在用的键**（同一个键给两个不同密钥用没有意义；早先全列出来，弹窗里一堆重复候选，用户截图说"这么乱"）。`datalist` 元素已整体删掉。
- **同一组字段共享标签列**（用户第四轮截图：URL 那一块三行错开，"看起来这么乱"）。`.dmm-fields` 是 grid（`max-content minmax(0,1fr)`），`.dmm-field-line{display:contents}` 让每行的标签/控件直接进这个 grid —— 于是**标签列同宽、所有输入框左边缘对齐**（GUI 断言 `alignedLefts === 1` 兜住；这条只能用真机量，`display:contents` 的盒子没有 rect，`useLayoutEffect`/单测都量不到）。URL 的地址行文案也改成短标签 `地址前段` + 占位符「可留空：整条地址都进凭据库时」，不再堆一长串解释。
- **尺寸对齐参考 `dsh-extra-context` 的「+ 添加规则」**（用户明确点名）：`.dmm-btn-sm{height:28px;padding:0 12px;font-size:12px}` 用于「+ 添加请求头/环境变量」与凭据行的「保存/清除」；行尾删除用 `.dmm-icon-button.sm`（26px）。注意输入框是 34px、按钮 28px，两者"同一行"的判据是**垂直中心对齐 + 纵向重叠**，不是 top 相等（GUI 断言第一版写成比 top，差 3px 就误报）。
- **凭据区是"键名 + 状态标签 + 输入行"两段**：`未配置/已配置 · 来源` 做成 `.dmm-status` 小标签（和列表行的状态 chip 同一套），输入框与两个小按钮在同一个 `.dmm-cred-input-row` 里。早先是 grid 两列（左边名字+输入框、右边按钮），按钮会被两行内容顶到中间，看起来"错开"（用户截图反馈）。
- **导入成功后不再显示"敏感字段已转入凭据库…"这句**（用户反馈：与字段旁的提示重复，而且把凭据键删掉之后它还挂着，成了假消息）。宿主半体（`lib/targets.js`）不再生成它，客户端 `visibleNotes()` 再兜一层过滤——这样"新客户端 + 旧宿主进程"的窗口期内也不会冒出来；其它真告警（如"宿主没有可用的凭据服务"）照旧显示。
- **弹窗里有第二个「保存」按钮**（凭据行的「保存」保存那枚凭据的值）：两个按钮都要有各自的 `aria-label`（`保存` / `保存凭据 <键>`），否则读屏和测试都会点错（本插件踩过：测试一直点的是凭据行的按钮，于是"保存没写盘"看起来像产品缺陷）。
- **草稿模型**：`envRows`/`headerRows` 是 `[{name, value}]`（不再是 `envText`/`headersText`），`rowsToRecord()` 会丢掉**名字为空**的行（用户正在输入的行不能变成脏数据），`recordToRows()` 反向回显。行式编辑器刻意不做文本往返：早先的 `parsePairs` 会把没写完的行吞掉。
- **凭据提示只留一行，但必须写清"直接写的后果"**：用户质疑过「这条提示有没有必要、直接写和进凭据库最终不都是拿到明文吗」。答案是差别在**明文存在哪里、谁能看到**：直接写 → `~/.dsh/settings.yaml` 明文，而且 settings 本来就要发给浏览器（设置页要能编辑），密钥会每次都进页面；写成 `credential:键名` → 值在 `~/.dsh/.credentials.yaml`（0600），settings 与状态接口里只有键名，界面只显示"已配置"，还能被多个条目复用、能复用已有环境变量。所以**不禁止直接写，但要在原地说明后果**，文案压成一句（随开关化改写过）：`密钥点「凭据」：键名自己取，值存进凭据库、界面不回显、可多处复用；直接填写的值会明文存进设置文件。`
- **状态只在列表行显示一次，且要高亮**：编辑弹窗顶部曾有一个「当前状态」块，用户反馈"跟下面的字段挤在一起、也不明显，直接去掉"。现在状态是列表行里的一枚**带底色的小 chip**（`ok` 绿 / `warn` 琥珀 / `error` 红 / 停用灰），完整原因（如"stdio 传输必须填写可执行命令"）挂在 chip 的原生 `title` 上（列表后来改成一行，不再有第二行放全文），编辑弹窗里也能看到。弹窗只在 mcp-client 真的产出过日志时，保留一个折叠的「最近日志」。
- **工具清单一律放在「已连接 · N 个工具」这个 tag 的官方 `Tooltip` 里**（用户要求：列表改一行、去掉工具说明、浮层挂在 tag 上、用 DSH 自带组件、宽高不出面板、内部可换行可滚动）。走过的弯路与最终做法：
  - 最早是自绘浮层（`.dmm-tools-tip`）：可预期、能用 CDP 悬停断言，但用户明确要求用官方组件，且自绘浮层的宽高没有跟随设置面板。
  - **官方 `Tooltip` 的三个实测事实**（从 `dsh-web-frontend/dist/assets/index-*.js` 的气泡实现与 `._bubble_1nw3t_1` 样式读出）：① 气泡是 `position:fixed; width:max-content; max-width:50vw`，**只按窗口夹取位置**，没有"别超出某个容器"的选项；② 气泡是 `pointer-events:none`，鼠标一离开锚点（进入气泡）就 `v(null)` 关闭——所以"把鼠标移进气泡里滚"物理上不成立；③ 只有 `label/side/delayMs/disabled/maxWidth/children` 这些 props，`side` 只影响贴哪一边。
  - **宽高约束自己算**（`useTooltipBounds`）：宽 ≤ `min(360, 面板宽-32)`；高 ≤ 面板可见高、且不超过锚点那一侧的剩余空间，朝向取空间大的那侧——这样官方那套"装不下就翻面"的判断不会触发，位置稳定。
  - **内边距由我们这层补**：官方气泡只有 `padding:3px 7px`，长清单贴边很难看（用户截图反馈），所以 `.dmm-tip-content` 再给 `padding:6px 7px`（`box-sizing:border-box`，算进 `maxHeight`，不会把浮层顶出面板）。
  - **横向不出面板靠"窄触发区 + 宽锚点盒子"**：锚点若是那枚窄 tag，气泡会从 tag 右侧探出面板外（官方只按窗口夹）；所以 Tooltip 的子元素是整块标题区（气泡以它的中线居中），再用 `.dmm-title-block.tip{pointer-events:none}` + `.dmm-tip-trigger{pointer-events:auto}` 把"能悬停的区域"收回到 tag 本身。代价：这条行的名称失去了原生 `title` 与文字选中（服务器名就在旁边的命名空间 chip 上，信息没丢）。
  - **滚动**：气泡自己不接受指针事件，于是把滚轮事件从锚点转发给清单容器（React 在根节点上的 `wheel` 是 passive 监听，`preventDefault` 无效，所以用 `addEventListener(..., {passive:false})` 原生挂）。清单溢出时表头会补一句「滚轮滚动」提示；那句话必须在**清单节点挂载时**量（`ref` 回调），写成 `useLayoutEffect` 永远量到 `null`——本层不会因为气泡打开而重渲染（真机验收抓到过）。
  - 只有"已连接**且**有工具"才挂浮层：其它状态挂上去只是把 tag 上的话再说一遍，那些状态继续用原生 `title` 兜底。
- **列表行只有一行**（用户要求"列表页改为一行，去掉工具说明"）：`.dmm-row-line` 一条 `grid-template-columns: auto minmax(0,1fr) auto` = 左边启停开关 / 中间名字 + 命名空间 + 状态 tag / 右边编辑 + 删除。被拦或失败的原因不再单独占一行，压成 tag 上的短标签（完整原因在 `title` 与编辑弹窗里）。
- **「服务器名」那一行的提示并进 label**（用户要求）：`服务器名 * (工具前缀为 mcp__<名字>__)` 与 label 同行、同一段文字里（曾短暂写成 `mcp-<名字>`，用户核对后要求与运行时对齐，已改回真前缀）。前缀以 `mount-manager.js` 的前缀过滤与行上的命名空间 chip 为准：工具全名 = `mcp__<服务器名>__<工具名>`，例如 `mcp__figma__get_design_context`。
- **必填项用 `*` 标注，非必填不写"（可空）"**：服务器名、命令（stdio）、URL（http）带 `*`；备注名、参数、工作目录、环境变量、请求头、超时都不带。
- **长文本的勾选项必须独占一整行**：`启动连不上就报错（默认只记录日志并继续重连）` 曾和「单次调用超时」挤在 `repeat(auto-fit,minmax(220px,1fr))` 的两列里，右侧文字换行、整行又被拉得很紧（用户截图反馈"布局太丑"）。现在超时输入框与勾选行上下排列，勾选用 `.dmm-checkline` 整行铺开。

## 已知边界

- **不写用户的 `cordis.patch.yml`**：里面可能有手写注释与 `!!js` 表达式；组合层的 MCP 行只读展示 + 导入，不改写（与 `dsh-local-plugin-manager` 的受管区块策略不同，因为这里没有必须落盘的持久层——托管清单存在 settings 里）。
- **patch 变化不会触发对账，但会即时提示**：运行期往 patch 里加一条与托管条目同名的行时，状态接口每次读取都会给出 `conflictNote`（纯读，不产生挂载动作）；真正把它列入 `blocked` 并停掉托管实例要等下一次对账（设置/凭据写入或手动「重新对账」）。中间这段时间里，配置文件那一条会自己报 `serverName already in use` 而加载失败。
- **`~/.dsh/.env` 里的 token 仍需重启**才能被 `!!js process.env.X` 看到——那是进程启动快照，与本插件无关；托管条目 + `credential:KEY` 才是免重启路线。
- **凭据来源为进程环境时只读**：`describe()` 返回 `writable:false`，界面会禁用输入。
- 删除托管条目不会删除已写入的 `.credentials.yaml` 记录（凭据可能被别的条目共用）。
- **升级中间态**：改了 `lib/*.js` 之后、用户重启之前，弹窗会提示"宿主还是旧版本"并禁用「保存」；这是设计行为，不是故障。
- **没有常驻的「验证」按钮**：验证是 `saveDraft()` 内部的一步（点了保存才发生），已保存条目的真实状态由列表行承担。
- **验证不通过就存不下来**：这是刻意的（用户明确要求"验证没问题才保存"）。因此服务器暂时连不上时也无法先存下配置——需要把服务器起起来再保存，或临时改成一个能连上的配置。**如果用户要的是"验证失败也照样存下来"（便于先把离线服务器登记好），改动很小：`saveDraft()` 里把失败分支的 `return` 去掉即可**，但要同步改这条边界说明与测试。

## 验证现状

```bash
npm run check       # node --check ×10 + bash -n ×2
npm test            # 94 项：store 13 / plan 10 / mount-manager 12 / targets 10 / host 12 / client 37
npm run pack:check  # 发布物 = 12 个文件
npm run publish:check   # = verify + pack:check，已绑定 prepublishOnly
npm run gui:check -- --url '<带 token 的隔离宿主 URL>' --cdp-port 9333   # 真机 GUI 验收（49 项通过；脚本共 53 个 check）
```

- `test/mount-manager.test.js` 用假 ctx（`plugin()` 返回可 await/可 dispose 的 fiber）驱动真实对账逻辑，不依赖宿主。
- `test/client.test.js` 在 `node:vm` 沙箱里加载 bundle（React 用 `test/harness.js` 的**可渲染**运行时），验证 slot 注册、绑定的 namespace/decode、导航补丁的三处同源与可回滚、样式注入与引用计数，以及**真渲染 + 真点击**的接线守卫：点「+」只开弹窗且不写设置且**没有单独的验证按钮**、点保存会先调一次 verify 且通过才写盘、验证失败时不落盘且原因就地显示、每次保存都重新验证（不复用上次结果）、编辑走同一弹窗且预填、宿主缺 `actions`/返回 `unknown action` 时提示重启并禁用保存、开关必须写回停用、删除必须先确认、写完必须等到宿主对账追上（不留在旧结论上）。
- `test/harness.js` 是小 React 运行时（不是测试文件）。它按组件实例的树路径保存 hook 槽，支持 `createContext`/`useContext`、类组件（`children` 会并入 `props`）、以及**按依赖真记忆化**的 `useCallback`。五条踩坑：`render()` 返回数组要显式展平；`useCallback` 若永远返回第一次的函数，闭包会一直看着旧状态（`useCallback(id => status.servers.find(...), [status])` 会永远读到初始 null），看起来像产品缺陷、实际是桩的错；`inputByLabel` 找字段容器必须**按 class token 精确匹配**——`.dmm-field-row` 也包含 `dmm-field` 子串，用 `includes` 会命中外层行容器、取到同排第一个输入框，表现为"表单没预填/没写进去"；`useRef` 必须返回**ref 对象**（曾写成返回 `initial`，于是 `useRef(null)` 在测试里就是 `null`，组件一碰 `ref.current` 整个分区都渲染不出来）；函数组件的 `children` 用 props 形式传（`createElement(C, {children: x})`）时不能被位置参数的**空数组**覆盖（官方 `Tooltip` 就是 props 形式传 children 的）。宿主元素上的 `ref` 本桩不赋值（真实 React 首次渲染前也是 null），所以组件必须自己处理 `current === null`，用到 DOM 的行为（浮层尺寸、滚轮转发）由真机验收覆盖。
- **GUI 脚本每次求值前都重新注入页内助手**：客户端 bundle 改动会触发 client HMR 重载页面，注入的 `window.__gui` 随之消失（脚本表现为 `__gui is not defined`）；`evaluate` 包装里先跑一次 `HELPERS` 是幂等且便宜的，比"注入一次管到底"稳。
- `scripts/gui-flow.mjs`（`npm run gui:check`）是**真机 GUI 验收**：用 CDP 驱动无头 Chrome 打开隔离宿主，走「打开设置（先关掉首启引导弹层）→ 进分区 → 查行是不是一行 → 导入（带上 URL/命令与凭据占位符、页面不出现明文）→ 新增（弹窗，label 文案与同一行）→ 填错命令后点保存（自动验证失败、不落盘）→ 换本地 fixture 服务器再保存 → 悬停「已连接 · N 个工具」看完整清单、量它是否在面板内、滚轮滚动清单 → 编辑 → 停用 → 删除」，每步都用宿主状态接口交叉核对，真机里还走了一遍「点『凭据』→ 自己取键名 → 凭据区出现该键」。**必须先关引导弹层**，否则它盖住设置面板、悬停事件落不到插件元素上。定位弹窗要用 `.dmm-dialog`：设置面板本身也带 `role=dialog`，按 role 查会先命中它。
- **导航图标补丁的几何**用工作区工具离线量过：`node tools/dsh-icons/verify-nav-icon.js --plugin dsh-mcp-manager --label 'MCP 服务器' --icon IconLinkOutline16`，六项检查全通过（`stylesInjected` / `geometryMatches`（label 偏移 36,9 与壳层原生行一致）/ `originalIconHidden` / `maskApplied` / `squareIconBox`（::before 恰好 16×16）/ `shellRowUntouched`）。为跑通它给固定场景补了 `createContext`/`useContext` 与 `ctx.effect`（详见 `tools/dsh-icons/README.md`），并用 `dsh-extra-context`、`dsh-chat-archive-manager` 回归确认没有改坏既有插件。
- **样式注入必须同步**：`installStyles` 先注入再登记 `ctx.effect` 清理。曾把注入整块放进 effect 回调，固定场景（无 effect）下样式永远进不了文档——这与 `dsh-extra-context` 踩过的「标记已打、CSS 未到」是同一个坑。
- **本机真实宿主上已验证**（用户重启后）：`runtime=ready`、`settingsAvailable=true`、模块走 `loader-import`；`profileTargets` 正确列出用户 patch 里的 `figma`/`jira`（jira 的 `Authorization` 只给键名，`JIRA_MCP_BASIC` 的值与任何 `Basic ` 明文都不在载荷里）；无自定义客户端头 403、错误 CSRF 403。
- **只读块（配置文件中的服务器）的文案不得出现实现细节**：曾经在页面上写「这些行来自 profile 的 cordis.patch.yml（含 !!js 表达式），本插件不修改该文件…」——用户直接反馈「很乱、说明描述了一些跟具体配置有关的信息，明显不合理」。现在页面上只有标题 +「只读 · 值不显示」，实现细节留在文档里；`test/client.test.js` 与 `scripts/gui-flow.mjs` 都断言渲染文本里不出现 `profile` / `cordis.patch.yml` / `!!js` / `本插件不修改`。
- 只读块**不复用托管行的 `.dmm-row` 样式**，自己成卡片（`.dmm-targets`/`.dmm-target`）：两者层级不同，混用会让人以为它也是可编辑条目。
- **真实 GUI 已由 `scripts/gui-flow.mjs` 自动验收通过**（隔离宿主 + 无头 Chrome + CDP，49/49，跑在 DSH `0.1.6-alpha.2` 上）：导航行换成连接图标且只改本行、分区渲染（含只读块文案无实现细节）、点「+」打开弹窗且**不写设置**、验证前保存禁用、错命令验证失败并显示原因、本地 fixture 服务器验证通过并列出工具、保存后宿主 `mounted`、编辑走同一弹窗且要重新验证、行上显示最新状态（不是旧的对账结论）、停用即卸载、删除后宿主清单里消失、配置文件里手写的条目全程未被触碰；列表行只有一行（`switchFirst`/`actionsLast`/没有 `.dmm-tools`/高度 <60px）；官方浮层的宽高都在 `.dmm-section` 之内（实测 `232x202` vs 面板 `464x389`，`insidePanel=true`）；浮层里 20 个工具全名齐全、溢出时表头出现「滚轮滚动」、滚轮落在 tag 上时清单 `scrollTop` 从 0 变正、移开鼠标后浮层消失。**fixture 服务器为此加了 19 个填充工具**：工具太少时清单不溢出，滚动这条就验不到。`dsh web` 的根页与 `/plugins` 模块路由都在 token 鉴权后面，所以 boot graph 不能用 `curl` 断言——CDP 才是这里的正确工具。
- **两个由真机验收（而不是单测）发现的缺陷**，都已修并补了会失败的护栏：
  1. 点「+」什么都不做——组件只把 `adding` 置真却没有任何渲染分支，`add()` 从未被调用（空状态文案还在引导用户点它）。现在「+」打开弹窗表单（用户后续又要求：不要直接落空条目、要"验证通过才保存"）。守卫：`test/client.test.js` 的「接线守卫」用例，注入此缺陷即失败。
  2. 保存后行上会一直挂着**旧的对账结论**（比如刚把 stdio 改成 HTTP，行上仍是「必须填写可执行命令」）——设置写入触发的宿主对账晚于客户端那一次状态读取，而客户端只读一次。现在所有写路径都走 `refreshAfterWrite()`：带写入时刻重读，直到 `lastReconcile.at` 追上来（最多 6 次 / 约 4 秒）。守卫：同名用例，把 `refreshAfterWrite()` 改回 `refresh()` 即失败。

## 发布与安装路线

- 用户路线：`dsh plugin --profile web add dsh-mcp-manager`（升级必须显式写 `@<版本>`）；`./install.sh` 只服务源码 `link:` 开发路线，它会先跑 `npm run verify` 再调用官方 `dsh plugin add`。
- 本包**没有运行时依赖**（`dependencies` 为空），因此 release 工作流不需要为它装依赖。
- 发布：`npm run publish:check` 是唯一闸门（语法 + 测试 + 打包白名单），`prepublishOnly` 已绑定；发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-mcp-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。
- 兼容线四处同源：`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 的版本门、本文件与 `lib/dsh.js` 的 `DSH_COMPATIBILITY_RANGE`。

## 排查顺序

1. 设置页没有「MCP 服务器」分区 → 确认 profile bundle 列表已包含 `dsh-mcp-manager`（需重启），并看宿主日志里的 `dsh-mcp-manager:` 前缀告警。
2. 页面顶部红条说「无法加载 @deepseek-ai/dsh-mcp-client」→ 看状态接口返回的 `mcpModule.errors`（两级解析都失败）。
3. 条目显示被拦 → 读 `blockedReason`：校验未过 / 与配置文件重名 / 凭据未配置。
4. 保存成功但没有工具 → 看该行的最近日志（重连、tools/list 失败），以及服务器是否本来就无工具能力。
5. 弹窗里写着"宿主进程还是旧版本"、保存按钮是灰的 → 宿主半体是旧的：请用户重启 `dsh web`（客户端刷新即新，宿主必须重启才加载）。
6. 想确认宿主真实状态与支持的动作 → `curl -s -H 'x-dsh-mcp-manager-client: 1' http://127.0.0.1:3080/dsh-mcp-manager/status | python3 -m json.tool`（同源 + loopback 才放行；`actions` 字段就是宿主的能力清单）。
7. 判断"到底是客户端新还是宿主新" → 比一下宿主进程启动时间与 `lib/*.js` 的修改时间：
   `ps -o lstart= -p <pid>` vs `ls -l lib/*.js`。
