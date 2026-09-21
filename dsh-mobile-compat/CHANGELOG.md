# 变更记录

本文件记录本项目的所有重要变更。

## [0.3.7] - 2026-09-20

### 修复

- **PC 端 header 被折成两行**：标题栏 strip 是手机专用改写，但 `installTitleStrip()` 原先无条件执行——宽屏下也会把 titleCluster 的子节点搬进一个没有样式的包装 div，标题与操作簇因此从一行折成两行（实测 `titleCluster` 高度 50px；禁用插件 CSS 后依然如此，说明是 DOM 重排而非样式）。现在只在移动媒体查询内安装，并监听断点变化：离开区间立即还原 DSH 原生 header，重新进入再挂。
- **点侧栏后抽屉不收起**：侧栏里的「新会话」、面板行「对话」/「插件」、**工作区下的会话行**都会导航离开当前页，而抽屉是全屏表面，不收就等于把刚打开的页面盖住。现在直接识别被点的导航行（`[class*='newSession']` / `[class*='panelRow']` / `[class*='sessionRow']`），行内自己的「…」菜单按钮不收起；另以 main seat 的内容替换作为兜底。两条判据共用一个入口并带 400ms 冷却窗，避免同一次点击 toggle 两次又把抽屉打开。会话行必须走"识别点击"这条路：会话行是 `role=treeitem` 的 div，而**两个会话之间切换会复用同一个会话容器、主区域 DOM 并不替换**——只观察主区域变化永远抓不到它（这正是"点工作区的对话没反应"的原因）。实测：普通/当前选中/另一条会话行 ✓、新会话 ✓、面板行 ✓ 收起，行内「操作」按钮 ✗、点「工作区」标题 ✗ 不动。
- **设置页开关被压成方块**：44px 命中下限把 primitives 的开关（`button[role=switch]`，DSH 原样式是 36×20 胶囊 + 16px thumb）撑成 44×44 正方形，圆点被挤出原位。现在五处下限规则一律排除 `[role='switch']`，开关保持原生形状并改用 `::after` 不可见 44×44 靶区（与原样式自带的 `position: relative` 对齐）。
- **点侧栏「插件」后移动端适配整体消失**：结构探测把「main seat 必须下探到 ConversationRoot」当成硬条件，而 plugin manager 会在同一个 seat 里渲染一个 `SECTION`，于是探测判 pending、插件退场，手机上退回 DSH 桌面三列（280px 侧栏 + 110px 内容列，标题被压成竖排）。现在 shell 级适配只要求前三列与 sidebar occupant（以及 overlay 位置），ConversationRoot 只决定是否给会话加 `data-dsh-mobile-conversation-compatible`；离开会话页时该标记被移除，回到会话时下一次探测补回。
- **右栏标签页的关闭图标漂移**：44px 命中盒原先写成 `[data-dockkit-strip] button`，把 strip 里**所有**按钮都放大；tab 的关闭键是 `position:absolute; top:4px; right:4px` 的 20×20，被撑到 44×44 后绝对锚点不变，图标相对 pill 向左下各漂 12px（实物形态就是关闭图标掉到 pill 左下角）。现在只有 strip 级控件（新建标签、分屏）与面板 chrome 的按钮吃 44px，tab 内部控件保持 DSH 原生尺寸。
- 同一个选择器收紧顺带修掉 tab 上下文菜单被放大：菜单项渲染在 tab 内部，原先也被顶成 44×44，破坏菜单行高。

### 变更

- 手机设置页的行序改成「操作行（打开配置文件 / 关闭）在上 → 菜单 tabs 在中 → 内容在下」，并把操作行拆到两端：次级动作「打开配置文件」回到左端（DSH 原本用一个很大的 `margin-left` 把它和关闭键一起推到右边），并收回 DSH 原生的紧凑尺寸（28px 高 / 12px 字；44px 触控下限曾把它撑得和关闭键一样重），命中区改用 `::after` 44px 不可见靶区；关闭键留在右端 44px。桌面不受影响（1280px 下仍是 800px 宽、`row`、容器未折叠）。
- 右栏面板 chrome 的图标回到 DSH 原生 15px（曾被 `[class*='stripChrome'] svg` 写成 18px，与同样 44px 盒 + 15px 图标的抽屉入口不一致）。
- dockkit 的 strip / chrome 选择器由 class 后缀改为 dockkit 自带属性 `data-dockkit-strip` / `data-dockkit-strip-chrome`；pane body 没有 data 属性，仍按 `[class*='paneBody']` 锚定，不匹配时静默回落到原生渲染。
- 三处各自手写的「微任务合并器」抽成 `coalesce()`；CSS 的两条媒体查询改为插值 `MOBILE_QUERY`，消除 JS/CSS 同源漂移。
- `compatibility.json#contracts` 的 `right-panel-chrome` 条款同步到真实结构（strip / chrome 有 data 属性，只有 pane body 走 class 后缀）。

