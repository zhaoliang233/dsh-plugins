# dsh-mobile-compat

一个面向 DeepSeek Harness Web 的版本锁定移动端兼容插件。插件不替换 DSH 的 root、Workspace、Conversation、Sidebar、Rightbar 或 Settings occupant，而是在经过验证的 npm 发布版本上添加可逆的外壳级适配。

## 功能

- 将手机视口下的三栏 Shell 重排为全宽 Conversation，并把 Sidebar 变成带遮罩的抽屉。
- 让 SidebarRoot 填满抽屉，修复 Workspace 搜索和操作区在触控布局下被裁切的问题。
- 在 `shell.overlay` 添加 44px Sidebar 入口；抽屉内所有增强命中区至少为 44px。
- 每次激活都会停用上一代插件遗留的悬浮层（标记 `data-dsh-mobile-orphan` 后隐藏并停止接收点击），并让样式表与当前运行的 bundle 保持一致：页面长时间打开、反复热更新后不会留下多余的入口或点不动的遮挡层。
- 抽屉打开时将焦点移入 Sidebar，隔离被覆盖的 Conversation/Rightbar，双向约束 Tab，支持 Escape，并在关闭后恢复入口焦点；其他 modal 出现时暂停抽屉 trap。
- 把 Settings 两列弹窗重排为 `100dvh` 全屏界面，Section 导航改为横向滚动标签。
- 缩小 Conversation/Composer 横向留白，约束代码和媒体溢出；0.1.6-alpha.1 的 Composer 文本编辑器字号至少为 16px。
- 可逆地补充 `viewport-fit=cover`，并使用 `dvh`、安全区和 reduced-motion 能力。
- 移动端把右侧栏（Rightbar）保留为零宽 grid 轨道，并让它的原生浮层在其中显示（`<768px` 自动 `position:fixed; inset:0` 全屏）：不再对整列 `display:none`，因此手机上的右侧栏仍可打开；也不调用 `layout.closeRightbar()`，不会清空用户的桌面右侧栏宽度偏好。

## DSH 兼容范围

机器可读策略位于 `compatibility.json`，`package.json#dshCompatibility` 指向该矩阵：

- 兼容发布线：`>=0.1.6-alpha.1 <0.1.7`
- 已逐版本验证：`0.1.6-alpha.1`
- 同线后续 alpha/beta/rc/正式版允许带警告运行，并继续由公开能力和精确 DOM 结构检查 fail closed。
- 跨到 `0.1.7`、低于 `0.1.6-alpha.1` 或落在其他发布线时拒绝运行，必须重新读取源码、更新契约后再调整范围。

版本号只是第一层门。安装前 `scripts/check-compat.js --installed` 校验 `dsh --version`；Host 半体从当前 CLI entry 向上解析实际安装的 `@deepseek-ai/dsh/package.json`，通过 `GET /dsh-mobile-compat/status` 提供真实运行版本。状态接口先通过 DSH trusted-host 与签名浏览器 cookie 认证，Client 显式携带 same-origin credentials。Client 以 `connection.generation.getSnapshot()/subscribe()` 作为连接就绪与重试触发器，再读取状态接口，并要求 `layout.toggleSidebar()`。任一能力、状态接口或结构探测失败时都不会安装 CSS、viewport 修改或 Slot entry。

## 结构 fail-closed

DSH 的 CSS Module 类名和部分 DOM 结构不是公共 ABI。本插件不使用 CSS Module hash，也不读取或改写 `window.__DSH_BOOT__`。

运行时会先验证 0.1.6-alpha.1 已核对的 AppFrame 关系：Sidebar、Center（Conversation）、Rightbar、overlay 必须是预期的前四个 host children，三列分别包含 `sidebar`、`main`、`rightbar` Slot seat；`main` seat 的 occupant 链（0.1.6 为 `main` seat → `main.conversation` Slot anchor → ConversationRoot）经单 element child 的 `display:contents` Slot anchor 下探到 ConversationRoot，其最后一个 direct child 包含 direct `[data-conversation-scroll]`。验证通过后才添加 shell marker，并在精确 ConversationRoot 添加 `data-dsh-mobile-conversation-compatible`；safe-area 与 header toggle clearance 只作用于该 root。悬浮 toggle 的净空只加在 header 的**第一行**上（375px 实测：`对话/轨迹` 标签行不再被右推，恢复完整 44px），toggle 本身保持 44×44 命中盒、可视化 chip 收成 36px。MutationObserver 同时观察挂载和结构属性变化，退化时立即清理、恢复后重新激活，持续未完成挂载会输出一次延迟诊断。

