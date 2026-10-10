# dsh-default-tuner — 技术契约

## 这是什么

宿主半体 + 浏览器半体的双面插件：宿主侧用官方 `ctx.configEditor` 读写当前 profile 的补丁文件，浏览器侧在设置里注册一个 `settings.section` 分区（`order: 110`，排在 DSH 自带项之后）。

结构：

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口、HTTP 路由（status / action）、守卫、错误翻译 |
| `lib/overrides.js` | 可覆盖项白名单 + 纯计算（候选配置、校验、可用性判定） |
| `client.js` | 设置分区 UI（单文件 bundle，无构建） |
| `cordis.patch.yml` | bundle patch：把 `dsh-default-tuner` 条目插进组合 |

## 兼容发布线与版本门（2026-10-01 补，2026-10-10 跨到 0.2.1）

兼容线 `>=0.2.1-alpha.2 <0.2.2`，逐版本核对清单 `0.2.1-alpha.2`（跨线当轮的逐包证据见下面「逐版本核对记录」）。

**声明必须四处同源**：`package.json#dshCompatibility.range`（+ `engines.dsh`）⟷ `lib/index.js` 的 `DSH_COMPATIBILITY_RANGE` / `VERIFIED_DSH_VERSIONS`（发布线与下界从 `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` 派生）⟷ `install.sh` 的五个常量 `DSH_COMPATIBILITY_RANGE` / `DSH_VERIFIED_VERSIONS` / `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR_CHANNEL` / `DSH_RELEASE_FLOOR_SEQUENCE`（**多版本用空格分隔**，脚本按词分割消费）+ 一份等价的 `prerelease_rank()` ⟷ 本文件与 `README.md` 的兼容段。`test/manifest.test.js` 的「四处同源」用例按行解析这些赋值逐字比对（并且把 range 反推回发布线与下界），加版本时必须四边一起改。

**跨线只改常量，判定逻辑不动**：`classifyDshVersion()` 从发布线 + 下界派生，五个常量都是普通字面量（**不要 `Object.freeze`、不要 `Set`**，形状与 8 个已跨线插件一致）。同线内的 prerelease 必须靠 **channel 优先级比较**挡住——旧写法 `channel !== 'alpha' || seq >= N` 只能表达"下界是 alpha"，换成 rc 后会静默放行 `0.2.0-alpha.9`。2026-10-10 下界从 `rc.2` 换成 `alpha.2` 后这个比较方向反过来，**两条判据都要在矩阵里有档**：`0.2.1-beta.1`/`0.2.1-rc.1` 必须放行、`0.2.1-alpha.1` 必须挡住。

**范围外必须 inert**：`applyForEntry()` 从 DSH CLI 入口 realpath 后向上 ≤4 层定位 `@deepseek-ai/dsh/package.json` 读真实版本，`applyForVersion()` 判定超出范围就只打一条 error 日志并返回——不注册路由、不读 profile、不写任何文件。线内未逐条核对的版本继续运行但打 warn（能力探测仍是权威判定）。

这条不是保守习惯，是**写错就救不回来**：本插件整块改写 profile 补丁里的 `config`，写错的后果是目标条目因 `required` 校验失败而加载失败（`fiber.state = 3`），此时 `configEditor` 会拒绝服务（"Configuration plugin is no longer active"），只能手改文件救回来。

**2026-10-01 的真实缺陷**：在此之前上面两段全是空话——`package.json`、`install.sh`、README 都声明了范围与清单，运行时的 `apply()` 却只有一句 `ctx.inject([...])`，从不判定版本。于是本机 DSH 升到 `0.2.0-rc.2` 后它照常注册路由、照常可写 profile，而 9 个兄弟插件里另外 8 个都按版本门退成了 inert。补上后新增 `test/version-gate.test.js`（7 个用例：纯函数判定矩阵、范围外零注册 + error 日志、已核对版本装配与不告警、同线未核对版本告警、入口定位失败 inert、`readDshPackage` 的包根探测与拒绝、常量同源）与 `manifest.test.js` 的四处同源守卫。

**客户端在 inert 下的表现**：宿主没注册路由时 `/dsh-default-tuner/status` 是空 body 的 404，`response.json()` 会抛 `SyntaxError`，页面只剩「读取状态失败：Unexpected end of JSON input」。`client.js` 因此显式识别 404 并给出可读文案，并单独捕获非 JSON 响应——这是「探测不到的能力各自降级，不要让整页 404」的落地。

