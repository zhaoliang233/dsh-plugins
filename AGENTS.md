# dsh-plugins 工作区 — 说明文档（AGENTS.md）

> 供**新会话的 agent** 快速了解工作区。本文件只保留对**所有插件**通用的知识；单个插件的细节在各自目录的 `AGENTS.md`，用户文档在各插件的 `README.md`。

## 这是什么

开发 **DeepSeek Harness（DSH）插件** 的工作区：用户提需求，agent 负责调研 DSH 内部机制、实现插件、编写挂载/卸载脚本并验证。

7 个插件都**已发布到公共 npm registry**，用户安装走官方命令；本地 `./install.sh`（`link:` 源码）只用于开发。分发与发布流程见「发布与分发（npm / OIDC）」一节。

`dsh-mcp-manager` 是本工作区第 8 个插件，**尚未发布**（走 `./install.sh` 的 `link:` 路线开发中，发布需用户明确授权后再改版本、打 tag）。

## 插件索引

| 插件 | 一句话说明 |
|---|---|
| `dsh-default-workspace/` | 创建并保护受管的“通用会话”默认 Workspace，并提供独立的新建通用会话入口 |
| `dsh-chat-archive-manager/` | 设置页的归档管理：分组浏览、批量归档、恢复与 fail-closed 永久删除，不创建额外 Workspace |
| `dsh-local-plugin-manager/` | 在设置页启停或卸载当前 web profile 中的本地 link 插件 |
| `dsh-sticky-user-bubble/` | 阅读长对话时把已滚出顶部的用户气泡固定在阅读区顶部 |
| `dsh-mobile-compat/` | 为精确声明的 DSH 版本提供移动抽屉、Settings、Composer、触控与安全区兼容层 |
| `dsh-auto-load-history/` | 打开会话时自动补齐整段历史，顶部「加载更早」不再常驻（设置→通用末尾的总开关可关闭） |
| `dsh-extra-context/` | 给全部会话/子代理的 system prompt 附加一段额外说明与上下文，设置页分段维护、热生效 |
| `dsh-mcp-manager/` | 设置页管理 MCP 服务器：增删改、启停、连接与工具状态、凭据走 credentials，不改 profile 配置、不重启即生效（**未发布**） |

用户安装（包名 = 目录名）：

```bash
dsh plugin --profile web add dsh-sticky-user-bubble        # 安装 / 升到 caret 范围内的最新版
dsh plugin --profile web add dsh-sticky-user-bubble@0.1.4  # 指定版本（升级必须显式写版本号）
dsh plugin --profile web remove dsh-sticky-user-bubble     # 卸载
```

改变 profile 组成的安装/卸载都要**由用户重启 `dsh web`** 并刷新页面才生效。每个插件内都有 `AGENTS.md`（技术）与 `README.md`（用户），部分还有 `PUBLISHING.md`（发布清单）与 `CHANGELOG.md`（历史）。新增插件：在本表加一行，并在新目录内建立自己的 `AGENTS.md`。

## 工作区工具（非插件）

`tools/dsh-icons/`：从已安装 DSH 提取**内置图标全集**（名字/字重档位/画布/SVG 源码/谁在用）→ 可 diff 快照 `icons.json` + 可交互预览页 `preview.html`；`check.js` 在 DSH 升级后核对漂移，并拦下“插件 require 了不存在的图标”。详见 `tools/dsh-icons/README.md`。

```bash
node tools/dsh-icons/build.js            # DSH 升/降级后重新提取
node tools/dsh-icons/check.js            # 漂移检查（0=无漂移，1=有漂移）
open tools/dsh-icons/preview.html        # 选图标：搜索/字重档位/真实尺寸/深浅背景，点卡片复制名字
node tools/dsh-icons/verify-nav-icon.js --plugin <插件>   # 验证设置页导航图标补丁的几何（无需真实 GUI）
```

