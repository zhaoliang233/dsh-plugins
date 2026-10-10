# dsh-sticky-user-bubble 技术说明

## 边界

纯客户端 DSH 插件。功能全在浏览器侧；Host 半体不提供业务能力，只做 DSH 版本门（从 CLI entry 定位 `@deepseek-ai/dsh` package.json，范围外保持 inert），不能添加路由、改写会话、改写 Workspace 或持久化任何数据。客户端只注册 `shell.overlay` 的新增 entry，不替换核心会话视图、`conversation.session`、消息 renderer 或现有 overlay occupant。

正式包名与 Slot ID 都是 `dsh-sticky-user-bubble`；早期动态原型 `sticky-1` 仅用于演示，不是正式包的依赖。

**版本门只盖得住 Host 半体，盖不住浏览器半体**：`dsh-client-modules` 的启动图是按 profile 的 bundle 列表逐个读 `package.json#dsh.client` 拼出来的（`processOne()` 只过滤「有没有 fiber / 是否 `disabled`」，**不看 `apply()` 是否真的注册了东西**），所以 Host 半体走 inert 分支时客户端 bundle 照样进 `window.__DSH_BOOT__` 并运行。2026-10-01 用隔离副本实测：把 Host 半体换成「一律 `supported:false` + 只打警告」的桩后，页面里 `[data-dsh-sticky-user-bubble-layer]`/`-host`/clone 依然存在、`state=ready`。**因此「范围外保持 inert（零副作用）」这条工作区规则对本插件只覆盖 Host 半体**；范围外真正的兜底是客户端自己的能力检查（找不到核心标记就 fail closed 隐藏），以及用户必须先从 profile 里移除本插件。

## Client 服务与 Slot

- `inject: ['slots', 'sessions', 'uiConversation']` 是客户端插件对象的硬依赖声明。
- UI 注册：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-sticky-user-bubble', order: 0 }, ...))`。
- `shell.overlay` 是 root-scoped frame-wide additive layer；插件自己的 layer/host 保持 `pointer-events: none`，只有当前固定气泡用 `pointer-events: auto`，不会阻塞会话其余区域。
- root Slot 只有 `useSessions`，没有 `useSession`：组件用 `useSessions(currentSessionIdOf)` 取当前会话 id，再经 `ctx.sessions.binding(currentId).session` 读生命周期快照、经 `ctx.uiConversation.binding(currentId).target('chat')` 读 Chat 目标；两个 observable 都经稳定闭包包装后无条件调用 `React.useSyncExternalStore`。
- **当前会话 id 的取法是跨 alpha 的双路径**（`currentSessionIdOf`）：`0.1.6-alpha.1` 的 `SessionListState` 有 `current: SessionId | undefined`；`0.1.6-alpha.2` 删掉了它（连同 `currentAddress`），导航改由视图持有关系表达，壳层自己的取法是 `Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id`（`dsh-client-ui-layout` 的 `DocumentTitle`、`dsh-client-ui-cordis` 的当前会话行、`dsh-client-ui-settings-general` 都这么写）。插件按 `current` → `retainedBy.mainView` 的顺序解析，两者都取不到时返回 `undefined`、组件保持 inert。**别再写回单一来源**：alpha.2 上只会得到 `undefined`，表现为状态永远停在 `inactive-snapshot`、气泡一次都不显示（本轮实测踩到）。
- `package.json#dsh.client.inject` 必须包含 `@deepseek-ai/dsh-client-ui-chat`，确保 Chat target/node definitions 与当前 bundle 一起可用。

## 快照与消息归组

`buildUserIndex(sessionSnapshot, chatSnapshot)` 只保留自有标量：`sessionSnapshot.sessionId` 等于当前 selected ID；`openState === 'open'` 且 `removed !== true`；独立 `ChatSnapshot.order` 中 `kind` 为 `user`/`steering` 的节点；节点的 `key` 与 `data.content` 文本块。对旧版仍接受嵌套的 `sessionSnapshot.chat`；`0.1.6-alpha.1` 的正式路径是 `uiConversation.binding(currentId).target('chat')`，生命周期 `SessionSnapshot` 与 Chat 数据不混用。

DOM 行只接受核心显式标记：`[data-conversation-scroll]`（scrollport）、`[data-chat-flow]`（聊天 flow）、`data-chat-anchor-key`/`data-chat-flow-key`/`data-chat-flow-kind`（行身份与种类）。遍历 flow 时不把 key 插进 CSS selector，而是逐行读 dataset 与快照索引比对。

