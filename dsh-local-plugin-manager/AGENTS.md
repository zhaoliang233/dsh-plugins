# dsh-local-plugin-manager 技术说明

## 定位与边界

面向**插件开发者**的本地开发插件管理：只管理 DSH `>=0.2.0-rc.2 <0.2.1` 兼容发布线的 `web` profile 中已安装的 `link:` bundle（`0.2.0-rc.2` 已逐版本验证）。不扫描未安装源码、不安装或更新插件、不管理 Agent preset、不删除源码或插件数据，也不修改 DSH 安装包。

**为什么是独立分区，而不是官方插件分区里的一个 tab**（0.1.8 之前别改回去）：

1. `settings.plugins.tab` 属于**官方插件管理**的组成。插件往里塞 tab，用户读到的就是"官方插件管理的第二部分"（0.1.5 起即如此，2026-09 用户实测反馈），与本包"服务开发者、不与官方冲突"的定位直接矛盾。
2. DSH `0.1.7` 起官方插件分区自带 `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 贡献的 inventory tab（会话插件 / 全局插件、运行状态、按预设分组）。本包与它重叠的只剩"启停"，而启停本来就是同一批覆盖项。
3. 于是本包退到只服务 `link:` 源码插件的开发循环，入口独立成设置菜单里的 `settings.section`（id `plugin-dev`、label 「插件开发」），并在面板正文里写明通用插件管理在官方那侧。

正式包名、Host row id 和 Client module id 均为 `dsh-local-plugin-manager`；Client 分区 id 为 `plugin-dev`。

## Host

- `lib/errors.js`：共享错误类型 `LocalPluginManagerError`（`code` + HTTP `status`），供两个模块复用而不产生循环 import。
- `lib/patch-writer.js`：**profile patch 事务**。行覆盖语义、profile 写锁、原子提交与陈旧覆盖项修剪。
- `lib/profile-manager.js`：profile 枚举、bundle patch 分析、state.json、官方 CLI 卸载与回滚。
- `lib/index.js`：Cordis 入口、运行版本门、loopback/同源/CSRF HTTP 路由、Loader 状态只读观察。
- `GET /dsh-local-plugin-manager/status`：返回当前 profile、本地插件 DTO 和每次 Host 运行随机生成的 CSRF token。
- `POST /dsh-local-plugin-manager/action`：body 只接受 `{ action: 'enable'|'disable'|'uninstall', name }`。

`ctx.webServer` 是硬依赖。Loader 经 `ctx.get('loader')` **只读**读取：启停由 profile patch 的覆盖项驱动，写完由 `@deepseek-ai/dsh-hmr` 的 profile 配置监听（它 watch `<profile>/cordis.patch.yml`、`<home>/cordis.patch.yml` 与 profile manifest，变化后走 `reconcileProfilePatches` 重组 loader 树）热重载，`observeLoaderEntryState()` 仅在有限时间内轮询 `entry.id === 'include:' + rowId` 的 fiber 是否到达预期状态，用来给出「已生效 / 需要重启」。**不要把它写成 `patchReload`**：profile `package.json` 里的 `patchReload: live` 在 `0.1.7-rc.2` 的 DSH 安装里全树搜不到消费者（本机 profile 里那条是遗留字段），热重载的真源是 hmr entry（`dsh-base/cordis.patch.yml` 里 `disabled: !!js "!ctx.get('profileContext')"`，web 下默认启用）。另外它的默认观察窗口只有 1500ms，短于 dsh-hmr 的写入稳定 + 重组耗时（rc.2 实测约 3 秒生效），所以「需要重启」是保守提示、未必真需要重启。**不要重新引入 `entry.update(...)` 之类的 Loader 私有写入**：那会与官方 plugin-manager 和 HMR 的重组并发改同一批行。

## 本地插件判定

一个条目必须同时满足：

- profile `dependencies[name]` 是 `link:` spec，且本地 `package.json#name` 与 dependency key 完全一致；
- 声明字符串 `dsh.bundle.patch`，patch 位于包目录内，package 位于 `dsh.profile.bundles`；
- bundle patch 每个顶层条目都只有 `id? + insert`，每个直接插入行都有稳定、安全的 id。

bundle 若覆盖现有行、缺少 id、默认禁用或解析失败，只展示为不可管理。不要为兼容其他包形状放宽这一 fail-closed 分类，除非当前运行 profile 有明确需求并补齐测试。

