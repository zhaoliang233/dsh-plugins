# dsh-local-plugin-manager 技术说明

## 定位与边界

面向**插件开发者**的本地开发插件管理：只管理 DSH `>=0.2.1-alpha.2 <0.2.2` 兼容发布线的 `web` profile 中已安装的 `link:` bundle（`0.2.1-alpha.2` 已逐版本验证）。不扫描未安装源码、不安装或更新插件、不管理 Agent preset、不删除源码或插件数据，也不修改 DSH 安装包。

**为什么是独立分区，而不是官方插件分区里的一个 tab**（0.1.8 之前别改回去）：

1. `settings.plugins.tab` 属于**官方插件管理**的组成。插件往里塞 tab，用户读到的就是"官方插件管理的第二部分"（0.1.5 起即如此，2026-09 用户实测反馈），与本包"服务开发者、不与官方冲突"的定位直接矛盾。
2. DSH `0.1.7` 起官方插件分区自带 `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 贡献的 inventory tab（会话插件 / 全局插件、运行状态、按预设分组）。本包与它重叠的只剩"启停"，而启停本来就是同一批覆盖项。
3. 于是本包退到只服务 `link:` 源码插件的开发循环，入口独立成设置菜单里的 `settings.section`（id `plugin-dev`、label 「插件开发」），并在面板正文里写明通用插件管理在官方那侧。

正式包名、Host row id 和 Client module id 均为 `dsh-local-plugin-manager`；Client 分区 id 为 `plugin-dev`。

## 已核对的契约（不是猜测）

> 行号取自**当前运行的 `0.2.1-alpha.2` 实际安装包**（`<(command -v dsh) 的安装目录>/node_modules/@deepseek-ai/…`）；跨线后行号会位移，追查时先按符号名搜。逐版本复核记录见「版本规则」末尾。

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
| 内置 `settings.section` 的 order 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（上限 20），本包 100 仍在其后 | 五个官方 client 包的注册行（`dsh-client-ui-settings-account`/`-general`/`-models`/`-settings-plugins`/`-agent-preset`） |
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
- 注册 `settings.section`：`id: 'plugin-dev'`、`order: 100`、`label: '插件开发'`。插件贡献的设置入口一律排到 DSH 自带项之后（`settings.section` / `settings.general.item` / `settings.plugins.tab` 的 order 都 ≥ 100）；DSH `0.2.1-alpha.2` 的内置分区 order 仍是 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（`0.1.7` 三版、`0.2.0-rc.2`、`0.2.1-alpha.2` 三次核对一致），本包的 100 仍排在全部内置分区之后。注意 **`settings.general.item` 的内置上限已经越过 100**（`settings-session-log` 90、`current-version` 100），`settings.section` 与它不是同一个 slot，所以这里不冲突；升级 DSH 后仍要重新读一遍内置项的 order 上限。
- **导航图标只能走 DOM 补丁**：`settings.section` 的注册选项只有 id/order/label，没有 icon；壳层 `navIcon(id)` 只给官方 id 配图标，未知 id 一律回落齿轮，本分区会与官方「插件」撞脸。实现是 `patchSettingsNavIcon()`（原 svg 只做占位，图标用 `::before` + mask 画，配色继续跟随壳层），挂载点注册在 **`settings.action`**——它随设置面板挂载，面板一开就存在；不要挂在分区组件里，分区要等用户点开那一行才渲染，图标会晚一步才对（`dsh-extra-context` 踩过）。图标取 `IconCodeOutlineMedium`（`iconOf` 候选链兜底）。壳层未来若支持在 slot 选项里声明图标，这段补丁应立刻删掉。
- 控件与标记一律用官方 primitives：行开关是 `Switch`（`checked`/`onChange`/`label`/`disabled`/`title`），确认弹窗与「重试 / 刷新页面」是 `Button`（取消 `outline`，卸载 `primary` + 只覆盖按钮色 token 的 `.dlpm-danger-button`），行徽标是 `Tag`（身份 `outline`、已启用 `success`、已禁用 `quiet`、部分启用 `warning`；只借 `.dlpm-tag` 做 `flex:none` 布局），图标用 `IconRefreshOutlineMedium`/`IconTrashOutlineMedium`/`IconLoadingOutlineMedium`/`IconWarningOutlineMedium`，永久卸载必须经过 Modal 确认；管理器自身行禁用开关和卸载按钮。**不要为这些控件自绘外观 CSS 或 `role=switch` 按钮**：几何、调色板、焦点环与危险色都随 primitives 走，自绘一套只会在官方换皮肤后留下不会跟着变的第二套外观（`test/client.test.js` 拦 `dlpm-switch`/`dlpm-button`/`dlpm-badge` 之类的残留）。Client 只显示 Host DTO，不自行推导路径、bundle 或 patch 所有权。
- 只使用当前 Inspect 公布的主题 token；样式和网络请求必须随组件/插件卸载清理。注入的 `<style>` 按引用计数共享并必须打 `data-plugin="dsh-local-plugin-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删；机制见根 `AGENTS.md`）。client HMR 重载只丢弃 fiber 而不跑旧 disposer，所以 `apply` 在元素仍在但文本过期时会重写样式文本。mutation 用同步 `actionRef` 单飞，开始时中止并递增 epoch 使旧 status GET 失效，防止旧快照覆盖 mutation 响应。
- 每行在名称与版本/路径之间渲染 DTO 的 `description`：最多两行（`-webkit-line-clamp:2`），`title` 给全文。层级固定为名称（14/500/primary）> 说明（13/`label-secondary`，配 `color-mix` 7% 自混底板，浅色深色主题都不写死颜色）> 版本与路径（12/`label-tertiary`，纯元信息）；缺失占位「未提供说明」不画底板并小一档，避免空说明行假装成重点。
- 行内还渲染 DTO 的 `rowIds`（loader 行 id），但**只在它带来信息时**才画：单一且等于包名的行 id 只是包名的回声（`loaderRowsLabel()` 负责这个判定）。这是本面板相对官方 inventory 的开发者向增量，不要把它当通用状态展示。

