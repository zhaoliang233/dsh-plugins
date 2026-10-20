# 新插件立项流程

> 只在**从零新建一个插件**或**跨发布线重做契约**时读本文件。日常维护、兼容性检查、修 bug 都不需要它。
> 工作区总览与用户规则见根 [`AGENTS.md`](../AGENTS.md)。

## 1. 先调研机制，再落包

解析 `dsh` 可执行文件的真实路径，读该安装下 `@deepseek-ai/*` 的 `lib/*.js` 与 README 确认机制；必要时用动态 Cordis 插件原型快速验证（可选）。

## 2. 落成正式包

入口固定为 `<插件名>/lib/index.js`（宿主半体）+ `client.js`（客户端半体，单文件产物），外加 `install.sh`/`uninstall.sh` + `package.json` + `README.md` + 插件内 `AGENTS.md`。

- **入口路径是契约，不是代码组织上限**：宿主其余代码按模块拆到 `lib/<模块>.js`（现例：`dsh-chat-archive-manager/lib/archive-deletion.js`、`dsh-local-plugin-manager/lib/profile-manager.js`）。`lib/index.js` 只留 Cordis 入口/服务注册/HTTP 路由；单文件超过约 400 行，或出现独立事务边界（文件事务、profile 管理、凭据读写）时**按边界拆，不按行数硬拆**——多个能力共享同一套状态时，硬拆只会制造跨文件隐式状态。
- **`client.js` 是单文件产物，不是单文件源码**：浏览器只按 `dsh-client-modules` 广告的 combo URL 取 bundle（见根 `AGENTS.md`「双面插件」），factory 的 `require` 也只解析 seed 词与 boot graph 包名，相对路径必然抛错。要拆源码必须加构建步骤产出 `client.js`（官方 `dsh-client-ui-*` 即 tsdown 构建）；不引入构建时，在 factory 内用分区与普通函数做逻辑分层。
- 新增 `lib/*.js` 时必须同步 `package.json#scripts.check` 的 `node --check` 列表，以及（若该插件有）`scripts/check-pack.js` 的期望文件清单。
- 完整的包还会带 `CHANGELOG.md`（发布时写条目）与 `scripts/check-pack.js` 的精确打包白名单，必要时 `PUBLISHING.md`、机器可读契约文件；`package.json` 必须有 `repository`（provenance 校验要求）、`publishConfig.access: "public"`、`license`、`engines.node`，并绑好 `prepublishOnly → publish:check` 门禁。
- **兼容门要一开始就写全**：`dshCompatibility.range` / `engines.dsh` / 运行时 `classifyDshVersion` / `install.sh` 四处同源，并提供 `test/manifest.test.js` 的守卫。漏掉运行时门的后果见 `../dsh-default-tuner/AGENTS.md`（声明齐全却照常在不支持的版本上跑）。

## 3. 挂载、验证、收尾

`./install.sh` 挂载（或直接 `dsh plugin --profile web add dsh-<插件>` 装 registry 版本）→ 需要时请用户重启 → 验证 → 收尾（文档、清理）→ 交付给用户时按根 `AGENTS.md`「发布与分发」升版本、打 tag、发布并核对。

## 附：门常量为什么是这个形状

跨发布线时只改常量、判定逻辑不动，是因为这套形状被同一个坑反复咬过——**旧写法 `channel !== 'alpha' || seq >= N` 只表达「下界是 alpha」**。下界换成 `rc.2` 后，它会把 `0.2.0-alpha.9` / `0.2.0-beta.9` / `0.2.0-rc.1` 全判成兼容；反过来下界仍是 alpha 时（如 `0.2.1-alpha.2`），把下界写进正则又会把同线的 `beta`/`rc`（都高于 alpha 下界）错挡在门外。只有「发布线 + `{channel, sequence}` 下界」这一组常量能同时表达两边，所以两侧（lib 的 `classifyDshVersion()`、`install.sh` 的 `prerelease_rank()`）都从它派生，跨线只改常量。

同理，五个常量写成普通字面量而不是 `Object.freeze` / `Set`，是因为 `test/manifest.test.js` 要按行解析这些赋值做四处同源比对——包成容器后解析就落空。