**选或换图标前先在预览页确认名字存在**：图标来自浏览器侧 `__ModuleLoader__` seed 的 `dsh-client-ui-primitives` 冻结导出对象，没被打进去的名字 `require` 回来是 `undefined`，组件会静默渲染成空白。**0.1.7 把旧的数字档位（`IconXxx14`/`16`/`20`）换成了字重档位 `…Medium`（描边 1.3）/`…Regular`（描边 1），同一行里的图标必须同字重档位**；换图标的取值处写候选链兜底（`iconOf()`），别直接解构。设置页分区想要自己的图标只能走 DOM 补丁（壳层 `settings.section` 没有 `icon` 选项），现成实现、关键事实与离线几何验证见该工具 README。

## 环境事实

- 部署为 web profile，宿主组成在 `~/.dsh/profiles/web/`：`cordis.yml` 只有注释和空 `[]`，实际组成 = `package.json#dsh.profile.bundles`（bundle 顺序）+ `cordis.patch.yml`。
- 插件声明 `dsh.bundle.patch` 并附带 `cordis.patch.yml`，经 `dsh plugin --profile web add/remove` 进入 profile 的依赖与 bundle 顺序。现有插件都走官方 profile 管理；不要重新引入共享 node_modules 符号链接或直接改用户 patch 的 fallback 方案。
- 两种安装形态并存：**用户机器**从 registry 装（profile 依赖是 caret 范围），**本机开发**用 `link:` 指向源码目录（改完源码需重启 `dsh web`，profile 不复制文件）。
- 凭据在 `~/.dsh/.credentials.yaml`，经 `ctx.credentials.resolve/describe/set/unset` 读写；附件库（粘贴图片）在 `~/.dsh/attachments/v1/objects/<前2位>/<sha256>`。
- DSH 源码位置以 `realpath "$(command -v dsh)"` 所属安装为准，当前为 `~/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh/`；调研机制时读该安装及其 `node_modules/@deepseek-ai/*/lib/*.js` 与 README。
- 插件代码或组成变化后，检查 Host 状态接口和浏览器 boot graph。部署配置是否热加载见下节；热加载可用时刷新页面即可，否则需要请求用户重启。

## 插件版本与兼容发布线（用户规则）

插件按**已核对契约的最窄兼容发布线**维护，不为每个 prerelease 建硬门，也不为多个版本维护分叉实现：