## 安全

status/action 都必须先调用 DSH `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界，再要求 loopback、same-origin/Sec-Fetch-Site 和自定义 Client header；action 另要求当前进程随机 CSRF token、`application/json` 和 16 KiB 上限。固定 Client header 不是认证凭据，status 返回 CSRF token 前必须完成 DSH browser auth。新增 mutation 时继续采用服务端白名单参数，禁止开放任意路径、specifier、命令或 CLI 参数。

## 版本规则

按已核对契约的兼容发布线维护，不为每个非破坏性 prerelease 建独立代码分支（范围与验证版本见「定位与边界」）。跨发布线前必须重新检查 Profile、CLI、Loader、webServer 和 Settings Slot，再同步更新 `DSH_COMPATIBILITY_RANGE`、验证清单、manifest、安装脚本、README 与测试。`install.sh` 的 `VERIFIED_DSH_VERSIONS` 必须与 `lib/profile-manager.js` 的清单逐字一致：0.1.6 换验证版本时漏改过这一处，真机安装因此每次打一条假告警，现由 `test/manifest.test.js` 守卫。

**版本门从常量派生**（2026-10-01 跨线时照抄已跨线的 `dsh-extra-context`，2026-10-10 跨 `0.2.1` 时只改常量）：`lib/profile-manager.js` 不内联任何版本字面量，改为读 `DSH_RELEASE_LINE`（`0.2.1`）+ `DSH_RELEASE_FLOOR`（`{ channel: 'alpha', sequence: 2 }`）+ `PRERELEASE_CHANNELS`；`install.sh` 有一份等价的 shell 版（含 `prerelease_rank()`）。旧写法 `channel !== 'alpha' || seq >= 1` 只能表达「下界是 alpha」，下界换成 rc 后必须改成 channel 优先级比较，否则 `0.2.0-alpha.9` 会被误判成兼容——所以判定逻辑保持 channel 优先级比较，跨线只改常量与清单。`test/manifest.test.js` 有守卫把 range 反推回下界常量、并核对 `install.sh` 的五个常量。

**运行时依赖随发布线一起走**：`@deepseek-ai/dsh-atomic-write` 由 `~0.1.7-alpha.1` → `~0.2.0-rc.2` → `~0.2.1-alpha.2` 随线推进。理由不是「有新 API」——这些版本的 lib 一直逐字相同（见下），而是插件既然只在某条线内运行，写锁就该用同一条线的实现，避免线内锁约定变化时插件与宿主静默分叉。锁是文件系统级的（`<锚点>.lock` + `wx`），跨版本副本之间本来就互斥。

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

### `0.2.0-rc.2 → 0.2.1-alpha.2` 逐项核对记录（2026-10-10，跨线）

取包方式：`npm pack` 两版到 `/tmp/dsh-lpm-021/{old,new}` 后逐文件比对；**先自证取到的是同一份代码**——new 侧 11 个契约包的 `lib/` 与运行安装逐字一致（`diff -rq` 0 差异），再开始比较。

| 包 | lib 改动规模 | 结论 |
|---|---|---|
| `dsh-plugin-manager` | `lib/index.js` +200/−28（新增 official-install-target / build-approval 重写） | 见下第 1、2 条：**新增 `dependencySpec()` 与新的 `removeBundle` 语义**；`writePluginEnabled` **逐字相同** |
| `dsh-app-boot` | `lib/index.js` +199/−43 | 见下第 3 条：**运行时替换校验放宽**；本包用到的 `readProfileManifest`/`composeEntries`/`readProfilePatches`/`resolveBundleDir`/`resolveProfileDir`/`bundlePatchPaths`/`loadOverlayPatches`/`loadOptionalPatches`/`reconcileProfilePatches` 全部**逐字相同**，`mountRootInclude()` 的 `{ id: 'include' }` 仍在（`:3861`） |
| `dsh-hmr` | `lib/index.js` +402/−37 | 见下第 4 条：**新增 `PackageManifests` 清单缓存失效**；profile 配置监听路径（`watchConfig` + `refresh` + `reconcileProfilePatches`）仍在，`runExclusive` 仍是官方 plugin-manager 调用的公开方法 |
| `dsh-host-webserver` | +207/−63 | `register(route)`（重复 (kind, path) 抛错 + disposer）**逐字相同**（`:298`） |
| `dsh-client-connection` | +94/−38 | `requestRejection` 三段判据不变，新增「绑定地址/协议」与 TLS 判定（`:639`） |
| `dsh-client-modules` | `lib/client.js` +9/−4 | 只改「未打标签 `<style>` 的认领范围」：现在只认领本 factory 期间新增的那些（`:495`/`:682`）。本包样式一直显式打 `data-plugin`，不受影响，反而更安全 |
| `cordis-plugin-loader` | `lib/index.js` +6/−3（1.0.5 → 1.0.6-alpha.1） | `EntryTree.sep` 仍是 `':'`（`:127`）、子行 id 仍是 `parent.id + sep + id`（`:332`）；改动只是 `_init()` 多留一份 `moduleNamespace` 给 HMR |
| `cordis-plugin-include` | 1.0.9 → 1.0.10-alpha.1 | `lib/` **逐字相同**（只有 `package.json` 版本号） |
| `dsh-atomic-write` | 版本号变 | `lib/` **逐字相同**（写锁与原子提交零改动） |
| `dsh-base` | `cordis.patch.yml` | 删了 `skill-badge`、`tool-ralph` 两条默认行、给 subagent 去掉 `backgroundMode`、新增 `working-directory` 两行；**`hmr` 那一行（含 `disabled: !!js "!ctx.get('profileContext')"`）逐字相同** |
| `dsh-client-ui-settings-general` | `lib/client.js` 仅 1 行 | 唯一差异是 `CurrentVersionRow` 的版本号字面量；`navIcon` 白名单（`:244`）与 `settings.section`/`settings.action` 声明**逐字相同** |
| `dsh-client-ui-settings` / `-slots` / `-settings-plugin-inventory` | lib 逐字相同 | 分区渲染与 slot 契约无变化 |
| `dsh-client-ui-primitives` | 新增 `CommandText`/`InlineEditor` | 本包用到的 `Switch`/`Button`/`Tag`/`Modal` 与 5 个图标名（`IconCodeOutlineMedium`、`IconRefreshOutlineMedium`、`IconTrashOutlineMedium`、`IconLoadingOutlineMedium`、`IconWarningOutlineMedium`）全部仍在；`tools/dsh-icons/check.js` 无漂移（188 个，Medium/Regular 各 94） |

**三处新结构逐行核对**（用户本轮点名，行号取自 `0.2.1-alpha.2` 安装包）：

1. **`dependencySpec()`**（`dsh-plugin-manager`）——官方新增的「把 profile 记录的依赖值变成可安装 spec」函数：
   - `lib/types/install-spec.js:104-115`：`const local = /^(file|link):(.*)$/s.exec(recorded)` → `path.replace(/^~(?=$|[\\/])/, () => homedir())` → `` `${local[1]}:${resolve(profileDir, path)}` ``；非 registry 值（git/URL）原样透传（只剥 http(s) 的 user-info），registry 值走 `${name}@${recorded}`。
   - `lib/index.js:135` 是同函数的内联副本，消费点只有 `:1603` 的 `sourceOf = (packageName) => owned ? { source: dependencySpec(name, recorded[name], this.profile.dir, packageName) } : {}`——即官方插件页 DTO 的 `source` 字段（`typert.host.js:104` 的 schema 里 `source?: string`），UI 用它显示「代码来源」并比较 `installTarget.spec` 决定是否提示更新。
   - **对本插件的处置**：本包不消费官方 DTO，但**读侧必须同样归一**——pnpm 会原样记录 `link:../src/foo` 或 `link:~/x`（2026-10-10 实测 pnpm 12.6.0），本包原先只做 `resolve(profileDir, target)`，`~` 形态会被判成「本地链接目标不可用」。已抽成 `resolveRecordedLocalPath(profileDir, target, home = homedir())`（`lib/profile-manager.js`）并补单测，语义与官方这条逐字对齐（含「`~` 后必须是结尾或分隔符」这条边界）。
2. **运行时替换校验放宽**（`dsh-app-boot` 的 `ResolutionRouter.replace()`）：旧版有两道「必须重启」的硬门，新版放开了 profile 一条：
   - 删除：`0.2.0-rc.2` 的 `:1368` —— `for (const name of this.current.localPackageNames) if (!localPackageNames.has(name)) throw new Error("profile resolution: removing local package … requires a process restart")`。
   - 新增：`0.2.1-alpha.2` 的 `:1446` —— `if (next === void 0 && current.scope === "profile") continue;`（profile scope 的映射允许消失），并把 `:1447` 的 `declarer` 比较收窄为 `current.scope === "installation" && !sameResolution(current.declarer, next.declarer)`。
   - 服务层注释同时写明新契约（`:3367-3371`）：profile 映射与 `localPackageNames` 可以在对应插件停掉之后移除、linked roots 也可以移除；保留的 profile 映射允许换 declarer，但不允许换目录/版本/scope；installation 映射必须保持不变。
   - **对本插件的处置**：这正是「卸载一个 `link:` 插件能真正生效」的前提（配合官方 plugin-manager 新增的 `refreshPackages()` 调用，`lib/index.js:1824`/`:1826`/`:1963`/`:2023`）。本包卸载走**外部 CLI**，进程内不发布 successor，因此本轮不需要改代码；但墓碑与覆盖项策略的措辞已按新事实订正（见「卸载」），并已在隔离宿主上实测卸载后 boot graph 的变化。
3. **`package.json` 缓存失效**（`dsh-hmr` 新增 `PackageManifests`）：
   - `lib/index.js:213` 的类持有 `directories`/`configurations`/`realDirectories`，装 Node 内部钩子：`readPackageJSON`、`getPackageScopeConfig`、`getPackageType`、`getNearestParentPackageJSON`、CJS `_load`（`:281-300` 一段）。
   - `:228` 的 `invalidate(manifest)`：加入被失效目录 → 清自己的配置缓存与 `realDirectories` → 删 `cjs._pathCache` 的全部键 → 抓 ESM `ResolveCache` 实例并 `Map.prototype.clear` 它；此后这些目录下的清单**从磁盘读**。
   - 触发点：`:748` 的主 watcher 分派 —— `const isManifest = basename(filename) === "package.json" && !filename.includes(`${sep}node_modules${sep}`)` → `this.manifests.invalidate(filename)`；`:752` 起对 manifest 一律 `continue`（不再当成模块重载），`:757` 的 `loadCache.has(url, "json")` 多认一种 JSON 加载。
   - **对本插件的处置**：无需改代码；它是「重装后 manifest 立刻可读」的另一半保证（另一半是 app-boot 的放宽）。注意 profile manifest 本身走的是 `:719` 的 `watchConfig(manifestPath, () => refresh(true))`，而 `:701` 有一个**条件提前返回**：bundle 列表没变时 manifest 变化不会触发重组——本包的卸载/重装都会改 `dsh.profile.bundles`，所以不受影响；将来若只改依赖不改 bundle 列表，别指望这条路径会重组 loader。

**其余契约项逐条复核**（都在实际安装包里重读，全部成立）：profile 写锁（`dsh-atomic-write` lib 逐字相同；官方 `lockWaitMs` 默认仍 `12e4`）、覆盖项四条语义（`writePluginEnabled` 逐字相同）、`include:<rowId>` 行 id 方案、`reconcileProfilePatches` 与 `readProfileManifest`/`composeEntries` 逐字相同、热重载真源仍是 dsh-hmr 的 profile 配置监听（`patchReload` 依旧无消费者）、`settings.section` 是 list slot 且无 `icon`、内置分区 order 上限仍是 20、`webServer.register` 与 `requestRejection` 语义不变、peerDependencies 兼容预检仍在（`:289`）但不门禁本包。

**本轮的代码改动**（业务逻辑只动读侧归一这一处）：`DSH_RELEASE_LINE='0.2.1'` / `DSH_RELEASE_FLOOR={channel:'alpha',sequence:2}` / 清单 `['0.2.1-alpha.2']` / range `>=0.2.1-alpha.2 <0.2.2`（四处同源）、依赖 `@deepseek-ai/dsh-atomic-write` 升到 `~0.2.1-alpha.2`、`resolveRecordedLocalPath()` 对齐官方 `dependencySpec()`；`README.md` 兼容段与该处「热生效真源」的表述一并订正。

## 验证

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run publish:check   # check + test + pack:check（唯一发布闸门）
./install.sh
```