## 逐版本核对记录

**`0.2.1-alpha.2`（2026-10-10 跨发布线：DSH 从 `0.2.0-rc.2` 升到 `0.2.1-alpha.2`）**：用 `npm pack` 拉下两版的 28 个契约包逐文件 sha256 比对（**new 侧 28 个包与运行安装 `diff -rq` 全树逐字一致**，自证取到同一份代码）。本插件点名的契约面逐条重读：

| 契约项 | 0.2.1-alpha.2 现状（读的是实际安装包，不是 CHANGELOG） |
|---|---|
| profile 补丁事务（`configEditor.edit()` / `configuration()`） | **整个 `dsh-config-editor/lib/index.js` 逐字相同**（sha256 一致）——「先校验后落盘、`fiber.state !== 2` 拒绝、`!!js` 重建、reconcile 失败回写原文」这条链一行未动 |
| 事务的底层依赖 | `dsh-atomic-write/lib/index.js` 与 `@deepseek-ai/cordis/lib/index.js` **逐字相同**（`writeFileAtomic`/`withFileLock` 未动）；`schemastery` 的 `lib/` 逐字相同（只有 `package.json` 的版本变）；`cordis-plugin-loader` 只有 2 处改动——`Entry` 新增字段 `moduleNamespace`、`_init()` 把局部变量改名并保存给它（HMR 用），**`unwrapExports(moduleNamespace)` 与 `registry.plugin(plugin, this.options.config, …)` 的调用一行未变** |
| `dsh-app-boot`（profile 读取链） | `composeEntries`、`readProfilePatches`、`reconcileProfilePatches`、`readProfileManifest` 四个函数**定义体逐字相同**（按参数括号 + 花括号配对提取的函数体长度 229/700/1787/461 字节两版一致）；`loadProfileDirectory` 的**唯一差异是第一行**——`readProfileManifest(...)` 外面套了新的 `dropRetiredBundles(dir, …)`（把退役 bundle 从 profile 的 bundle 列表剔除，且只在列表里真含退役项时才写回 manifest）。132 行 diff 的其余部分全在导出表（新增 `OFFICIAL_ON_DEMAND_CATALOG`/`ON_DEMAND_BUNDLES`/`ProfileRuntimeResolution`/`resolvePluginResource`）与无关区域 |
| 目标条目 schema（整块写入的前提） | `dsh-session-title-first-prompt-llm` 本轮被**重写**（`Config` 里 `targetWords`/`targetCjkCharacters` 从共享字段改为本地 `z.number().step(1).min(1).required()`；`apply()` 从 `registerSessionTitleLlmProvider(...)` 换成 `ctx.sessionTitle.register({...})`），但白名单要的 5 个字段**仍是全 required 的顶层字段**：前两个显式 required，`maxInputBytes`/`maxOutputTokens`/`timeoutMs` 来自 `SessionTitleLlmConfigFields`（同样 `.required()`，`timeoutMs` 多一条 `.max(MAX_TIMER_DELAY_MS)`）。`dsh-session-title` 的 `Config`（`fallbackMaxWords`/`fallbackMaxBytes`/`maxTitleBytes`，`:202-205`）**逐字相同** |
| 标题预检口径 | `frameMessages()` 现在在 `dsh-session-title-first-prompt-llm/lib/index.js:54-56`（0.2.0 时在 `dsh-session-title-llm`），文本与插件 `TITLE_INPUT_PREFIX` **逐字一致**（`Generate the session title from this JSON array of human messages:\n` + `JSON.stringify(messages)`）；超限文案 `session-title-llm: input is N bytes, exceeding maxInputBytes M` 在 `dsh-session-title-llm/lib/index.js:170` **逐字相同**（同一句，行号 `:195` → `:170`），检查仍是 `Buffer.byteLength(prepared.input,'utf8') > config.maxInputBytes`；`titleInput` 投影仍是 `key: "titleInput"` / `stateVersion: 3` / `first: { seq, text }`（`dsh-session-title/lib/index.js:236-250`，字段顺序未变） |
| 会话与标题服务 | `dsh-session-title` 的 `get(session)`（`:281`）与 `refresh(session, signal)`（`:319`）位置与函数体未变（该文件 3 个 hunk 全在 `:350` 之后：`register()` 允许 closing 期重注册、一处边界条件放宽、`generate()` 新增 `currentTitle` 入参）；`dsh-session` 的 `get(id)` 与 `list()` **逐字未变**（两处 hunk 分别是注释改写与导出表新增 `appendPluginRecord`/`pluginRecordOf`） |
| 状态路由与能力探测 | `dsh-host-webserver/lib/index.js:298-305` 的 `register(route)` **逐字相同**（`{kind:'exact'|'prefix'}`、重复 (kind,path) 抛错、返回 disposer）；`dsh-client-connection` 的 `requestRejection` **零改动行命中** |
| 客户端 slot | `dsh-client-ui-settings/lib/client.js` **逐字相同**；`settings.section` 的声明与插件注册 `id:'default-tuner'` / `order:110` 零改动行命中；内置分区 order 上限仍是 **20**（`agent-presets`，全仓重读 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），110 无并列 |
| 官方控件与图标 | `dsh-client-ui-primitives` 的导出表只新增 `CommandText`/`InlineEditor` 两个名字；本插件要的 `Button`/`Input`/`Tag`/`IconTriangleRightFill{Medium,Regular}` 全在表内 |
| `dsh-settings` / `dsh-session-projection` | `dsh-settings` 的 `lib/` 逐字相同；`dsh-session-projection` 只有 `register()` 的返回值写法变了（`const dispose = ctx.effect(...); return () => void dispose()` → 直接 `return ctx.effect(...)`，语义等价），`stateOf` 未动 |

