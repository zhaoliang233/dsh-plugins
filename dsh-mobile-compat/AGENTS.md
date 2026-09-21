# dsh-mobile-compat 技术说明

## 边界

Client 主导、Host 只提供运行版本状态接口、外壳级且版本锁定的 DSH Web 兼容插件。不能修改 DSH 源码、Session、Workspace、Settings 数据或 boot manifest，也不能替换 root、main、rightbar、sidebar 或 settings Slot occupant。

正式包名、`shell.overlay` list entry ID 和 Locale namespace 均为 `dsh-mobile-compat`。

## 兼容发布线策略

`compatibility.json` 是机器可读矩阵，`package.json#dshCompatibility` 必须满足：`policy: "compatible-release-line"`；package 为 `@deepseek-ai/dsh`；range `>=0.1.6-alpha.1 <0.1.7`；verifiedVersions 严格为 `0.1.6-alpha.1`、`0.1.6-alpha.2`；`futureVersionsRequireCapabilityChecks: true`；matrix 指向 `./compatibility.json`；`engines.dsh` 与 `dshCompatibility.range` 同源。

`0.1.6-alpha.1` 与 `0.1.6-alpha.2` 已逐版本核对：把两个版本**全部 51 个 `dsh-client-*` 发布包**按文件哈希逐文件比对，只有 `dsh-client-ui-agent-preset`（hero chip 的 seat store）与 `dsh-client-ui-cordis`（会话选择器改为按视图）不同，本插件依赖的 layout/sidebar/sidebar-right/conversation/workspace/settings 产物逐字节相同。同一 `0.1.6` 发布线内的后续 alpha/beta/rc/正式版允许带警告运行，但版本门、公开能力和精确 DOM 结构探测必须继续 fail closed；跨到 `0.1.7` 之前、或收录低于 `0.1.6-alpha.1` 的版本，都必须重新读取源码并调整范围，禁止无上界范围或跨发布线猜测。

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
5. `main` seat 的 occupant 链（0.1.6 为 `main` seat → `main.conversation` Slot anchor → ConversationRoot）经只含单个 element child 的 `display:contents` Slot anchor 下探到 ConversationRoot，其最后一个 direct child 内有 direct `[data-conversation-scroll]`。**第 5 条是可选的**：main seat 也可以承载非会话页面 —— 点侧栏「插件」进入的 plugin manager 就是一个 `SECTION.X_2TxG_page` —— 那时只缺少 conversation 级标记，shell 级适配必须照常工作。

1–4 满足即添加 `data-dsh-mobile-shell-compatible` 并激活 style、viewport、Locale 和 Slot；第 5 条也成立时才把 `data-dsh-mobile-conversation-compatible` 加到 ConversationRoot 上（会话页消失时移除该标记，shell 级适配不停）。把第 5 条当成必需要会踩坑：进入 plugin manager 时探测判 pending → 插件整个退场 → 手机上退回 DSH 桌面三列（280px 侧栏 + 110px 内容列），实测就是这个形态被用户报出来。结构 1–4 不符时卸载所有增强、保留原生布局，并输出一次诊断。

header clearance 必须落在 session-header Slot 内实际 header 元素的**第一行**（`[CONV] > :first-child:not(:last-child) > :first-child > :first-child`）：`renderSlot` anchor 是 `display:contents`，对 anchor 本身设置 padding 无效；给整块 header 加 padding 会把下方的 `对话/轨迹` 标签行一起右推（实测 375px 下推 44px）。header 自身保留原生 gutter，第一行额外 38px 即可得到 ~58px 净空。

