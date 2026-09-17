# dsh-sticky-user-bubble 技术说明

## 边界

纯客户端 DSH 插件。功能全在浏览器侧；Host 半体不提供业务能力，只做 DSH 版本门（从 CLI entry 定位 `@deepseek-ai/dsh` package.json，范围外保持 inert），不能添加路由、改写会话、改写 Workspace 或持久化任何数据。客户端只注册 `shell.overlay` 的新增 entry，不替换核心会话视图、`conversation.session`、消息 renderer 或现有 overlay occupant。

正式包名与 Slot ID 都是 `dsh-sticky-user-bubble`；早期动态原型 `sticky-1` 仅用于演示，不是正式包的依赖。

## Client 服务与 Slot

- `inject: ['slots', 'sessions', 'uiConversation']` 是客户端插件对象的硬依赖声明。
- UI 注册：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sticky-user-bubble', order: 0 }, ...))`。
- `shell.overlay` 是 root-scoped frame-wide additive layer；插件自己的 layer/host 保持 `pointer-events: none`，只有当前固定气泡用 `pointer-events: auto`，不会阻塞会话其余区域。
- root Slot 只有 `useSessions`，没有 `useSession`：组件用 `useSessions(state => state.current)`，再经 `ctx.sessions.binding(currentId).session` 读生命周期快照、经 `ctx.uiConversation.binding(currentId).target('chat')` 读 Chat 目标；两个 observable 都经稳定闭包包装后无条件调用 `React.useSyncExternalStore`。
- `package.json#dsh.client.inject` 必须包含 `@deepseek-ai/dsh-client-ui-chat`，确保 Chat target/node definitions 与当前 bundle 一起可用。

## 快照与消息归组

`buildUserIndex(sessionSnapshot, chatSnapshot)` 只保留自有标量：`sessionSnapshot.sessionId` 等于当前 selected ID；`openState === 'open'` 且 `removed !== true`；独立 `ChatSnapshot.order` 中 `kind` 为 `user`/`steering` 的节点；节点的 `key` 与 `data.content` 文本块。对旧版仍接受嵌套的 `sessionSnapshot.chat`；`0.1.6-alpha.1` 的正式路径是 `uiConversation.binding(currentId).target('chat')`，生命周期 `SessionSnapshot` 与 Chat 数据不混用。

DOM 行只接受核心显式标记：`[data-conversation-scroll]`（scrollport）、`[data-chat-flow]`（聊天 flow）、`data-chat-anchor-key`/`data-chat-flow-key`/`data-chat-flow-kind`（行身份与种类）。遍历 flow 时不把 key 插进 CSS selector，而是逐行读 dataset 与快照索引比对。

- **候选**：最后一个 `user`/`steering` 行的 row top 越过 reading line（`scrollport.top + flow parent 的 computed paddingTop`）后成为候选。**reading line 只决定候选与副本落点，不是可见性门槛**。
- **出现**：副本只在原气泡彻底离开绘制区后出现——`paintedTopBoundary` 以 scrollport 的 clip 边界（`scrollRect.top + borderTopWidth`）为基线，被 source 到 scrollport 之间任何 `overflow-y !== visible` 祖先的 padding box 顶部收窄。`0.1.6-alpha.1` 中两者相差 16px（`[data-conversation-scroll]` 无 padding；内层 `.EvIC1a_scroll` padding-top=16 且在该上下文 `overflow:visible`），用 reading line 作门槛会让副本在原气泡底部约 16px 仍可见时提前出现。pending steering 没有 durable row marker，保持排除。
- **让位**：候选行之后的第一个 `user`/`steering` 行是「下一个卡片」。`collapsedHeight = min(source 高度, 3 × lineHeight + verticalInset)`（真实折叠高度要等 clone 测量后才有）；`gap = clamp(incoming row 的 computed marginTop, MIN_PUSH_GAP=16, MAX_PUSH_GAP=48)`，取不到时用 16。该卡片 row top 一进入 `cloneBottom + gap`，副本整体上移 `push = clamp(gap + cloneBottom - incomingTop, 0, collapsedHeight + gap)`，并以 `clip-path: inset((push - readingInset) 0 0 0)` 在 scrollport 顶边被裁掉——与列表 sticky 标题被下一段顶出同构，但始终保留 `gap` 间距（贴合会被看成同一个卡片块）。`gap = readingInset = 16` 时，卡片刚进入顶部那一帧副本也正好被完全裁掉，因此没有“状态 ready 但什么都看不到”的窗口。`push` 有意不参与 `samePin`：变化时只写一次 `top`/`clipPath` 的 `!important`，不重建也不重新测量 clone（否则每帧抖动）。卡片 row top 越过 reading line 时它自己成为候选且仍可见，副本随即消失——正是让位结束的时刻。
- **展开**（hover/focus）受同一条约束：`expansionRoom = min(availableHeight, max(0, incomingTop - gap - edge))` 是展开高度的**上限**，`naturalCloneGeometry` 仍以折叠高度为下限；`setCloneExpanded` 只在 `expandedHeight > collapsedHeight` 时才真正展开（否则保持三行 ellipsis + `overflow:hidden`），展开后超出部分在气泡内部滚动。所以“卡片很远时全展开 → 卡片逼近”的整个过程里，展开气泡底部始终停在 `incomingTop - gap`，不会盖住卡片。`samePin` 命中时测量循环把新 pin 交给已渲染 clone 的控制器（`cloneStateRef.current.update` → `activePin`，只重算高度上限），上限能随卡片实时收紧；hover/focus 状态另由同一 ref 跨重建保留。
- **限高下界**：`availableHeight` 由 `readingLowerBoundary` 给出——取 scrollport 底边、overlay 底边与 `[data-composer-seat]` 顶部的最小值（再减 16px）。composer 是 scrollport **内部**底部的 sticky 子元素，只按 scrollport 底边限高会让展开的气泡压住输入卡片和它下方的状态栏；找不到或量不到 seat 时退回视口限高（fail open，只是变回旧行为）。

