# dsh-local-plugin-manager 技术说明

## 定位与边界

面向**插件开发者**的本地开发插件管理：只管理 DSH `>=0.2.2-alpha.2 <0.2.3` 兼容发布线的 `web` profile 中已安装的 `link:` bundle（`0.2.2-alpha.2` 已逐版本验证）。不扫描未安装源码、不安装或更新插件、不管理 Agent preset、不删除源码或插件数据，也不修改 DSH 安装包。

**为什么是独立分区，而不是官方插件分区里的一个 tab**（0.1.8 之前别改回去）：

1. `settings.plugins.tab` 属于**官方插件管理**的组成。插件往里塞 tab，用户读到的就是"官方插件管理的第二部分"（0.1.5 起即如此，2026-09 用户实测反馈），与本包"服务开发者、不与官方冲突"的定位直接矛盾。
2. DSH `0.1.7` 起官方插件分区自带 `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 贡献的 inventory tab（会话插件 / 全局插件、运行状态、按预设分组）。本包与它重叠的只剩"启停"，而启停本来就是同一批覆盖项。
3. 于是本包退到只服务 `link:` 源码插件的开发循环，入口独立成设置菜单里的 `settings.section`（id `plugin-dev`、label 「插件开发」），并在面板正文里写明通用插件管理在官方那侧。

正式包名、Host row id 和 Client module id 均为 `dsh-local-plugin-manager`；Client 分区 id 为 `plugin-dev`。

## 已核对的契约（不是猜测）

> 行号取自**当前运行安装包**（`<(command -v dsh) 的安装目录>/node_modules/@deepseek-ai/…`，版本用 `dsh --version` 取）；跨线后行号会位移，追查时先按符号名搜。逐版本复核记录见「版本规则」末尾。

| 事实 | 来源 |
|---|---|
| 禁用状态的真源是 profile patch 的**顶层、不带 `insert`** 覆盖项：`findLast` + `name` 匹配 → 命中就地 `setIn(['disabled'], !enabled)`、没有则 `add({id, disabled})`；**启用写显式 `false`、不删条目**；目标值与现值相同直接 `return false` 不写文件；提交 `writeFileAtomic(..., { mode: 384 })` | `dsh-plugin-manager/lib/index.js:950`（`writePluginEnabled`；0.2.0-rc.2 → 0.2.1-alpha.2 **逐字相同**），本包 `lib/patch-writer.js` 复刻同一语义 |
| 写锁是文件系统级：`<锚点>.lock` + `wx` 独占创建，锚点 `profile/package.json`，官方 `lockWaitMs` 默认 `12e4` | `dsh-atomic-write/lib/index.js`（两版 lib **逐字相同**）；`dsh-plugin-manager/lib/index.js` 的 config 默认值 |
| loader 行 id = `include:<rowId>`：根 include 行 `{ id: 'include', name: 'cordis:include' }`，子行 id = 父 id + `EntryTree.sep` | `dsh-app-boot/lib/index.js:3861`；`@deepseek-ai/cordis-plugin-loader/lib/index.js:127`（`static sep = ":"`）、`:332` |
| 热重载的真源是 dsh-hmr 的 profile 配置监听（watch `profile/cordis.patch.yml`、`home/cordis.patch.yml`、profile manifest → `reconcileProfilePatches`），**不是** profile 的 `patchReload` 字段 | `dsh-hmr/lib/index.js:700`（`refresh(manifestOnly)`）、`:713`、`:719`；`dsh-base/cordis.patch.yml` 的 hmr 行两版逐字相同 |
| manifest 监听是**有条件的**：bundle 列表没变就直接返回（`if (manifestOnly && bundles === lastBundles) return`），只有 patch 内容变化也走同一条 refresh | 同上 `:701` |
| **0.2.1 起移除 `link:` 插件可以真的进程内生效**：`plugin-packages` 发布的 successor 允许 profile 映射与 `localPackageNames` 消失（0.2.0-rc.2 会抛 `removing local package … requires a process restart`） | `dsh-app-boot/lib/index.js:1441`（`ResolutionRouter.replace`）：`:1446` 的 `next === void 0 && current.scope === "profile"` 跳过、`:1447` 的 `declarer` 比较收窄到 installation scope；对比 0.2.0-rc.2 的 `:1368` 整行守卫（已删除） |
| **0.2.1 新增 package.json 缓存失效**：非 `node_modules` 的 `package.json` 变化时清 Node 内部 `package_json_reader` / ESM resolve cache / CJS `_pathCache`，之后这些目录的清单从磁盘读 | `dsh-hmr/lib/index.js:213`（`var PackageManifests = class`）、`:228`（`invalidate`）、`:748`（watcher 分派判 `isManifest` 后调用） |
| **0.2.1 新增 `dependencySpec()`**：官方把 profile 记录的 `file:`/`link:` 值归一成**绝对路径**（`~` → home，相对 → 相对 profile 解析），DTO 的 `source` 由此而来 | `dsh-plugin-manager/lib/types/install-spec.js:104`（`dependencySpec`）、`lib/index.js:135`（同函数内联副本）、`:1603`（`sourceOf` 消费） |
| 官方 `removeBundle()` 新语义：**选中的名字若已无 dependency 持有，只取消选择**（不再失败），移除后调 `refreshPackages()` | `dsh-plugin-manager/lib/index.js:2007`（`return bundle.installed` 决定是否继续）、`:2196`（`refreshPackages`） |
| `settings.section` 是 list slot（需 `id`），注册选项没有 `icon`；壳层 `navIcon(id)` 只白名单 5 个官方 id，其余回落齿轮 | `dsh-client-ui-settings-general/lib/client.js:244`（该文件两版唯一差异是版本号字面量） |
| 内置 `settings.section` 的 order 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（上限 20），本包 110 仍在其后 | 五个官方 client 包的注册行（`dsh-client-ui-settings-account`/`-general`/`-models`/`-settings-plugins`/`-agent-preset`） |
| `webServer.register({kind, path, handler})`：重复 (kind, path) 抛错、返回 disposer | `dsh-host-webserver/lib/index.js:298`（**逐字相同**） |
| `connection.requestRejection(req)`：trusted host/origin 栅栏 → 403，未认证 → 401，放行 → `undefined` | `dsh-client-connection/lib/index.js:639`（0.2.1 多传绑定地址/协议与 TLS 判定，三段判据不变） |
| 自带 `<style>` 必须打 `data-plugin`：0.2.1 起 client-modules 只认领**本 factory 新产生**的未打标签 style（此前会把别人留下的也认领走） | `dsh-client-modules/lib/client.js:495`（`claimStyles(id, before)`）、`:682`（materialize 前记 `before`） |

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

成功卸载会留下带 `processMarker` 的 `pendingRemovals` tombstone：**同一进程里不清理这条覆盖项**——卸载刚完成时 loader 树仍可能持有那几行（hmr 的重组是异步的，`hmr` 缺失时更是只能等重启），覆盖项要留到本进程结束。marker 由 `process.pid + performance.timeOrigin` 构成；同一 Host 进程内即使管理器 HMR 重载也保留。新 Host 进程确认包已不在 manifest 后，用 `pruneRowOverrides()` 清掉遗留覆盖项——**必须清**，否则将来重装该插件会被这条陈旧覆盖项继续禁用；条目只有 `id`+`disabled` 时整条删除，还带别的字段时只摘 `disabled`（不丢用户配置，也不留 `- id: x` 空壳）。

**0.2.1 线上「卸载是否热生效」已实测**（2026-10-10，隔离宿主，见「验证」）：外部 `dsh plugin remove` 之后，profile manifest 变化会经 dsh-hmr 的 manifest 监听触发 `reconcileProfilePatches`，该插件的行**确实离开了 loader 树**、boot graph 里它的 client bundle 也消失——这一条在 0.2.0-rc.2 上做不到（resolution 里仍有它，且旧版 `ResolutionRouter.replace` 对「移除本地包」直接抛 restart）。但**墓碑与覆盖项策略本轮刻意不动**：同一进程内立刻重装时，管理器仍会让该插件回到「已禁用」状态（用户点一下开关即恢复，或重启后由 prune 清掉），这是 fail-closed 的保守选择，不是遗忘。真要改，必须先补齐「hmr 不在场 / 重组失败」两条路径的用例。

## Client

- `client.js` 是手写 lazy-CJS bundle，无 JSX/TypeScript/import；`exports.inject = ['slots']`；`package.json#dsh.client.inject` 依赖 `@deepseek-ai/dsh-client-ui-settings-general`（声明 `settings.section` 的包；换分区落点时必须同步改这里）。
- 注册 `settings.section`：`id: 'plugin-dev'`、`order: 110`、`label: '插件开发'`。插件贡献的设置入口一律排到 DSH 自带项之后（`settings.section` / `settings.general.item` / `settings.plugins.tab` 的 order 都 ≥ 100）；DSH `0.2.2-alpha.2` 的内置分区 order 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（`0.1.7` 三版、`0.2.0-rc.2`、`0.2.1-alpha.2` 三次核对一致），本包的 110 仍排在全部内置分区之后。**同 slot 内各插件不复用同一档**：extra-context 100 / 本包 110 / default-tuner 120 / mcp-console 130 / chat-archive-manager 140（权威表在根 `AGENTS.md`，新增插件往下顺延）。注意 **`settings.general.item` 的内置上限已经越过 100**（`settings-session-log` 90、`current-version` 100），`settings.section` 与它不是同一个 slot，所以这里不冲突；升级 DSH 后仍要重新读一遍内置项的 order 上限。
- **导航图标目前走 DOM 补丁**：`settings.section` 的注册选项只有 id/order/label；0.2.2-alpha.3 起壳层另提供 `settings.section.icon`（list/root/inline），并把 fallback 图标包进 `span.navIcon[aria-hidden=true]`——本包为兼容 alpha.2 暂不迁 slot，补丁 CSS 必须同时隐藏直接 `svg`、新包装层和内部 svg（只认直接 `svg` 会漏掉，表现为「自定义图标 + 齿轮」）。实现是 `patchSettingsNavIcon()`（原 svg 只做占位，图标用 `::before` + mask 画，配色继续跟随壳层；**0.2.2 起 mask 源码必须优先从 `ICON_SYMBOLS` 还原自包含 SVG**，组件 `outerHTML` 只有 `<use>`，直接作 mask 会空白），挂载点注册在 **`settings.action`**——它随设置面板挂载，面板一开就存在；不要挂在分区组件里，分区要等用户点开那一行才渲染，图标会晚一步才对（`dsh-extra-context` 踩过）。图标取 `IconCodeOutlineMedium`（`iconOf` 候选链兜底）。壳层未来若支持在 slot 选项里声明图标，这段补丁应立刻删掉。
- 控件与标记一律用官方 primitives：行开关是 `Switch`（`checked`/`onChange`/`label`/`disabled`/`title`），确认弹窗与「重试 / 刷新页面」是 `Button`（取消 `outline`，卸载 `primary` + 只覆盖按钮色 token 的 `.dlpm-danger-button`），行徽标是 `Tag`（身份 `outline`、已启用 `success`、已禁用 `quiet`、部分启用 `warning`；只借 `.dlpm-tag` 做 `flex:none` 布局），图标用 `IconRefreshOutlineMedium`/`IconTrashOutlineMedium`/`IconLoadingOutlineMedium`/`IconWarningOutlineMedium`，永久卸载必须经过 Modal 确认；管理器自身行禁用开关和卸载按钮。**不要为这些控件自绘外观 CSS 或 `role=switch` 按钮**：几何、调色板、焦点环与危险色都随 primitives 走，自绘一套只会在官方换皮肤后留下不会跟着变的第二套外观（`test/client.test.js` 拦 `dlpm-switch`/`dlpm-button`/`dlpm-badge` 之类的残留）。Client 只显示 Host DTO，不自行推导路径、bundle 或 patch 所有权。
- 只使用当前 Inspect 公布的主题 token；样式和网络请求必须随组件/插件卸载清理。注入的 `<style>` 按引用计数共享并必须打 `data-plugin="dsh-local-plugin-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删；机制见根 `AGENTS.md`）。client HMR 重载只丢弃 fiber 而不跑旧 disposer，所以 `apply` 在元素仍在但文本过期时会重写样式文本。mutation 用同步 `actionRef` 单飞，开始时中止并递增 epoch 使旧 status GET 失效，防止旧快照覆盖 mutation 响应。
- 每行在名称与版本/路径之间渲染 DTO 的 `description`：最多两行（`-webkit-line-clamp:2`），`title` 给全文。层级固定为名称（14/500/primary）> 说明（13/`label-secondary`，配 `color-mix` 7% 自混底板，浅色深色主题都不写死颜色）> 版本与路径（12/`label-tertiary`，纯元信息）；缺失占位「未提供说明」不画底板并小一档，避免空说明行假装成重点。
- 行内还渲染 DTO 的 `rowIds`（loader 行 id），但**只在它带来信息时**才画：单一且等于包名的行 id 只是包名的回声（`loaderRowsLabel()` 负责这个判定）。这是本面板相对官方 inventory 的开发者向增量，不要把它当通用状态展示。

## 安全

status/action 都必须先调用 DSH `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界，再要求 loopback、same-origin/Sec-Fetch-Site 和自定义 Client header；action 另要求当前进程随机 CSRF token、`application/json` 和 16 KiB 上限。固定 Client header 不是认证凭据，status 返回 CSRF token 前必须完成 DSH browser auth。新增 mutation 时继续采用服务端白名单参数，禁止开放任意路径、specifier、命令或 CLI 参数。