- **候选**：最后一个 `user`/`steering` 行的 row top 越过 reading line（`scrollport.top + flow parent 的 computed paddingTop`）后成为候选。**reading line 只决定候选与副本落点，不是可见性门槛**。
- **出现**：副本只在原气泡彻底离开绘制区后出现——`paintedTopBoundary` 以 scrollport 的 clip 边界（`scrollRect.top + borderTopWidth`）为基线，被 source 到 scrollport 之间任何 `overflow-y !== visible` 祖先的 padding box 顶部收窄。`0.1.6-alpha.1` 中两者相差 16px（`[data-conversation-scroll]` 无 padding；内层 `.EvIC1a_scroll` padding-top=16 且在该上下文 `overflow:visible`），用 reading line 作门槛会让副本在原气泡底部约 16px 仍可见时提前出现。pending steering 没有 durable row marker，保持排除。
- **让位**：候选行之后的第一个 `user`/`steering` 行是「下一个卡片」。`collapsedHeight = min(source 高度, 3 × lineHeight + verticalInset)`（真实折叠高度要等 clone 测量后才有）；`gap = clamp(incoming row 的 computed marginTop, MIN_PUSH_GAP=16, MAX_PUSH_GAP=48)`，取不到时用 16（**0.2.0 线起核心默认 flow gap 已降到 6px，实测取到的是 `MIN_PUSH_GAP` 下限 16，不再是行自己的 margin**；数值结果不变，见「兼容发布线」的差异第 1 条）。该卡片 row top 一进入 `cloneBottom + gap`，副本整体上移 `push = clamp(gap + cloneBottom - incomingTop, 0, collapsedHeight + gap)`，并以 `clip-path: inset((push - readingInset) 0 0 0)` 在 scrollport 顶边被裁掉——与列表 sticky 标题被下一段顶出同构，但始终保留 `gap` 间距（贴合会被看成同一个卡片块）。`gap = readingInset = 16` 时，卡片刚进入顶部那一帧副本也正好被完全裁掉，因此没有“状态 ready 但什么都看不到”的窗口。`push` 有意不参与 `samePin`：变化时只写一次 `top`/`clipPath` 的 `!important`，不重建也不重新测量 clone（否则每帧抖动）。卡片 row top 越过 reading line 时它自己成为候选且仍可见，副本随即消失——正是让位结束的时刻。
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

范围 DSH `>=0.2.1-alpha.2 <0.2.2`，其中 `0.2.1-alpha.2` 已逐版本核对（静态契约 + 单测 + 隔离宿主上的半离线几何量测）；**视觉观感仍需实机确认**。同线后续版本可带警告运行，但客户端必须继续通过 Session/Chat snapshot、Slot、核心 DOM 标记和几何自检；跨到 `0.2.2` 前必须重新读取源码和实时契约。Host 版本门、installer 与 manifest 必须同步该范围；`package.json#engines.dsh` 与同一 range 同源，`test/manifest.test.js` 有同源断言守卫（range 反推发布线与下界、`install.sh` 的五个常量、`install.sh` 验证清单逐字断言）。版本门从 `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` 派生，`install.sh` 有一份含 `prerelease_rank()` 的等价 shell 版——下界是 prerelease 时，同线内更低 channel 或更小序列号必须靠 channel 优先级比较挡住，旧的 `channel !== 'alpha' || seq >= N` 写法只表达「下界是 alpha」，换界后会静默放行。

`0.2.0-rc.2 → 0.2.1-alpha.2` 的逐项核对结果（隔离宿主 `DSH_HOME=/tmp/dsh-sub-021/home`、`dsh web --port 0 --no-open`（实际 50952）、headless Chrome 155/CDP 9371，视口 1512×813，目标会话 `f8e6ec6b`）：**活 DOM 里 4350 行 / 53 个 user 行 / 492 个 `[data-chat-flow]`，与 0.2.0-rc.2 逐数相同**，标记计数逐个相同（`data-chat-anchor-key` 4350、`data-chat-flow-key` 3143、`data-chat-node-key` 2652、`data-chat-group-part` 1279、`data-chat-paging-anchor` 3089、`data-composer-seat` 1、`data-conversation-scroll` 1；`data-time-hover-root`/`data-user-bubble`/`data-chat-user-bubble`/`data-ref-chip` 仍为 0，气泡仍走评分 fallback）。`[data-conversation-scroll]` 仍是 `wSkVaW_scrollBody`（padding/border 0、`rect.top 76`）；`.EvIC1a_scroll` 仍 `padding:16px 32px`、该上下文 `overflow:visible` → `readingInset` 16px；`[data-composer-seat]` 仍是 scrollBody 直接子元素、`position:sticky; bottom:0`（top **684.5**）；`shell.overlay` 层仍 `z-index:20 / pointer-events:none / absolute / inset:0`（layout 包单独比对：`.overlayLayer` 规则逐字相同，只多了 `shell.bottom` 槽与字族变量）。**六个几何常量全部重新量出且与 0.2.0 线一致**（见下节量测记录），控制台 0 error。