真实 GUI 至少覆盖：设置菜单里的分区顺序（排在全部 DSH 自带项之后）、专属导航图标真的画出来（不只看 dataset，要看 `::before` 的 mask）、当前 profile 的全部 link 插件、每行的说明行与缺失占位、长说明的两行截断、源码路径截断、loader 行只在带来信息时出现、self 保护、开关/徽标/弹窗按钮的官方 primitives 外观（开关为官方胶囊、禁用态半透明、焦点环可见；徽标为官方胶囊 Tag，当前管理器描边 / 已启用 success / 已禁用 quiet / 部分启用 warning 四档可区分；弹窗按钮为官方胶囊并排，卸载为官方危险色）、禁用/启用后 Host fiber 与页面刷新、卸载确认、卸载后 profile manifest/lock、Figma patch 原样保留、重启后 tombstone 清理，以及非 loopback/跨源 action 拒绝。

`scripts/gui-check.mjs`（`npm run gui:check`）把上面「能被 CDP 断言的那部分」自动化了：在**隔离**宿主 + 无头 Chrome 上真点一遍设置菜单 → 分区 → 开关，并交叉核对 profile patch。前置与用法见脚本头部；它只操作自己点的那条插件并切回原状态，不碰 3080 上的宿主。三处细节：全新的隔离 `DSH_HOME` 会先弹引导对话框（「内测声明」写入 profile patch 后不再出现，「添加一个 API Key」在无凭据时每次加载都出现），它们带 `aria-modal` 会吃掉对设置入口的点击，脚本因此先关掉这两类引导再点设置；patch 断言写的是「该行覆盖项条目数不增长 + 最后一条覆盖项的 `disabled` 值正确」，而不是「条目数 +1」——该行原本就可能有覆盖项，官方语义是就地改写；**patch 必须用 YAML 解析而不是逐行正则**——`yaml` 给「流式空序列」（初始化写下的注释 + `[]`）追加条目时会输出流式 YAML `[ { id: x, disabled: true } ]`，逐行正则会把语义完全正确的写入判成失败（2026-10-10 实测；官方 `writePluginEnabled` 用同一份 `yaml@2.9.1` 写出的字节与我们的**逐字相同**，所以这是排版差异、不是分歧）。

