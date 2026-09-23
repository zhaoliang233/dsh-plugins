# dsh-extra-context — 技术说明（AGENTS.md）

> 面向在本工作区继续开发/排查的 agent；用户文档见 `README.md`。
> 目标 DSH `0.1.7-alpha.1`，兼容线 `>=0.1.7-alpha.1 <0.1.8`，逐版本核对的是 `0.1.7-alpha.1`（见 `lib/index.js` 的 `VERIFIED_DSH_VERSIONS`）。

## 一句话

把一段「额外说明 + 上下文」注册为**进程级** system prompt section，使当前 DSH 的**所有**会话（主会话、子代理、workflow 子步骤）都带上它；文本在设置页分段维护、热生效。

## 已核对的契约（不是猜测）

| 事实 | 来源 |
|---|---|
| `ctx.systemPrompt.section({name, order, text})` 注册在**调用者 fiber 的全局层**，对所有 agent 生效；同名 scoped section 才会遮蔽它 | `dsh-system-prompt/lib/index.js`（`ScopedLayers` + `section()`） |
| `text` 可以是 `(context) => string`，**每次组装实时求值** → 设置变化无需重新注册 | 同上 `assemble()` |
| `SECTION_ORDERS`：`DEPLOYMENT_PERSONA_PREFIX = 0`、`TOOL_BASH = 1000`；本插件取 **204**，落在两者之间的空档 | `dsh-system-prompt/lib/index.js` |
| section 注册返回的正是 Cordis effect disposer | `SystemPrompt.section()` 文档 |
| **0.1.7 的设置就是 profile 条目配置**：插件导出 schemastery `Config`（字段 `.volatile()`）→ loader 在「只有 volatile 字段变化」时就地更新运行中 fiber 的引用（不重启插件），插件读 `ctx.config.<字段>.get()` 拿实时值、并在 `loader/volatile-update` 时被通知；`settings.configure({auto:false}, fiber)` 声明本实例自带设置页、不要让壳层再自动生成一页 | `dsh-settings/lib/index.js`（`describe`/`configure`/`update`）、`cordis-plugin-loader/lib/index.js` 的 `_commitVolatile`、`dsh-agent-default-model/lib/index.js`（官方读法样板） |
| `settings.describe()` 返回每条的 `{ ns, value, user, base, revision, autoGenerate }`；**`user` 里有哪个字段就说明用户在设置页写过它**（本插件用它决定是否让旧 settings.yaml 迁移段生效） | `dsh-settings/lib/index.js` 的 `describe()` |
| 宿主侧 schema 必须是真正的 schemastery 对象 | 同上（`z<T>` + `toJSON` 序列化方言） |
| 客户端 `ctx.configForms.get(<条目 id>)` 返回 `{getSnapshot, subscribe, mutate, set, unset}`（写入带 revision 栅栏与排队）；`settingsScope` 服务在 0.1.7 已被删除 | `dsh-client-ui-settings/lib/client.js`①`configForms` 服务、`lib/types/client/config-form-types.d.ts` |
| `settings.section` 是 list slot，注册需要 `id`（+ 可选 `order`/`label`） | 实时 Slot 树查询 |
| **设置页导航图标不可由插件声明**：壳层只取注册项的 `id/order/label`（没有 `icon`），图标由 `navIcon(id)` 决定，且只白名单 5 个官方 id（`account`/`models`/`agent-presets`/`plugins`/`archived-sessions`——0.1.7 删掉了 `archived-sessions` 那一页），其余一律回落 `IconSettingsOutlineMedium`（齿轮） | `dsh-client-ui-settings-general/lib/client.js` 的 `rows`/`navIcon`（0.1.7-alpha.1 已核对） |
| `settings.action` 与 `settings.section` 同属 `sidebar.settings` 的 children 表（同时声明），随设置面板挂载/卸载 | 同上 `register({ name: 'sidebar.settings', children: {...} })` |
| `agent.inject(UserMessage)` 是官方「补模型可见上下文」通道，空闲时不唤醒 driver | `dsh-agent/lib/types/runtime-types.d.ts`；`dsh-user-approval`、`dsh-cordis-host-runner` 同款用法 |
| **开关一律用壳层自己的 `Switch`**：`Switch({ checked, onChange, label, disabled, title, className })` → `<button role="switch" aria-checked>`（36×20、开启态 `--dsw-alias-brand-primary` 轨道、视觉由 `aria-checked` 驱动、`disabled` 时 `opacity:.5`）；它在 primitives 静态 seed 里，`require('@deepseek-ai/dsh-client-ui-primitives').Switch` 直接可用 | `dsh-client-ui-primitives/lib/types/Switch.d.ts`、`lib/Switch.module.css`、`lib/index.js:1786`（0.1.6-alpha.2 实测） |
| `PromptSection.interpolate: false` 让 `renderPrompt()` 原样取 `section.text`，不做 `{{variable}}` 插值 | `dsh-system-prompt/lib/index.js:115`；`renderPrompt()` 是 `assemble()` 的唯一渲染口（`dsh-agent-loop/lib/index.js:1014`） |
| **压缩摘要是一次独立的模型调用**：`purpose: "compaction"`，消息 = 被压缩区间的回放（**含 surface 节点 0 的 system prompt**）+ 末尾追加的固定英文指令（含 `Write concise English engineering prose`） | `dsh-compaction-basic/lib/index.js` 的 `summarizeWithLlm()`、`buildSummarizationInput()`、`COMPACTION_INSTRUCTION` |
| `ctx.llm.stream()` 是 `llm/stream` **waterfall**；监听器拿到的 `options` 就是终段 `adapterStream(options, prepared)` 闭包里的同一个对象（摘要调用里未冻结），**就地改 `options.messages` 可影响真正发出去的请求**；`next(...)` 的入参不会被采纳 | `dsh-llm/lib/index.js:2332`（waterfall）、`:2248`（`adapterStream` 读 `resolvedOptions.messages`）；内置先例 `dsh-session-checkpoint-policy/lib/index.js` 的 `ctx.on("llm/stream", …)` |
| **surface 节点 0（system prompt）受保护**：覆盖节点 0 的替换必须本身是 `system/message` 且只覆盖该节点，所以压缩区间（形如 `replace(9..N)`）不含它——额外上下文在压缩后仍在请求里 | `dsh-session/lib/index.js:381-391`（`assertSystemHeadRewrite`）、`:426-435`（`applySurfacePlan`） |
| 浏览器 `__ModuleLoader__` 静态 seed 共 **9** 个键：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit` | `dsh-web-frontend/dist/assets/index-*.js` 的 seed 映射 |

## 关键实现事实

### 1. schemastery 必须按 DSH 安装的绝对路径加载（模块作用域）

宿主插件不声明 `@deepseek-ai/*` 依赖（工作区惯例），实测**裸 import 会 `ERR_MODULE_NOT_FOUND`**：插件目录向上找不到 DSH 的 `node_modules`。而 0.1.7 起**条目 schema 必须是模块导出的 `Config`**（loader 在 `plugin()` 时读它、`settings.describe()` 又要求它是真 schemastery 对象），所以装载发生在**模块作用域**：

1. `locateDshRootSync()`：先按 `process.argv[1]`（CLI 入口）realpath 后向上 ≤4 层找 `@deepseek-ai/dsh` 包根；测试进程（`node --test`）与其它加载方式下 argv[1] 不是 DSH 入口，于是补一条 **PATH 上的 `dsh`** 兜底。两条都失败返回 `undefined`。
2. `loadDshModule(root, '@deepseek-ai/schemastery')`：`createRequire(join(root,'package.json')).resolve(name)` → **`pathToFileURL()` 转成 file:// URL 后**动态 import（`js-yaml` 读旧 settings.yaml 走同一函数）。

**`pathToFileURL` 是 Windows 上必需的（真实缺陷，用户实测反馈）**：`require.resolve` 返回**文件系统路径**，而 ESM 装载器只接受带协议的说明符；Windows 下 `import('C:\\…\\schemastery\\lib\\index.cjs')` 把 `C:` 当成协议，抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Node 24 实测）。这条链路失败时 `Config` 为 `undefined`（模块照常加载、section 照常注册），后果是**条目在 `settings.describe()` 里不出现** → 状态接口 `writable:false` → 设置页的「+ 添加上下文」与右侧总开关（`Switch`）被 `disabled: busy || !writable` 永久禁用（只有这两个动作控件会因它禁用：`textarea` 与每行的启停开关刻意恒 `disabled:false`）。POSIX 上裸绝对路径能 import，所以这个缺陷只在 Windows 暴露——**改这条链路时别再退回 `import(resolved)`**。

### 2. 生效值的三个来源与优先级（0.1.7）

`mergeEffectiveSettings(resolved, explicitFields, legacySection)`（纯函数，可单测）按字段合成：

1. **用户 override**：`settings.describe()` 里本条目 `user` 出现的字段——用户在设置页写过它，以解析值为准（哪怕值是空数组，所以"删掉最后一条规则"真的删得掉）；
2. **旧 settings.yaml 迁移段**：`$DSH_HOME/settings.yaml.imported` 的 `extra-context:` 段——0.1.7 的迁移按**条目 id** 找目标，而旧段名是 `extra-context`、条目 id 是 `dsh-extra-context`，因此 DSH 自己没能带上它；本插件只读兜底，字段级生效：某个字段一旦在设置页写过，就只认设置；
3. **实时解析值**：`config.<字段>.get()`（schema 默认 + 组合层）。

判据必须是 **`user` 的键**，不是"值是否为空"、也不是"解析值有哪些键"——两个真实缺陷都出在这里（曾用 `scope.get()` 的字段名把"从未写过"误判成"写过"，空默认值覆盖了基线；更早还用 `isConfigured()` 判内容为空，出现"设置页显示空、而 config 里的基线文本仍在生效"）。`describe()` 抛错时保守地当作用户没写过（保留迁移段与解析值），这一条有测试守卫。

### 3. 异常兜底在 section 的 `text` 回调，不在渲染函数里

`renderExtraContext()`（`lib/rules.js`）只做防御性规范化，本身没有 try/catch；真正保证“脏数据不会让模型请求失败”的是注册 section 时的回调：

```js
text: () => { try { return renderForPrompt() } catch (error) { log('error', …); return '' } }
```

（`lib/index.js`）改动时不要把守卫挪进 `rules.js` 的纯函数里假装有兜底。

### 4. 设置页导航图标只能做可逆的 DOM 补丁

用户实测反馈：「额外上下文」这一行用的是**齿轮**，与“设置”本身撞脸。根因是壳层设计（见契约表最后两行与 `navIcon` 白名单）。插件做法（`client.js` 的「设置页导航图标」分区）：

1. 注册 `settings.action`（id `extra-context-nav-icon`）作为挂载点——它与设置面板同生命周期，面板关闭即随 fiber 卸载并回滚；
2. 挂载点在 `useLayoutEffect` 里把 `IconContextInjectionOutline16` 渲染进 `display:none` 的模板 div，取 `outerHTML` 作 mask 源码（**必须补 `xmlns`**，否则 data: URI 里的 SVG 按 HTML 解析、mask 静默失效）；
3. `patchSettingsNavIcon(doc, source, label)` 在 `nav button` 里按 `textContent.trim() === '额外上下文'` 精确匹配（前缀相同的行不会误伤），给按钮打 `data-dec-nav-icon`、写内联 CSS 变量，并挂 `MutationObserver` 以便壳层重建导航后补回来；
4. 样式（`.dec-nav-icon-template` + `[data-dec-nav-icon]` 三条规则）隐藏原 svg，用 `::before` + `mask` 画图标。`::before` 是 flex item 而**不是绝对定位**：尺寸/间距沿用壳层布局，壳层改内边距也不会错位；图形用 `currentColor`，选中/悬停/深色主题配色继续跟随壳层；
5. **样式表由插件级 `installStyles(ctx)` 注入（在 `apply()` 里），任何组件都不负责它**：按 `style[data-dec-owner="dsh-extra-context-v1"]` 认领自己那份样式、写 `data-plugin`，元素存活但文本过期时重写文本，并用 `ctx.effect` 做**引用计数**（HMR 先卸旧 fiber 再 materialize 新的，计数保证窗口内样式不被提前移除；归零才移除，副作用可逆）。

第 5 条是被真实缺陷逼出来的（用户反馈：“刷新后打开设置页，图标还是旧的齿轮；点一下额外上下文才对”）：注入原先长在分区组件里，而分区要等用户点开那一行才渲染，补丁却挂在 `settings.action`（面板一打开就渲染）——两个生命周期不再嵌套，于是“标记已打、CSS 未到”。**要点：样式的所有者应当是插件（apply），不是某个组件**；组件一旦挂在比样式更早/更广的生命周期上（导航补丁、overlay、状态栏…），组件级注入就覆盖不到。`dsh-chat-archive-manager` 同样是 `apply()` 级 + 引用计数，可直接参照。

全部状态都在按钮 dataset / 内联样式上并做引用计数，清理函数能完整还原成齿轮；`document`、模板 svg、`querySelectorAll` 任一拿不到都静默退化（最差继续显示齿轮，绝不报错到设置页）。

> 壳层哪天支持在 slot 选项里声明 `icon`，这段补丁就该整块删掉——它不是能力，是权宜。**改前先回读 `dsh-client-ui-settings-general` 的 `navIcon`/`rows` 两处源码。**

### 5. 压缩摘要的写作语言必须被拉回用户的额外上下文

**症状（用户实测反馈）**：某次会话被自动压缩后，模型的过程性回复（“Now I'll replace the row rendering…”）连续几个回合变成英文，最终答复仍是中文 + `✅`。用户据此判断“额外上下文在压缩之后不生效了”。

**逐项核对后的真相**（`dsh 技能与 MCP 管理插件` 会话，`~/.dsh/sessions/…/session-c8b57ddd…`）：

| 结论 | 证据 |
|---|---|
| 额外上下文**没有丢** | 压缩事件 `compaction/prune`/`compaction/start` 的替换区间是 `replace(9..3422)`，起点是第一条 user 消息；surface 节点 0（system prompt）受 `assertSystemHeadRewrite` 保护，不在区间内。重放整个会话的 surface 后可确认：压缩后每个请求仍是 `[system(含额外上下文), checkpoint, 最新 user]` |
| 额外上下文**仍在生效** | 压缩后 8 个回合的最终答复**全部**以 `✅` 结尾，而 `✅` 在整个压缩后上下文里只可能来自 system prompt 的额外上下文（摘要正文 0 次、checkpoint 前言 0 次、此后没有子代理完成通知） |
| 变英文的是**过程性回复**，不是最终答复 | 逐回合统计助手文本块：压缩前 turn 1–13 全中文（0 英文）；压缩后 turn 14 起 8/9 为英文，turn 15–19 仍有 1–6 条英文，turn 20 起恢复中文 |
| 直接原因：**摘要本身是英文** | `dsh-compaction-basic` 的 `COMPACTION_INSTRUCTION` 最后写着 `- Write concise English engineering prose.`，并且它是摘要请求里**最后一条 user 消息**；压缩用这一次调用把整段会话换成一个英文 checkpoint，checkpoint 随后成为 system prompt 之后最近的上下文。实测该会话摘要有 0 个中文字符 |

**做法**：在 `llm/stream` 上只对 `purpose === 'compaction'` 的请求，把用户的额外上下文原文**追加**为一条 user 消息（排在 DSH 那条英文指令之后），并写清两件事——摘要沿用额外上下文要求的输出语言、摘要不是给用户的回复（额外上下文里给回复用的装饰不得搬进摘要）。要点：

- 只改 `options.messages`（`summarizeWithLlm()` 新建、未冻结的那个对象），**不写 session**：这条消息只存在于那一次模型请求里，会话记录与界面上都看不到，无需清理逻辑。
- 异常一律吞掉后放行原请求：压缩失败、摘要变差的代价远大于缺一条补充说明。冻结的 `options`、非数组 `messages`、`purpose` 缺失都必须原样放行（`test/host.test.js` 有守卫，注入缺陷必红）。
- 同一份文本此前就在 system prompt 里，这里只是换到更靠后的位置，不制造“新旧两套要求并存”（这正是当年移除 `/context-refresh` 的理由，别把它做回来）。
- 进 `ctx.inject(['llm'])` 而不是顶层 `inject`：`llm` 缺失时整块跳过，section / 设置 / 状态接口照常。

**验证**（见「验证现状」）：桩模型服务下确认真实 DSH 发出去的压缩请求最后一条就是这个补充指令、其它请求不受影响；真实路由 A/B 下确认摘要语言确实由这一行决定（带它 = 中文摘要，去掉它 = 英文摘要）。

## 文件职责

- `lib/rules.js`：纯逻辑（规范化 / 过滤 / 渲染 / 预算）。**不对用户文本做任何改写**——`{{…}}` 由 section 的 `interpolate: false` 原样放行，不再用“把 `{{` 拆成零宽字符”的老 hack。只依赖 Node 内置，可在 `node --test` 下独立验证。分段的形状是 `{ id, enabled, text }`：`label`（分段名称）与 `order` 字段都已随功能移除，规范化只挑已知字段，老数据里的残留键一律丢弃；顺序即数组顺序。
- `lib/index.js`：Cordis 入口。模块作用域导出 `Config`（`enabled` / `segments[{id,enabled,text}]` / `maxBytes`，三者都 `.volatile()`），**并且必须同时挂在 `default` 插件对象上**——loader 的 `unwrapExports()` 在有 default 时返回 default，`runtime.Config` 只从那里读；只写命名导出会让条目拿不到 schema（`entryPresent:false`、动作控件禁用、写入被拒，用户实测反馈，`test/manifest.test.js` 有守卫）→ 版本门 → 装配 section / 状态路由 / **压缩摘要补充指令（`llm/stream`，见实现事实 5）**；`settings.configure({auto:false})` 只声明"本实例自带设置页"。其余导出仅为测试与兼容检查可见。
- `client.js`：单文件 CJS 惰性 bundle（无构建步骤，逻辑分层靠函数分区）。`apply()` 做三件事：取设置条目控制器（`ctx.configForms.get('dsh-extra-context')`，只用于写入）、注入插件样式表、注册两个插槽（`settings.section` id `extra-context` order 100；`settings.action` id `extra-context-nav-icon` order 100，仅作导航图标补丁的挂载点）。**插件设置入口一律排到 DSH 自带分区之后（`order ≥ 100`；内置最大是 `archived-sessions` 25），别再按“挨着谁放”挑数字**——0.1.5 用的 25 与内置的 `archived-sessions` 正好并列，谁先谁后只能靠注册顺序决胜；约定见根 `AGENTS.md` 的 Slot 章节。客户端**不**做 schema 校验（bundle 里拿不到 schemastery，`dsh-client-ui-settings` 也不导出 `Schema`）；宿主是权威，组件对任何字段都防御性读取。界面上两个开关（动作行右侧的总开关、每行行首的启停）**都用官方 `Switch`**，插件样式只负责定位（`.dec-master{…margin-left:auto}` / `.dec-row-switch{flex:none}`），不给它写尺寸或配色。

## 运行期行为

| 入口 | 行为 |
|---|---|
| system prompt | `<name: deployment:extra-context, order: 204, interpolate: false, text: () => renderForPrompt()>`；用户文本里的 `{{…}}` 原样进入 prompt |
| 设置条目 | `dsh-extra-context`（profile 里这一行的 `config` 段）。用户写入走客户端 `configForms.mutate` → `configEditor` 落进 profile patch；宿主读 `config.<字段>.get()`；旧 `settings.yaml.imported` 的 `extra-context:` 段只读兜底（见实现事实 2） |
| 状态路由 | `GET /dsh-extra-context/status`，要求 `x-dsh-extra-context-client: 1` 且同源；`connection.requestRejection` 可用时先做鉴权判断 |
| 设置页导航图标 | 由 `settings.action` 挂载点 + `patchSettingsNavIcon()` 在设置面板打开期间绘制 `IconContextInjectionOutline16`；面板关闭即回滚成壳层齿轮（见实现事实 4） |
| 压缩摘要请求 | `purpose === 'compaction'` 的 `llm/stream` 请求末尾会多一条 `source.kind = 'plugin'`、`plugin = 'dsh-extra-context'` 的 user 消息（额外上下文原文 + 语言/装饰两条说明）。它只存在于这次模型请求里，**不进会话记录**（见实现事实 5） |

全部副作用都走 `ctx.effect` / ctx 服务的 disposer，`stop` 或卸载后不残留 section、工具与路由。

## 配置与安装

- `package.json`：`engines.dsh` 与 `dshCompatibility.range` 同源（`>=0.1.7-alpha.1 <0.1.8`），另有 `dsh.bundle.patch` + `dsh.client.platform: 'web'` + `dsh.client.inject: ['@deepseek-ai/dsh-client-ui-settings']`（浏览器侧需要 `configForms`）。
- `cordis.patch.yml`：一行 `insert`。**新增插件首次安装必须重启 `dsh web`**——bundle 列表只在启动时读取（`patchReload: live` 只热重载 patch 文件，不重读 bundle 列表）。
- `install.sh` / `uninstall.sh`：兼容性检查（范围外拒绝安装）+ `npm run publish:check` + 官方 `dsh plugin --profile` 管理；卸载保留 profile 配置里的用户数据。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-extra-context`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 8 文件白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-extra-context-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。本包是首个验证 OIDC 自动发布的包。

## 测试与守卫

`test/` 下的护栏不是“断言存在”，而是**注入缺陷后必须失败**（逐条人工验证过）。按主题归纳：

- 写入时机与并发：失焦才写入（改成 `onChange` 直接提交 → 失败）、总开关与每行开关/增删当场提交、`busy` 期间动作控件禁用而输入控件不 `disabled`——这三条规则本身见「已知边界」，这里守的是实现；另有“失败补丁必须留住并能重写”“commit 成功不得回滚在途输入”（用 `hooks.beforeReadback()` 构造窗口，别用“等固定若干微任务”）。
- 组合层优先级：`describe` 无 `user` 键时不得回退 `scope.get()`、`describe` 抛错必须保留组合层、字段级合并而非整体替换。
- 文本口径：section 必须声明 `interpolate: false`、渲染结果不得含零宽空格、客户端预览不得再中和 `{{`、预览必须与宿主 `renderExtraContext()` 同口径（含包裹标记、空内容不包裹）、状态接口的口径与鉴权（删掉 `trustedClientRequest` 校验 → 失败）。
- 界面几何与一致性：图标按钮内容必须同型（回退文本 `'✕'` → 失败）且同尺寸档、规则行字数必须是字符数（回退 `byteLength` → 失败）、计数单位必须是「个字符」（行内退回 `N 字` → 失败，且断言整页不出现裸露的 `N 字`）、预览容器边框足够可见（新增 `border-l1` 规则必须被扫到，只查第一条匹配规则会漏）、客户端 `normalizeSettings` 必须去重、错误边界必须真的接在渲染树上。
- 预览分区（注入缺陷验证过）：卡片必须**恰好两段** `['dec-preview-text','dec-preview-cost']`，把 `.dec-preview-note` 塞回去 → 2 个用例红；「它写在每次对话的最前面，优先于其他说明」必须出现在标题下方的 `.dec-intro-line` 里，从那里删掉 → 1 个用例红（同时守着"卡片里不得再出现这句"）。
- 开关与 `label` 移除（本轮新增的护栏，全部**注入缺陷验证过**）：primitives 桩把 `Switch` 渲染成 `type: 'switch'`，于是"用的是官方组件还是自绘控件"在渲染树上可判定——①去掉 `.dec-master{margin-left:auto}` → 顶部排版用例红；②把总开关/行内开关换回自绘按钮或原生 checkbox → 4 个用例红（含 `dec-check` 残留检测）；③行内开关丢掉 `dec-row-switch` 定位类 → 4 个用例红；④行内开关被按下 `disabled: true` → 「写入进行中不得禁用输入控件」用例红；⑤新增分段时把 `label` 写回去 → 2 个用例红（添加分段的字段清单断言 + 脏数据用例）。另外 `decode`、`buildStatus`、`normalizeSettings` 与真实 schemastery 的 `toJSON()` 各有一条"不得再出现 `label`"的断言。
- 导航图标补丁：挂载点/CSS 变量/dataset 键**三处同源**（各自写一遍字面量就会静默失效）、必须补 `xmlns`、可回滚（引用计数递减、断开 MutationObserver、重建后补回）、`apply` 必须注册 `settings.action`、样式必须插件级注入（删掉 `apply()` 里的 `installStyles(ctx)` → 单测与 `tools/dsh-icons/verify-nav-icon.js` 的 `stylesInjected/originalIconHidden/maskApplied/squareIconBox` 四项同时失败）、样式表引用计数必须递减而不是清零。

测试基建的两个坑（写在 `test/client.test.js` 顶部，勿简化）：**React 桩必须按组件实例分池**——曾用“全局游标 + 全局数组”，父子组件 hook 槽位互相推挤，同一 `useRef` 位置在不同渲染轮次返回不同对象，看起来像产品缺陷、实际是桩的错；**`useCallback` 桩必须真记忆化**——曾写成 `useCallback(fn) { return fn }`，回调标识每轮变化，`useEffect([flush])` 的清理每轮重跑，“打字过程中不得写设置”的守卫因此恒为真。

`mountPanel(handler, hooks)` 提供三个测试钩子：`holdWrites()`/`releaseWrites()` 把写入挂在“进行中”这一刻以观察 `busy=true` 的真实 DOM；`hooks.afterWrite(writeLog)` 让宿主返回与提交不一致的内容或“落后一拍”的读回值；`hooks.beforeReadback()` 让读回停住不返回。

## 已知边界（含用户实测反馈）

- **改动只影响新开的会话**（历史不可追溯，已实机验证）：同一对话里先问“你现在遵守哪些额外上下文规则” → 改设置（写盘成功、预览同步）→ **不新开对话**再问 → 模型只报旧规则。**与源码推断相反，务必别再按源码改回来**：`dsh-agent-loop` 的 `project()`（`:266`）在 `inHistory === true` 且内容变化时会返回 `surfaceOp: "append"` 的 `system/message`，`buildRequest()` 又用 `session.deriveMessages()` 重建消息列表——只看这条链路会得出“改动会进入进行中的会话”，但实测并不成立。改这条文案前必须先做同样的实机对照。（README 与设置页文案一度被按源码推断改成“下一次请求就生效”，已改回。）
- 曾实现 `/context-refresh`（`agent.inject` 追加 user 消息）来“把新内容刷进旧对话”，**已移除**：这类注入只能追加普通用户消息，会让新旧两套要求并存冲突；语义不明确的功能不如不做。
- 同名 section 会被 agent preset 的 scoped 版本遮蔽（DSH 规则）；本插件不注册 agent 级 section，也不尝试对抗遮蔽。
- `$DSH_HOME/AGENTS.md` 已承担“用户级工作指导”；两者分工只写在 README 的对照表里，设置页刻意不重复技术说明。
- 这段文本每轮都在上下文里（token 成本），故有偏长提醒；软上限只提醒、不阻止任何改动。
- **没有保存动作，也不做“打字即写入”**：输入过程只改本地（`editLocal`），**失焦时提交**（`commitPending`）；显式动作（添加/删除/总开关/每行的启停开关）点了即写；组件卸载时兜底写入未提交的改动。提交串行化（pending + flush）避免并发覆盖，成功不提示，只有写入失败才出现错误与重试。（曾用“输入停顿 600ms 自动写入”，写入触发的重渲染打断输入，已改掉并加回归测试。）
- **输入控件绝不禁用**：写入期间 `busy` 为真，而给已聚焦元素加 `disabled` 会让浏览器强制失焦（表现为“打字一停顿就再也输入不了”）。`textarea` 与每行的启停开关显式 `disabled: false`，`busy` 只用于动作控件（「+ 添加上下文」与总开关）。
- **开关/增删必须当场提交**：这些是明确点击动作（没有“边打边看”的过程），漏提交会表现为“切了像没切”。
- **两个开关都用官方 `Switch`，不自绘**（用户要求“开关组件在 dsh 中可以直接拿来用”）：动作行里是「总开关」（左侧配一行可见小字，容器 `.dec-master` 用 `margin-left:auto` 贴右），每行行首是启停开关（`.dec-row-switch`）。开关的尺寸、开启态品牌色轨道、圆角拇指、焦点环、过渡全部由壳层组件负责，插件样式**只做定位**（早先的实现是自绘按钮 + `.dec-btn-on` 中性填充，深色主题下还要额外绕开品牌色，已删除）。
- **`label`（分段名称）字段已整体移除**：界面、客户端规范化、`buildStatus` 状态行、宿主规范化与设置 schema 五处都不再认识它。schemastery 对未知键是 **merge 保留**（`object` 非 strict），所以老设置文件里的 `label:` 不会让校验失败，但也**不会**被读进来；两侧规范化只挑 `id/enabled/text`，因此脏数据里的 label 既不出现在界面上，也不会被重新提交回去。改这条时注意别只改一边：`test/client.test.js` 的 `decode`、添加分支与 `test/host.test.js` 的 `normalizeSettings`/`buildStatus`/schema 都有断言。
- **图标按钮两条硬约束**（用户实测反馈，两次都踩过）：①内容必须同型——删除按钮原用文本 `'✕'`、展开按钮用 SVG，class 相同却因基线对齐差 1.5px；现在两者都是 SVG，按钮 `inline-flex` + `align-items:center` 居中、图标 `display:block` 去掉行内盒间隙，**别把图标按钮的内容写成文本字符**（它还会随字体渲染变化）。②必须同尺寸档——官方图标按 `14`/`16` 分档（`IconXxx14`/`IconXxx16`），曾用 `IconCloseOutline16`（16 档描边）搭 `IconTriangleRightFill14`（14 档实心），实测删除图标 12×12、箭头 5×8，明显一大一小；**同一行里的图标必须同档**，本条用 `IconCloseFill14`，换图标前先确认档位。
- **呈现用字符数、判断用字节数**（用户反馈“字符统计跟我看到的字数不一致”）：UTF-8 一个汉字 3 字节，把字节数标成“字”会大出约 2.7 倍（实测那条 67 字的规则显示成 183）。`characterCount()`（`Intl.Segmenter` 字素簇，emoji/组合字符算一个可见字符）**只用于界面呈现**（规则行「N 个字符」、预览「约 N 个字符 · 约 N tokens」）；`byteLength()`（UTF-8 字节）**只用于预算与上限**（`overBudget` 必须字节口径，宿主上限 `maxBytes` 就是字节，换成字符数会“看着没超、实际已超”）。新增任何“给用户看的体积数字”时先问：这是字节还是字符？
- **计数单位全界面统一为「字符」**（用户反馈：行内写「N 字」、预览写「约 N 个字符」，同一份数字两种叫法）：行内是精确字素计数，不写“约”；“约”只留给预览里的 token 估算。测试同时断言"行内数字 == 实际字符数"与"整页不得出现裸露的 `N 字`"（注入回 `N 字` → 变红）。
- **预览是本地渲染的单一数据源**：`previewText()` 必须与宿主 `renderExtraContext()` 口径一致（含前置说明与前后标记），空内容时**不得**渲染包裹结构；曾让预览在“本地/宿主”两份数据间切换，导致勾选后预览显示旧值（`test/client.test.js` 有跨端一致性断言守着两边固定文字）。
- **压缩摘要的写作语言由 DSH 决定、由本插件拉回**（用户实测反馈，见实现事实 5）：`dsh-compaction-basic` 的最后一条指令固定要求英文摘要，所以压缩后的 checkpoint 默认是英文。插件会把用户的额外上下文原文追加到那次请求的最末尾。副作用要说清：①摘要语言从此跟随额外上下文——**想让它保持英文，把额外上下文里的语言要求去掉即可**；②只影响摘要请求，不改写 DSH 的指令本身；③那条消息不进会话记录。若哪天 DSH 自己也按会话语言写摘要，这段钩子就该删掉。
- **预览卡片只有两段：内容（`.dec-preview-text`）与消耗（`.dec-preview-cost`）**，卡片外只有区块级「预览」标题。位置与优先级的说明（「它写在每次对话的最前面，优先于其他说明」）属于**页面级文案**，写在标题下方的 `.dec-intro-line` 里——用户明确要求从卡片里移出来，别再往卡片里塞第三段（旧的 `.dec-preview-note` 元素与它的样式都已删除，测试有"卡片恰好两段"与"该句只能出现在标题下方的说明里"两条断言守着）。

## 验证现状

```bash
npm run check       # node --check ×4 + bash -n ×2（bash 不在 PATH 时本机跑不通，CI 用 ubuntu）
npm test            # 73 项：版本门/定位/规范化/渲染/预算/装配/客户端组件与样式（含两个开关的
                    #        落位、形态与禁用策略）、label 移除、写入时机与重试、预览口径、
                    #        状态路由鉴权、字段级合并、错误边界、图标对齐与字数口径、
                    #        导航图标补丁、样式表注入与引用计数、Windows 装载路径（file URL）、
                    #        压缩摘要补充指令（纯函数 / 只认 compaction / 脏输入放行 / 热更新）
npm run pack:check  # 发布物 = 8 个文件（npm 12 的 --json 返回对象而非数组，本机跑不通，见下）
```

- `test/host.test.js`：用伪 Cordis ctx 验证版本门、DSH 定位、规范化/渲染/预算、settings 注册与热更新、组合层与用户层优先级、删除语义。
- `test/client.test.js`：以 stub `__ModuleLoader__` + stub React/primitives 加载 bundle，验证 `apply` 的命名空间绑定（`namespace` + `decode` 契约）、slot 注册、组件渲染成元素树、样式表打标、失焦写入、写入失败与重试、预览口径。
- **压缩摘要补充指令的四条护栏**（实现事实 5，逐条**注入缺陷验证过**）：①去掉 `purpose` 筛选 → 「其它 purpose 不得被改动」用例红；②把追加改成替换 `options.messages` → 「DSH 英文摘要指令必须还在原位」用例红；③去掉 try/catch → 「冻结 options 必须原样放行」用例红；④把 `llmCtx.on('llm/stream')` 换成别的钩子 → 契约锚点用例红。
- **Windows 装载路径的两条护栏**（真实缺陷：`import(绝对路径)` 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，见实现事实 1）：①`test/host.test.js` 里"装载 schemastery 必须经 file URL"用**假 DSH 根 + 桩 schemastery** 走 `applyCompatibleRuntime`，装载失败时 `state.registers` 为 0 → 必红（已在 Windows 上注入缺陷验证过）；②`test/manifest.test.js` 断言宿主源码必须写成 `await import(pathToFileURL(resolved).href)`。另外 `REAL_DSH_MANIFEST` 的探测已补 Windows 分支（原先只跑 POSIX 的 `command -v dsh`，于是依赖它的"真实 schemastery 全链路"用例在 Windows 上被整体 skip —— 这正是缺陷溜到用户机器上的原因）；伪造 DSH 根的目录软链在 Windows 用 `junction`（`symlink(..., 'dir')` 需要开发者模式，EPERM）。
- **已在真实部署验证**：`GET /dsh-extra-context/status`、设置页分区、设置写盘、预览与消耗提示，以及“新建会话自动带上最新上下文”（用真实子代理逐字核对过 system prompt 内容）。
- **导航图标补丁在真实浏览器里量过**（固定场景已固化进工作区工具）：`node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context` 用壳层原样抽取的导航 CSS + 真实 bundle（极简 React 垫片挂到真 DOM，保证 ref/`outerHTML`/`getComputedStyle` 都是真的）搭出与设置面板同构的 `nav button` 结构，并自动探测本插件的补丁契约（`data-dec-nav-icon` / `var(--dec-nav-icon-mask)` / 用 `display:none` 隐藏原 svg），契约与代码不同源时直接报错。量测结果：补丁行与壳层原生行的 `labelOffsetLeft/Top` 相同（36/9），原 svg `display:none`、`::before` 为 16×16 且 `mask-image` 是 data URI，壳层其他行保持齿轮且无任何 dataset 痕迹。**这不是实机设置页**，实机观感仍需用户刷新页面目视确认。
- 仍未实机验证：客户端 bundle 的裸单包路径 `/plugins/<id>/client.js` 取不到（`dsh-client-modules` 只广告/应答 combo URL `/plugins/??<id>/client.js&rev=<rev>`），所以“客户端是否加载”只能靠页面现象判断，不能用 curl 断言。
- **本机（Windows）跑不全闸门的两个已知原因**，与插件代码无关：①`npm run check` 的 `bash -n install.sh/uninstall.sh` 依赖 PATH 里有 bash（这台机器的 Git bash 只剩 `bin\bash.exe` 壳、`usr\bin\bash.exe` 缺失）；②`npm run pack:check` 读 `npm pack --dry-run --json`，npm 12 起该输出是**以包名为键的对象**、而脚本按数组解构（`const [pack] = JSON.parse(output)`）→ `object is not iterable`。CI/发布跑 ubuntu，不受影响；要在本机跑全闸门得先修这两处。

## 排查顺序

1. 页面提示 "Failed to load plugins" → 看 Host 日志里的 `dsh-extra-context:` 前缀告警；常见原因是 schemastery 定位失败或版本门拒绝。
2. 设置页分区不出现 → 确认 profile 的 bundle 列表已包含 `dsh-extra-context`（需重启），且 `@deepseek-ai/dsh-client-ui-settings` 已进 boot graph。
3. **分区在、但「+ 添加上下文」和右侧总开关灰掉点不动（其余控件可点）** → 客户端只按 `disabled: busy || !writable` 禁这两个动作控件（每行的启停开关与 `textarea` 刻意不禁用），所以必然是"宿主没给可写"或"busy 卡住"。查状态接口：`GET /dsh-extra-context/status`（带 `x-dsh-extra-context-client: 1`，浏览器同源请求才过鉴权；命令行 curl 会拿到 401）看 `writable`；`?debug=1` 看 `entryPresent`（条目是否在 `settings.describe()` 里）、`schemaPresent`（`Config` 有没有构造出来）、`legacyPresent`（旧 settings.yaml 段是否在用）。`entryPresent:false` = 条目没有可配置 schema——Windows 上最常见的原因是 schemastery 装载失败（见实现事实 1），也可能是 `settings` 服务缺失（Host 日志有 `dsh-extra-context:` 前缀告警）。
4. 文本没进提示词 → 检查是否 `enabled=false`、分段是否启用且非空、是否有 preset 注册了同名 section。
5. 改了设置但当前会话没变 → **预期行为**（见「已知边界」）。若新开的对话也没变，再查预览里是不是你想要的内容、是否有 preset 注册了同名 section。
6. **压缩之后模型改用英文写过程性回复** → 先看会话记录里 `compaction/summary` 那段摘要的语言。摘要若是英文，说明补充指令没生效：查 Host 日志有没有 `dsh-extra-context:` 的 warn（追加失败会打 `cannot attach the extra context to a compaction request`），再确认 `llm` 服务存在（本钩子进 `ctx.inject(['llm'])`，缺服务时整块跳过）。