`dsh-client-ui-chat` 的逐行 diff 分类（`npm pack` 两版 + 17 段内联 CSS 按哈希前缀规范化后比对）：`lib/client.js` 行差 11.5k，去掉搬移后新增内容只有三类——① **CSS 4 个模块有改动，且没有值级几何变化**（`EvIC1a`：flow-gap 选择器从 `.column>` 放宽为 `:is(.column,[data-slot="conversation.chat.flow"])>`（值仍是 `var(--dsh-chat-flow-gap,6px)`）、新增 `.turnSpacer{height:0}` 与 `[data-chat-motion]` 的 `transition:margin-top .16s`；`O_Ebla` 只加两条同样的 motion 规则；`lcKema` 把 `[data-disclosure-row]` 换成 `[data-disclosure-header]`；`bOPqQW`（StatsPills）把 root 的盒模型/字号规则挪到 `.anchor`）；② **类名表**：18 个模块里只有 ChatView 多一个 `turnSpacer`、StatsPills 删掉 `root`，其余逐字相同（“类名表大面积变化”的表象其实来自 `css$N`/`tagId$N` 编号位移）；③ **JS**：新增 `flow-motion.js`（233 行）/`ChatFlow.js`（77）/`ReasoningContent.js`（26）、`nodes.bottomSource(key)`（`EMPTY_BOTTOM_SOURCE` 是它的空实现）、`TurnProcessViewEntry.collapsed`，以及打包依赖升级（`@tanstack/virtual-core` 3.17.7→3.17.8、`@tanstack/react-virtual` 3.14.9→3.14.10、`@deepseek-ai/dsh-util-values` 新进包体）。**本线内没有发现破坏性变化**，业务代码一字未改，改动只有版本门、`package.json` 的 range/engines/清单、测试守卫与四份文档。

**两条 0.2.1 的新结构（本轮已记录，未改代码）**：

1. **行容器多了一层**：`[data-slot="conversation.chat.flow"]`（类名为空、`display:contents` 语义、静态高度 0）现在是行的直接父元素，`.EvIC1a_column` 是它的父。插件取到的 flow 仍是 `.EvIC1a_column`（`[data-chat-flow]` 计数 492 不变），`readingInset` 取 `flow.parentElement`（`.EvIC1a_scroll`）仍 16px，`visibleFlow()` 与 `paintedTopBoundary` 的语义不变——chat CSS 里那些 `:is(.column,[data-slot="…flow"])>` 的放宽就是为它做的，以后核对 flow 结构要连这条一起看。
2. **新增 `[data-chat-turn-spacer]`（`EvIC1a_turnSpacer`，静态 `height:0`）与 opt-in 折行动画**：`[data-chat-motion]` 只在「turn 运行中 / 刚结束的 motionTail / 有 pending 输入」时挂到 flow 上（静态会话实测计数 0），折叠中的行会被写 `height`/`margin-top`/`opacity` 过渡、被移除的高度记到 spacer 上、并按需把 `overflowAnchor` 置 `none`。插件只在滚动/RO/rAF 触发时重算 `incomingTop`，而折叠期间 flow 总高被 spacer 顶住（RO 可能不触发）→ 理论上存在 ≤240ms 的陈旧 `push`；**本轮脚本化量测是静态回放，覆盖不到这一瞬**，需在真机 GUI 上按「回答结束后收起工作步骤 / 下次有新消息时收起」两个设置各看一遍。

`0.1.7-rc.2 → 0.2.0-rc.2` 的逐项核对结果（隔离宿主 `DSH_HOME=/tmp/dsh-020-home`、端口 5931、headless Chrome 153/CDP 9361，目标会话仍是 `f8e6ec6b`）：**活 DOM 里 4350 行 / 53 个 user 行 / 主 flow 内 492 个 `[data-chat-flow]`，与 0.1.7-rc.2 逐数相同**。行标记齐全：53 个 user 行的 `data-chat-anchor-key`/`data-chat-flow-key`/`data-chat-node-key` **三键同值 53/53**，`data-chat-group-part` 仍只出现在 assistant-step 拆分行（1279 行，值 `reasoning`/`response`）；三键不等的 2486 行全部是 `kind` 为空的过程分组包装行或 assistant-step 行，都不进 `userIndex`。`[data-conversation-scroll]` 仍是 `wSkVaW_scrollBody`（`overflow-y:auto`、padding/border 0、`rect.top 76`），内层 `.EvIC1a_scroll` 的 CSS 规则与 0.1.7-rc.2 **逐字相同**（`padding:16px calc(var(--dsh-composer-side-clearance) + 16px)`、该上下文 `overflow:visible`）→ `readingInset` 仍 16px；`[data-composer-seat]` 仍是 scrollBody 直接子元素、`position:sticky; bottom:0`（实测 top 684.5~685）；`.overlayLayer[data-shell-overlay]` 仍是 `absolute / z-index:20 / pointer-events:none / inset:0`，`[data-slot="shell.overlay"]` 是它的子元素（`display:contents`），插件 layer 的父链不变；绘制边界祖先链与 0.1.7 逐字同构（`Sixlwa_userStack → userRow → 空 div → EvIC1a_flowItem → EvIC1a_column → EvIC1a_scroll → EvIC1a_root`(`overflow:visible clip`) `→ EvIC1a_frame → 空 div → wSkVaW_viewArea → 空 div → wSkVaW_scrollBody`），裁剪祖先的顶边都在 scrollport 之上，边界仍是 76。`visibleFlow()` 取文档序第一个可测量 flow 的语义仍取到主 flow（第 0 个 flow = 4350 行；其余 491 个是 `O_Ebla_content` 折叠过程组，高度 0、不可测量）；副本与原气泡的文本、宽度、左边界逐字相等（实测 201.31 / 1085.42）。**本线内没有发现破坏性变化**，业务代码一字未改，改动只有版本门、`package.json` 的 range/engines/清单、测试守卫与文档。

