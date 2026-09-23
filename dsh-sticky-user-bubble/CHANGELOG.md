# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.6] - 2026-09-22

### 变更

- **兼容线移到 `>=0.1.7-alpha.1 <0.1.8`**（`0.1.7-alpha.1` 已逐版本核对）：`package.json`、`engines.dsh`、`install.sh` 版本门与 `lib/index.js` 四处同源更新，上一发布线（`0.1.6-*`）上的旧版本继续服务旧线，范围外保持 inert。
- 逐项复核 0.1.7 的契约后确认无需改实现：`ChatSnapshot` 骨架（`order`/`nodes.get(key)`/`locations`/`navigation`/`timeline`/`legacy`）、节点种类 `user`/`steering`、聊天行标记（`data-chat-flow`、`data-chat-flow-key`、`data-chat-flow-kind`、`data-chat-anchor-key`，另新增 `data-chat-node-key`/`data-chat-group-part`）、`[data-conversation-scroll]` 的 scrollport 与内层 16px padding、`[data-composer-seat]`、`shell.overlay`（`z-index:20; pointer-events:none`）、`retainedBy.mainView` 与 `uiConversation.binding(id).target('chat')` 均未变化；`data-ref-chip` + `title` 仍在 primitives 里渲染。

## [0.1.5] - 2026-09-18

### 修复

- 修复 DSH `0.1.6-alpha.2` 上固定气泡完全不出现：客户端会话列表快照在这一版移除了 `current` 单元格（导航改由视图持有关系表达），插件原先直接读它取当前会话，于是永远拿不到会话身份、状态停在 `inactive-snapshot`。现在先读 `current`（`0.1.6-alpha.1` 及更早），取不到时按壳层自己的算法用 `byId` 的 `retainedBy.mainView` 持有计数解析当前会话，两个版本共用一份实现。

### 变更

- 逐版本验证版本更新为 `0.1.6-alpha.2`（兼容范围仍是 `>=0.1.6-alpha.1 <0.1.7`）；`0.1.6-alpha.2` 上已重新核对 Chat target、`ChatSnapshot.order`/`nodes`、聊天行标记、`[data-conversation-scroll]`、`[data-composer-seat]` 与几何契约，未再发现其它漂移。

## [0.1.4] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「功能 → 要求 → 安装与卸载 → 已知边界」，只描述当前行为，实现结构与开发检查命令移到 `AGENTS.md`。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-sticky-user-bubble`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- 要求一节里的兼容范围更正为 `>=0.1.6-alpha.1 <0.1.7`（此前文档仍写着旧的 `0.1.5` 发布线，与 manifest 不一致）。

## [0.1.3] - 2026-09-17