行说明只有一个来源：本地 `package.json#description`。`normalizeDescription()` 去掉控制字符、把空白折叠为单行、裁到 200 字符（超出补省略号），非字符串或空串一律归一为 `undefined`；Client 只渲染该字段，不读文件也不自行推导文案。

## profile patch 事务（与官方 plugin-manager 对齐）

**禁用状态的真源是 profile patch 的覆盖项本身**，没有第二份记账。`lib/patch-writer.js` 复刻了 `@deepseek-ai/dsh-plugin-manager` 的 `writePluginEnabled` 语义，改动它前先读官方实现：

1. 覆盖项是**顶层、不带 `insert`** 的 `- id: <loader 行 id>` 条目；定位用 `findLast`，只接受同时满足「id 相同」且「未声明 `name` 或 `name` 与该行模块名一致」的最后一条。
2. 命中就地 `setIn(['disabled'], !enabled)`；没有则 `document.add({ id, disabled })` 追加。**启用写显式 `disabled: false`，绝不删除条目**——删除会让官方那边继续生效。
3. 目标值与现值相同就返回 `{ changed: false }`，不重写文件（保持字节级不变）。
4. 编辑用官方同一个 `yaml` 包的 Document API（只有它能保注释、引号与 `!!js` 地就地改值）。不要用 `js-yaml`（它没有 Document API），也不要用「重渲染整个文件」的做法。
5. 整个「读—改—提交」包在 profile 写锁里：`withFileLock(join(profileDir, 'package.json'), ...)`，锚点与官方 `PluginManager.change()` 相同，因此与官方插件页和 `dsh plugin` CLI 串行化；`waitMs` 默认 120000，与官方 `lockWaitMs` 一致。读路径保持无锁。
6. 提交用官方 `writeFileAtomic`，mode 固定 `0o600`（与官方写入一致，避免两边来回改文件模式）。

**为什么必须对齐**：官方 `dsh-base` 在 `0.1.6-alpha.2` 起默认启用 `plugin-manager`，侧边栏「插件」页与设置里的插件分区都能启停同一批行。两套写入若各写一条同 id 覆盖项，最后一条永远生效，两边会互相回滚；启用时若删除自己那条而不是写 `false`，官方那条会继续压着。任何「按自己的账本重写区块」的实现都会退回这个 bug。

state 文件 `<profile>/.dsh-local-plugin-manager/state.json` 只保留卸载墓碑，schema version `2`：

```json
{ "version": 2, "pendingRemovals": [] }
```

只认这一个 schema：0.1.3/0.1.5 用过的 v1（`{ version: 1, disabled: [...], pendingRemovals: [] }`）与它在 profile patch 里写的受管区块标记都不再兼容，读到 v1 直接以 `invalid-state` fail closed（状态里没有墓碑，删掉 `state.json` 即恢复；禁用意图本身在 profile patch 的覆盖项里，不会丢）。这段迁移是刻意删掉的：旧文件表达的禁用意图已经在覆盖项里，继续替它猜语义只会多出第二种记账。

## 卸载

卸载前必须：拒绝管理器自身；重新读取当前 profile（不信任 Client 路径或旧快照）；检查 profile/home 用户 patch 的所有 `insert`，仍引用目标包则拒绝；先写 `disabled: true` 覆盖项并请求热停。

命令固定由 `process.execPath + 当前真实 dsh lib/bin.js` 异步执行，参数只能是：

```text
plugin --profile web remove <server-derived-name> --config.minimumReleaseAge=0
```

命令输出有界、操作单飞；超时先发 SIGTERM，5 秒未退出再发 SIGKILL。成功后必须重新读取 manifest，确认 dependency 与 bundle 都消失；pnpm 已删 dependency 但 bundle list 残留时，当前发布线允许原子移除该残留。失败且 profile 仍完整时恢复之前的 state、patch 和 live 状态。

成功卸载会留下带 `processMarker` 的 `pendingRemovals` tombstone：bundle 层在启动时已冻结，卸载后这些行仍在 loader 树里，覆盖项必须留到进程结束。marker 由 `process.pid + performance.timeOrigin` 构成；同一 Host 进程内即使管理器 HMR 重载也保留。新 Host 进程确认包已不在 manifest 后，用 `pruneRowOverrides()` 清掉遗留覆盖项——**必须清**，否则将来重装该插件会被这条陈旧覆盖项继续禁用；条目只有 `id`+`disabled` 时整条删除，还带别的字段时只摘 `disabled`（不丢用户配置，也不留 `- id: x` 空壳）。