`scripts/e2e-remove-reinstall.mjs`（`npm run e2e:check`）是卸载/重装这条链路的端到端脚本：**用设置页把一条 `link:` 插件摘掉，再从官方侧装回来**，24 项断言覆盖三处状态（profile manifest / 设置页面板 / boot graph）+ 两处文件（patch 覆盖项、state.json 墓碑）。它同时是「与官方插件管理并存」的证据来源：摘除走 `dsh plugin remove` 子进程，装回走官方插件页的安装对话框 + bundle 开关，两边读写的都是同一批覆盖项。用法见脚本头部；它只操作自己指定的那条插件，不碰 3080 上的宿主。

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

**`0.2.1-alpha.2` 上的复跑（2026-10-10，隔离 `DSH_HOME=/tmp/dsh-lpm-021-home` + 独立端口 5911 + headless Chrome 155/CDP 9344，全程未触碰用户的 3080）**：

| 检查 | 结果 |
|---|---|
| `npm run publish:check` | **47 项单测 + tarball 10 文件全过**（跨线新增两条：link 记录形态归一、相对路径依赖仍可管理） |
| `npm run gui:check` | **20 项全过**（第一次跑时 18/20，红的两项是脚本自己的解析问题，见下） |
| `npm run e2e:check`（新的卸载/重装端到端） | **24 项全过**：设置页摘除 → manifest 依赖与 bundle 都消失 → patch 写入 `disabled: true` → state.json 留下当前进程墓碑 → boot graph 里它的 client bundle 消失 → 官方插件页「添加插件」填 `link:<源码目录>` 装回 → 依赖写回 → 官方列表 bundle 开关选中 → 面板重新列出（此时是「已禁用」，fail-closed）→ 开关切回已启用 → 覆盖项写 `disabled: false` → boot graph 里 client bundle 回来 |
| 隔离 profile 用的是 `link:~/Documents/...` 形态 | 管理器把它解析成绝对源码路径并正常列出/启停/卸载——这正是本轮新增的 `resolveRecordedLocalPath()` 在真实环境里的证据（pnpm 12.6.0 原样记录 `~`） |
| `node tools/dsh-icons/check.js` | 无漂移（188 个，Medium/Regular 各 94） |
| `verify-nav-icon.js --plugin dsh-local-plugin-manager --measure` | **六项全过**（label 偏移 36/9、原 svg 被隐藏、mask 生效、`::before` 恰好 16×16、壳层行未被动过） |
| 工作区 9 个插件 `npm test` | **458 项全过**（0 失败） |