**两条与 0.1.7 的差异（都不改变行为，但都要记下来）**：

1. **核心默认 flow gap 由 16px 降到 6px**：chat CSS 从 `margin-top:var(--dsh-chat-flow-gap,16px)` 变成 `…,6px)`（`--dsh-chat-flow-gap` 只在特定上下文被写成 12px/16px），实测 53 个 user 行的 computed `margin-top` 是 52×6px + 1×0px。让位清距实测**仍是恒 16px**，但来源从「下一行自己的 margin」变成 `MIN_PUSH_GAP` 下限（`clamp(6,16,48) = 16`）。**`gap === readingInset === 16` 这个巧合仍成立**，所以「卡片刚进入顶部那一帧副本也正好被完全裁掉、没有 ready 却什么都看不见的窗口」的行为不变——实测 push 上限 102 = 折叠高 86 + gap 16，`clip-path` 到 82，下一帧（卡片 row top 越过阅读线 92）翻成 `inactive-source-visible` 并清空 host。
2. 亚像素与内容层面的差异只有两处：composer seat 顶 **684.5**（0.1.7 记的是 685，视口同为 1512×813），以及会话总高 70510px（0.1.7 是 72521px，会话内容变化，与契约无关）。**六个几何常量的数值本身全线一致**，逐条对照见下节的量测记录。

`0.1.7-alpha.1 → 0.1.7-rc.2` 的逐项核对结果（历史，该线已不再是本版本的兼容范围）：`ChatSnapshot` 与 `nodes.get(key)` 未变（本次会话的活 DOM 有 4350 行，`user` 53 行的 `data-chat-anchor-key`/`data-chat-flow-key`/`data-chat-node-key` 三键同值、`data-chat-group-part` 为 `undefined`，所以 `userIndex` 的 key 匹配仍成立；`data-chat-group-part` 只出现在 assistant-step 的 reasoning/response 拆分行上）；`data-chat-flow`/`data-chat-anchor-key`/`data-chat-flow-kind`/`data-chat-node-key`/`data-chat-paging-anchor` 全部仍在（chat 包的 `data-*` 属性集与 alpha.1 逐字相同，无增无删）；`[data-conversation-scroll]`（`.scrollBody`，仍 `overflow-y:auto`、padding/border 为 0）与 `[data-composer-seat]`（仍是 `scrollBody` 直接子元素、active 相位仍 `position:sticky; bottom:0`）未变，内层 `.EvIC1a_scroll` 在该上下文仍 `overflow:visible`、padding 仍 16px（实测 `readingInset = 16px`）；`shell.overlay` 仍是 `{kind:'list', scope:'root'}`，层仍是 `z-index:20; pointer-events:none; position:absolute; inset:0`，插件 layer 的父链仍是 `[data-slot="shell.overlay"] > .overlayLayer[data-shell-overlay]`；`SessionListState` 仍走 `retainedBy.mainView`（`dsh-client-ui-layout` 那行一字未改）；`data-ref-chip` + chip `title` 的渲染代码与 alpha.1 逐字相同（本会话无 `@` 引用消息，未取到活体样本）。**本线内没有发现破坏性变化**；`current` 兼容分支保留是为了同一份代码能在 0.1.6 线上跑。

rc.2 里两处与几何相关的新事实：`.EvIC1a_root` 从无 overflow 变成 `overflow:visible clip`，于是 source 与 scrollport 之间多了一个纵向裁剪祖先；它不影响判定，因为该祖先滚动后位于 scrollport 顶边之上，`paintedTopBoundary` 的 `max` 保留 scrollport 自己的 clip 边（实测边界 76 = `scrollRect.top`，阅读线 92 = 76 + 16，出现阈值正好落在 76）。`test/client.test.js` 新增一条 `overflow-y: clip` 祖先的用例锁住这个语义。另一处是过程分组让内层 `[data-chat-flow]` 变多（实测 492 个），`visibleFlow()` 取文档序第一个可测量 flow 的写法仍取到主 flow（4350 行）——这条语义以后升级仍要复核。对话包新增 `data-conversation-region`/`data-conversation-session`/`data-window-drag`（本插件不读；`data-conversation-session` 是将来可用的更强当前会话标记），ConversationRoot 的渲染结构与 CSS 逐字未变；chat CSS 另有两处与几何无关的变化（`.EvIC1a_toBottomSlot` 改成 absolute/sticky 双形态、`.EvIC1a_callRow` 与「加载更早」按钮改用 `var(--dsw-radius-sm)`）。

