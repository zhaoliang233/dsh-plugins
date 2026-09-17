# dsh-extra-context — 技术说明（AGENTS.md）

> 面向在本工作区继续开发/排查的 agent；用户文档见 `README.md`。
> 目标 DSH `0.1.6-alpha.1`，兼容线 `>=0.1.6-alpha.1 <0.1.7`，逐版本核对的是 `0.1.6-alpha.1`（见 `lib/index.js` 的 `VERIFIED_DSH_VERSIONS`）。

## 一句话

把一段「额外说明 + 上下文」注册为**进程级** system prompt section，使当前 DSH 的**所有**会话（主会话、子代理、workflow 子步骤）都带上它；文本在设置页分段维护、热生效。

## 已核对的契约（不是猜测）

| 事实 | 来源 |
|---|---|
| `ctx.systemPrompt.section({name, order, text})` 注册在**调用者 fiber 的全局层**，对所有 agent 生效；同名 scoped section 才会遮蔽它 | `dsh-system-prompt/lib/index.js`（`ScopedLayers` + `section()`） |
| `text` 可以是 `(context) => string`，**每次组装实时求值** → 设置变化无需重新注册 | 同上 `assemble()` |
| `SECTION_ORDERS`：`DEPLOYMENT_PERSONA_PREFIX = 0`、`TOOL_BASH = 1000`；本插件取 **204**，落在两者之间的空档 | `dsh-system-prompt/lib/index.js` |
| section 注册返回的正是 Cordis effect disposer | `SystemPrompt.section()` 文档 |
| `ctx.settings.register(ns, schema, {applies:'live'})` 返回带 `get()/watch()/update()/replace()` 的 owner scope；`describe()` 会调用 `schema.toJSON()`，其 `user` 层字段名可用于判断「用户是否显式配置过」 | `dsh-settings/lib/types/index.d.ts` |
| 宿主侧 schema 必须是真正的 schemastery 对象 | 同上（`z<T>` + `toJSON` 序列化方言） |
| 客户端 `ctx.settingsScope.bind({namespace, decode})` 返回 `{getSnapshot, subscribe, mutate, set, unset}`，写入带 revision 栅栏 | `dsh-client-ui-settings/lib/client.js` |
| `settings.section` 是 list slot，注册需要 `id`（+ 可选 `order`/`label`） | 实时 Slot 树查询 |
| **设置页导航图标不可由插件声明**：壳层只取注册项的 `id/order/label`（没有 `icon`），图标由 `navIcon(id)` 决定，且只白名单 4 个官方 id（`models`/`agent-presets`/`plugins`/`archived-sessions`），其余一律回落 `IconSettingsOutline16`（齿轮） | `dsh-client-ui-settings-general/lib/client.js` 的 `rows`/`navIcon` |
| `settings.action` 与 `settings.section` 同属 `sidebar.settings` 的 children 表（同时声明），随设置面板挂载/卸载 | 同上 `register({ name: 'sidebar.settings', children: {...} })` |
| `agent.inject(UserMessage)` 是官方「补模型可见上下文」通道，空闲时不唤醒 driver | `dsh-agent/lib/types/runtime-types.d.ts`；`dsh-user-approval`、`dsh-cordis-host-runner` 同款用法 |
| `PromptSection.interpolate: false` 让 `renderPrompt()` 原样取 `section.text`，不做 `{{variable}}` 插值 | `dsh-system-prompt/lib/index.js:115`；`renderPrompt()` 是 `assemble()` 的唯一渲染口（`dsh-agent-loop/lib/index.js:1014`） |
| 浏览器 `__ModuleLoader__` 静态 seed 共 **9** 个键：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit` | `dsh-web-frontend/dist/assets/index-*.js` 的 seed 映射 |

## 关键实现事实

### 1. schemastery 必须按 DSH 安装的绝对路径加载

宿主插件不声明 `@deepseek-ai/*` 依赖（工作区惯例），实测**裸 import 会 `ERR_MODULE_NOT_FOUND`**：插件目录向上找不到 DSH 的 `node_modules`。因此 `loadSchemastery(dshRoot)`：

1. `readDshPackage(process.argv[1])` 从 CLI 入口 realpath 后向上 ≤4 层找到 `@deepseek-ai/dsh` 包根（与工作区其他插件同款探测）；
2. `createRequire(join(root,'package.json')).resolve('@deepseek-ai/schemastery')` → 绝对路径动态 import。

若 DSH 把 schemastery 移出 `node_modules`，这里 fail closed（只告警：settings 命名空间不注册，section 仍按组合层值生效）。

### 2. 「组合层配置」与「settings 用户值」的优先级由 `describe()` 的 `user` 层决定

判定「用户是否显式配置过」的权威来源是 `settings.describe()` 返回行的 `user` 键：

- 没有 `user` 键（用户从未写过这一段）→ 视为“尚未配置”，保留 `ctx.config`（组合层）作为生效值；
- 有 `user` 键 → 只把 `user` 里出现的字段当作用户显式设置，其余字段回落组合层值。

两个真实缺陷都出在这里（都已修复、各有测试守卫）：曾用 `scope.get()`（返回 resolved 值、恒含全部字段）取字段名，“从未写过”被误判成“写过”，空默认值覆盖组合层 config；更早还用 `isConfigured()`（内容是否为空）判断，出现“设置页显示空、而 config 里的基线文本仍在生效”。这也是**不传 `base`** 的原因——传 `base` 会把“未配置”伪装成“已配置”。

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

## 文件职责

- `lib/rules.js`：纯逻辑（规范化 / 过滤 / 渲染 / 预算）。**不对用户文本做任何改写**——`{{…}}` 由 section 的 `interpolate: false` 原样放行，不再用“把 `{{` 拆成零宽字符”的老 hack。只依赖 Node 内置，可在 `node --test` 下独立验证。顺序即数组顺序，`order` 字段已随排序功能移除。
- `lib/index.js`：Cordis 入口。版本门 → 装配 section / settings 命名空间 / 状态路由。其余导出仅为测试与兼容检查可见。
- `client.js`：单文件 CJS 惰性 bundle（无构建步骤，逻辑分层靠函数分区）。`apply()` 做三件事：绑定设置命名空间、注入插件样式表、注册两个插槽（`settings.section` id `extra-context` order 25；`settings.action` id `extra-context-nav-icon` order 25，仅作导航图标补丁的挂载点）。客户端**不**做 schema 校验（bundle 里拿不到 schemastery，`dsh-client-ui-settings` 也不导出 `Schema`）；宿主是权威，组件对任何字段都防御性读取。

## 运行期行为

| 入口 | 行为 |
|---|---|
| system prompt | `<name: deployment:extra-context, order: 204, interpolate: false, text: () => renderForPrompt()>`；用户文本里的 `{{…}}` 原样进入 prompt |
| 设置命名空间 | `extra-context`，`applies: 'live'`，写入 `$DSH_HOME/settings.yaml` |
| 状态路由 | `GET /dsh-extra-context/status`，要求 `x-dsh-extra-context-client: 1` 且同源；`connection.requestRejection` 可用时先做鉴权判断 |
| 设置页导航图标 | 由 `settings.action` 挂载点 + `patchSettingsNavIcon()` 在设置面板打开期间绘制 `IconContextInjectionOutline16`；面板关闭即回滚成壳层齿轮（见实现事实 4） |

全部副作用都走 `ctx.effect` / ctx 服务的 disposer，`stop` 或卸载后不残留 section、工具与路由。

## 配置与安装

- `package.json`：`engines.dsh` 与 `dshCompatibility.range` 同源（`>=0.1.6-alpha.1 <0.1.7`），另有 `dsh.bundle.patch` + `dsh.client.platform: 'web'` + `dsh.client.inject: ['@deepseek-ai/dsh-client-ui-settings']`（浏览器侧需要 `ctx.settingsScope`）。
- `cordis.patch.yml`：一行 `insert`。**新增插件首次安装必须重启 `dsh web`**——bundle 列表只在启动时读取（`patchReload: live` 只热重载 patch 文件，不重读 bundle 列表）。
- `install.sh` / `uninstall.sh`：兼容性检查 + `npm run publish:check` + 官方 `dsh plugin --profile` 管理；卸载保留 `settings.yaml` 里的用户数据。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-extra-context`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 8 文件白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-extra-context-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。本包是首个验证 OIDC 自动发布的包。

## 测试与守卫

`test/` 下的护栏不是“断言存在”，而是**注入缺陷后必须失败**（逐条人工验证过）。按主题归纳：

- 写入时机与并发：失焦才写入（改成 `onChange` 直接提交 → 失败）、勾选/增删/总开关当场提交、`busy` 期间动作按钮禁用而输入控件不 `disabled`——这三条规则本身见「已知边界」，这里守的是实现；另有“失败补丁必须留住并能重写”“commit 成功不得回滚在途输入”（用 `hooks.beforeReadback()` 构造窗口，别用“等固定若干微任务”）。
- 组合层优先级：`describe` 无 `user` 键时不得回退 `scope.get()`、`describe` 抛错必须保留组合层、字段级合并而非整体替换。
- 文本口径：section 必须声明 `interpolate: false`、渲染结果不得含零宽空格、客户端预览不得再中和 `{{`、预览必须与宿主 `renderExtraContext()` 同口径（含包裹标记、空内容不包裹）、状态接口的口径与鉴权（删掉 `trustedClientRequest` 校验 → 失败）。
- 界面几何与一致性：图标按钮内容必须同型（回退文本 `'✕'` → 失败）且同尺寸档、规则行字数必须是字符数（回退 `byteLength` → 失败）、预览容器边框足够可见（新增 `border-l1` 规则必须被扫到，只查第一条匹配规则会漏）、客户端 `normalizeSettings` 必须去重、错误边界必须真的接在渲染树上。
- 导航图标补丁：挂载点/CSS 变量/dataset 键**三处同源**（各自写一遍字面量就会静默失效）、必须补 `xmlns`、可回滚（引用计数递减、断开 MutationObserver、重建后补回）、`apply` 必须注册 `settings.action`、样式必须插件级注入（删掉 `apply()` 里的 `installStyles(ctx)` → 单测与 `tools/dsh-icons/verify-nav-icon.js` 的 `stylesInjected/originalIconHidden/maskApplied/squareIconBox` 四项同时失败）、样式表引用计数必须递减而不是清零。

测试基建的两个坑（写在 `test/client.test.js` 顶部，勿简化）：**React 桩必须按组件实例分池**——曾用“全局游标 + 全局数组”，父子组件 hook 槽位互相推挤，同一 `useRef` 位置在不同渲染轮次返回不同对象，看起来像产品缺陷、实际是桩的错；**`useCallback` 桩必须真记忆化**——曾写成 `useCallback(fn) { return fn }`，回调标识每轮变化，`useEffect([flush])` 的清理每轮重跑，“打字过程中不得写设置”的守卫因此恒为真。

`mountPanel(handler, hooks)` 提供三个测试钩子：`holdWrites()`/`releaseWrites()` 把写入挂在“进行中”这一刻以观察 `busy=true` 的真实 DOM；`hooks.afterWrite(writeLog)` 让宿主返回与提交不一致的内容或“落后一拍”的读回值；`hooks.beforeReadback()` 让读回停住不返回。

## 已知边界（含用户实测反馈）

- **改动只影响新开的会话**（历史不可追溯，已实机验证）：同一对话里先问“你现在遵守哪些额外上下文规则” → 改设置（写盘成功、预览同步）→ **不新开对话**再问 → 模型只报旧规则。**与源码推断相反，务必别再按源码改回来**：`dsh-agent-loop` 的 `project()`（`:266`）在 `inHistory === true` 且内容变化时会返回 `surfaceOp: "append"` 的 `system/message`，`buildRequest()` 又用 `session.deriveMessages()` 重建消息列表——只看这条链路会得出“改动会进入进行中的会话”，但实测并不成立。改这条文案前必须先做同样的实机对照。（README 与设置页文案一度被按源码推断改成“下一次请求就生效”，已改回。）
- 曾实现 `/context-refresh`（`agent.inject` 追加 user 消息）来“把新内容刷进旧对话”，**已移除**：这类注入只能追加普通用户消息，会让新旧两套要求并存冲突；语义不明确的功能不如不做。
- 同名 section 会被 agent preset 的 scoped 版本遮蔽（DSH 规则）；本插件不注册 agent 级 section，也不尝试对抗遮蔽。
- `$DSH_HOME/AGENTS.md` 已承担“用户级工作指导”；两者分工只写在 README 的对照表里，设置页刻意不重复技术说明。
- 这段文本每轮都在上下文里（token 成本），故有偏长提醒；软上限只提醒、不阻止任何改动。
- **没有保存动作，也不做“打字即写入”**：输入过程只改本地（`editLocal`），**失焦时提交**（`commitPending`）；显式动作（添加/删除/勾选框/总开关）点了即写；组件卸载时兜底写入未提交的改动。提交串行化（pending + flush）避免并发覆盖，成功不提示，只有写入失败才出现错误与重试。（曾用“输入停顿 600ms 自动写入”，写入触发的重渲染打断输入，已改掉并加回归测试。）
- **输入控件绝不禁用**：写入期间 `busy` 为真，而给已聚焦元素加 `disabled` 会让浏览器强制失焦（表现为“打字一停顿就再也输入不了”）。`textarea`/勾选框显式 `disabled: false`，`busy` 只用于按钮。
- **勾选/增删/总开关必须当场提交**：这些是明确点击动作（没有“边打边看”的过程），漏提交会表现为“勾了像没勾”。
- **图标按钮两条硬约束**（用户实测反馈，两次都踩过）：①内容必须同型——删除按钮原用文本 `'✕'`、展开按钮用 SVG，class 相同却因基线对齐差 1.5px；现在两者都是 SVG，按钮 `inline-flex` + `align-items:center` 居中、图标 `display:block` 去掉行内盒间隙，**别把图标按钮的内容写成文本字符**（它还会随字体渲染变化）。②必须同尺寸档——官方图标按 `14`/`16` 分档（`IconXxx14`/`IconXxx16`），曾用 `IconCloseOutline16`（16 档描边）搭 `IconTriangleRightFill14`（14 档实心），实测删除图标 12×12、箭头 5×8，明显一大一小；**同一行里的图标必须同档**，本条用 `IconCloseFill14`，换图标前先确认档位。
- **呈现用字符数、判断用字节数**（用户反馈“字符统计跟我看到的字数不一致”）：UTF-8 一个汉字 3 字节，把字节数标成“字”会大出约 2.7 倍（实测那条 67 字的规则显示成 183）。`characterCount()`（`Intl.Segmenter` 字素簇，emoji/组合字符算一个可见字符）**只用于界面呈现**（规则行「N 字」、预览「约 N 个字符」）；`byteLength()`（UTF-8 字节）**只用于预算与上限**（`overBudget` 必须字节口径，宿主上限 `maxBytes` 就是字节，换成字符数会“看着没超、实际已超”）。新增任何“给用户看的体积数字”时先问：这是字节还是字符？
- **预览是本地渲染的单一数据源**：`previewText()` 必须与宿主 `renderExtraContext()` 口径一致（含前置说明与前后标记），空内容时**不得**渲染包裹结构；曾让预览在“本地/宿主”两份数据间切换，导致勾选后预览显示旧值（`test/client.test.js` 有跨端一致性断言守着两边固定文字）。

## 验证现状

```bash
npm run check       # node --check ×4 + bash -n ×2
npm test            # 67 项：版本门/定位/规范化/渲染/预算/装配/客户端组件、样式、
                    #        写入时机与重试、预览口径、状态路由鉴权、字段级合并、
                    #        错误边界、图标对齐与字数口径、导航图标补丁、样式表注入与引用计数
npm run pack:check  # 发布物 = 8 个文件
```

- `test/host.test.js`：用伪 Cordis ctx 验证版本门、DSH 定位、规范化/渲染/预算、settings 注册与热更新、组合层与用户层优先级、删除语义。
- `test/client.test.js`：以 stub `__ModuleLoader__` + stub React/primitives 加载 bundle，验证 `apply` 的命名空间绑定（`namespace` + `decode` 契约）、slot 注册、组件渲染成元素树、样式表打标、失焦写入、写入失败与重试、预览口径。
- **已在真实部署验证**：`GET /dsh-extra-context/status`、设置页分区、设置写盘、预览与消耗提示，以及“新建会话自动带上最新上下文”（用真实子代理逐字核对过 system prompt 内容）。
- **导航图标补丁在真实浏览器里量过**（固定场景已固化进工作区工具）：`node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context` 用壳层原样抽取的导航 CSS + 真实 bundle（极简 React 垫片挂到真 DOM，保证 ref/`outerHTML`/`getComputedStyle` 都是真的）搭出与设置面板同构的 `nav button` 结构，并自动探测本插件的补丁契约（`data-dec-nav-icon` / `var(--dec-nav-icon-mask)` / 用 `display:none` 隐藏原 svg），契约与代码不同源时直接报错。量测结果：补丁行与壳层原生行的 `labelOffsetLeft/Top` 相同（36/9），原 svg `display:none`、`::before` 为 16×16 且 `mask-image` 是 data URI，壳层其他行保持齿轮且无任何 dataset 痕迹。**这不是实机设置页**，实机观感仍需用户刷新页面目视确认。
- 仍未实机验证：客户端 bundle 的裸单包路径 `/plugins/<id>/client.js` 取不到（`dsh-client-modules` 只广告/应答 combo URL `/plugins/??<id>/client.js&rev=<rev>`），所以“客户端是否加载”只能靠页面现象判断，不能用 curl 断言。

## 排查顺序

1. 页面提示 "Failed to load plugins" → 看 Host 日志里的 `dsh-extra-context:` 前缀告警；常见原因是 schemastery 定位失败或版本门拒绝。
2. 设置页分区不出现 → 确认 profile 的 bundle 列表已包含 `dsh-extra-context`（需重启），且 `@deepseek-ai/dsh-client-ui-settings` 已进 boot graph。
3. 文本没进提示词 → 检查是否 `enabled=false`、分段是否启用且非空、是否有 preset 注册了同名 section。
4. 改了设置但当前会话没变 → **预期行为**（见「已知边界」）。若新开的对话也没变，再查预览里是不是你想要的内容、是否有 preset 注册了同名 section。