- 当前运行 `@deepseek-ai/dsh 0.1.7-alpha.1`；逐包核对 `0.1.6-alpha.2 → 0.1.7-alpha.1` 的契约差异后，工作区兼容线统一收敛为 `>=0.1.7-alpha.1 <0.1.8`，其中 `0.1.7-alpha.1` 是逐版本验证版本。同线后续 prerelease 允许带警告运行；跨到 `0.1.8` 前必须重新读取源码和实时契约再扩大范围。
- 范围外保持 inert（零副作用），`install.sh` 也拒绝安装：**上一线的用户留在上一线的插件版本**，一个插件版本只服务一条发布线。
- 必须始终保留结构与能力检查 fail closed；禁止无上界范围、跨发布线猜测兼容。线内未逐条验证的版本只是"带警告运行"，能力探测仍是权威判定——探测不到的能力各自降级，不要让整页 404。
- 声明必须四处同源：`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 版本门（`DSH_COMPATIBILITY_RANGE` + `DSH_VERIFIED_VERSIONS`）、插件内文档。
- **按能力取资源仍是默认写法**：官方图标名、客户端服务字段、slot 契约都会随发布线改名（例：0.1.7 把图标从数字档位改成档位词），取值处写候选兜底（见 `dsh-chat-archive-manager/client.js` 的 `iconOf()`），让代码不因一个名字消失就静默变空白。

## 发布与分发（npm / OIDC）

7 个包都已发布到公共 npm registry，由 tag 驱动、经 npm trusted publishing（OIDC）带 provenance 发布，不含任何长期 token：

- 发布流程：改 `package.json#version` → 写 `CHANGELOG.md` 条目 → 跑该插件的 `npm run publish:check` → `git tag dsh-<插件>-v<版本>` → `git push origin HEAD && git push origin dsh-<插件>-v<版本>`。tag 必须与 `package.json#version` 完全一致；工作流还会拒绝 `private: true` 的包，并在发布后回查 registry。
- 发版必须由用户明确授权：`commit`/`tag`/`push` 都属「提交规范」里的受限操作（只读检查不受限）。
- **`release.yml` 在 `npm publish` 前必须安装依赖**：带运行时依赖的插件（现例 `dsh-local-plugin-manager` 的 `js-yaml`）否则会在 `prepublishOnly` 门禁里以 `ERR_MODULE_NOT_FOUND` 失败——`dsh-local-plugin-manager@0.1.4` 就是这样没发出去的。也不要缩短 registry 回查窗口：可见性实测可达数分钟，曾经的 12×10s 把"发布成功"误判成失败，还跳过了 GitHub Release 创建。
- 认证：每个包在 npmjs.com 设置页配置 trusted publisher（组织/用户 `zhaoliang233`、仓库 `dsh-plugins`、工作流文件名 `release.yml`）。报 `ENEEDAUTH` / `Unable to authenticate` 时先核对这三个字段。
- 有硬编码版本断言的 manifest 测试要同步（现例：`dsh-local-plugin-manager`、`dsh-mobile-compat`），否则发布门禁会失败。
- 发布后核对三件事：registry 上的版本、该版本 `dist.attestations` 是否存在（证明是 OIDC 发布）、GitHub Release 是否创建。`gh` 已装在 `/usr/local/bin/gh`（brew 在这台 Intel Mac 上装不了 gh，用的是官方预编译二进制），已登录 `zhaoliang233`。
- 升级语义：profile 依赖是 caret 范围，`dsh plugin --profile web add <包名>` **不会**自动升到新版本，必须显式写 `@<版本>`。

## 当前 DSH Web 进程（重要）

当前 Web GUI 与 agent 工具连接由用户在 Warp 中**前台**运行的 `dsh web` 承载，进程所有权必须始终属于用户并保持在可见终端中。

- **禁止** agent 停止、重启或替换当前 `127.0.0.1:3080` 的监听进程。
- **禁止**用 `launchctl`、`nohup`、`setsid`、后台 shell、受管 background job 或其他守护机制启动当前 DSH Web。
- 确实需要重启时：agent 先做完所有无需重启的检查，再说明原因并请用户在 Warp 中执行 `Ctrl+C` 和 `dsh web --no-open`。
- 请求重启时**不得调用 `ask_user_question`**：该交互句柄属于即将退出的 Host 进程，重启后旧按钮失效。应结束当前工作轮，用普通消息交接重启步骤，请用户重连后发“已重启”或“继续”开启新一轮验证。
- 用户确认已重启后，agent 只读检查端口监听进程、Host 状态接口和浏览器 boot graph，不接管进程所有权。
- `--port 0` 启动的隔离测试服务器不承载当前 GUI，可以继续用受管 background job，并在验证后正常停止。
- 需要请求用户重启 Host 的变化：Host 代码、bundle/profile 组成。仅改文档不需要重启；仅改 client bundle 时先确认 client-plugin watcher 是否正在构建，没有 watcher 时请用户重启并刷新页面。

## 测试资源与进程隔离（重要）

**禁止按进程名杀进程。** 2026-09-19 事故：agent 为清理自己的无头 Chrome，反复执行 `Get-Process chrome | Stop-Process -Force`，**11 次杀掉用户正在使用的浏览器**（`Stop-Process -Force` 走 `TerminateProcess`，Crashpad/WER 全无痕迹，所以第一轮排查还误判为「没有崩溃」）。`taskkill /IM`、`pkill -f chrome`、`Stop-Process -Name <同名>` 同理禁止。