悬浮 toggle 保持 44×44 命中盒，但**可视部分必须读作 DSH 自己的标题栏控件**：28×28 的 `::after` 圆角 28px 裸底（无边框/底色/阴影，仅 `hover` 时填 `--dsw-alias-interactive-bg-hover`）、图标 15px、墨色 `--dsw-alias-label-secondary`，位置 `top: 10px`（会话 header 第一行）与 `left: 12px`（命中盒 12..56，其中 28×28 可视框落在 20..48，与手机 header 自身的 20px 左留白、标题栏第一个元素同一条竖线）。图标用与右栏入口**同一个 token**（`IconPanelLeftOutline16`）并由 primitives 的 `size: 15` 声明尺寸，不用 CSS 覆盖宽度。**对齐判据是墨迹**：实测（320/390/457/568/578/844 一致）右侧 `[data-sidebar-right-expand]` 的 44px 盒距右边 12px、其 15px 图标墨迹距右边 26.5px；两个 SVG 在 15px 盒内都是满幅墨迹，所以可视框位置就是墨迹位置，`left: 12px` 才与右侧镜像（曾按「可视框距边 12px」写成 `left: 4px`，盒子对齐了但墨迹差 4px，用户一眼看出不齐）。`getBoundingClientRect` 量的是盒，量墨迹要栅格化 SVG。抽屉打开时入口隐藏：抽屉标题行右侧 DSH 自带的「收起侧边栏」就是关闭入口，避免两个关闭键。结构不符时卸载所有增强、保留原生布局，并输出一次诊断。

### 会话标题栏 strip

**只在移动媒体查询内安装**（`window.matchMedia(MOBILE_QUERY)`；进出断点都要重新 sync）。包装节点是一个没有样式的 `<div>`，一旦在宽屏 pointer 视口里装上去，它就把标题与操作簇从一行折成两行——PC 端必须完全保持 DSH 原生 header。回归断言：桌面视口下不存在 `[data-dsh-mobile-title-strip]`，且 `titleCluster` 高度 ≤30px（单行）。

手机上 `[class*='titleRow'] [class*='titleCluster']` 的子节点（`nav.crumbs`、`div.headerActions`）被搬进一个 `[data-dsh-mobile-title-strip]` 包装节点，包装节点**插在原第一个子节点的位置**，`headerUtilities` / `headerCorner` 两个兄弟保持原样：

- CSS：`height: 28px`（与 header 第一行等高，整行仍 44px，标题栏不增高）、`flex: 1 1 auto; min-width: 0`、`overflow-x: auto; overflow-y: hidden`、`flex-wrap: nowrap`、`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`、`touch-action: pan-x`。滑块必须隐藏且**不占布局**（回归断言 `offsetHeight - clientHeight === 0`）。
- 拖动由 JS 提供（`scrollTitleStrip()`）：pointerdown/move/up/cancel，位移超过 6px 才判定轴向，只有 x 轴且未到边界时才写 `scrollLeft` 并 `setPointerCapture`；边界外的手势让给 DSH 自己的滑动。手势结束后 350ms 内吞掉一次 click，避免拖完误触底下的按钮。
- 注册与移除监听器必须使用**同一组选项值**（`{ passive: true }` / `{ passive: false }` / `{ capture: true }`）：`removeEventListener` 只比较 capture 语义，传 `true` 当第三参无法移除 `{ passive: true }` 注册的监听器。
- `installTitleStrip()` 在 mutation 后判断「子节点是否全部在 strip 内」，不满足就 dispose 再重新收纳（标题栏 owner 会重建/追加子节点）；disposer 把子节点按原位置还原并 `wrapper.remove()`，插件停用后不留残余 DOM。顺序是先清 `disposeStrip` 再重新挂，避免同一个 wrapper 被 dispose 两次。
- 标题节点（`wSkVaW_crumbCurrent` 一类）会把自己左移到负坐标来显示末尾，因此判断控件是否可达必须用 `左侧边界 - maxScroll .. 右侧边界 + maxScroll`，只看右边界会误判。

### 设置页（手机）

手机上把 DSH 的设置弹窗改造成全屏单列：`width: 100vw / height: 100dvh`、直角、`flex-direction: column`；导航标题视觉隐藏、tabs 变成一条可横向滚动的 chips 行；关闭键与导航按钮 44px 起；内容区加安全区 padding 并自己滚动。DSH 自己不给设置页做移动适配（实测禁用插件样式后仍是 800px、`flex-direction: row` 的桌面弹窗）。

**行序是插件重排的**：DSH 的 DOM 是 `dialog > nav(标题+tabs)` + `dialog > div(操作行「打开配置文件/关闭」+ 滚动内容)`，而手机上要的是「操作行 → tabs → 内容」。做法是把内容容器 `display: contents` 折叠，让它那两个子项直接成为 dialog 的列项，再用 `order`（操作行 1 / nav 2 / 滚动内容 3）排出来；纯 CSS，无 DOM 突变。**折进去的容器自身没有盒子**（0×0），所以宽度、可滚动性这类断言必须落在滚动内容上，不是那个容器。桌面用 `@media` 排除在外（回归断言 1280px 下仍是 800px 宽、`row`、容器未被折叠）。