`0.1.6-alpha.2 → 0.1.7-alpha.1` 的逐项核对结果：`ChatSnapshot` 骨架仍是 `{ order, nodes, locations, navigation, timeline, legacy }`、`nodes.get(key)` 仍返回含 `kind`/`data.content` 的节点（种类 `user`/`steering` 未变，新增 `turn-trigger`）、`uiConversation.binding(id).target('chat')` 仍返回 `{ getSnapshot, subscribe }`、`SessionSnapshot` 仍带 `sessionId`/`openState`/`removed`、聊天行仍带 `data-chat-flow`/`data-chat-flow-key`/`data-chat-flow-kind`/`data-chat-anchor-key`（另新增 `data-chat-node-key`、`data-chat-group-part`、`data-chat-paging-anchor`）、`[data-conversation-scroll]`（`.scrollBody`，内层聊天容器在该上下文里 `overflow:visible`、padding 仍 16px）与 `[data-composer-seat]`（`scrollBody` 直接子元素、`position:sticky`）仍在、`shell.overlay` 仍是 `{kind:'list', scope:'root'}` 且层仍是 `z-index:20; pointer-events:none; position:absolute; inset:0`、`retainedBy.mainView` 仍是壳层自己的当前会话判定口径（`current` 那条路在 0.1.6 线上才有效）、`data-ref-chip` + chip `title` 仍由 primitives 渲染。**本线内没有发现破坏性变化**，`current` 兼容分支保留是为了同一份代码能在 0.1.6 线上跑。

`0.1.6-alpha.1 → 0.1.6-alpha.2` 的逐项核对结果：`ChatSnapshot` 仍是 `{ order, nodes, locations, navigation, timeline, legacy }`（`order` 为 key 数组、`nodes.get(key)` 返回含 `kind`/`data.content` 的节点）、`uiConversation.binding(id).target('chat')` 仍返回 `{ getSnapshot, subscribe }`、`SessionSnapshot` 仍带 `sessionId`/`openState`/`removed`、聊天行仍带 `data-chat-flow`/`data-chat-flow-key`/`data-chat-flow-kind`/`data-chat-anchor-key`、`[data-conversation-scroll]` 与 `[data-composer-seat]`（`scrollBody` 直接子元素、`position:sticky`）仍在、flow 内层 padding 仍是 16px。**唯一破坏性变化是 `SessionListState` 丢掉 `current`/`currentAddress`**（`SessionSnapshot` 另删了 `queue`，本插件不读它）。

## 已知限制与升级策略

- 专用 bubble marker 仍是 ABI 首选；没有 marker 的评分 fallback 只在唯一可信时工作，DSH 改变 row/hover-root 结构后可能直接隐藏。
- 含 reference chip 的用户消息只靠 `data-ref-chip` + chip `title` 还原原文；DSH 改名或不再写 `title` 时退回 `bubble-not-found`，不会退化成错误克隆。
- wrapper 无法忠实保留 flex/grid/table root、垂直 writing-mode、root transform、非 1 zoom、Shadow DOM、canvas 或依赖关键伪元素生成内容的气泡；当前分别 fail closed 或不支持。
- 第三方 `!important` 若主动覆盖 clone 关键样式，宽度/高度自检只能发现一部分冲突；host 的 `data-dsh-sticky-user-bubble-state` 记录 `inactive-*`、`missing-*`、`bubble-not-found`、`unsupported-*`、`*-mismatch`、`ready` 等非视觉原因。
- CSSOM `insertRule()` 等完全不产生 DOM、font、resize 事件的静默修改不会立即 force；下一次滚动仍会比较 root computed visual signature，但仅改后代样式且 root 不变时可能继续保留旧 clone。
- 纯图片用户消息没有文本 bubble 时不显示文字副本；轨迹/其他非 chat view 没有 `[data-chat-flow]` 时隐藏。
- 保留核心“加载更早”按钮和手动分页，不自动调用 `SessionFace.loadOlder()`；prepend 完成后由 snapshot、MutationObserver 和 ResizeObserver 自动重新测量。
- 可见性边界依赖 source 到 scrollport 之间祖先的 computed `overflow-y`/`overflow` 与 `borderTopWidth`：若 DSH 把裁剪或滚动放进新的中间层（或让内层聊天容器重新成为 scroller），上文的 16px 差值随之变化，升级时必须重新核对这两个元素的真实 overflow 与 padding（`0.2.0-rc.2` 已复核：`.EvIC1a_scroll` 的 CSS 与 0.1.7 逐字相同，padding-top 仍 16px、该上下文仍 `overflow:visible`；`0.2.1-alpha.2` 复核同结论——该 CSS 模块规范化后与 0.2.0 逐字相同，实测 padding-top 16px、`overflow:visible`）。
- **折行动画期间的陈旧几何（`0.2.1` 新增的系统，本轮未改代码）**：`[data-chat-motion]` 挂在 flow 上时，被折叠的行会走 `height`/`margin-top` 过渡（≤240ms），插件只在滚动/RO/rAF 触发时重算 `incomingTop`，而折叠期间 flow 总高由 `[data-chat-turn-spacer]` 顶着（RO 可能不触发）——理论上存在「副本让位位置短暂停在旧值」的窗口。折叠的是助理/过程行、不涉及用户行本身，且宿主的滚动位置由 `overflowAnchor` 与 spacer 保住；要确认观感需在 3080 上按设置→通用的「工作步骤收起时机」（回答结束后 / 下次有新消息时）各看一遍。
- 阅读区下界依赖 composer 位置，核对点：`ConversationRoot` 的 `composerSeat` 仍带 `data-composer-seat`、仍是 `scrollBody` 的直接子元素且 `position:sticky; bottom:0`；DSH 改名或移动 composer 后限高退回视口，展开的气泡会重新压住输入卡片与状态栏。
- 让位距离与展开上限都按折叠高度和下一个 durable 行的位置推算：按「让位」的排除规则，pending submission echo 与 pending steering 不会成为「下一个卡片」，它们短暂经过顶部时仍可能被副本遮挡。展开窗口只剩 `gap` 级空间时 hover 不再展开（避免退化成极窄的内部滚动窗口）；要读全文时向上滚一点让卡片离开即可恢复。
- **当前会话的解析必须两条路都留着**：只有 `current` 时 alpha.2 会全盘失效（状态停在 `inactive-snapshot`），只有 `mainView` 时旧版失效。升级后先确认 `SessionListState` 的字段（`ids`/`byId`/`phase`/`subagentsByParent`）、`SessionSummary.retainedBy` 仍由 `retainInfo` 投影，以及 `mainView` 仍是主视图的 source 名。
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