- 同类规则适用于一切共享资源：只结束**本会话创建、且能按命令行/端口/锁文件证明归属**的进程；不能证明归属时改用隔离资源（独立端口、独立 `DSH_HOME`、独立 profile），而不是"清理"别人的进程。
- 隔离验证用 `dsh --profile web --port <非 3080> --no-open` 起受管 background job，验证后停止；用户自己的 `127.0.0.1:3080` 永不触碰。
- **禁止用 `git checkout-index` / `git checkout -- <path>` / `git restore` 处理行尾或索引问题**：它们会用索引内容**覆盖工作区的未提交改动**（2026-09-19 实际发生过，一次操作清空了整个会话的未提交成果，且无法从 git/npm 恢复）。行尾统一靠 `.gitattributes`（`* text=auto eol=lf`）在**下一次 checkout 时**生效；要立即改写工作区行尾，必须先提交或备份，再单独确认。

## DSH 插件开发通用手册

### 挂载/卸载脚本模式

**分发主路线是 npm 官方安装**（见「发布与分发（npm / OIDC）」），`install.sh` / `uninstall.sh` 只服务开发与本机联调。每个插件都带这两个脚本，默认 `DSH_PROFILE=web`：

- package 声明 `dsh.bundle.patch`；install 先跑校验，再调用 `dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR"`；uninstall 调用官方 remove。
- `cordis.patch.yml` 属于插件发布物；profile 的 `cordis.patch.yml` 属于用户覆盖层，安装脚本不得直接改写。

### 宿主插件要点

- 插件对象 `export default { name, inject, apply(ctx) }`；`inject` **必须声明**要用到的服务（如 `['tools','systemPrompt']`），否则 apply 在 services 就绪前运行、注册被静默跳过（踩过此坑）。
- **要导出 `Config`（0.1.7 起插件设置的 schema）时必须同时挂在 default 对象上**：`Loader.unwrapExports()` 对"既有 default 又有命名导出"的模块返回 **default 对象**，而 `registry.plugin()` 只从那个对象读 `runtime.Config`。只写 `export const Config` 会让 `settings.describe()` 认定该条目没有 schema → 条目进不了配置表单 → 状态接口 `writable:false`、设置页动作控件永久禁用、所有写入被拒（2026-09-22 用户实测反馈）。`dsh-extra-context` 有回归守卫（`test/manifest.test.js`）。
- 只在部分 profile 出现的服务不要放进顶层 `inject`：需随服务出现/替换自动重绑时用 `ctx.inject(['name'], childCtx => ...)`，只做一次性探测才用 `ctx.get('name')`。
- **字节级 base64 必须自实现**（查表法）：宿主 `btoa` 是 `Buffer.from(s,'utf-8')` 实现，会把二进制当 UTF-8 文本二次编码、损坏图片字节（踩过此坑）。
- Cordis 4 没有 `service/ready` 事件；新代码用动态 `ctx.inject` 管理生命周期。
- 所有副作用必须可逆：补丁/路由/disposer 进 `ctx.effect`，事件监听 `ctx.on` 随 fiber 自动移除——保证不侵入 dsh 源码、运行时全可逆、能干净卸载。

### 双面插件（浏览器 UI）