**操作行内部**：`header` 是 `space-between`，但「打开配置文件」在自己的 flex 行里、被 DSH 用一个很大的 `margin-left` 推到右侧，所以那条行要显式 `margin-left: 0` 才会落到左端（右侧留给关闭键）。那个次级动作是 `header > .actions > div > button`（**不是 header 的直接子**）——选择器写 `> :first-child > :first-child button`；它的 44px 会被触控下限撑得和关闭键一样重，这里显式收回 DSH 原生的 28px 高 + 12px 字，并用 `::after` 补 44px 靶区。

### Composer、附件条与开关

44px 命中下限只对**字形按钮**生效：`[data-composer-card]` / `[data-conversation-scroll]` / shell 首列 / `aria-modal` dialog 四处规则，以及 `[data-composer-seat]` 规则，都带 `:not(:is([role='group'], [role='group'] *, [role='switch']))`。两类控件是**固定形状**，撑大即破形，因此一并豁免：

- 待发送附件条（composer 里唯一的 `role=group`）：DSH 自己已为触屏适配它（coarse-pointer 媒体查询把 18px 删除键设为常显、缩略图 64px、箭头 24px），一刀切放大就会把删除键顶成一块盖住照片的 44px 方块；
- 开关（primitives 的 `Switch` 渲染成 `button[role=switch]`，DSH 自己的 `Switch.module.css` 是 36×20 胶囊 + 16px thumb）：`min-width/min-height: 44px` 会把它压成正方形方块、圆点被挤出原位（用户实测报过「设置页开关变成这样」）。

两者的命中区用 `::after` 不可见 44px 靶区实现，视觉尺寸保持原生；开关在原样式里本就是 `position: relative`，靶区直接锚在胶囊上。回归里真实粘贴一张图片挂载附件条（断言条内不出现 44px、操作行仍 ≥44px），并在内实例的 plugin manager 页断言每个 `[role='switch']` 仍 <44px 且靶区恰为 44×44。

Workspace patch 还需验证 `[data-slot=sidebar.workspaces]` 的 WorkspaceBrowser root、header、含 `button[aria-expanded]` 的 search Slot 及其相邻 action cluster，通过后添加 `data-dsh-mobile-workspaces-compatible`。所有 owner、结构和版本映射维护在 `compatibility.json#contracts`。

## Selector 纪律

禁止 CSS Module hash、`window.__DSH_BOOT__`、Conversation snapshot/internal Slot、消息行识别或 Composer DOM 改写。共享 selector 仅限：

- AppFrame：`data-shell-overlay`、`data-sidebar-collapsed`、`data-side`；
- runtime markers：`data-dsh-mobile-shell-compatible`、`data-dsh-mobile-workspaces-compatible`、`data-dsh-mobile-conversation-compatible`；
- Shell seats：`data-slot=sidebar`、`data-slot=main`、`data-slot=rightbar`、`data-slot=sidebar.workspaces` 及版本锁定 direct occupants；
- 右栏 dockkit 面板（0.1.6 内唯一宿主）：`data-sidebar-right-panel`、`data-sidebar-right-open`、`data-sidebar-right-toggle`、`data-sidebar-right-expand`、`data-dockkit-strip`、`data-dockkit-strip-chrome`（回归断言另外读 `data-dockkit-tab-close`）；pane body 没有 data 属性，只能按 class 后缀 `[class*='paneBody']` 锚定（不匹配时静默回落到原生渲染）；
- Conversation 外层：`data-conversation-scroll`、`data-composer-seat`、`data-composer-card`，以及 Composer 的 `[role=textbox][aria-multiline=true]` 可访问语义；
- Settings：`role=dialog`、`aria-modal=true`、direct `nav`。

AppFrame position、SidebarRoot inline width、Workspace header/search/action 和 Settings direct children 都是精确版本结构，不是公共 ABI。

## Drawer 行为