## Client

- `client.js` 是手写 lazy-CJS bundle，无 JSX/TypeScript/import；`exports.inject = ['slots']`；`package.json#dsh.client.inject` 依赖 `@deepseek-ai/dsh-client-ui-settings-general`（声明 `settings.section` 的包；换分区落点时必须同步改这里）。
- 注册 `settings.section`：`id: 'plugin-dev'`、`order: 100`、`label: '插件开发'`。插件贡献的设置入口一律排到 DSH 自带项之后（`settings.section` / `settings.general.item` / `settings.plugins.tab` 的 order 都 ≥ 100）；DSH `0.2.0-rc.2` 的内置分区 order 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（`0.1.7` 三版与 `0.2.0-rc.2` 一致），本包的 100 仍排在全部内置分区之后。注意 **`settings.general.item` 的内置上限已经越过 100**（`settings-session-log` 90、`current-version` 100），`settings.section` 与它不是同一个 slot，所以这里不冲突；升级 DSH 后仍要重新读一遍内置项的 order 上限。
- **导航图标只能走 DOM 补丁**：`settings.section` 的注册选项只有 id/order/label，没有 icon；壳层 `navIcon(id)` 只给官方 id 配图标，未知 id 一律回落齿轮，本分区会与官方「插件」撞脸。实现是 `patchSettingsNavIcon()`（原 svg 只做占位，图标用 `::before` + mask 画，配色继续跟随壳层），挂载点注册在 **`settings.action`**——它随设置面板挂载，面板一开就存在；不要挂在分区组件里，分区要等用户点开那一行才渲染，图标会晚一步才对（`dsh-extra-context` 踩过）。图标取 `IconCodeOutlineMedium`（`iconOf` 候选链兜底）。壳层未来若支持在 slot 选项里声明图标，这段补丁应立刻删掉。
- 控件与标记一律用官方 primitives：行开关是 `Switch`（`checked`/`onChange`/`label`/`disabled`/`title`），确认弹窗与「重试 / 刷新页面」是 `Button`（取消 `outline`，卸载 `primary` + 只覆盖按钮色 token 的 `.dlpm-danger-button`），行徽标是 `Tag`（身份 `outline`、已启用 `success`、已禁用 `quiet`、部分启用 `warning`；只借 `.dlpm-tag` 做 `flex:none` 布局），图标用 `IconRefreshOutlineMedium`/`IconTrashOutlineMedium`/`IconLoadingOutlineMedium`/`IconWarningOutlineMedium`，永久卸载必须经过 Modal 确认；管理器自身行禁用开关和卸载按钮。**不要为这些控件自绘外观 CSS 或 `role=switch` 按钮**：几何、调色板、焦点环与危险色都随 primitives 走，自绘一套只会在官方换皮肤后留下不会跟着变的第二套外观（`test/client.test.js` 拦 `dlpm-switch`/`dlpm-button`/`dlpm-badge` 之类的残留）。Client 只显示 Host DTO，不自行推导路径、bundle 或 patch 所有权。
- 只使用当前 Inspect 公布的主题 token；样式和网络请求必须随组件/插件卸载清理。注入的 `<style>` 按引用计数共享并必须打 `data-plugin="dsh-local-plugin-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删；机制见根 `AGENTS.md`）。client HMR 重载只丢弃 fiber 而不跑旧 disposer，所以 `apply` 在元素仍在但文本过期时会重写样式文本。mutation 用同步 `actionRef` 单飞，开始时中止并递增 epoch 使旧 status GET 失效，防止旧快照覆盖 mutation 响应。
- 每行在名称与版本/路径之间渲染 DTO 的 `description`：最多两行（`-webkit-line-clamp:2`），`title` 给全文。层级固定为名称（14/500/primary）> 说明（13/`label-secondary`，配 `color-mix` 7% 自混底板，浅色深色主题都不写死颜色）> 版本与路径（12/`label-tertiary`，纯元信息）；缺失占位「未提供说明」不画底板并小一档，避免空说明行假装成重点。
- 行内还渲染 DTO 的 `rowIds`（loader 行 id），但**只在它带来信息时**才画：单一且等于包名的行 id 只是包名的回声（`loaderRowsLabel()` 负责这个判定）。这是本面板相对官方 inventory 的开发者向增量，不要把它当通用状态展示。

## 安全

status/action 都必须先调用 DSH `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界，再要求 loopback、same-origin/Sec-Fetch-Site 和自定义 Client header；action 另要求当前进程随机 CSRF token、`application/json` 和 16 KiB 上限。固定 Client header 不是认证凭据，status 返回 CSRF token 前必须完成 DSH browser auth。新增 mutation 时继续采用服务端白名单参数，禁止开放任意路径、specifier、命令或 CLI 参数。