## 版本规则

按已核对契约的兼容发布线维护，不为每个非破坏性 prerelease 建独立代码分支（范围与验证版本见「定位与边界」）。跨发布线前必须重新检查 Profile、CLI、Loader、webServer 与 Settings 这五处契约面。

**版本门从常量派生**：`lib/profile-manager.js` 不内联版本字面量，读 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`；`install.sh` 有等价的 shell 版（含 `prerelease_rank()`）。跨线只改常量与清单，判定逻辑不动。

**运行时依赖随发布线一起走**：`@deepseek-ai/dsh-atomic-write` 的 `~` 范围跟发布线同步推进（profile 写锁与原子提交靠它）。

**核对方式**：`npm pack` 契约包后用 `diff` 比对解包后的 `lib/*.js`，不要靠 CHANGELOG；比对前先抹掉版本号字面量。

**两条跨轮有效的处置**：

- **profile 记录的依赖值必须归一到绝对路径**：pnpm 会原样记录 `link:../src/foo` 或 `link:~/x`，读侧必须用 `dependencySpec()` 同款归一，否则相对路径的本地插件会被判成不可管理。
- **0.2.1 起移除 `link:` 插件可以真的进程内生效**：`ResolutionRouter.replace()` 放开了 profile 作用域那条「必须重启」的硬门，因此在 `link:` 插件停掉之后移除 profile 映射与 `localPackageNames` 不再要求重启进程。

**`0.2.2-alpha.2`（2026-10-28，跨发布线，最小兼容修复）**：`dsh-plugin-manager` 的 `writePluginEnabled()` 主体与 `dependencySpec()` 仍与 0.2.1 同构（启用写显式 `false`、命中行就地改、`writeFileAtomic(..., { mode: 384 })` 都未变）；`dsh-atomic-write` 的 `lib/` 与 0.2.1-rc.4 **逐字相同**；`dsh-hmr` 的 profile 配置监听与 manifest 缓存失效仍在；`dsh-app-boot` 新增的 `dsh.bundle.platforms` 校验对本包无影响（无该字段 = 全平台放行）。隔离 `DSH_HOME` + 0.2.2-alpha.2 宿主实测：`/dsh-local-plugin-manager/status` 200、`dshVersion:"0.2.2-alpha.2"`、`verifiedVersion:true`，6 个 `link:` 插件全部 `manageable:true`；设置页「插件开发」分区真实渲染；三个导航图标补丁在真实 GUI 里均生效。`npm install` 已把 `@deepseek-ai/dsh-atomic-write` 与 lockfile 同步到 `~0.2.2-alpha.2`。**业务代码未改**，只换版本门、依赖范围与清单（单测 48 项，新增 sprite mask 回归）。**随后用户反馈设置菜单图标空白**（2026-10-29）：0.2.2 的图标是 sprite 壳，组件 `outerHTML` 只有 `<use href="#…">`；已改为优先从 `primitives.ICON_SYMBOLS` 还原自包含 SVG（`navIconSymbolSource()`），旧线无该导出时退回 `outerHTML`。

逐版本逐项核对记录（`0.1.7-alpha.2` 起 6 轮，含三处新结构逐行核对与 45/24/20/47 项验收数据）见 [`docs/compat-log.md`](../docs/compat-log.md)。

## 验证

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run publish:check
./install.sh
```

`scripts/gui-check.mjs`（`npm run gui:check`）覆盖隔离宿主上的设置分区、导航图标、开关/徽标翻转与 patch 断言；`scripts/e2e-remove-reinstall.mjs`（`npm run e2e:check`）覆盖卸载/重装链路（manifest / 面板 / boot graph / patch / state.json 五处）。逐版本复跑数据与仪器问题见 `docs/compat-log.md` 的 J 轮次。

- 与官方插件管理并存：在管理器禁用后，官方插件页应读到禁用并可就地启用；反向亦然；同一行始终只有一条覆盖项。
- 官方插件页的行级开关要先点「查看 <包名>」进详情，再用「启用组件 <包名>」；列表上的「启用 <包名>」是 bundle 选择开关。
- 运行态要等 dsh-hmr 重载完成（约 3 秒）再读 GUI；GUI 脚本的 patch 断言必须用 YAML 解析，不能逐行正则（流式 YAML 排列差异）。
- 官方「安装」不等于「启用」：先写依赖，再选中 bundle；重装后仍是已禁用是 fail-closed 的预期，最后用本插件开关切回启用。
- 真实 GUI 至少覆盖：分区顺序、专属导航图标 `::before` mask、全部 link 插件行、说明缺失占位与两行截断、loader 行只在有信息时出现、self 保护、官方 primitives 外观、启停后的 fiber/刷新、卸载确认、Figma patch 保留、重启后 tombstone 清理。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-local-plugin-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线，它会先 `npm install` 再跑 `npm run publish:check`。
- **本包有运行时依赖，且它们是对齐官方的关键**：`@deepseek-ai/dsh-atomic-write`（`~0.2.2-alpha.2`，profile 写锁 + 原子提交）与 `yaml`（`^2.9.0`，patch 编辑）。锁是**文件系统级**的（`<锚点>.lock` + `wx`），因此即使装的是另一个补丁版本也仍与宿主互斥；但锁路径约定若在发布线之间变化就会失配——跨 `0.2.1` 与 `0.2.2` 时都已重新核对（该包 lib 逐字相同，锁与 `mode` 都没动），跨 `0.2.3` 前要再核一次。release 工作流必须在 `npm publish` 之前显式安装依赖，否则 `prepublishOnly` 的测试会以 `ERR_MODULE_NOT_FOUND` 失败（0.1.4 就是这样没发出去的，根仓库 release 工作流已补上依赖安装步骤，改动它时不要删掉）。**改依赖范围必须跟着 `npm install` 并把 `package-lock.json` 一起提交**：CI 与 release 在有 lockfile 时跑 `npm ci`，范围与 lock 失配会以 `EUSAGE` 停在“安装依赖”这一步（2026-10-10 的 0.4.0 首次 tag 就是这样失败的，两个 workflow 都没产出任何发布物）；本机 `publish:check` 用已装好的 `node_modules`，察觉不到这种失配。
- 发布：`npm run publish:check`（`verify` 的 `check` + `test`，再加 `pack:check` 的 tarball 白名单）是发布闸门，`prepublishOnly` 已绑定它；`scripts/` 不进发布物（`files` 白名单里没有它），`scripts/check-pack.js` 因此是纯开发期校验。`.github/workflows/ci.yml` 在 Node 20/22 上执行同一闸门，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-local-plugin-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（`private: true` 会被工作流拒绝，本包已改为可公开发布）。