Workspace header 的私有关系单独验证并使用 `data-dsh-mobile-workspaces-compatible` 标记。机器可读的 owner、版本、结构预期和 browser assertion 位于 `compatibility.json#contracts`。

插件使用的外层能力包括：

- `connection.generation.getSnapshot()/subscribe()`；
- `layout.toggleSidebar()`；
- `shell.overlay` additive list Slot；
- `data-shell-overlay`、`data-sidebar-collapsed`、`data-side`；
- `[data-slot='sidebar']`、`[data-slot='main']`、`[data-slot='rightbar']`、`[data-slot='sidebar.workspaces']` 及已验证的 direct occupants；
- `data-conversation-scroll`、`data-composer-seat`、`data-composer-card` 和 Composer 的 `[role='textbox'][aria-multiline='true']`；
- Settings 的 `role="dialog"`、`aria-modal="true"` 和 direct `nav` 结构。

## 浏览器范围

移动布局在以下条件启用：

- viewport 宽度不超过 720px；或
- coarse pointer 且 viewport 宽度不超过 900px，用于手机横屏。

目标浏览器需要支持 `:has()`；建议最低 iOS Safari 15.4 或同等能力的 Chromium。真实软键盘、非零 notch 安全区和不同 WebView 的行为仍应在逐版本验证或扩大兼容发布线时做实机复核，Chromium emulation 不能替代这部分证据。

## 安装与卸载

```bash
cd ~/Documents/dsh-plugins/dsh-mobile-compat
./install.sh
```

安装脚本先检查当前 DSH 版本与 `web` profile，再运行完整发布门禁，最后使用官方 profile manager：

```bash
dsh plugin --profile web add "link:$PWD" --config.minimumReleaseAge=0
```

它不会直接修改用户 profile 的 `cordis.patch.yml`。若 bundle/profile 组成发生变化，需要由用户在自己的终端中重启 `dsh web`，再刷新页面。

卸载：

```bash
./uninstall.sh
```

卸载只移除 profile 依赖和 bundle 层，不修改 DSH 源码、会话、Workspace 或用户设置。Client 停止时会恢复 viewport、移除样式、marker、Locale、观察器、焦点隔离和 Slot entry。ARIA/inert 采用 compare-and-restore：只有当前属性仍等于插件写入值时才恢复，避免覆盖其他 owner 在抽屉打开期间的后续变更。

## 验证

```bash
npm run compatibility:check
npm run check
npm test
npm run pack:check
npm run publish:check
```

仓库还包含 Node 22、零额外依赖的 CDP 浏览器回归。两个 URL 都必须显式提供，并应指向临时 DSH Home 的随机端口 server 和隔离 Chrome；脚本不再默认连接用户的 3080 GUI：

```bash
DSH_MOBILE_DEVTOOLS=http://127.0.0.1:9333 \
DSH_MOBILE_SMOKE_URL=http://127.0.0.1:<isolated-port>/ \
DSH_MOBILE_SMOKE_PREFIX=/tmp/dsh-mobile-compat \
npm run test:browser
```

浏览器套件检查 320x568、390x844、457x707、568x320、844x390、900/901px、1023/1024px 和桌面布局，包括 Sidebar/SidebarRoot 同宽、横屏 Settings 可达、Workspace controls/search、命名 modal、competing modal 隔离、Tab/Shift+Tab wrap、Escape/焦点恢复、compare-and-restore、直接 mobile→desktop 偏好保持、Settings、Composer 字号、断点恢复和 console/network diagnostics。发布前还应人工覆盖长会话、长代码/媒体、主题、中文/英文、真实软键盘和安全区。

## 已知边界

- 这是外壳级兼容层，不会把 DSH 私有 DOM 变成公共 ABI。
- 手机（`<768px`）上右侧栏沿用 DSH 原生全屏浮层；768–900px 的粗指针设备上它覆盖在 Conversation 之上，而不是把中间栏挤窄。
- Settings 内各插件自己的复杂 Section 仍需自行保证内容响应式。
- 320px 下模型名称的完整可识别展示属于 Composer 所有者，不能在本插件中安全修补私有 DOM。
- 当公开能力、结构契约或发布线上界改变时，正确行为是 fail closed、重新验证并发布新插件版本，而不是自动猜测兼容。

## License

MIT
