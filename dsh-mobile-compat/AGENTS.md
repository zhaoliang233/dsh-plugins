# dsh-mobile-compat 技术说明

## 边界

Client 主导、Host 只提供运行版本状态接口、外壳级且版本锁定的 DSH Web 兼容插件。不能修改 DSH 源码、Session、Workspace、Settings 数据或 boot manifest，也不能替换 root、main、rightbar、sidebar 或 settings Slot occupant。

正式包名、`shell.overlay` list entry ID 和 Locale namespace 均为 `dsh-mobile-compat`。

## 兼容发布线策略

`compatibility.json` 是机器可读矩阵，`package.json#dshCompatibility` 必须满足：`policy: "compatible-release-line"`；package 为 `@deepseek-ai/dsh`；range `>=0.1.6-alpha.1 <0.1.7`；verifiedVersions 严格为 `0.1.6-alpha.1`；`futureVersionsRequireCapabilityChecks: true`；matrix 指向 `./compatibility.json`；`engines.dsh` 与 `dshCompatibility.range` 同源。

`0.1.6-alpha.1` 已逐版本读取发布包源码并核对契约。同一 `0.1.6` 发布线内的后续 alpha/beta/rc/正式版允许带警告运行，但版本门、公开能力和精确 DOM 结构探测必须继续 fail closed；跨到 `0.1.7` 之前、或收录低于 `0.1.6-alpha.1` 的版本（本次只 source-verified 了 `0.1.6-alpha.1`），都必须重新读取源码并调整范围，禁止无上界范围或跨发布线猜测。

`scripts/check-compat.js --installed` 比较 `dsh --version`。运行时 Host 从 CLI entry 解析实际 `@deepseek-ai/dsh/package.json` 并在 `GET /dsh-mobile-compat/status` 返回版本；route 先通过 DSH `connection.requestRejection(req)` 的 trusted-host 与签名浏览器 cookie 认证，Client fetch 显式使用 `credentials: 'same-origin'`。Client 只用 `connection.generation.getSnapshot()/subscribe()` 作为连接就绪/重试触发器，release version 始终来自插件状态接口；跨发布线版本必须保持 inert。

## Client 契约

Client hard dependencies `['slots', 'layout', 'locale', 'connection']`；package bundle dependencies `["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-primitives"]`。

UI 只向 `shell.overlay` 注册 additive list entry：`{ name: 'shell.overlay', id: 'dsh-mobile-compat', order: -1000 }`。

公开能力只读取 `connection.generation.getSnapshot()/subscribe()` 并调用 `layout.toggleSidebar()`；两项都必须在激活前完成函数形状检查。不要调用 `layout.closeRightbar()`：它会把 `rightbarShown/rightbarTrack/rightbarFullscreen` 置为 false（桌面右栏宽度偏好本身不被写，但 track 因此派生为 0）；右栏在移动端的处理见「Drawer 行为」。

## 结构 capability

运行时必须先探测 0.1.6-alpha.1 已核对的精确 AppFrame：

1. `[data-shell-overlay]` 的 parent 是 frame；
2. frame 的前四个 host children 是 Sidebar column、Center column、Rightbar column 与 overlay；
3. 三列分别有 direct `sidebar`、`main`、`rightbar` Slot seat；
4. Sidebar seat 有 first occupant；
5. `main` seat 的 occupant 链（0.1.6 为 `main` seat → `main.conversation` Slot anchor → ConversationRoot）经只含单个 element child 的 `display:contents` Slot anchor 下探到 ConversationRoot，其最后一个 direct child 内有 direct `[data-conversation-scroll]`。

通过后才添加 `data-dsh-mobile-shell-compatible`，并在精确 ConversationRoot 上添加 `data-dsh-mobile-conversation-compatible`，再激活 style、viewport、Locale 和 Slot。safe-area top 与 toggle header clearance 只使用该 marker，不再用会误命中 body wrapper 的 `:has(> [data-conversation-scroll])`。

header clearance 必须落在 session-header Slot 内实际 header 元素的**第一行**（`[CONV] > :first-child:not(:last-child) > :first-child > :first-child`）：`renderSlot` anchor 是 `display:contents`，对 anchor 本身设置 padding 无效；给整块 header 加 padding 会把下方的 `对话/轨迹` 标签行一起右推（实测 375px 下推 44px）。header 自身保留原生 gutter，第一行额外 38px 即可得到 ~58px 净空。

悬浮 toggle 保持 44×44 命中盒（`top/left: max(4px/10px, safe-area)`），可视 chip 用 `::after { inset: 4px }` 收成 36px，焦点环也移到 chip 上，因此不会在视觉上压过 header 第一行（chip y8..44 与 y50 起的标签行不重叠，命中盒 y4..48 仍在标签行之上）。结构不符时卸载所有增强、保留原生布局，并输出一次诊断。

Workspace patch 还需验证 `[data-slot=sidebar.workspaces]` 的 WorkspaceBrowser root、header、含 `button[aria-expanded]` 的 search Slot 及其相邻 action cluster，通过后添加 `data-dsh-mobile-workspaces-compatible`。所有 owner、结构和版本映射维护在 `compatibility.json#contracts`。

## Selector 纪律

禁止 CSS Module hash、`window.__DSH_BOOT__`、Conversation snapshot/internal Slot、消息行识别或 Composer DOM 改写。共享 selector 仅限：

