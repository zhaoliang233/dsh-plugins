# dsh-local-plugin-manager 技术说明

## 边界

只管理 DSH `>=0.1.6-alpha.1 <0.1.7` 兼容发布线的 `web` profile 中已安装的 `link:` bundle（`0.1.6-alpha.2` 已逐版本验证）。不扫描未安装源码、不安装或更新插件、不管理 Agent preset、不删除源码或插件数据，也不修改 DSH 安装包。

正式包名、Host row id 和 Client module id 均为 `dsh-local-plugin-manager`；Client tab id 为 `local-plugins`。

## Host

- `lib/errors.js`：共享错误类型 `LocalPluginManagerError`（`code` + HTTP `status`），供两个模块复用而不产生循环 import。
- `lib/patch-writer.js`：**profile patch 事务**。行覆盖语义、profile 写锁、原子提交、旧格式迁移与陈旧覆盖项修剪。
- `lib/profile-manager.js`：profile 枚举、bundle patch 分析、state.json、官方 CLI 卸载与回滚。
- `lib/index.js`：Cordis 入口、运行版本门、loopback/同源/CSRF HTTP 路由、Loader 状态只读观察。
- `GET /dsh-local-plugin-manager/status`：返回当前 profile、本地插件 DTO 和每次 Host 运行随机生成的 CSRF token。
- `POST /dsh-local-plugin-manager/action`：body 只接受 `{ action: 'enable'|'disable'|'uninstall', name }`。

`ctx.webServer` 是硬依赖。Loader 经 `ctx.get('loader')` **只读**读取：启停由 profile patch 的覆盖项驱动，写完由 profile 配置重载（`patchReload: live` 或 `dsh-hmr`）重组 loader 树，`observeLoaderEntryState()` 仅在有限时间内轮询 `entry.id === 'include:' + rowId` 的 fiber 是否到达预期状态，用来给出「已生效 / 需要重启」。**不要重新引入 `entry.update(...)` 之类的 Loader 私有写入**：那会与官方 plugin-manager 和 HMR 的重组并发改同一批行。

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

**为什么必须对齐**：官方 `dsh-base` 在 `0.1.6-alpha.2` 起默认启用 `plugin-manager`，侧边栏「插件」页也能启停同一批行。两套写入若各写一条同 id 覆盖项，最后一条永远生效，两边会互相回滚；启用时若删除自己那条而不是写 `false`，官方那条会继续压着。任何「按自己的账本重写区块」的实现都会退回这个 bug。

state 文件 `<profile>/.dsh-local-plugin-manager/state.json` 只保留卸载墓碑，schema version `2`：

```json
{ "version": 2, "pendingRemovals": [] }
```

v1（`{ version: 1, disabled: [...], pendingRemovals: [] }`）仍可读：`initialize()` 把 `disabled` 里的包补写成显式覆盖项（正常情况它们已经在受管区块里），并顺手把旧标记行删掉后写成 v2。旧标记只是注释，区块内的条目原地保留为普通覆盖项，因此禁用状态不会丢失。

## 卸载

卸载前必须：拒绝管理器自身；重新读取当前 profile（不信任 Client 路径或旧快照）；检查 profile/home 用户 patch 的所有 `insert`，仍引用目标包则拒绝；先写 `disabled: true` 覆盖项并请求热停。

命令固定由 `process.execPath + 当前真实 dsh lib/bin.js` 异步执行，参数只能是：

```text
plugin --profile web remove <server-derived-name> --config.minimumReleaseAge=0
```

命令输出有界、操作单飞；超时先发 SIGTERM，5 秒未退出再发 SIGKILL。成功后必须重新读取 manifest，确认 dependency 与 bundle 都消失；pnpm 已删 dependency 但 bundle list 残留时，当前发布线允许原子移除该残留。失败且 profile 仍完整时恢复之前的 state、patch 和 live 状态。

成功卸载会留下带 `processMarker` 的 `pendingRemovals` tombstone：bundle 层在启动时已冻结，卸载后这些行仍在 loader 树里，覆盖项必须留到进程结束。marker 由 `process.pid + performance.timeOrigin` 构成；同一 Host 进程内即使管理器 HMR 重载也保留。新 Host 进程确认包已不在 manifest 后，用 `pruneRowOverrides()` 清掉遗留覆盖项——**必须清**，否则将来重装该插件会被这条陈旧覆盖项继续禁用；条目只有 `id`+`disabled` 时整条删除，还带别的字段时只摘 `disabled`（不丢用户配置，也不留 `- id: x` 空壳）。

## Client