### 参考引用 chip 的文本投影

快照文本是用户原文，但核心 `projectUserText` 会把「空白后紧跟的 `@token` / `/token`」投影成 reference chip：chip 只显示图标加 token 的最后一段路径，原文只保留在 chip 的 `title`。因此 DOM `textContent` 与快照文本不再相等，`elementTextAffinity(element, expected)` 在 plain `textContent` 之外再用 `referenceProjectedText(element)` 重建一次文本：遍历子树，遇到带 `data-ref-chip` 且 `title` 非空的节点就整体替换为 `title`，其余节点保留文本；两层取 `max`，无 chip 时行为完全一致。遍历上限 `MAX_PROJECTION_NODES = 512`，超限返回空串退回 plain 比较（fail closed），绝不拿截断文本参与评分。chip 本身无背景与 padding（`._refChip_` 只有 `display:inline` + margin/color/字重/`white-space`），不会成为竞争候选。

这条匹配路径依赖两个核心 ABI：`data-ref-chip` 与 chip `title`。DSH 改名或不再写 `title` 时，含 `@`/`/` 的用户消息退回 `bubble-not-found`（fail closed），升级时必须重新核对；两者会被 clone 原样保留，固定副本的渲染与原文一致。

## 原生气泡克隆

`0.1.6-alpha.1` 的 bubble 只有 CSS Module class、没有稳定 data marker，用户行也不再保证存在旧版 `data-time-hover-root`。`roundedBackgroundElement(row, expectedText)` 不依赖 hash class：

1. 存在旧版标记时，从权威 row 找 `data-time-hover-root` 作为候选边界；否则直接以权威 row 为边界；
2. 优先接受可测量且文本匹配的 `[data-user-bubble]` / `[data-chat-user-bubble]`；
3. 没有 marker 时，对边界内后代的规范化消息文本、背景色/背景图/border、padding、圆角和面积联合评分，允许透明背景、小圆角与渐变；
4. 最佳与次佳候选分差不足、文本不匹配或没有任何 surface/padding 证据时返回 `null`，绝不克隆整行或猜测布局。

测量结果只在当前 effect 的闭包内短暂持有 source DOM node。clone 写入 React 创建的空 host ref，React 不会再 reconcile host 的 children。clone 会：