**官方默认值变了（本轮唯一的实质修复）**：`dsh-base/cordis.patch.yml` 把 `session-title-llm` 的 `maxOutputTokens` 从 **64 改成 4096**（新增一段注释说明它是"防跑飞的天花板，不是长度目标；推理模型关不掉的思考也算输出"），其余 7 个字段的默认值未变（`targetWords: 5` / `targetCjkCharacters: 10` / `maxInputBytes: 4096` / `timeoutMs: 60000` / `fallbackMaxWords: 5` / `fallbackMaxBytes: 40` / `maxTitleBytes: 80`）。本插件的提示文案硬编码了"默认 64"（`lib/overrides.js`）与 README 的默认值表格——两处都同步成 4096。**教训：默认值是"官方随时会调"的数据，跨线时必须重读 `dsh-base/cordis.patch.yml`，别信自己上一轮的记录。**

改动：`lib/index.js` 的四个常量（`DSH_RELEASE_LINE='0.2.1'` + `DSH_RELEASE_FLOOR={channel:'alpha',sequence:2}` + 清单 `['0.2.1-alpha.2']`）、`install.sh` 的五个常量与一处注释、`package.json`/`engines.dsh`/`README.md` 的兼容段、`test/version-gate.test.js` 的 13 档矩阵（下界换 channel 后必须覆盖两条新判据：`beta`/`rc` 放行、`alpha.1` 挡住）与四处同源断言，外加上面那条默认值文案同步。**插件业务逻辑一字未改**。

**发布（2026-10-10，用户授权；首次发布 = 占位版本 + OIDC 两步）**：`package.json` bump 到 `0.2.0`（首次发布；跨线按惯例走 minor），CHANGELOG 写了 `[0.2.0]` 条目并把原先的「未发布（2026-10-08 改名）」并入首发说明；`publish:check` 44 项 + tarball 8 文件全绿；commit `5d73d92`，tag `dsh-default-tuner-v0.2.0`。

**第一次跑 tag 失败**：workflow 在「发布到 npm」这一步报 `npm error 404 Not Found - PUT https://registry.npmjs.org/dsh-default-tuner` / `The requested resource 'dsh-default-tuner@0.2.0' could not be found or you do not have permission to access it.`（provenance 签名本身成功，是 registry PUT 被拒）。**根因是"先有鸡还是先有蛋"**：trusted publisher 只能在**已存在**的包上配置（`npm help trust` 的 Prerequisites 明写 *Package must exist*；网站那个入口也挂在包页面的 Settings → Trusted Publisher 下），而包名不存在时 publish 又被拒。**没有任何残留**——失败点在 npm publish，后面的「回查 registry」与「创建 GitHub Release」都没执行（registry 仍是 404、也没有空 release）。