- 包声明 `exports["./client"]`（字符串路径）+ `dsh.client: { platform: 'web' }` → `dsh-client-modules` 的 Node 半体自动把 client bundle 加进 `window.__DSH_BOOT__`，并在它注册的 `prefix /plugins` 路由上按自己广告的 combo URL（`/plugins/??<包名>/client.js&rev=<rev>`）服务，**插件行不用改**；裸 `/plugins/<包名>/client.js` 不在应答表里（未广告路径一律 404）。
- 浏览器 bundle 必须是 `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => {...} })`，factory 里 `var module={exports:{}}; var exports=module.exports;`，最后 `exports.inject=...; exports.apply=...; return module.exports`（照抄任一 `dsh-client-ui-*` 包 `lib/client.js` 的壳）。bundle 是 CJS lazy 模型，`require` 先查平台静态 seed（`react`/`react-dom`/`@deepseek-ai/cordis`/`dsh-client-store`/`dsh-client-ui-slots`/`dsh-client-ui-primitives`/`dsh-client-ui-dockkit` 等 9 个词），再查 boot graph 包名；组件用 `React.createElement`，无 JSX/TS/import。
- 插件对象的 `inject` 是**服务名数组**（如 `['slots']`）；`package.json#dsh.client.inject` 是 bundle 依赖的 client 包名（只 require react 可省略）。
- **自己注入的 `<style>` 必须打 `data-plugin="<包名>"`**（官方 `dsh-client-ui-*` 由构建期 CSS 注入助手代打）。`dsh-client-modules` 在 materialize 时会把当前**所有未打标签**的 style 认领给“下一个 materialize 的 bundle”，而 `dsh-client-hmr` 热更新只删 `style[data-plugin=<id>]`：不打标签的样式表会被记到别的插件名下，于是“别人更新 → 你的样式被删”“你更新 → 旧样式留下”，页面上就是样式不符预期、刷新才恢复。写了标签后按引用计数自清理，并在元素存活但文本过期时重写文本。
- 宿主给浏览器暴露 HTTP：`ctx.webServer.register({ kind: 'exact'|'prefix', path, handler(req,res) })`（node:http）；重复路径会 throw（路由表是组合级契约）；返回 disposer，client 端同源 `fetch` 调用。
- 写凭据用服务 API `credentials.set/unset/describe`：内部 yaml Document 编辑会保留注释、文件 watcher 自动重载，别自己解析 yaml。

### Slot 系统（客户端 UI 落点）

- 全局 Slot：`shell.overlay`（`dsh-client-ui-layout` 声明，`{kind:'list', scope:'root'}`，AppFrame 渲染为绝对定位全屏层，z-index 20，`pointer-events:none`、子元素 auto）——全局弹窗/横幅的落点；`sidebar.footer.action` 可放侧边栏底部按钮。
- 子 Slot 由父 entry 的 `children` 表在运行期声明：注册方必须用 `ctx.slots.inject('<slot>', () => ctx.slots.register({ name: '<slot>', ... }, Component))` 等待声明，不要直接 `register` 或依赖 client bundle 顺序。两者的副作用都归调用方 fiber，随插件卸载清理。
- 注册规则（按 slot 类型）：list slot **必须带 `id`**（否则 apply 抛 `list slot "..." requires options.id`，插件加载失败、浏览器显示 "Failed to load plugins"）；single slot 不需要额外字段；keyed slot 需要 `key`；chain slot 需要 `select`。
- **设置入口一律排在 DSH 自带项之后（用户规则）**：插件贡献的 `settings.section` / `settings.general.item` / `settings.plugins.tab` 的 `order` 都 **≥ 100**。DSH `0.1.7-alpha.1` 内置项：分区 account −10 / general 0 / models 10 / plugins 15 / agent-presets 20（0.1.6 的最大项 `archived-sessions` 25 已被 DSH 删除），通用行 permission −20 / appearance 10 / font-size 11 / transcript-view 12 / performance-usage 13 / link-opening 14 / developer-tools 15 / composer-enter 20 / current-version 100，插件页 tab all 10。同一个 slot 里多个插件不要复用同一档 order（壳层是 `sort((a,b) => a.order - b.order)` 的稳定排序，并列时只能靠注册顺序决胜）；需要固定次序就 100 / 110 / 120 往上排。**升级 DSH 后重新读一遍内置项的 order 上限**，别把插件行插到内置行中间。

### 子代理委派纪律