- AppFrame：`data-shell-overlay`、`data-sidebar-collapsed`、`data-side`；
- runtime markers：`data-dsh-mobile-shell-compatible`、`data-dsh-mobile-workspaces-compatible`、`data-dsh-mobile-conversation-compatible`；
- Shell seats：`data-slot=sidebar`、`data-slot=main`、`data-slot=rightbar`、`data-slot=sidebar.workspaces` 及版本锁定 direct occupants；
- Conversation 外层：`data-conversation-scroll`、`data-composer-seat`、`data-composer-card`，以及 Composer 的 `[role=textbox][aria-multiline=true]` 可访问语义；
- Settings：`role=dialog`、`aria-modal=true`、direct `nav`。

AppFrame position、SidebarRoot inline width、Workspace header/search/action 和 Settings direct children 都是精确版本结构，不是公共 ABI。

## Drawer 行为

- 打开时 Sidebar column 临时成为有名称的 modal dialog；Conversation 与 Rightbar 加可逆 `inert` 和 `aria-hidden`。
- 焦点进入 Sidebar，Tab/Shift+Tab 保持在 Sidebar，Escape 关闭，cleanup 恢复入口焦点。
- document 中出现任一可见且非 Drawer 自身的 `aria-modal` dialog（含 Settings 和 shell.overlay modal）时，暂停 Drawer dialog semantics 与 Tab/Escape trap，避免 competing modal 冲突。
- 从 mobile query 离开到 DSH narrow 区间（901-1023px）时，若 Drawer 仍开就调用一次 `toggleSidebar()` 清除 `narrowExpanded`；直接进入 >=1024px 时只清理移动端 ARIA/inert/focus trap，不调用 toggle、不改桌面偏好。
- 移动端只把第三列（Rightbar column）的 grid track 置 0，**禁止**对整列设置 `display:none`：0.1.6 的右侧栏面板是该列内的绝对定位浮层（fullscreen 时 `position:fixed; inset:0`，`<768px` 自动全屏），隐藏整列会把已打开的右侧栏压成 0×0，手机上根本显示不出来。
- 触控命中区至少 44x44；Workspace search/action 容器要同步扩展，不能只放大 button。

## 生命周期

所有副作用由一个 `ctx.effect()` 控制器持有：

- Host status 未验证时等待，unsupported 或 status 失败时不激活；`connection.generation` 短暂 undefined 不引发布局闪烁，generation 能力缺失时保持 inert。status 请求由 `AbortController` 管理，重连刷新或卸载时中止前一请求。
- `<style>` 和 viewport patch 有引用计数，最后一个 disposer 恢复；元素必须打 `data-plugin="dsh-mobile-compat"`（未打标签的样式会被别的 bundle 认领、热更新时误删）。`installStyles()` 在元素仍在但文本与当前 `MOBILE_CSS` 不一致时重写它——client HMR 可能留下上一代 bundle 的元素，样式必须描述正在运行的代码。
- overlay layer 带每次激活生成的 `data-dsh-mobile-layer-generation`；激活后下一个动画帧执行 `sweepOrphanLayers()`，把不携带当前 generation 的 `.dmc-layer` 标为 `data-dsh-mobile-orphan`（CSS `display:none !important` + `pointer-events:none !important`）。上一代残留层必须停用：它的悬浮 chip 会盖住 header，旧版全屏 backdrop 会吞掉整页点击（“多了 UI + 部分 UI 失效”的实测形态）。只标记不删除，避免从 React 手里摘掉它仍持有的节点。
- body marker、shell/workspace marker、临时 Sidebar ID、Locale、Slot、MutationObserver、matchMedia listener、keydown listener、inert/ARIA 均可逆；ARIA/inert 使用 compare-and-restore，cleanup 只恢复当前值仍等于插件写入值的属性，不覆盖其他 owner 的后续变更。
- MutationObserver 同时观察 childList 和精确属性白名单（Slot/overlay/composer/ARIA）；仅属性变化也会立即重探测，compatible 退化时清理、恢复后重激活。暂时未挂载的 `pending` 保持 inert，持续 1.5 秒输出一次诊断而不是永久静默。
- Host 半体除只读、no-store 的 `GET /dsh-mobile-compat/status` 外不产生业务副作用；route disposer 必须归当前 Fiber。

## 升级验证

1. 对候选版本读取实际 npm 发布包和本机运行包源码，不以 dist-tag 或相似版本号推断契约。
2. 对比 `connection.generation`、layout Service、AppFrame 三列与 `sidebar`/`main`/`rightbar`/`shell.overlay` Slot、SidebarRoot、WorkspaceBrowser、Settings、Conversation outer attributes、Composer textbox 和 viewport。
3. 同步更新 release-line range、verifiedVersions、`compatibility.json#contracts`、安装脚本、运行时门和文档；同线未逐版本验证的版本继续依赖能力探测。
4. 运行 unit、manifest、installed compatibility、pack checks 和隔离 profile install/remove。
5. 运行 `test/browser-regression.mjs`，覆盖 320x568、390x844、457x707、568x320、844x390、900/901、1023/1024 和 desktop。
6. 人工补测真实 iOS/Android 软键盘、安全区、长会话、代码/媒体、主题和 Locale。
7. 调整兼容范围上界（跨到 `0.1.7`）或下界之前，必须完成以上检查并重新读取源码。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-mobile-compat`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（含 `node scripts/check-compat.js --manifest` 与 `scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-mobile-compat-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。

## 验证命令

```bash
npm run compatibility:check
npm run publish:check
npm run test:browser
./install.sh
```

profile/bundle 组成改变后由用户在自己的 Warp 中重启 `dsh web`。不得停止或替换用户拥有的 `127.0.0.1:3080`；隔离验证使用随机端口并在完成后停止。