### 内部清理

改动均为行为等价，且每条都先在隔离实例或宿主源码里取证（下文括号内为判据）。

- 四条永不生效的 CSS：嵌套 `titleRow` 规则（实测命中 0）、`conversation.session.header.actions` / `.utilities` 两个 Slot 兜底（锚点恒为 `display:contents`、0×0 盒，flex 系声明无效）、`.dmc-layer { display: block }`（禁用插件样式后仍是 block，即 div 默认值）、`.dmc-sidebar-toggle svg { display: block }`（父级是 flex，子项本就被 blockify——实测声明 `inline` 后 computed 仍是 block）。
- 两处已失效的兼容属性：`-ms-overflow-style`（Trident 专属）与 4 处 `-webkit-overflow-scrolling`（iOS 13+ 忽略；`CSS.supports()` 在当前引擎对两者都返回 false），滚动条的隐藏由 `scrollbar-width` 与 `::-webkit-scrollbar` 承担。
- 无消费方的死代码：CSS 变量 `--dmc-mobile-edge`、overlay 层上的 `data-dsh-mobile-controls` 属性、`style.dataset.owner`（宿主与 HMR 只读 `data-plugin`），以及 `rightPanelOpen()` 里在 0.1.6 恒不成立的第二段判断（open 标记只写在面板元素上，toggle 恒定不带）。
- 测试侧：重复的对象键 `inner`（被同对象后一个 `inner` 覆盖）、只写不读的 `panelClosed`、同一表达式连算两遍的 rail filter、harness 导出的 `context` / `document` / `invalidNode`。
- 过期注释与文档：header 预留注释里的 `36px / x50 / x54` 改为 `28px / x48 / x56`；`AGENTS.md` 的 selector 白名单改成代码真正引用的集合；`PUBLISHING.md` 的 tag 示例补上「换成本次发布的版本」；`CHANGELOG` 末尾孤立的 `## [0.3.2]` 空标题补上正文丢失说明。

### 测试

- 浏览器回归新增：桌面视口（1024px）不得安装标题 strip——`[data-dsh-mobile-title-strip]` 必须不存在、`titleCluster` 高度 ≤30px（单行）；点侧栏「插件」面板行后、以及点会话行（选中态与未选中态各一次）后 `data-sidebar-collapsed` 必须自动变 true。
- 单元测试新增「标题栏 strip 只在手机区间安装」用例（进出断点装卸、卸载后子节点还原），并让测试夹具具备真实 DOM 语义：`appendChild`/`insertBefore` 会移动已有父节点的节点，`matches()` 支持 `[class*='…']` 与 `[attr]`，元素支持事件监听。
- 浏览器回归新增右栏 strip 断言（390×844，真实打开一个文件标签页）：关闭键仍是 20×20 且锚点 `absolute; top:4px; right:4px`、相对 tab 偏移仍是 `top:4 / right:4`、图标居中于控件（≤0.6px）、每个 strip 级控件 ≥44×44、chrome 图标 15px。
- manifest 测试新增版本常量守卫：`DSH_RELEASE_LINE` 与 `DSH_MINIMUM_ALPHA` 必须仍能推出 `dshCompatibility.range` 的上下界，避免跨发布线时只改一处而门禁全绿。
- 浏览器回归新增「非会话页」断言（点侧栏「插件」进入 plugin manager）：body / shell 标记与样式表必须保留、conversation 标记必须移除、grid 必须是 `0px <视口>px 0px`、内容列不被压缩、抽屉入口仍在，且该页每个 `[role='switch']` 仍 <44px 并带 44×44 靶区；随后回到会话，断言 conversation 标记在下一次探测后回来。
- manifest 测试新增「44px 下限不碰固定形状控件」守卫：五处下限规则都必须排除 `role=group` 与 `role=switch`，且源码里存在 `[role='switch']::after` 靶区。
- 单元测试新增「main seat 承载非会话页面时保留 shell 级适配」用例（含会话回来后标记补上）。
- 标题栏 strip 的可达性断言收窄到「strip 自己排布的控件」：`nav.crumbs` 内部被 DSH 自己的 `overflow: hidden` 裁掉的按钮在桌面上同样不可见（实测 320px + 带子代理入口的会话触发，改动前的 HEAD 版本同样失败），不再计入失败条件，报告里另留 `controlsNestedInCrumbs` 作为观测值。

## [0.3.6] - 2026-09-19

> 说明：0.3.3–0.3.6 的实现与文档曾在开发过程中被一次错误的 git 操作从工作区覆盖，本版是**按设计记录重建**的版本，并逐条重新验证（21 个单元测试、完整浏览器回归、隔离实例实测）。

