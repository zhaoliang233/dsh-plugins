# dsh-local-plugin-manager 技术说明

## 边界

只管理 DSH `>=0.1.6-alpha.1 <0.1.7` 兼容发布线的 `web` profile 中已安装的 `link:` bundle（`0.1.6-alpha.1` 已逐版本验证）。不扫描未安装源码、不安装或更新插件、不管理 Agent preset、不删除源码或插件数据，也不修改 DSH 安装包。

正式包名、Host row id 和 Client module id 均为 `dsh-local-plugin-manager`；Client tab id 为 `local-plugins`。

## Host

- `lib/index.js`：Cordis 入口、运行版本门、loopback/同源/CSRF HTTP 路由、当前 Loader 私有热切换。
- `lib/profile-manager.js`：profile 枚举、bundle patch 分析、受管状态、原子写入、官方 CLI 卸载与回滚。
- `GET /dsh-local-plugin-manager/status`：返回当前 profile、本地插件 DTO 和每次 Host 运行随机生成的 CSRF token。
- `POST /dsh-local-plugin-manager/action`：body 只接受 `{ action: 'enable'|'disable'|'uninstall', name }`。

`ctx.webServer` 是硬依赖。Loader 经 `ctx.get('loader')` 可选读取；热切换只匹配根 profile Include 下的完整 `entry.id === 'include:' + rowId`，再用已在 `0.1.6-alpha.1` 验证的 entry ABI `entry.update({ disabled: true|null }, false, true)`。热切换失败不等于写入失败：持久 patch 仍是下次启动的真源。

## 本地插件判定

一个条目必须同时满足：

- profile `dependencies[name]` 是 `link:` spec，且本地 `package.json#name` 与 dependency key 完全一致；
- 声明字符串 `dsh.bundle.patch`，patch 位于包目录内，package 位于 `dsh.profile.bundles`；
- bundle patch 每个顶层条目都只有 `id? + insert`，每个直接插入行都有稳定、安全的 id。

bundle 若覆盖现有行、缺少 id、默认禁用或解析失败，只展示为不可管理。不要为兼容其他包形状放宽这一 fail-closed 分类，除非当前运行 profile 有明确需求并补齐测试。

行说明只有一个来源：本地 `package.json#description`。`normalizeDescription()` 去掉控制字符、把空白折叠为单行、裁到 200 字符（超出补省略号），非字符串或空串一律归一为 `undefined`；Client 只渲染该字段，不读文件也不自行推导文案。

## 持久状态与 patch

状态文件 `<profile>/.dsh-local-plugin-manager/state.json`，schema version `1`：

```json
{ "version": 1, "disabled": [], "pendingRemovals": [] }
```

profile `cordis.patch.yml` 中只有 `# >>> dsh-local-plugin-manager (managed)` 与 `# <<< dsh-local-plugin-manager (managed)` 之间的内容归本插件；任何标记缺失、重复或交错都拒绝写入。完整文件始终用与当前 DSH 相同的 `js-yaml` `JSON_SCHEMA + !!js` 类型解析验证；写入只替换受管区块、保留其他字节。`[]` 空序列在加入第一条受管 row 时移除，在只剩注释时恢复。

profile patch 与 state 都经同目录临时文件原子 rename；两文件事务任一步失败时要尽力恢复操作前文本。state 文件模式 `0600`；用户 patch 保留现有模式，首次创建用 `0644`。

## 卸载

卸载前必须：拒绝管理器自身；重新读取当前 profile（不信任 Client 路径或旧快照）；检查 profile/home 用户 patch 的所有 `insert`，仍引用目标包则拒绝；先写 disabled 状态并热停目标行。

命令固定由 `process.execPath + 当前真实 dsh lib/bin.js` 异步执行，参数只能是：

```text
plugin --profile web remove <server-derived-name> --config.minimumReleaseAge=0
```

命令输出有界、操作单飞；超时先发 SIGTERM，5 秒未退出再发 SIGKILL。成功后必须重新读取 manifest，确认 dependency 与 bundle 都消失；pnpm 已删 dependency 但 bundle list 残留时，当前发布线允许原子移除该残留。失败且 profile 仍完整时恢复之前的 state、patch 和 live 状态。

成功卸载会留下带 `processMarker` 的 `pendingRemovals` tombstone，防止启动时固定的 bundle patch 在当前进程复活。marker 由 `process.pid + performance.timeOrigin` 构成；同一 Host 进程内即使管理器 HMR 重载也保留，只有新 Host 进程确认包已不在 manifest 后才清理。

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

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-local-plugin-manager`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线，它会先装 `js-yaml` 再跑 `npm run verify`。
- **本包有运行时依赖 `js-yaml`**：release 工作流必须在 `npm publish` 之前显式安装依赖，否则 `prepublishOnly` 的测试会以 `ERR_MODULE_NOT_FOUND: js-yaml` 失败（0.1.4 就是这样没发出去的，根仓库 release 工作流已补上依赖安装步骤，改动它时不要删掉）。
- 发布：`npm run verify`（`check` + `test`）是发布闸门，`prepublishOnly` 已绑定它；本包没有 `pack:check`。`.github/workflows/ci.yml` 在 Node 20/22 上执行同一闸门，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-local-plugin-manager-v<版本>` tag 后经 npm trusted publishing（OIDC）完成（`private: true` 会被工作流拒绝，本包已改为可公开发布）。