## 版本规则

按已核对契约的兼容发布线维护，不为每个非破坏性 prerelease 建独立代码分支（范围与验证版本见「定位与边界」）。跨发布线前必须重新检查 Profile、CLI、Loader、webServer 和 Settings Slot，再同步更新 `DSH_COMPATIBILITY_RANGE`、验证清单、manifest、安装脚本、README 与测试。`install.sh` 的 `VERIFIED_DSH_VERSIONS` 必须与 `lib/profile-manager.js` 的清单逐字一致：0.1.6 换验证版本时漏改过这一处，真机安装因此每次打一条假告警，现由 `test/manifest.test.js` 守卫。

**版本门从常量派生**（2026-10-01 跨线时照抄已跨线的 `dsh-extra-context`）：`lib/profile-manager.js` 不再内联 `0.1.7` 与 `alpha` 字面量，改为读 `DSH_RELEASE_LINE`（`0.2.0`）+ `DSH_RELEASE_FLOOR`（`{ channel: 'rc', sequence: 2 }`）+ `PRERELEASE_CHANNELS`；`install.sh` 有一份等价的 shell 版（含 `prerelease_rank()`）。旧写法 `channel !== 'alpha' || seq >= 1` 只能表达「下界是 alpha」，下界换成 rc 后必须改成 channel 优先级比较，否则 `0.2.0-alpha.9` 会被误判成兼容。跨线时只改常量与清单，判定逻辑不动；`test/manifest.test.js` 新增一条守卫，把 range 反推回下界常量、并核对 `install.sh` 的五个常量。

**运行时依赖随发布线一起走**：`@deepseek-ai/dsh-atomic-write` 由 `~0.1.7-alpha.1` 改为 `~0.2.0-rc.2`。理由不是「有新 API」——两版逐字相同（见下），而是插件既然只在 0.2.0 线内运行，写锁就该用同一条线的实现，避免将来 0.2.0 线内的锁约定变化让插件与宿主静默分叉。锁是文件系统级的（`<锚点>.lock` + `wx`），跨版本副本之间本来就互斥。