### 变更

- 抽屉入口与右栏入口统一为**同一款图标 token**（`IconPanelLeftOutline16`）并由 primitives 的 `size` 声明尺寸（15，与原生控件同值），不再由 CSS 覆盖宽度。canvas 栅格化实测两侧墨迹 `15×14.06`、内缩 0、同一 y，距各自边缘均为 **26.5px**。
- 手机会话标题栏把标题与两侧操作簇（任务 / 日程 / 智能体预设 / 终端、模式、智能体团队、更多菜单）一起放进**一条可横向滑动的 strip**：高度锁 28px（整行仍 44px，标题栏不增高）、`overflow-x: auto`、滑块隐藏且不占布局、`touch-action: pan-x`；拖动由 pointer 事件驱动，手势结束吞掉随后的 click，避免拖完误触。实测 320px 可滚 82px、390px 可滚 12px，拖动确实改变 `scrollLeft` 且手势后 click 被吞。
- 手机抽屉改为**全屏**（`width: 100%`），与右栏在 <768px 自动全屏的形态一致；>720px 的粗指针大屏仍保留抽屉宽度。

### 修复

- **点左侧入口却打开了右侧栏**：`[data-sidebar-right-toggle]` 是 DSH 的对称 toggle，面板原本关着时盲点一下会把它**打开**，而面板在手机上是 `z-index:40` 全屏浮层，会立刻盖住正要打开的抽屉。现在只在面板确实打开时才去点它；打开抽屉的顺序改为先 `toggleSidebar()` 再收起面板，避免面板收起带来的 `narrowExpanded=false` 把刚开的抽屉关掉。
- **抽屉底部漏出对话界面**：抽屉列、`[data-slot='sidebar']`、SidebarRoot 三层钉上 `min-height: 100%`，修掉「844px 视口下抽屉只有 820px、下方 24px 仍可点」的形态。
- **Composer 附件预览被撑坏（删除图片图标巨大无比）**：44px 命中下限原先一刀切到 Composer 内所有按钮，把待发送附件缩略图上的删除键从 DSH 自己的 **18×18** 顶成 44×44（在 64px 缩略图上是一块盖住照片的方块），滚动箭头也被顶大。DSH 已为触屏适配过这块：`@media (pointer: coarse)` 里把删除键设为常显、尺寸**故意保持 18px**。现在 44px 下限按结构排除附件条（composer 里唯一的 `role=group`），条内小圆钮改用 `::after` 不可见 44px 指针靶区；实测五档手机视口 `rail 64×64 / 18×18`、操作行仍 `44×44`。
- **左右两侧导航图标不对称**：修前实测插件入口 44px 命中盒在 `x 20..64`、原生右栏入口在 `x 334..378`（按盒子差 8px，按墨迹差 4px）。现在入口可视框落在手机 header 自身的 20px 左留白（28×28 可视框 20..48），图标回到原生 15px；六档宽度（320/390/457/568/578/844）实测两侧墨迹完全一致。

### 兼容性

- 收录 `0.1.6-alpha.2` 为第二个 source-verified 版本：该版本全部 51 个 `dsh-client-*` 发布包按文件哈希与 `0.1.6-alpha.1` 逐文件比对，只有 `dsh-client-ui-agent-preset`（hero chip seat store）与 `dsh-client-ui-cordis`（会话选择器改为按视图）不同，本插件依赖的 layout / sidebar / sidebar-right / conversation / workspace / settings 产物逐字节相同。兼容发布线仍是 `>=0.1.6-alpha.1 <0.1.7`。

### 测试

- 浏览器回归新增四组判据：标题 strip（存在性、28px 高度、整行 44px、`overflow-x: auto`、隐藏滑块不占布局、控件都在可滚动范围内、真实 pointer 拖动生效且吞掉手势 click）；导航图标对称（两侧墨迹距各自边缘之差 ≤1.5px、图标同为 15×15、同一行同色）；附件条（真实粘贴图片挂载附件条，断言条内不出现 44px、Composer 操作行仍 ≥44px）；抽屉全屏与面板交接（全屏宽高、下方无可达元素、面板打开时点入口后抽屉可见且面板关闭、面板关闭时点入口不得打开面板、Escape 关闭后焦点回到入口）。
- `scripts/check-pack.js` 同时接受 npm 10 的数组输出与新版 npm 的对象输出，并把 npm 警告挡在 JSON 之外；测试改用 `fileURLToPath`，修掉 `url.pathname` 在 Windows 上生成 `C:\C:\...` 的失效路径。

## [0.3.2] - 2026-09-17

> 该版本的正文在 2026-09-19 的 git 事故中丢失，见 0.3.6 条目的说明。