**破环办法（以后新包首发照抄这三步）**：① 手动发一个**占位版本**（`npm login` 后在临时目录发 `{name, version:"0.0.1"}`，不碰插件源码）——只为让包名在 registry 上存在；② 配 trusted publisher（网站包设置页，或 `npm trust github <包> --file release.yml --repository zhaoliang233/dsh-plugins --allow-publish`，要求 npm ≥ 11.15 + 账号 2FA）；③ `gh workflow run release.yml -f tag=dsh-default-tuner-v0.2.0` 走 OIDC 发正式版。**别用"手动发 0.2.0"代替第 ③ 步**：本地发布拿不到 provenance，而且版本一旦被占，workflow 的 `npm publish` 会冲突失败、GitHub Release 也建不出来。

**结果**：workflow run `38035755070` 九个步骤全绿（发布 → 回查 → 创建 Release），**三件发布后判据全过**：registry 可读 `0.2.0`（`latest` 指向它）、`dist.attestations.provenance.predicateType = https://slsa.dev/provenance/v1`、GitHub Release `dsh-default-tuner@0.2.0` 已创建。registry 上该版本的 `dshCompatibility.range` / `engines.dsh` 回读同为 `>=0.2.1-alpha.2 <0.2.2`。**遗留**：占位版本 `0.0.1` 仍在版本列表里（无害，`latest` 已是 0.2.0），可选清理 `npm unpublish dsh-default-tuner@0.0.1`。

**`0.2.0-rc.2`（2026-10-01 跨发布线：DSH 从 `0.1.7-rc.2` 升到 `0.2.0-rc.2`）**：按根 `AGENTS.md` 的「插件兼容性检查」走完，跨线是立项而不是例行检查。逐包比对（`@deepseek-ai/dsh@0.1.7-rc.2` 装到临时目录 vs 本机运行安装）后，本插件点名的契约面**逐条在 0.2.0-rc.2 的实际安装包里重读**（行号取自 0.2.0-rc.2）：