`0.1.6-alpha.2 → 0.1.7-alpha.1/alpha.2` 的核对方式（后续跨线照做）：`npm pack` 契约包后用 `diff` 比对解包后的 `lib/*.js`，不要靠 CHANGELOG。本包用到的六个包在 `0.1.7-alpha.1` 与 `alpha.2` 之间逐字相同（`dsh-atomic-write`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-client-ui-settings-general` 的 host/client、`dsh-app-boot` 的 include 行 id）；`dsh-plugin-manager` 的差异只是一处 registry 常量重构，`@deepseek-ai/cordis-plugin-loader@1.0.4→1.0.5` 与 `cordis-plugin-include@1.0.8→1.0.9` 逐字相同（`include:<rowId>` 的 entry id 方案因此仍成立）。

### `0.1.7-alpha.2 → 0.1.7-rc.2` 逐项核对记录（2026-09-28）

命中的包：`dsh-plugin-manager`（17 个 lib 文件，`lib/index.js` +757/−154，新增 github-connection 与 run-tree）、`dsh-app-boot`（8 个，+424/−48）、`dsh-atomic-write`（2 个，+73/−8）、`dsh-client-ui-settings-general`（4 个）。逐字相同：`dsh-host-webserver`、`dsh-client-connection`、`dsh-base`、`dsh-client-ui-settings-plugin-inventory`、`@deepseek-ai/cordis-plugin-loader`（仍 1.0.5）、`cordis-plugin-include`（仍 1.0.9）、`dsh-hmr`（只有 README.i18n.yaml 与版本号不同）。

五项结论，都在 rc.2 上真机复验过，**无需改代码**：

1. **profile 写锁仍对齐**：`dsh-atomic-write` 的改动只是新增「持锁进程已退出（PID 探测 ESRCH）时接管死锁」；锁路径约定仍是 `<锚点>.lock` + `wx` 独占创建、锚点仍是 `<profile>/package.json`、`mode` 仍是 `0o600`（`384`）、`waitMs` 语义与默认值都没变，`writeFileAtomic` 逐字未变。本包用的是自己的 `~0.1.7-alpha.1` 副本（锁文件内容同为 `<pid>\n`），与宿主的 rc.2 副本跨版本仍然互斥。
2. **覆盖项语义四条全部仍成立**：rc.2 的 `writePluginEnabled` 仍是「顶层、不带 `insert`」「`findLast` + `name` 匹配」「命中就地 `setIn(['disabled'], !enabled)`、启用写显式 `false` 不删条目」「目标值与现值相同直接 `return false` 不写文件」，`writeFileAtomic(..., { mode: 384 })` 也没变。唯一新增是写前多一次 `loadOptionalPatches('dsh', filename)`（读同一 profile patch 做解析准备），不改变写入结果。GUI 往返实测：两边轮流启停同一条，`cordis.patch.yml` 里该行始终只有一条覆盖项。
3. **`include:<rowId>` 的 entry id 方案仍在**：`dsh-app-boot` 的 `mountRootInclude()` 依然建 `{ id: 'include', name: 'cordis:include' }`，`cordis-plugin-loader` 仍以 `parentEntryId + EntryTree.sep`（`':'`）拼子行 id，所以顶层 `insert` 进来的行仍是 `include:<rowId>`。
4. **热重载路径仍在，但真源不是 `patchReload`**：`dsh-hmr` 逐字未变，它 watch profile patch 与 manifest 后走 `reconcileProfilePatches` 重组 loader 树；rc.2 全树搜不到 `patchReload` 的消费者。真机实测：写入后约 3 秒运行态生效（boot graph 里该包的 client bundle 消失 / 回来）。
5. **`settings.section` 的 order 上限未变**：rc.2 内置仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20，本包的 100 仍排在最后。

同时确认 rc.2 新增的 **plugin-manager 兼容预检**（读 bundle 的 `peerDependencies`，不满足就在 profile 装配时抛错）不门禁本包：本包（以及本工作区其他插件）都没声明 `peerDependencies`。

### `0.1.7-rc.2 → 0.2.0-rc.2` 逐项核对记录（2026-10-01，跨线）

逐包 diff 见 `docs/compat-log.md` 的「A1–A3」：`dsh-plugin-manager`、`dsh-atomic-write`、`dsh-hmr` 与 0.1.7-rc.2 **逐字相同**（只有 `version` 字段变）；`dsh-app-boot` 只给 `OPTIONAL_BUNDLES` 追加了 `@deepseek-ai/dsh-experimental-schedule-bundle`，**插件兼容预检逻辑一行未改**。本轮把本包点名的每一处契约在 0.2.0-rc.2 的**实际安装包**里重读确认，**全部成立，业务代码一字未改**（本轮改动只有版本门、清单、依赖范围与 `gui-check.mjs` 的一条断言）：

1. **profile 写锁仍对齐**：`dsh-atomic-write` 的 `withFileLock` 仍是 `<filename>.lock` + `wx` 独占创建 + `mode: 384`（`lib/index.js:188-196`），`writeFileAtomic` 的提交路径与 `mode` 参数未变（`:61`/`:127`），`DEFAULT_LOCK_WAIT_MS` 仍是 `2e3`；本包继续传自己的 `waitMs`（默认 120000，对齐官方的 `lockWaitMs`，`plugin-manager/lib/index.js:1356` 仍是 `z.number().default(12e4)`）。
2. **覆盖项语义四条仍成立**：`writePluginEnabled`（`plugin-manager/lib/index.js:881-910`）仍是「顶层、不带 `insert`」（`item.has("insert")` 直接 false）「`findLast` + `name` 匹配（未声明 `name` 也接受）」「命中就地 `setIn([index, "disabled"], !enabled)`、没有则 `add({ id, disabled })`、**启用写显式 `false` 不删条目**」「目标值与现值相同直接 `return false`」，提交仍是 `writeFileAtomic(filename, String(document), { mode: 384 })`。
3. **`include:<rowId>` 的 entry id 方案仍在**：`dsh-app-boot` 的 `mountRootInclude()` 仍建 `{ id: 'include', name: 'cordis:include' }`（`:3701-3703`），`@deepseek-ai/cordis-plugin-loader` 的 `EntryTree.sep` 仍是 `':'`（`lib/index.js:127`），子行 id 仍是 `parent.id + EntryTree.sep + id`（`:330`）。
4. **热重载路径仍在**：`dsh-hmr` 逐字未变，仍 watch profile 目录并在变化后走 `reconcileProfilePatches`（`lib/index.js:8`/`:370`/`:387`）。隔离宿主实测：管理器禁用后 boot graph 里该包的 client bundle 消失，再启用后回来。
5. **`settings.section` / `settings.action` 的声明未变**：`dsh-client-ui-settings-general` 的 `settings.section` 仍是 `{ kind: 'list', scope: 'root' }` 的声明（`:1128-1131` 是 `settings.action` 的），注册选项仍只有 id/order/label/locale/children/inject（**没有 icon**，DOM 补丁仍必要）；壳层 `navIcon(id)` 的白名单仍是 account/models/agent-presets/plugins/archived-sessions（`client.js:244-267`），未知 id 回落齿轮。
6. **`connection.requestRejection` 与 `webServer.register` 未变**：前者仍在 `dsh-client-connection/lib/index.js:586`，后者仍在 `dsh-host-webserver/lib/index.js:177`。
7. **兼容预检不门禁本包**：`dsh-app-boot` 的 peerDependencies 预检仍在（`:289`），本包没有声明 `peerDependencies`，因此不受它门禁。

## 验证

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run publish:check   # check + test + pack:check（唯一发布闸门）
./install.sh
```