**不等用户操作也能自己做一轮真机回归**：另起一个受管后台宿主 `dsh web --port 0 --no-open`（不接管当前 GUI），用无头 Chromium 打开它打印的带 token URL，点开一个长会话后直接写 `[data-conversation-scroll].scrollTop`，读取 `[data-dsh-sticky-user-bubble-state]` 与 host 内 clone 的 `getBoundingClientRect()`/`clipPath` 即可覆盖出现、让位、切换与会话跳回（2026-09-19 即用此法复现并复核 `0.1.6-alpha.2` 的回归）。调试期间可以临时把快照形状写进 host 的 `data-*` 属性，但**必须在该轮结束前删掉**（本轮未新增任何调试属性，`client.js` 只有 layer/host/state/clone/content 五个发布用标记）。

### 半离线量测记录（`0.2.1-alpha.2`，2026-10-10）

隔离宿主 `DSH_HOME=/tmp/dsh-sub-021/home`（新建：`storages/` + `workspaces/` + 只拷 `dsh-plugins` 工作区的目标会话目录；profile 用 `dsh plugin --profile web add link:<源码目录>` 现建）+ `dsh web --port 0 --no-open`（实际端口 50952）+ 无头 Chrome 155/CDP 9371（独立 `--user-data-dir`，视口 **1512×813**、dpr 1）；目标会话仍是 `f8e6ec6b`（4350 行 / 53 个用户行 / 492 个 `[data-chat-flow]`）。**全程未触碰用户自己的 3080**；脚本与原始输出在 `/tmp/dsh-sub-021/`（非发布物：`cdp.mjs`/`helpers.js`/`measure*.mjs` + `*.log` + `measure-021*.json`）。宿主按 `lsof -nP -iTCP:50952 -sTCP:LISTEN -t` 取 PID、Chrome 按 `--user-data-dir` 证明归属后停止，未按进程名杀。

**先确认隔离 home 里有会话**：B4 用的 `/tmp/dsh-020-home` 里 `sessions/<workspace>/` 只剩空目录，所以这一轮重建了 home（从真实 `~/.dsh` 只读拷 `storages/`、`workspaces/` 与目标会话 `session-f8e6ec6b-…`）。下次接着量时先看 `session.v3.jsonl.zstd` 是否还在，别假设旧 home 可用；`dsh plugin --profile web add link:<目录>` 会在全新 home 里自动初始化 profile（同 G1 的结论）。

量测方法沿用 B4：全部数值来自页面里的 `getBoundingClientRect()`/`getComputedStyle()`（读 `[data-dsh-sticky-user-bubble-state]` 与 host 内 clone），定位用收敛式（按 delta 补差，最多 8 次、每次 420ms）。与 B4 的两点差异：① 让位/展开要**先把下一张卡片拉近再步进**——目标行后面隔着 1000px 助理内容时，+4px 步进 24 帧全在「未夹紧」区间，会量出「清距随滚动单调变化」的假结果；② push 上限要在同一个循环里跑到候选交接才看得到。