| 契约项 | 0.2.0-rc.2 现状（读的是实际安装包，不是 CHANGELOG） |
|---|---|
| profile 补丁事务（`configEditor.edit()`） | `dsh-config-editor/lib/index.js` 全 138 行：文件锁（`:72`，锁 profile 的 `package.json`）→ 条目身份复核（`:73` "no longer available"、`:76` "changed during reload"）→ `next = change(current, inherited)`（`:77-79`）→ `fiber.state !== 2` 拒绝（`:81` "Configuration plugin is no longer active"）→ 经 `internal/config` waterfall + `resolveConfig()` **先校验后落盘**（`:82-83`）→ js-yaml `Document` 原地替换 `config` 节点 / 不存在则追加（`:98`、`:105-110`）→ `!!js` 由 `__jsExpr` 标记重建为 `tag:yaml.org,2002:js` 标量（`:111-116`，注释因此在块外保留）→ 候选等于继承层时删 `config`、只剩 id/name 时连行删（`:99-104`）→ 更高层覆盖报错（`:122`）→ `writeFileAtomic(path, String(document), { mode: 384 })`（`:123`）→ reconcile 失败时回写原文并重放旧 patches（`:124-130`）。**与 0.1.7-rc.2 逐字相同** |
| `configuration()` 的语义 | 与 0.1.7-rc.2 的唯一差异是这一处 hunk（`dsh-config-editor/lib/index.js:39-53`）：不在 `overridden` 集合里的条目不再逐个调 `inherited()`，改成一次 `composeEntries()` 查表。A1–A3 轮已用 8 个场景的合成 profile 实测两版输出逐字相同（等价重构）；本插件只消费 `{entry, inherited, override}` 这层形状，**未受影响** |
| 事务的底层依赖 | `dsh-atomic-write`（`writeFileAtomic`/`withFileLock`）、`cordis-plugin-loader`、`@deepseek-ai/cordis`、`schemastery` 与 0.1.7-rc.2 **逐字相同**；`dsh-app-boot` 只有一处改动（`lib/index.js:552-556` 给 `OPTIONAL_BUNDLES` 追加 `dsh-experimental-schedule-bundle`），`composeEntries`/`loadProfileDirectory`/`readProfilePatches`/`reconcileProfilePatches` 未动 |
| 目标条目 schema（整块写入的前提） | `dsh-session-title-first-prompt-llm` 与 `dsh-session-title` **lib 逐字相同**（只有 `package.json` 的 version 变）：`targetWords`/`targetCjkCharacters`/`maxInputBytes`/`maxOutputTokens`/`timeoutMs` 全是 `.required()`（`dsh-session-title-llm/lib/index.js:73-81`），`fallbackMaxWords`/`fallbackMaxBytes`/`maxTitleBytes` 也是（`dsh-session-title/lib/index.js:203-205`）。白名单 8 个字段全在顶层，且 `planFieldWrite` 写的是「当前生效配置 + 一个新值」，required 项必然齐全 |
| 标题预检口径 | `frameMessages()`（`dsh-session-title-llm/lib/index.js:157`）与插件 `TITLE_INPUT_PREFIX`（`lib/overrides.js:269`）逐字一致；超限文案 `input is N bytes, exceeding maxInputBytes M`（同文件 `:193-194`）与插件正则一致；`titleInput` 投影由 `dsh-session-title/lib/index.js:237` 注册、`stateOf` 在 `dsh-session-projection/lib/index.js:127`；该包 lib 与 0.1.7-rc.2 逐字相同 |
| 会话与标题服务 | `dsh-session-title` 的 `get(session)`（`:281`）与 `refresh(session, signal)`（`:319`）逐字相同；`dsh-session` 的 `get(id)`（`:1855` 前）与 `list()`（`:1868`）未变，该包 4 处 hunk 全在 `repair.js` 的失败工具结果恢复（`openTurnClosers` 重写 + 新增 `ToolCallRecovery`）与导出表 |
| 状态路由与能力探测 | `dsh-host-webserver/lib/index.js:177-186` 的 `register()` 仍是 `{kind:'exact'|'prefix', path, handler}`、重复 (kind,path) 抛错、返回 disposer；`dsh-client-connection/lib/index.js:586-589` 的 `requestRejection()` 仍是 `403`（host/origin 栅栏）→ `401`（未认证）→ `undefined`（放行），正是两级守卫的语义 |
| 客户端 slot | `dsh-client-ui-settings/lib/client.js` **逐字节相同**；`settings.section` 仍由 `dsh-client-ui-settings-general/lib/client.js:1111-1141` 在 `sidebar.settings` 的 children 里声明为 **list slot**（注册必须带 `id`），插件注册 `id:'default-tuner'` / `order:110`（`client.js:576-579`）。内置分区 order 不变：account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（上限 20），110 无并列 |
| 官方控件与图标 | `dsh-client-ui-primitives/lib/index.js` 的导出表（`:12381`）里 `Button`/`Input`/`Tag`/`IconTriangleRightFillMedium`/`IconTriangleRightFillRegular` **全在**；`Button`（`:3216`）与 `Tag`（`:3327`）定义逐字相同，`Input`（`:3529`）只是包了一层 `forwardRef`（props 与「wrapper span + 原生 input」形态不变） |
| `dsh-settings` | lib 与 0.1.7-rc.2 **逐字相同**（只有 `package.json` 的 version 变）。本插件宿主**不消费 `settings` 服务**（`ctx.get` 的清单里没有它），它依赖的是 `configEditor` 的条目配置模型 + 目标包自己的 Config schema，两者分别由上面的条目与 `cordis-plugin-loader`（逐字相同）承担 |
| 图标集 | `node tools/dsh-icons/check.js` 无漂移（188 个，Medium/Regular 各 94） |

改动：`lib/index.js` 的门改成**从常量派生**（`DSH_RELEASE_LINE='0.2.0'` + `DSH_RELEASE_FLOOR={channel:'rc',sequence:2}` + `PRERELEASE_CHANNELS`，清单 `VERIFIED_DSH_VERSIONS=['0.2.0-rc.2']`，全部普通字面量），`install.sh` 补上五个常量与 `prerelease_rank()`，`package.json`/`engines.dsh`/`README.md` 四处同源更新，`test/` 同步为 13 档矩阵 + 四处同源（含文档腿加强）。**插件业务代码一字未改**。

**更早一轮（`0.1.7-rc.2`，2026-10-01）的版本门补缺与实机证据**：已归档到 [`docs/compat-log.md`](../docs/compat-log.md)。本插件的**当前**契约以上面这节与「兼容发布线与版本门」一节为准。

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