- 启动前先答清三个问题：交付什么独立结果、影响主流程的哪个具体决策、失败后主流程怎么处理；答不清就不启动。
- 不按插件或目录数机械拆分。要求顺序修改、分别验证、分别提交，且主代理仍须完整读取同一批源码的任务，默认由主代理直接完成；只有高风险私有 ABI 的独立复核、大量互不依赖的检索、能直接解除阻塞的工作才值得委派。
- 委派 prompt 必须写清当前 DSH 版本、准确源码路径、只读/可写边界、预期交付格式和完成标准；禁止“审计这个插件”这类无法验收的宽泛目标。
- 后台子代理不阻塞无关工作，但依据其结果实施或提交前必须收取并复核。失败且无有效输出时按零贡献处理并立即剔除；只有仍存在明确缺口、且新尝试采用不同策略时才重试。
- 子代理不能替代主代理的源码契约核对、工作树审查和真实验证：采用其发现时必须自己定位到源码或测试独立确认，并在结论里说明哪些被采用；失败代理不计入“已审计/已验证”。
- 收尾前核对子代理是否改过共享工作区（`git diff`、测试、提交范围确认归属）；未进入最终实现或验证证据的委派记为无收益，作为后续少开代理的依据。

### 调研路径（新插件立项流程）

1. 先解析 `dsh` 可执行文件的真实路径，再读该安装下 `@deepseek-ai/*` 的 `lib/*.js` 与 README 确认机制；必要时用动态 Cordis 插件原型快速验证（可选）。
2. 落成正式包：入口固定为 `<插件名>/lib/index.js`（宿主半体）+ `client.js`（客户端半体，单文件产物），外加 `install.sh`/`uninstall.sh` + `package.json` + `README.md` + 插件内 `AGENTS.md`。
   - 入口路径是**契约**，不是代码组织上限：宿主其余代码按模块拆到 `lib/<模块>.js`（现例：`dsh-chat-archive-manager/lib/archive-deletion.js`、`dsh-local-plugin-manager/lib/profile-manager.js`）。`lib/index.js` 只留 Cordis 入口/服务注册/HTTP 路由；单文件超过约 400 行，或出现独立事务边界（文件事务、profile 管理、凭据读写）时**按边界拆，不按行数硬拆**——多个能力共享同一套状态时，硬拆只会制造跨文件隐式状态。
   - `client.js` 是**单文件产物**，不是单文件源码：浏览器只按 `dsh-client-modules` 广告的 combo URL 取 bundle（见上文「双面插件」），factory 的 `require` 也只解析 seed 词与 boot graph 包名，相对路径必然抛错。要拆源码必须加构建步骤产出 `client.js`（官方 `dsh-client-ui-*` 即 tsdown 构建）；不引入构建时，在 factory 内用分区与普通函数做逻辑分层。
   - 新增 `lib/*.js` 时必须同步 `package.json#scripts.check` 的 `node --check` 列表，以及（若该插件有）`scripts/check-pack.js` 的期望文件清单。
   - 完整的包还会带 `CHANGELOG.md`（发布时写条目）与 `scripts/check-pack.js` 的精确打包白名单，必要时 `PUBLISHING.md`、机器可读契约文件；`package.json` 必须有 `repository`（provenance 校验要求）、`publishConfig.access: "public"`、`license`、`engines.node`，并绑好 `prepublishOnly → publish:check` 门禁。
3. `./install.sh` 挂载（或直接 `dsh plugin --profile web add dsh-<插件>` 装 registry 版本）→ 需要时请用户重启 → 验证 → 收尾（文档、清理）→ 交付给用户时按「发布与分发」升版本、打 tag、发布并核对。

## 常用操作

```bash
cd ~/Documents/dsh-plugins && ./install-all.sh       # 开发路线：用 link: 挂载全部插件
cd ~/Documents/dsh-plugins && ./uninstall-all.sh     # 卸载全部
cd ~/Documents/dsh-plugins/<插件名> && ./install.sh  # 单个插件（幂等）
cd ~/Documents/dsh-plugins/<插件名> && ./uninstall.sh
node --check <插件名>/lib/*.js                       # 改动宿主代码后逐文件语法检查

dsh plugin --profile web add dsh-extra-context       # 用户路线：装 registry 上的版本
dsh plugin --profile web add dsh-extra-context@0.1.2 # 升级（caret 范围不会自动升）
dsh plugin --profile web remove dsh-extra-context    # 卸载
```