**真实宿主（用户的 3080）重启后已确认**：两条路由由 404 变 **401**（未认证 = 路由已注册 → 版本门放行），同宿主的 `dsh-extra-context` 对照 401、仍在旧线的 `dsh-auto-load-history`/`dsh-default-tuner` 对照 404；真实 profile 的 9 条依赖全是绝对 `link:`、无本插件覆盖项、无墓碑、无残留写锁。页面观感留给用户目视。

**端到端这条链路本轮暴露并修掉的两个「仪器问题」**（都不是产品缺陷，但不修就会把正确行为判成失败）：

1. **`gui-check.mjs` 的 patch 解析只认块式 YAML**：隔离 profile 初始化写下的 patch 是「注释 + `[]`」，`yaml` 给流式空序列追加条目时会写成 `[ { id: x, disabled: true } ]`，逐行正则读不到 → 「禁用写进该行覆盖项的 disabled: true」与「启用写显式 disabled: false」两条恒红。已改成用 `parseDocument` 真解析（`overrideEntries()`），并用官方那份 `yaml@2.9.1` 复现证明**两版输出逐字相同**——这是排版差异，不是本包与官方分歧。
2. **官方「安装」不等于「启用」**：手动 spec 的 `installBundle(spec, { enabled: subject.selection ?? false })` 只把**依赖**写进 profile；选中 bundle 是第二步（对话框完成态的「立即启用」走 `setPluginEnabled`，或列表卡片上的 bundle 开关走 `setBundleEnabled`）。而且 profile 一变，客户端会重挂、对话框可能直接消失——脚本因此按「依赖先落地 → 再用官方入口选中 bundle」两步走，并把「重装后仍是已禁用」作为 fail-closed 的断言（上一进程写的覆盖项还在），最后再用本插件的开关把它切回启用。