## HTTP 契约

两个同源端点，路径常量在 `lib/overrides.js`：

- `GET /dsh-default-tuner/status` → `{ ok, available, csrfToken, documentPath, groups, entries, advanced, totalEntries, managedEntries, sessions, sessionsAvailable, sessionsReason, sessionsTotal, sessionsNeedRetitle }`
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

只改 `lib/overrides.js` 的 `GROUPS` / `ENTRIES`：加条目 id、字段名、label、单位、下限、提示语。两端校验与页面渲染都由这份白名单驱动，客户端不用动。

约束：字段必须是**顶层字段**，且目标条目的 Config schema 要求这些字段（否则整块写入会因缺 required 项而让目标插件加载失败）。加字段前先用 `dsh --profile web --dump-config` 确认该条目的默认值与字段名。

## 已验证 / 未验证

已验证（隔离 `DSH_HOME` + 独立端口 + 本会话专属无头 Chrome，2026-09-28）：

- `npm run check` + `npm test`（当前 44 个用例：白名单、候选配置计算、可用性、标题来源标签、会话行整理与排序、冻结标记、重算候选过滤与统计、JSON 回执形状、13 档版本矩阵与发布线派生、入口定位失败 inert、四处同源（含文档腿逐行解析））。
- 发布闸门 `npm run publish:check`（= `check` + `test` + `pack:check`）：`scripts/check-pack.js` 断言发布物恰好 8 个文件（`CHANGELOG.md` / `LICENSE` / `README.md` / `client.js` / `cordis.patch.yml` / `lib/index.js` / `lib/overrides.js` / `package.json`），`prepublishOnly` 与 `install.sh` 都跑它。**它不随发布物出去**（`files` 白名单里没有 `scripts/`）。
- 宿主端到端（curl 走真实路由，带 cookie 认证 + CSRF）：status 读取、apply 写 8192、reset 还原——reset 后补丁文件与原始配置**逐字节一致**（该次补丁里另有其它条目，顶部注释挂在第一个条目上、不受影响；**补丁里只有这一个条目时，reset 会把顶部注释一起删掉**，见「机制契约」的「注释与 `!!js`」行，2026-10-10 实测补记）。
- 错误路径：非法值（400 `invalid-value`）、白名单外字段（400）、缺 CSRF（403）、无覆盖时恢复默认、重算未知会话（404 `session-not-live`）。
- 浏览器端到端（CDP 驱动无头 Chrome，缓存已禁用）：设置面板打开 →「默认设置覆盖」分区渲染出 8 个输入框 → 点「应用」写入 32768（提示「已写入 session-title-llm.maxInputBytes = 32768。」、实际生效同步、「已覆盖」1 个 +「随整块写入」4 个）→ 高级模式展开列出 10 个带覆盖条目 → 会话标题重算卡片列出活跃会话、点「重新生成」得到「已请求重算标题（原：无）。」→ 点「恢复默认」回到 4096、标记清零。
- 过滤口径（重启实例后复验）：实例里那个无标题的活跃会话**不再出现**在列表里，卡片显示「当前 1 个活跃会话，其中 0 个需要重算」——这正是修掉的"每打开一个对话就多一行"的来源。
- 版本不同步窗口（用"旧宿主 + 新客户端"专门复现）：把插件副本的宿主过滤临时改回"返回全部会话、不带统计字段"，页面仍显示「当前 1 个活跃会话，其中 0 个需要重算」且列表 0 行——证明客户端兜底过滤与统计回退都生效。
- 真机（用户 `127.0.0.1:3080`，重启后）：`/dsh-default-tuner/status` 返回 401 而随机路径 404（路由已注册）；用户点「应用」后补丁新增 8 行整块 config（`maxInputBytes: 32768`），注释 16→16、`!!js` 2→2 未丢；点「重新生成」后本会话多出一条 `provider` 标题记录（官方 UI 无此入口，只可能来自本插件）。
- 客户端 bundle 已进入页面启动图（`dsh-default-tuner/client.js&rev=…` 出现在 `/` 的 HTML 里）。

版本门（2026-10-01 跨线轮，本机 DSH `0.2.0-rc.2`；隔离 `DSH_HOME=/tmp/ddt-020-home` + 端口 5945，验证后已停掉并删除目录，用户的 3080 全程未触碰）：