- 保留原 bubble 的 CSS class、内部 rich text/reference markup 和主题样式，并向最多 128 个后代复制有边界的 computed 文本/视觉属性，降低祖先选择器失效造成的差异；
- 复制 root 的关键 computed visual properties，覆盖 absolute left/top/width，并把 DOMRect 宽度作为 border-box 总量；transform/animation/position 等上下文属性不复制；
- 先以真实宽度、`height:auto`、`max-height:none`、`visibility:hidden` 挂入 host，用 wrapper 的 `scrollHeight` 得出不受 source 固定 height/min-height 限制的自然内容高度；
- 内容 wrapper 无 padding；优先逐文本节点读 `Range.getClientRects()`，用第四行与第一行起点的实际间距确定三行边界，避免 whole-range 块级聚合矩形和字形 leading 舍入误差；浏览器拿不到行框时退回三倍 computed `line-height`；root 保留原始 padding/背景，避免 Chromium 在底部 padding 中泄露第四行；
- hover/focus 恢复自然完整高度；完整高度超过可用高度（视口或下一张卡片上方空间）时，限制 root 高度、由内容 wrapper 承担内部滚动（`overflow-y:auto`），root 始终 `overflow:hidden`。滚动条因此落在气泡 padding 之内、不压圆角边框，并按核心「卡片内滚动区域」的约定把 `--dsh-scrollbar-thumb`/`-hover` 覆盖为 `l2`（与 composer 卡片一致）。wrapper 只在真正拥有滚动条时把 `pointer-events` 置为 `auto`（`pointer-events:none` 的元素收不到滚轮与滑块拖动），复制来的后代保持 inert，点击照旧冒泡到 clone root；
- 删除 `id`、`for`、`href`、`target`、`tabindex`、`contenteditable`、`accesskey`、`autofocus`、`aria-*`、`data-chat-*` 和 inline event attributes，所有后代保持 `pointer-events:none`；
- clone root 用 `role="button"`、`tabindex="0"`、`pointer-events:auto`，点击或按 `Enter`/空格时按原气泡实时坐标平滑滚动到对应位置。

原节点永远不移动、不隐藏、不修改。

## 测量生命周期

`usePinnedMeasurement` 不用 React state 保存每个滚动位置，而是在一个合并后的 scheduler 中执行：精确 scrollport 的 passive `scroll` listener；观察 scrollport/当前 flow/当前 source bubble 的 `ResizeObserver`；只观察 body subtree childList 的 structure `MutationObserver`（Chat/trajectory 切换、flow 替换、分页，并过滤 clone host 自己的 mutation）；观察当前 source 文本/subtree 与 source→scrollport 最多 12 层祖先 class/style/dir/hidden/theme 的 source `MutationObserver`；观察 documentElement/body 主题属性与 head 中 stylesheet/style 节点/文本/关键属性的 style `MutationObserver`；`document.fonts` 的 `loadingdone`、window resize 与 visual viewport resize（以上走 force 路径）。

普通 scroll 只在 `samePin()` 发现 source identity、节点 key、文本、根样式或几何真实变化时才替换 clone；source 属性、stylesheet/主题、字体加载、window/visualViewport resize 会设 force 标记并重建一次。**ResizeObserver（scrollport/flow/source）只走普通比较、不 force**：流式回答会持续改变 flow 尺寸，每次都 force 会逐 token 重建 clone 并丢掉交互状态；真正的几何变化本来就会被 `samePin` 的 width/height/availableHeight 比较捕获。优先用 `requestAnimationFrame`，没有时用可取消的零延迟 timeout。

clone 的 hover/focus 意图存在 effect 级 `cloneStateRef.current`（`{ update, hovered, focused }`），不随 clone 生命周期消失：`renderPinnedClone` 先读出旧意图、清空状态，成功挂载新 clone 后按旧意图初始化（focus 情况还要把焦点移到新节点，否则 `blur` 永远无法结束展开），`state.update` 继续负责“新 pin 实时收紧展开上限”。因此兼容性重建、切换 clone 都不会让展开态闪断；只有 host 被真正清空（无 clone / 失败态 / 卸载）时意图才归零。`mouseenter`/`mouseleave`/`focus`/`blur` 都同步写回该 ref。

切换 current session 会重建 effect；cleanup 必须移除 listener、断开三个 mutation observer 与 resize observer、取消 frame/timeout、移除 font/viewport listener、清空 `cloneStateRef` 与 clone host。普通测量不写 `scrollTop`，只有用户显式激活固定气泡时才写入目标滚动位置。

## 兼容发布线

范围 DSH `>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 已逐版本验证。同线后续版本可带警告运行，但客户端必须继续通过 Session/Chat snapshot、Slot、核心 DOM 标记和几何自检；跨到 `0.1.7` 前必须重新读取源码和实时契约。Host 版本门、installer 与 manifest 必须同步该范围；`package.json#engines.dsh` 与同一 range 同源，`test/manifest.test.js` 有同源断言守卫。