真实 GUI 至少覆盖：设置菜单里的分区顺序（排在全部 DSH 自带项之后）、专属导航图标真的画出来（不只看 dataset，要看 `::before` 的 mask）、当前 profile 的全部 link 插件、每行的说明行与缺失占位、长说明的两行截断、源码路径截断、loader 行只在带来信息时出现、self 保护、开关/徽标/弹窗按钮的官方 primitives 外观（开关为官方胶囊、禁用态半透明、焦点环可见；徽标为官方胶囊 Tag，当前管理器描边 / 已启用 success / 已禁用 quiet / 部分启用 warning 四档可区分；弹窗按钮为官方胶囊并排，卸载为官方危险色）、禁用/启用后 Host fiber 与页面刷新、卸载确认、卸载后 profile manifest/lock、Figma patch 原样保留、重启后 tombstone 清理，以及非 loopback/跨源 action 拒绝。

`scripts/gui-check.mjs`（`npm run gui:check`）把上面「能被 CDP 断言的那部分」自动化了：在**隔离**宿主 + 无头 Chrome 上真点一遍设置菜单 → 分区 → 开关，并交叉核对 profile patch。前置与用法见脚本头部；它只操作自己点的那条插件并切回原状态，不碰 3080 上的宿主。两处细节：全新的隔离 `DSH_HOME` 会先弹引导对话框（「内测声明」写入 profile patch 后不再出现，「添加一个 API Key」在无凭据时每次加载都出现），它们带 `aria-modal` 会吃掉对设置入口的点击，脚本因此先关掉这两类引导再点设置；patch 断言写的是「该行覆盖项条目数不增长 + 最后一条覆盖项的 `disabled` 值正确」，而不是「条目数 +1」——该行原本就可能有覆盖项，官方语义是就地改写。

**与官方插件管理并存**也要覆盖（这是本包唯一容易踩的坑）：在管理器的分区里禁用，再去官方插件页看该行是否为禁用、能否就地启用；反向再走一遍，并确认 `cordis.patch.yml` 里该行始终只有一条覆盖项。自动化侧的做法见下：把真实 profile 复制到临时目录，用该插件的 `setEnabled()` 与从官方包里提取的 `writePluginEnabled` 往返改写（`test/profile-manager.test.js` 里的若干用例已覆盖覆盖项定位与迁移），再加上 `gui-check.mjs` 的「覆盖项条目数不增长」断言。