**`gui-check.mjs` 的一条断言 2026-10-01 修正过**：「本分区排在 DSH 自带项之后」原本写成 `labels.indexOf(SECTION_LABEL) === labels.length - 1`（要求它是**最后一行**），这在只装本插件的隔离环境里成立，但别的插件同样会贡献 ≥100 的 `settings.section`（`extra-context` 100、`default-overrides`/`mcp-manager` 110、`chat-archive-manager` 120），于是 2026-10-01 的实机跑出现了「菜单顺序完全正确却判失败」的假阴性。现在改为按内置 label 白名单（通用设置/模型/内置插件/Agent 预设）定位最后一个自带项、再断言本分区在它之后——度量的是契约本身而不是环境巧合。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-local-plugin-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线，它会先 `npm install` 再跑 `npm run publish:check`。
- **本包有运行时依赖，且它们是对齐官方的关键**：`@deepseek-ai/dsh-atomic-write`（`~0.2.1-alpha.2`，profile 写锁 + 原子提交）与 `yaml`（`^2.9.0`，patch 编辑）。锁是**文件系统级**的（`<锚点>.lock` + `wx`），因此即使装的是另一个补丁版本也仍与宿主互斥；但锁路径约定若在发布线之间变化就会失配——跨 `0.2.1` 时已重新核对（该包 lib 逐字相同，锁与 `mode` 都没动），跨 `0.2.2` 前要再核一次。release 工作流必须在 `npm publish` 之前显式安装依赖，否则 `prepublishOnly` 的测试会以 `ERR_MODULE_NOT_FOUND` 失败（0.1.4 就是这样没发出去的，根仓库 release 工作流已补上依赖安装步骤，改动它时不要删掉）。**改依赖范围必须跟着 `npm install` 并把 `package-lock.json` 一起提交**：CI 与 release 在有 lockfile 时跑 `npm ci`，范围与 lock 失配会以 `EUSAGE` 停在“安装依赖”这一步（2026-10-10 的 0.4.0 首次 tag 就是这样失败的，两个 workflow 都没产出任何发布物）；本机 `publish:check` 用已装好的 `node_modules`，察觉不到这种失配。
- 发布：`npm run publish:check`（`verify` 的 `check` + `test`，再加 `pack:check` 的 tarball 白名单）是发布闸门，`prepublishOnly` 已绑定它；`scripts/` 不进发布物（`files` 白名单里没有它），`scripts/check-pack.js` 因此是纯开发期校验。`.github/workflows/ci.yml` 在 Node 20/22 上执行同一闸门，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-local-plugin-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（`private: true` 会被工作流拒绝，本包已改为可公开发布）。