- **范围外零注册（真有宿主取证，跨线前）**：插件当时声明 `>=0.1.7-alpha.1 <0.1.8`，在 `0.2.0-rc.2` 宿主上——取证探针尝试抢占 `/dsh-default-tuner/status` 与 `/dsh-default-tuner/action` 两个 exact 路由**都抢到了**（`dsh-host-webserver` 对重复路径抛错，抢到即证明没注册）；插件条目 `fiber.state = 2`（模块已加载、`apply()` 已执行完并返回）、`configEditor`/`sessions`/`sessionTitle` 三个服务都在，直接请求两个路由都是 **404**（与随机路径同码，且未认证时门内路由本该是 401）。
- **范围外零注册（新门的第二形态）**：把一份插件副本的声明改成 `>=0.2.1 <0.2.2`（下界高于宿主）后用同一套探针取证——两个路由同样空闲、`fiber.state` 仍是 2，**profile 补丁文件的 md5 与启动前逐字节一致**（零副作用）。
- **门内可用（跨线后同一宿主重启）**：两个路由被插件占用（探针抢不到）、未认证请求返回 **401**（与范围外的 404 形成对照）；带 cookie 与 `x-dsh-default-tuner-client: 1` 的 status 返回 **200**，`session-title-llm` / `session-title` 两个条目 `writable:true`，8 个字段读出默认值 4096/64/60000/5/10 与 80/5/40；POST apply 写 `maxInputBytes=8192` → 补丁追加**整块 config**、原有注释未丢 → 用 `dsh --profile web --dump-config` 独立核对也读到 8192；reset 后补丁文件与写入前**逐字节一致**、生效值回到 4096。

**2026-10-10（跨到 `0.2.1-alpha.2` 的换线轮；隔离 `DSH_HOME=/tmp/dsh-021-verify/after-home` + 端口 3099 + 受管后台任务，用户的 3080 全程未触碰，验证后已停掉自建实例）**：

- **路由判别码（换线前 → 换线后的对照）**：换线前副本（`git archive HEAD`，声明 `>=0.2.0-rc.2 <0.2.1`）挂在同一套隔离 profile 上时，`/dsh-default-tuner/status` 与随机路径**同为 404**（版本门挡住、零注册）；换成当前源码后 `/status` 与 `/action` 都变 **401**（路由已注册、未认证），带 cookie 认证 + `x-dsh-default-tuner-client: 1` 的 status 是 **200**，无 CSRF 的 POST 是 **403**。「404 → 401/403 → 200」链路完整。
- **门内可用（同一隔离宿主）**：status 200 回执 `ok:true` / `available:true` / `totalEntries:187` / `managedEntries:2`，两个条目 `writable:true`、`reason:active`；**8 个字段的实际默认值** `maxInputBytes` 4096 / `maxOutputTokens` **4096** / `timeoutMs` 60000 / `targetWords` 5 / `targetCjkCharacters` 10 与 `maxTitleBytes` 80 / `fallbackMaxWords` 5 / `fallbackMaxBytes` 40——这条同时验证了本轮同步的默认值文案。
- **写路径端到端**：POST apply `maxInputBytes=8192` → 200、补丁追加整块 config（5 个字段，含 `maxOutputTokens: 4096`）、**块外注释保留**；reset → 200、生效值回到 4096、条目被整条删除。**注意**：这次隔离 profile 的补丁里只有这一个条目，所以 reset 后顶部注释一起消失、文件只剩 `[]`（见「机制契约」的「注释与 `!!js`」行，`configEditor` + `yaml` 的既有行为）。
- **boot graph**：`/` 的 `globalThis.__DSH_BOOT__` 里 `dsh-default-tuner` 出现 4 处（id/url/rev/inject），挂载生效。
- **13 档版本矩阵**（`test/version-gate.test.js`，与 8 个已跨线插件同形）：`0.2.0-rc.2` 与 `0.2.0-rc.2+build.1` 接受且 verified；`0.2.0`、`0.2.0-rc.3` 接受带警告；`0.2.1` / `0.1.7-rc.2` / `0.2.0-alpha.1` / `0.2.0-alpha.9` / `0.2.0-beta.4` / `0.2.0-rc.1` / `0.1.8-alpha.1` / `undefined` / 空串全部拒绝。
- **守卫注入缺陷验证**（在副本上做，七处各自必须变红，本轮实测）：①`classifyDshVersion` 恒真 → 3 个用例红；②lib 的 `VERIFIED_DSH_VERSIONS` 改掉 → 6 个红；③`install.sh` 的 `DSH_VERIFIED_VERSIONS` 改掉 → 2 个红；④`install.sh` 的 `DSH_RELEASE_FLOOR_SEQUENCE` 改掉 → 1 个红；⑤`install.sh` 的 range 上界改掉 → 2 个红；⑥`AGENTS.md` 兼容段改掉（range 或清单，任一处）→ 1 个红；⑦`README.md` 兼容段改掉 → 1 个红。**⑥⑦是本轮加严的**：原先只断言"版本号在全文任意处出现"，而清单版本号（`0.2.0-rc.2`）恰好是 range 下界的子串，改掉兼容段照样全绿（已实测复现），现在改成逐行解析「兼容线」/「逐版本验证」那一行并核对 range + 清单。
- **shell 侧与 lib 侧逐条一致**：用桩 `dsh`（`--version` 回放被测版本）+ 桩 `pnpm`/`npm` 真跑 `install.sh`，13 档矩阵的「接受且已核对 / 接受带警告 / 拒绝」与 `classifyDshVersion()` **逐行相同**（另加 `0.2.0-rc.0`、`0.3.0` 两档同样一致）。单测只按行解析 `install.sh` 的常量，这条才是那套 shell 判定的行为证据。
- **未覆盖**：客户端在 inert 下的可读文案仍只做了代码路径与单测层面的确认（隔离宿主里没开浏览器目视）；`lib/` 是 Host 代码，真机（用户 3080）要等用户重启 `dsh web` 后刷新页面才切到新线。