- 打开时 Sidebar column 临时成为有名称的 modal dialog；Conversation 与 Rightbar 加可逆 `inert` 和 `aria-hidden`。
- 焦点进入 Sidebar，Tab/Shift+Tab 保持在 Sidebar，Escape 关闭，cleanup 恢复入口焦点。
- document 中出现任一可见且非 Drawer 自身的 `aria-modal` dialog（含 Settings 和 shell.overlay modal）时，暂停 Drawer dialog semantics 与 Tab/Escape trap，避免 competing modal 冲突。
- 从 mobile query 离开到 DSH narrow 区间（901-1023px）时，若 Drawer 仍开就调用一次 `toggleSidebar()` 清除 `narrowExpanded`；直接进入 >=1024px 时只清理移动端 ARIA/inert/focus trap，不调用 toggle、不改桌面偏好。
- 移动端只把第三列（Rightbar column）的 grid track 置 0，**禁止**对整列设置 `display:none`：0.1.6 的右侧栏面板是该列内的绝对定位浮层（fullscreen 时 `position:fixed; inset:0`，`<768px` 自动全屏），隐藏整列会把已打开的右侧栏压成 0×0，手机上根本显示不出来。
- 触控命中区至少 44x44；Workspace search/action 容器要同步扩展，不能只放大 button。唯一的例外是**绝对定位在 pill 内部的 tab 控件**，见下节。
- 侧栏里任何**导航离开当前页**的点击都要让抽屉自己收起来（抽屉是全屏表面，不收就等于把刚打开的页面盖住）。两条判据共用一个 `collapse()`，带 400ms 冷却窗——否则一次同时命中两条的点击会 toggle 两次、把抽屉又打开：
  1. **点击导航行本身**：`[class*='newSession']`（新会话）、`[class*='panelRow']`（对话/插件面板行）、`[class*='sessionRow']`（会话行）。会话行是工作区下的 `role=treeitem` **div**，而**两个会话之间切换会复用同一个 conversation occupant、main seat 的 childList 不变**，所以"只看 seat"永远抓不到它（用户报的「点工作区的对话没反应」就是这个）；点击目标是行内 button 时（行自己的「…」菜单，锚在行上的浮层）不收起。
  2. **main seat 的 childList 变化**：覆盖"点击后不替换被点行、而是换 seat"的路径（例如在会话里新建会话）。

  实测七类（真实触摸、每类独立加载页面）：会话行（普通/当前选中/另一条）✓ 收起、新会话 ✓ 收起、面板行 ✓ 收起、行内「操作」按钮 ✗ 不动、点「工作区」标题 ✗ 不动。回归断言：点「插件」行后、点会话行（选中态与未选中态各一次）后 `data-sidebar-collapsed` 必须变 true。

## 右栏 dockkit strip 的 44px 边界

0.1.6 的右侧栏是 dockkit 面板，44px 命中盒**只给 strip 级控件**：`[data-dockkit-strip] > button`（新建标签、分屏）与 `[data-dockkit-strip] [data-dockkit-strip-chrome] button`（面板 chrome 的全屏 / 收起），并把 strip 与 chrome 容器同步撑到 44px（`[data-dockkit-strip]{min-height:44px}` 覆盖 dockkit 自己的 `height:28px`，容器与按钮一起长高才不会互相盖住）。

**tab 内部的按钮一律保持 DSH 原生尺寸**：`data-dockkit-tab-close` 是 `position:absolute; top:4px; right:4px` 的 20×20，放大到 44px 会保持绝对锚点、把图标相对 pill **向左下各推 12px**（实测图标中心从距 tab 顶 14px 变成 26px、距右 14px 变成 26px，页面上的形态就是「关闭图标漂移到 pill 左下角」）。tab 的上下文菜单同样渲染在 tab 内部，放大按钮会破坏菜单行高。CSS 因此不能用 `[data-dockkit-strip] button` 这种后代万能选择器。

chrome 图标不再单独放大（曾写成 18px）：DSH 的 `iconButton` 是 28px 盒 + 15px 图标，撑到 44px 盒后仍保持 15px，才与 shell.overlay 的抽屉入口（同样 44px 盒 + 15px 图标）一致。

回归断言（390×844，打开一个真实文件 tab）：关闭键仍 20×20 且 `absolute; top:4px; right:4px`、相对 tab 偏移仍是 `top:4 / right:4`、图标居中于控件（≤0.6px）、每个 strip 级控件 ≥44×44、chrome 图标为 15px。

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