首个公开发布到 npm registry 的版本。

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对 Session/Chat 快照、Slot、核心 DOM 标记与几何契约：聊天行标记（`data-chat-flow`、`data-chat-anchor-key`/`-flow-key`/`-flow-kind`）、`.EvIC1a_*` flow CSS、`[data-conversation-scroll]`、`[data-composer-seat]` 都由未变代码产出；唯一新增的 DOM 形态是 `@`/slash 引用 chip 在可点击时渲染成 `<button>`，而克隆本就把它中和（清除 `tabindex` 并把复制元素的 `tabIndex` 置为 `-1`）。兼容线移到 `>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 逐版本验证。
- 针对 DSH `0.1.5-alpha.1` 核对 Session、Chat、Slot、client module 与 DOM 契约后，兼容线曾收窄为 `>=0.1.5-alpha.1 <0.1.6`。

### 新增

- 可用时优先使用显式的 user-bubble 标记，否则联合权威消息文本、paint、padding 与几何来识别源气泡。
- 用一个合并后的测量调度器观察当前源气泡、其到 scrollport 的有界祖先链、主题属性、样式表节点、字体加载、visual viewport 与会话几何。
- 在克隆 host 上记录非视觉的兼容状态，并对已断开、测量无效、不支持的根布局与几何不匹配 fail closed。

### 变更

- 把顶部位置让给下一条用户卡片而不是盖住它：卡片前沿进入 flow 间距后副本随之上移、保留该间距、在 scrollport 边缘被裁切，卡片到达阅读线时副本已消失。
- 用下一条用户卡片上方的可用空间限制 hover/focus 展开：长消息停在该卡片预留的间距处，超出部分内部滚动；没有空间时保持折叠，卡片逼近时即使已展开也会实时收紧。
- 按真实宽度测量未截断的克隆内容，使源气泡固定的 `height`/`min-height` 不再决定三行截断或展开高度。
- 能拿到实际行框时使用行框，浏览器不提供行矩形时才退回 computed line-height。
- 向克隆后代复制有边界的 computed 文本与视觉样式，让依赖祖先选择器的样式在移入 `shell.overlay` 后更可靠地保留。
- 极长的展开气泡按可用对话视口限高，并允许内部滚动。

### 修复

- 修掉会话流式生成时的折叠/展开闪断：回答的每个 token 都会改变 flow 尺寸，此前会重建克隆并让新副本先折叠、等浏览器重算 hover 后才重新展开。现在布局 resize 走普通比较路径而不强制重建，hover/focus 意图保存在 effect 级 ref 中，由重建后的副本继承（键盘触发的展开还会恢复焦点）。
- 展开高度改为受 composer 限制而不只是 scrollport：composer 是 scrollport **内部**底部的 sticky 元素，展开的长消息此前会压住输入卡片与底部状态栏；`availableHeight` 现在止于 `[data-composer-seat]` 顶部再减 16px（找不到该座位时退回视口限高）。
- 把限高后的内部滚动从气泡 root 移到内容 wrapper：滚动条此前压在气泡圆角边框上且使用全局亮度的滑块，现在落在气泡 padding 内、使用 DSH 的卡片内暗色滑块（`l2`，与 composer 卡片一致），并且 wrapper 只在真正拥有滚动条时才接收指针事件。
- 固定副本的可见性改为以气泡真实绘制边界为准，而不是阅读线：此前与 `scrollport.top + readingInset` 比较，而在已核对布局里两者相差 16px，导致原气泡底部内边距与圆角仍完全可见时副本就出现了；现在等气泡底部离开 scrollport 裁剪边（并被任何裁剪或独立滚动祖先的 padding box 收窄）才出现。
- 固定包含 `@`/slash token 的用户消息：核心渲染器把 token 投影成只显示最后一段路径的引用 chip，导致渲染文本与快照原文不一致、该行此前 fail closed 成 `bubble-not-found`；现在会先按每个 chip 的 `title` 重建气泡文本再比较。
- 通过 `uiConversation.binding(id).target('chat')` 读取已核对的 DSH Chat target，不再假设生命周期快照里仍有 `chat`。
- 已核对的 DSH 行不再带旧版 `data-time-hover-root` 时，直接在权威用户行内搜索；旧 bundle 的 marker 路径保留。
- 从 document observer 中过滤克隆 host 自身的变更，避免兼容性刷新造成自触发的渲染循环。

## [0.1.1]

### 新增

- 固定气泡可点击、可用键盘激活，点击后滚动回对应的原始用户或 steering 消息。
- 长固定气泡限制三行并以省略号截断，鼠标悬停或键盘聚焦时显示完整内容。

### 修复

- 把行截断应用在无 padding 的内层 wrapper 上，避免 Chromium 在气泡底部内边距里露出第四行的一部分。

## [0.1.0]

### 新增

- 当原始气泡已滚出阅读边缘后，在 DSH Web 对话顶部固定当前用户或 steering 消息气泡。
- 用实时的会话/Chat 快照解析消息文本，用核心对话 data 属性定位渲染行。
- 复用已渲染气泡的测量几何与 computed 视觉样式，使副本在不同宽度与主题下跟随原生气泡。
- 预期聊天标记缺失或找不到可测量的文本气泡时 fail closed。
- 卸载时清理 Slot 注册、滚动监听、observer、已排期的帧与会话订阅。
- 增加官方 profile 元数据、本地 link 安装、发布检查与 Node 20/22 兼容的测试。

### 修复

- 把测得的 DOMRect 尺寸按 border-box 总量解释，避免克隆气泡重复加上原生 content-box 的 padding。