未验证 / 踩到的墙：

- **"兜底会话出现在列表里"这条正向路径没能在隔离环境里造出来**：无头浏览器里 composer 是自定义 contenteditable，`execCommand('insertText')` 与 CDP `Input.insertText` 都不被接受（发送按钮始终 disabled），改用探针直接 `session.append('user/message', …)` 则被 surface 契约拦下（`session event "user/message" is surface-eligible and requires a surfaceOp marker`）。该路径由单测覆盖（`selectRetitleCandidates` / `summarizeSessions`），真机确认请打开一条标题是半句话的旧会话。
- 隔离实例里模型成功命名那条路径同理（无凭证）。

### 「随整块写入」标记从哪来

补丁整块替换，所以应用一个字段会把该条目的全部字段一起写进补丁。`describeEntryFields` 用 `frozenSameAsDefault`（override 存在且等于继承值）把"用户改过的"与"只是被一起写进去的"分开，客户端据此显示「已覆盖 / 随整块写入」。恢复某个字段时，若整块恰好等于继承层，configEditor 会删掉整个 `config`——这就是"解除冻结"的路径。

## 待办

- ~~发版前必须先改名~~ → **2026-10-08 已改名**：旧名 `dsh-default-overrides` 在 npm registry 上被第三方占用（当时是 0.3.6、维护者 `chenwei116057`、描述 "Configurable Bash and PowerShell overrides for the DSH standard preset"，与本插件无关），新名 `dsh-default-tuner` 同日实测未被占用。改名同步了 `package.json#name`、`cordis.patch.yml` 的行 id/name、客户端 bundle 注册名、`lib/overrides.js` 的 `PLUGIN_NAME` / `SECTION_ID` / 两条 HTTP 路由 / 两个固定头名，以及内部短前缀（CSS 类名 `ddo-*` → `ddt-*`）；**功能一行未改**。~~发版前仍要配 trusted publisher~~ → **2026-10-10 已配好并完成首发**（见「逐版本核对记录」的发布段；首发的三步做法也在那里）。
- ~~registry 上残留的占位版本 `0.0.1`~~ → 可选清理：`npm unpublish dsh-default-tuner@0.0.1`（72 小时窗口内可撤；留着也无害，`latest` 已是 `0.2.0`）。
- 白名单扩展（压缩阈值、subagent 并发、Web 搜索等），按同一张表加。
- 高级模式目前只支持"清除整块覆盖"；若以后要支持任意字段编辑，需要先解决"非白名单字段写坏组合"的风险（二次确认 + 组合校验 + 一键回滚）。