- `client.js` 是手写 lazy-CJS bundle，无 JSX/TypeScript/import；`exports.inject = ['slots']`；`package.json#dsh.client.inject` 依赖 `@deepseek-ai/dsh-client-ui-settings-plugins`。
- 注册 `settings.plugins.tab`：`id: 'local-plugins'`、`order: 20`、`label: '本地插件'`。开关用 `role=switch`，刷新与卸载用官方 primitives 图标（`IconRefreshOutline16`/`IconTrashOutline16`），永久卸载必须经过 Modal 确认；管理器自身行禁用开关和卸载按钮。Client 只显示 Host DTO，不自行推导路径、bundle 或 patch 所有权。
- 只使用当前 Inspect 公布的主题 token；样式和网络请求必须随组件/插件卸载清理。注入的 `<style>` 按引用计数共享并必须打 `data-plugin="dsh-local-plugin-manager"`（未打标签的样式会被别的 bundle 认领、热更新时误删；机制见根 `AGENTS.md`）。client HMR 重载只丢弃 fiber 而不跑旧 disposer，所以 `apply` 在元素仍在但文本过期时会重写样式文本。mutation 用同步 `actionRef` 单飞，开始时中止并递增 epoch 使旧 status GET 失效，防止旧快照覆盖 mutation 响应。
- 每行在名称与版本/路径之间渲染 DTO 的 `description`：最多两行（`-webkit-line-clamp:2`），`title` 给全文。层级固定为名称（14/500/primary）> 说明（13/`label-secondary`，配 `color-mix` 7% 自混底板，浅色深色主题都不写死颜色）> 版本与路径（12/`label-tertiary`，纯元信息）；缺失占位「未提供说明」不画底板并小一档，避免空说明行假装成重点。

## 安全

status/action 都必须先调用 DSH `connection.requestRejection(req)` 复用 trusted-host 与签名浏览器 cookie 边界，再要求 loopback、same-origin/Sec-Fetch-Site 和自定义 Client header；action 另要求当前进程随机 CSRF token、`application/json` 和 16 KiB 上限。固定 Client header 不是认证凭据，status 返回 CSRF token 前必须完成 DSH browser auth。新增 mutation 时继续采用服务端白名单参数，禁止开放任意路径、specifier、命令或 CLI 参数。

## 版本规则

按已核对契约的兼容发布线维护，不为每个非破坏性 prerelease 建独立代码分支（范围与验证版本见「边界」）。跨发布线前必须重新检查 Profile、CLI、Loader、webServer 和 Settings Slot，再同步更新 `DSH_COMPATIBILITY_RANGE`、验证清单、manifest、安装脚本、README 与测试。

## 验证

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run verify
./install.sh
```

真实 GUI 至少覆盖：第三个 tab 顺序、当前 profile 的全部 link 插件、每个插件的说明行与缺失占位、长说明的两行截断、源码路径截断、self 保护、禁用/启用后 Host fiber 与页面刷新、卸载确认、卸载后 profile manifest/lock、Figma patch 原样保留、重启后 tombstone 清理，以及非 loopback/跨源 action 拒绝。

**与官方插件页并存**也要覆盖（这是本包唯一容易踩的坑）：在管理器的 tab 里禁用，再去侧边栏官方「插件」页看该行是否为禁用、能否就地启用；反向再走一遍，并确认 `cordis.patch.yml` 里该行始终只有一条覆盖项。自动化侧的做法见下：把真实 profile 复制到临时目录，用该插件的 `setEnabled()` 与从官方包里提取的 `writePluginEnabled` 往返改写（`test/profile-manager.test.js` 里的若干用例已覆盖覆盖项定位与迁移，GUI 步骤无法被单测替代）。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-local-plugin-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线，它会先 `npm install` 再跑 `npm run verify`。
- **本包有运行时依赖，且它们是对齐官方的关键**：`@deepseek-ai/dsh-atomic-write`（`~0.1.6-alpha.1`，profile 写锁 + 原子提交）与 `yaml`（`^2.9.0`，patch 编辑）。锁是**文件系统级**的（`<锚点>.lock` + `wx`），因此即使装的是另一个补丁版本也仍与宿主互斥；但锁路径约定若在发布线之间变化就会失配，跨 `0.1.7` 前必须重新核对。release 工作流必须在 `npm publish` 之前显式安装依赖，否则 `prepublishOnly` 的测试会以 `ERR_MODULE_NOT_FOUND` 失败（0.1.4 就是这样没发出去的，根仓库 release 工作流已补上依赖安装步骤，改动它时不要删掉）。
- 发布：`npm run verify`（`check` + `test`）是发布闸门，`prepublishOnly` 已绑定它；本包没有 `pack:check`。`.github/workflows/ci.yml` 在 Node 20/22 上执行同一闸门，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-local-plugin-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（`private: true` 会被工作流拒绝，本包已改为可公开发布）。