| 常量 | `0.2.1-alpha.2` 实测 | 与 `0.2.0-rc.2` 的差异 |
|---|---|---|
| 出现阈值（绘制边界） | `scrollRect.top = 76`（scrollport 无 padding/border）→ 边界 **76**；阅读线 **92** = 76 + 16。底边 140/100/92/84/80/77 全部 `inactive-source-visible`，**76 → `ready`**（clone 落点 92）；细扫 76.2/76.4/76.5 仍 ready、76.6 起隐藏，翻转点落在 `边界 + EPSILON(0.75)` | 数值**完全一致** |
| 让位清距 | 卡片拉近后每步 +4px：`incomingTop − cloneBottom` 从 236 递减，到 **16 后恒定**，之后 clone 随卡片上移（push 2→100）；交接帧 `incomingTop = 92`（= 阅读线）翻成 `inactive-source-visible`、host 清空、active 换成下一行；push 上限 = 折叠高 86 + gap 16 = **102** | 完全一致（B4 记的 102 同样是「上一帧 100、交接帧 92」） |
| `clip-path` | 逐帧 `inset(push − 16)`（push 18→100 对应 `2px`…`84px`，push ≤ 16 时为 `none`） | 完全一致 |
| 三行折叠 | 源气泡 218px（`line-height:22px`、`padding:10px 16px`、`content-box`）→ clone **86px** = 3×22 + 20；内容 wrapper 66px、`scrollHeight` 198px、`overflow:hidden` | 完全一致（同一行 `13:input-messagee5e14446…`） |
| 展开上限随卡片收紧 | 卡片在 452/392/332px：展开为自然全高 **218**、底边 310；292/252/212px：展开高 **184/144/104** = `incomingTop − 16 − 92`，底边 **276/236/196** = `incomingTop − 16`，wrapper 切 `overflow-y:auto`（`scrollHeight` 198 > `clientHeight`）；172px 时展开窗口只剩 64 < 折叠高 86 → 保持三行折叠 | 完全一致 |
| 展开不越过 composer seat | 1512×813：seat 顶 **684.5**、`availableHeight` **577**；压到 **1512×420** 后 seat 顶 292 → `availableHeight` **184**，hover 展开高**正好 184**、底边 **276 ≤ 292**，内部滚动 220 > 164 | 完全一致 |
| 跳回 | 点击 clone：`scrollTop 6152 → 5902`，源气泡 top 回到 **92 = 阅读线**（`state` 转 `inactive-source-visible`） | 一致（0.2.0 记的是 6436 → 5902，终点同为 5902） |
| 控制台 | 0 个 error / exception | 一致 |

**这一线额外核到的静态事实**：`[data-slot="conversation.chat.flow"]` 是行的直接父元素（类名为空、高度 0），插件取到的 flow 仍是 `.EvIC1a_column`；下一张 user 行的 computed `margin-top` 仍是 **6px** → 让位清距 16px 仍来自 `MIN_PUSH_GAP` 下限；`[data-chat-turn-spacer]` 存在但 `height:0`、`[data-chat-motion]` 计数 0。**仍未覆盖**：目视部分（滚动流畅度、真实 hover 手感、非 1 缩放/自定义字号、含 `@` 引用 chip 的用户消息——本会话该类消息仍为 0），以及**折行动画进行中的那一瞬**（见「兼容发布线」的新结构第 2 条，需要真机 GUI 或能触发 fold 的场景）。

### 半离线量测记录（`0.2.0-rc.2`，2026-10-01）

隔离宿主 `dsh web --port 5931 --no-open` + 独立 `DSH_HOME`（复用 `/tmp/dsh-020-home`：B2 轮建的拷贝，profile 的 `link:` 软链已是绝对路径）+ 无头 Chrome 153/CDP 9361（独立 `--user-data-dir`，视口 **1512×813**、dpr 1）；目标会话 `f8e6ec6b`（4350 行 / 70510px / 53 个用户行）；**全程未触碰用户自己的 3080**；脚本与原始输出在 `/tmp/dsh-sub-020/`（非发布物：`.mjs` + `*.txt` + `geo2-result.json`）。宿主与 Chrome 都按**端口**取 PID（`lsof -nP -iTCP:<端口> -sTCP:LISTEN -t`）核对命令行后停止，未按进程名杀。

量测方法：所有数值都取自宿主页面里的 `getBoundingClientRect()`/`getComputedStyle()`（脚本直接读 `[data-dsh-sticky-user-bubble-state]` 与 host 内 clone），不靠读码推断。定位用**收敛式**写法——先按当前 rect 加一次 delta，等 500ms 再量、再补差，最多 6 次（隔离宿主里 `dsh-auto-load-history` 已跨到 0.2.0 线并真的在补齐历史，单次粗跳会因上方内容前插而偏 80~120px）。