## 已知限制与升级策略

- 专用 bubble marker 仍是 ABI 首选；没有 marker 的评分 fallback 只在唯一可信时工作，DSH 改变 row/hover-root 结构后可能直接隐藏。
- 含 reference chip 的用户消息只靠 `data-ref-chip` + chip `title` 还原原文；DSH 改名或不再写 `title` 时退回 `bubble-not-found`，不会退化成错误克隆。
- wrapper 无法忠实保留 flex/grid/table root、垂直 writing-mode、root transform、非 1 zoom、Shadow DOM、canvas 或依赖关键伪元素生成内容的气泡；当前分别 fail closed 或不支持。
- 第三方 `!important` 若主动覆盖 clone 关键样式，宽度/高度自检只能发现一部分冲突；host 的 `data-dsh-sticky-user-bubble-state` 记录 `inactive-*`、`missing-*`、`bubble-not-found`、`unsupported-*`、`*-mismatch`、`ready` 等非视觉原因。
- CSSOM `insertRule()` 等完全不产生 DOM、font、resize 事件的静默修改不会立即 force；下一次滚动仍会比较 root computed visual signature，但仅改后代样式且 root 不变时可能继续保留旧 clone。
- 纯图片用户消息没有文本 bubble 时不显示文字副本；轨迹/其他非 chat view 没有 `[data-chat-flow]` 时隐藏。
- 保留核心“加载更早”按钮和手动分页，不自动调用 `SessionFace.loadOlder()`；prepend 完成后由 snapshot、MutationObserver 和 ResizeObserver 自动重新测量。
- 可见性边界依赖 source 到 scrollport 之间祖先的 computed `overflow-y`/`overflow` 与 `borderTopWidth`：若 DSH 把裁剪或滚动放进新的中间层（或让内层聊天容器重新成为 scroller），上文的 16px 差值随之变化，升级时必须重新核对这两个元素的真实 overflow 与 padding。
- 阅读区下界依赖 composer 位置，核对点：`ConversationRoot` 的 `composerSeat` 仍带 `data-composer-seat`、仍是 `scrollBody` 的直接子元素且 `position:sticky; bottom:0`；DSH 改名或移动 composer 后限高退回视口，展开的气泡会重新压住输入卡片与状态栏。
- 让位距离与展开上限都按折叠高度和下一个 durable 行的位置推算：按「让位」的排除规则，pending submission echo 与 pending steering 不会成为「下一个卡片」，它们短暂经过顶部时仍可能被副本遮挡。展开窗口只剩 `gap` 级空间时 hover 不再展开（避免退化成极窄的内部滚动窗口）；要读全文时向上滚一点让卡片离开即可恢复。
- DSH 升级后必须重新确认 `uiConversation` 的 Chat target、ChatSnapshot 节点结构、row marker、`data-time-hover-root`（如仍存在）、专用 bubble marker、`data-composer-seat`、root display/writing-mode、computed style、line rect 和 Slot contract，再声明兼容。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-sticky-user-bubble`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-sticky-user-bubble-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。

## 验证

```bash
npm run publish:check
./install.sh
```

安装后检查 `dsh web --dump-config` 的 bundle graph 是否包含 `dsh-sticky-user-bubble`。Host 入口或 profile/package 组成改变需要用户在 Warp 中重启 `dsh web`；客户端 bundle 改变后刷新页面，除非已确认 client-plugin watcher 正在运行。

GUI 验证覆盖：顶部初始隐藏、下滚/上滚切换、点击/键盘跳回原消息、原气泡（含底部内边距与圆角）完全离开可视区后才出现副本、让位时保留消息间距且新卡片不被遮挡、长内容 hover/focus 展开的高度上限随下一个卡片收紧（超出部分内部滚动、空间过小时保持三行）、展开高度不越过 composer（输入卡片与底部状态栏保持可见）、流式回答/工具调用持续更新时展开状态不闪断、三行 ellipsis 与第四行完全隐藏、不同 font-size/line-height/padding/border、透明/渐变/小圆角、固定 height/min-height、主题与字体变化、窄屏、会话和 Chat/trajectory 切换、历史 prepend、含 `@` 引用 chip 的用户消息、unsupported layout fail closed，以及 clone 内部控件不可触发且不阻塞 composer。