隔离宿主上的**真 GUI 往返**也做通过（2026-09-28，rc.2），方法是照抄但别搞错两个坑：① 官方插件页的行级开关**不在列表里**——列表上那个 `aria-label="启用 <包名>"` 是 **bundle 选择**开关（`setBundleEnabled`，改 `dsh.profile.bundles`），行级开关要先点 `aria-label="查看 <包名>"` 进详情，再用 `aria-label="启用组件 <包名>"`（`setPluginEnabled`）；② 官方页显示的是**运行态**（`enabled: !entry.disabled`），而运行态要等 dsh-hmr 重载完（约 3 秒）才变，所以每一步都得先等运行态稳定（用浏览器 `__DSH_BOOT__` 里该包的 client bundle 在不在作判据）再用干净页面读 GUI，否则会看到上一拍的旧值。这套往返目前仍是人工/临时脚本执行，没有固化进 `gui-check.mjs`。

**`0.2.0-rc.2` 上的复跑（2026-10-01，隔离 `DSH_HOME=/tmp/dsh-020-home` + 独立端口 5911 + headless Chrome 153/CDP，全程未触碰用户的 3080；脚本在 `/tmp/dsh-alh-020/`，非发布物）**：

| 检查 | 结果 |
|---|---|
| `npm run verify` | **45 项全过**（跨线时新增一条「发布线/下界/验证清单四处同源」守卫） |
| `npm run gui:check`（`--url` 指向隔离宿主） | **20 项全过**：分区出现在菜单里、专属导航图标 `::before` 的 mask 真的画出来、9 条 link 插件行与源码路径/说明都对、管理器自身只读、开关翻转 + 徽标翻转 + `profile patch` 覆盖项条目数不增长（1 → 1）+ 禁用写 `disabled: true` + 启用写显式 `disabled: false` 不删条目 |
| 双向启停往返（管理器 ↔ 官方插件详情页，目标 `dsh-sticky-user-bubble`） | 管理器禁用 → 官方详情页读到 `aria-checked=false`；官方就地启用 → patch 里**同一条覆盖项**被改写为 `disabled: false`（条目数恒为 1）；管理器再读为已启用；反向再走一遍同样成立 |
| 运行态（boot graph 判据） | 禁用后 `__DSH_BOOT__.entries` 里没有该包，重新启用后回来——证明写覆盖项之后 dsh-hmr 的 profile 重组确实生效 |
| 与官方插件管理共存的又一个事实 | 官方插件**列表**上的 `aria-label="启用 <包名>"` 与进入详情后的 `aria-label="启用组件 <包名>"` 在同一页里同时存在，脚本必须按后者定位行级开关（只按前者会点到 bundle 选择） |

**`gui-check.mjs` 的一条断言本轮修正过**：「本分区排在 DSH 自带项之后」原本写成 `labels.indexOf(SECTION_LABEL) === labels.length - 1`（要求它是**最后一行**）。这在只装本插件的隔离环境里成立，但别的插件同样会贡献 ≥100 的 `settings.section`（`extra-context` 100、`default-overrides`/`mcp-manager` 110、`chat-archive-manager` 120），于是 2026-10-01 的实机跑出现了「菜单顺序完全正确却判失败」的假阴性。现在改为按内置 label 白名单（通用设置/模型/内置插件/Agent 预设）定位最后一个自带项、再断言本分区在它之后——度量的是契约本身而不是环境巧合。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-local-plugin-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线，它会先 `npm install` 再跑 `npm run publish:check`。
- **本包有运行时依赖，且它们是对齐官方的关键**：`@deepseek-ai/dsh-atomic-write`（`~0.2.0-rc.2`，profile 写锁 + 原子提交）与 `yaml`（`^2.9.0`，patch 编辑）。锁是**文件系统级**的（`<锚点>.lock` + `wx`），因此即使装的是另一个补丁版本也仍与宿主互斥；但锁路径约定若在发布线之间变化就会失配，跨 `0.2.1` 前必须重新核对。release 工作流必须在 `npm publish` 之前显式安装依赖，否则 `prepublishOnly` 的测试会以 `ERR_MODULE_NOT_FOUND` 失败（0.1.4 就是这样没发出去的，根仓库 release 工作流已补上依赖安装步骤，改动它时不要删掉）。
- 发布：`npm run publish:check`（`verify` 的 `check` + `test`，再加 `pack:check` 的 tarball 白名单）是发布闸门，`prepublishOnly` 已绑定它；`scripts/` 不进发布物（`files` 白名单里没有它），`scripts/check-pack.js` 因此是纯开发期校验。`.github/workflows/ci.yml` 在 Node 20/22 上执行同一闸门，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-local-plugin-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（`private: true` 会被工作流拒绝，本包已改为可公开发布）。