批量脚本扫描一级子目录中的对应脚本，默认使用 `DSH_PROFILE=web`（可被调用方覆盖）；单个插件失败会继续处理其余插件，最后汇总并返回非零退出码。所有卸载脚本都给 pnpm 传 `--config.minimumReleaseAge=0`，避免卸载时 profile 重算被刚发布的其他包卡住；该参数只对当前命令生效，不改持久配置。

若 DSH 因某个插件加载失败而无法启动，可在插件目录外执行官方移除命令：

```bash
dsh plugin --profile web remove <插件名> --config.minimumReleaseAge=0
```

**卸载原则**：官方 bundle 插件只移除 profile 依赖和 bundle 层，运行时补丁必须可逆；不改 dsh 源码与 `@deepseek-ai/*` 包，也不自动删除插件创建的用户数据。

## 文档分工与语言（用户规则）

每个插件的文档固定四类职责，**全部纯中文**（不再维护中英双语）：

| 文档 | 面向谁 | 只写什么 |
|---|---|---|
| `README.md` | 使用者（npm 页面 / GitHub 访客） | 当前功能、要求（含兼容范围）、安装与卸载、使用方法、注意事项与已知边界 |
| `AGENTS.md` | 后续 agent / 维护者 | 技术契约、结构与实现约束、历史沿革与决策理由、踩坑、发布与安装路线 |
| `PUBLISHING.md` | 发布者 | 该插件的发布闸门、打 tag、tarball 隔离验证、发布后抽查；没有就不要新建，除非确有插件专有清单 |
| `CHANGELOG.md` | 历史记录 | 每个版本的变更（含"移除了什么、为什么"） |

- **README 不写沿革、不写决策**：例如"本包由 X 改名而来""曾用 Y 方案已移除""当时是未发布候选"这类内容属于 `AGENTS.md` / `CHANGELOG.md`，不进入 README。
- **写之前先判断必要性**：不写会不会让后人踩坑？不会就不写；一句话能说清就别写一段；别处已解释过的机制只留指向（如指向根 `AGENTS.md`）。
- 安装段固定给官方命令（`dsh plugin --profile web add/remove <包名>`，升级写成 `@<版本>`），源码 `./install.sh` 只作为开发路线一句话带过；并写明安装改变 bundle 列表需要重启 `dsh web`。
- 机器可读的数据文件（如 `dsh-mobile-compat/compatibility.json`）不属于"文档"，保留英文；改它必须同步 `scripts/check-compat.js` 与相关测试。

## 提交规范（用户规则）

- 标题 `<type>(<scope>): <祈使句概括>`。详情最多 **10 行**，只写必要的“为什么/影响面”，每行精炼，不逐文件罗列、不叙述排查与试错过程；一个 commit 只做一件事。
- **禁止自动提交**：agent 不得自行 `git commit`（含“顺手提交”“阶段性收尾提交”）。只有用户明确要求时才执行；不确定就先问一句，并说明待提交的文件范围。
- **一次性授权不构成后续授权**：用户某一轮说“提交”只覆盖**那一轮明确提到的改动**，之后每轮都要重新得到明确指示，不得把历史授权当长期模式（踩过：一次“提交代码”之后，后续几轮都自行提交了）。除非用户明说“以后都自动提交”。
- 未经明确指示，也不得自行执行其他改写历史的 git 操作（`reset`/`rebase`/`amend`/`cherry-pick`/`revert`/打 tag，以及 push/pull）；只读检查（`status`/`diff`/`log`/`show`/`blame`）不受限。