| 常量 | `0.2.0-rc.2` 实测 | 与 `0.1.7-rc.2` 的差异 |
|---|---|---|
| 出现阈值（绘制边界） | `scrollRect.top = 76`（scrollport 无 padding、无 border，`wSkVaW_scrollBody`）→ 边界 **76**；阅读线 **92** = 76 + 16。逐档逼近：底边 84（**夹在 76 与 92 之间**）仍 `inactive-source-visible`、77 仍隐藏、**76 → `ready`**，clone 落点 92 | 数值**完全一致**；门槛仍是 scrollport 裁剪边而不是阅读线（本轮用 84 这一档直接证伪了阅读线假设） |
| 让位清距 | 每步下滚 4px 共 24 帧：`incomingTop − cloneBottom` **恒 16px** | 数值一致；来源变了（见上面第 1 条差异：下一行 margin 6px，16px 现在来自 `MIN_PUSH_GAP`）。push 上限实测 **102 = 86 + 16**，下一帧换候选 |
| `clip-path` | 逐帧等于 `inset(push − 16)`（push 10→98 对应 `none`/0/2…82，`none` 只在 `push ≤ 16` 时） | 完全一致 |
| 三行折叠 | 源气泡 218px（`line-height:22px`、`padding:10px 16px`、`box-sizing:content-box`）→ clone **86px** = 3×22 + 20（差值 0）；内容 wrapper 66px、`scrollHeight` 198px、`overflow:hidden` | 完全一致（同一行 `13:input-messagee5e14446…`，同为 218/86） |
| 展开上限随卡片收紧 | 卡片在 452/392/332px 处：展开仍是自然全高 **218**、底边 310（未夹紧）；推进到 292/252/212px：展开高 **184/144/104** = `incomingTop − 16 − 92`，底边 **276/236/196** = `incomingTop − 16`，清距返 16，wrapper 切 `overflow-y:auto`（`scrollHeight` 198 > `innerHeight`） | 完全一致（0.1.7 记的单点 204 = `incomingTop − 16 − 92` 落在同一公式上） |
| 展开不越过 composer seat | 1512×813：seat 顶 **684.5**、`lowerBoundary` = min(scroll底, overlay底, seat顶) = **684.5**、`availableHeight` **577**，自然高 218 用不满；把视口压到 **1512×420** 后 seat 顶 292 → `availableHeight` **184 < 240**（最高气泡），hover 展开高**正好 184**、底边 **276 ≤ 292**，内部滚动 220 > 164、`overflow-y:auto` | 0.1.7 只量到「底边 310 在 seat 685 之上」，**没有真正触发 seat 限高**；本轮把 seat 压成限制项后限高被真实触发且等于 `availableHeight` |
| 跳回 | `scrollTop 6436 → 5902`，源气泡 top 回到 **92 = 阅读线**（`state` 随之转 `inactive-source-visible`，因为原气泡已在阅读线上可见） | 一致 |
| 控制台 | 0 个 error / exception | 一致 |

**这一线比上一线多覆盖两处**：出现阈值在「边界与阅读线之间」的那一档（直接证伪阅读线假设），以及 seat 真正成为限制项时的展开夹紧。**仍未覆盖的是目视部分**：滚动流畅度、真实鼠标 hover 的手感、非 1 缩放与自定义字号下的观感、含 `@` 引用 chip 的用户消息（本会话该行数为 0，只有静态核对）——这些仍需用户在 3080 上按「GUI 验证覆盖」看一遍。

### 半离线量测记录（`0.1.7-rc.2`，2026-09-28）

隔离宿主 `dsh web --port 0 --no-open` + 独立 `DSH_HOME`（`/tmp/dsh-sub-rc2/home`：复制 profile/storages/workspaces 与 dsh-plugins 会话目录，插件软链改成绝对路径）+ 无头 Chrome/CDP（独立 `--user-data-dir` 与调试端口）；目标会话 `f8e6ec6b`（4350 行 / 72521px / 53 个用户行）；**全程未触碰用户自己的 3080**；脚本与原始输出留在 `/tmp/dsh-sub-rc2/`（非发布物，只有 `.mjs` 与 `run*.txt`），临时 DSH_HOME 拷贝与浏览器 profile 已在该轮结束时删除。

| 断言 | 实测 |
|---|---|
| 阅读线 / 绘制边界 | `scrollRect.top = 76`（scrollport 无 padding、无 border）→ 边界 76；`.EvIC1a_scroll` padding-top 16px 且 `overflow:visible` → 阅读线 92 |
| 出现阈值 | 二分到 1px：`scrollTop 25030`（源气泡 bottom 77 > 76）= `inactive-source-visible`；`25031`（bottom 76）= `ready`，clone 落点正是阅读线 92 |
| 让位 | 每步下滚 4px：源气泡与下一张卡的清距恒 **16px**（= incoming row 的 `margin-top`），push 4.5 → 56.5，`clip-path` 逐帧等于 `inset(push − 16)`；卡片越过阅读线那一帧（push 上限 = gap + 折叠高 = 16 + 42）翻成 `inactive-source-visible` 并清空 host |
| 三行折叠 | 源气泡 218px（`line-height:22px`、`padding:10px 16px`）→ clone 折叠高 **86px** = 3×22 + 20；内容 wrapper 66px、`scrollHeight` 198px、`overflow:hidden`、`pointer-events:none` |
| hover 展开 | clone 展开到 **218px**（自然全高），底边 310 远在 `[data-composer-seat]` 顶 685 之上；卡片逼近到阅读线 +220 时展开高收到 **204px**、底边 296 = `incomingTop − 16`，wrapper 切到 `overflow-y:auto` + `pointer-events:auto`；`mouseleave` 后回到 86px |
| 会话切换 | A → B → A 均无残留 clone、无报错；回到 A 后重新固定，再把目标行钉回 `scrollTop 36244` 与切换前一致 |
| 跳回 | 点击 clone：`scrollTop 25031 → 24973`，源气泡 top 回到 92 = 阅读线 |
| 控制台 | 0 个 error / exception |

**这轮量测覆盖了可脚本化的全部几何判据；未覆盖的是目视观感**（滚动流畅度、真实鼠标 hover 的手感、非 1 缩放/自定义字号下的观感，以及含 `@` 引用 chip 的用户消息——本次会话没有这类消息，该路径只有静态核对）。这些仍需用户在 3080 上按「GUI 验证覆盖」看一遍。
