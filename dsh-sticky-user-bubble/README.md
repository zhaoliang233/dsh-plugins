# dsh-sticky-user-bubble

一个面向 DeepSeek Harness Web 的客户端插件：阅读长对话时，当当前用户气泡已经完整滚出对话顶部（原气泡不再有任何可见部分）后，插件会在顶部固定显示同一条原生用户气泡。固定内容直接来自原气泡的 DOM 克隆，因此不会把用户发言强行称为“问题”，也不会改写正文排版。

## 功能

- 固定当前已完整滚出对话可视区顶部的用户或 durable steering 消息气泡。
- 向上、向下滚动时按真实消息顺序切换；原气泡仍有任何可见部分（包括底部内边距和圆角）时保持隐藏，不会出现原气泡与副本同时可见。
- 下一条用户卡片进入顶部区域时，固定气泡像列表 sticky 标题一样被它顶出去（超出对话顶边的部分被裁掉），不会盖住新卡片；让位过程始终保持与对话一致的消息间距（跟随该行的 `--dsh-chat-flow-gap`，不小于 16px），新卡片到达阅读线时固定气泡完全消失。
- 点击固定气泡会平滑滚动到对应的原始用户输入位置；同时支持键盘聚焦后按 `Enter` 或空格键跳转。
- 固定气泡超过三行时默认只显示三行并以省略号截断，鼠标移入或键盘聚焦时恢复完整内容；展开高度同时受**输入框顶部**和「下一条用户卡片上方空间」限制（超出部分在气泡内部滚动），空间只剩消息间距时保持三行不展开，因此展开既不会盖住新卡片，也不会压住输入卡片与底部状态栏。
- 内部滚动发生在气泡 padding 之内的内容区：滚动条不会压住气泡的圆角边框，并沿用 DSH「卡片内滚动区域」的约定使用更暗的 `l2` 滑块颜色（与 composer 输入卡片一致）。
- 会话仍在进行（思维链、工具调用、回答流式增长）时不会打断阅读：展开状态不会因为会话更新而反复收起再展开，clone 重建时 hover/focus 意图会被继承。
- 使用当前 DSH 独立 `ChatSnapshot.order` 和 `chat.nodes.get(key)` 校验消息归属；同时保留旧版嵌套 `snapshot.chat` 兼容路径，不把 DOM 中的未知行当作用户消息。
- 使用 DSH 核心公开的 `data-conversation-scroll`、`data-chat-flow`、`data-chat-anchor-key`、`data-chat-flow-kind` 标记定位（阅读区下界另用 `data-composer-seat`），不替换会话 Slot 或消息渲染器；若未来出现专用 user-bubble marker 会优先使用。
- 副本的显示条件只看原气泡是否仍被绘制：以 scrollport 的实际裁剪边界为准（并被中间任何裁剪或独立滚动祖先的 padding box 顶部收窄），与固定副本所在的顶部内边距线无关。
- 从原生气泡读取实际 DOMRect 和计算样式，并向克隆后代复制有边界的文本/视觉样式集，降低祖先选择器在 `shell.overlay` 中失效造成的差异。
- 先以真实宽度、自然高度测量不可见克隆，再用实际文本行框确定第三行边界；外部固定 `height`/`min-height` 不再决定是否截断或完整展开高度。
- 通过有边界的 `MutationObserver`、`ResizeObserver`、当前 source 到 scrollport 的祖先样式属性、页面主题、样式表、字体加载、visual viewport 和窗口尺寸监听，在同一动画帧调度器内重新测量。
- 极长内容展开时限制在当前对话可用高度内并允许内部滚动，避免固定气泡伸出视口。
- 保留 DSH 原生的手动历史分页：更早消息仍由用户点击“加载更早”；旧消息进入当前窗口后，固定气泡自动重新归组和定位，无需刷新页面。
- 固定副本位于独立的 `shell.overlay` 层，除气泡本身外均点击穿透；克隆内部节点会移除 ID、ARIA 引用、核心聊天标记和交互属性，避免引用链接或控件被二次触发。
- 找不到预期核心标记、当前快照过期、气泡不可测量、结构存在歧义或克隆几何自检失败时自动隐藏，并在 host 上保留非视觉状态码供诊断。

## 已知边界

- 当前 DSH 的圆角气泡没有稳定的专用 `data-*` 标记，也不再保证存在旧版 `data-time-hover-root`。没有这些 marker 时，插件在权威用户行内部用消息文本、paint、padding 和几何联合评分；候选存在歧义时 fail closed。
- wrapper 无法可靠保留 flex/grid/table 根布局、垂直书写、root transform 或非 1 zoom，因此这些布局会隐藏固定气泡并记录 `unsupported-*` 状态，而不是显示近似布局。
- Shadow DOM、canvas、关键伪元素内容以及非 DOM 气泡不在当前架构支持范围内。
- 第三方 `!important` 规则如果主动覆盖 clone 的关键属性，几何自检能发现一部分但不能保证全部识别；原消息始终不受影响。
- 通过 `CSSStyleSheet.insertRule()` 等方式静默修改 CSSOM 且不产生 DOM、字体或尺寸事件时，不保证立即刷新；后续滚动、resize 或其他受观察事件会重新测量根样式。
- 尚未持久化的 pending steering 行目前没有核心行锚点，因此会等到它成为 durable 节点后再参与切换。
- 尚未点击“加载更早”的历史消息不在当前 `ChatSnapshot` 和 DOM 窗口内，不能提前参与固定气泡切换；插件有意不自动调用 `loadOlder()`。
- 纯图片消息没有文本气泡时不会伪造文字副本；原消息保持不变。
- 这是纯客户端行为，不提供开关、历史数据或 Host 路由。

## 要求

- DeepSeek Harness Web `>=0.1.5-alpha.1 <0.1.6`；`0.1.5-alpha.1` 已逐版本验证，同线后续版本带警告并继续依赖客户端结构与能力检查；旧版嵌套快照仍保留兼容读取。
- Node.js 20 或更高版本，用于安装和发布检查。
- 不需要额外的运行时 npm 依赖。

## 本地安装

从当前源码目录执行：

```bash
npm run publish:check
./install.sh
```

安装脚本通过 DSH 官方 profile manager 加入 `link:` 依赖，不直接改写用户的 `cordis.patch.yml`：

```bash
dsh plugin --profile web add "link:$PWD" --config.minimumReleaseAge=0
```

修改 `package.json`、`cordis.patch.yml` 或 Host 入口后，请在用户终端重启 `dsh web`，然后刷新页面。只修改客户端源码时，如果当前部署没有运行 client-plugin watcher，同样需要重启并刷新。

## 卸载

```bash
./uninstall.sh
```

卸载只移除 profile 依赖和 bundle 层，不修改 DSH 源码、会话历史或用户配置。

## 开发检查

```bash
npm run check
npm test
npm run pack:check
npm run publish:check
npm pack --ignore-scripts
```

## 实现概要

1. `shell.overlay` 是唯一 UI 注册点，采用独立 ID `dsh-sticky-user-bubble`，不替换任何已有 Slot occupant。
2. 根 overlay 通过 `useSessions` 得到当前会话 ID，用 `sessions.binding(id).session` 的 `subscribe/getSnapshot` 读取生命周期状态，并用 `uiConversation.binding(id).target('chat')` 读取当前 `ChatSnapshot`。
3. 每次测量先用生命周期状态和 Chat snapshot 建立用户节点索引，再在当前可见 flow 中按 DOM 顺序寻找最后一个已跨过阅读边界的 durable `user`/`steering` 行；副本只在原气泡完全离开绘制区后显示，并在下一条用户卡片逼近时让位（保留消息间距、被对话顶边裁切）。
4. 在该行内优先查找专用 marker，否则在整行权威边界内用消息文本、paint、padding 和几何选择唯一可信气泡；无法唯一确定时隐藏。
5. 克隆会先以真实宽度、自然高度和 `visibility:hidden` 挂入 overlay，递归复制有边界的后代样式，并通过 `Range.getClientRects()` 或 computed line-height 得出三行边界。
6. 渲染前检查 source 连接、根布局、宽度、内容宽度和高度；不支持的结构只在 host 上记录状态码，不显示 clone。
7. source、flow、主题属性、样式表、字体和 viewport 变化统一合并到一个动画帧；clone host 自身的 DOM 变化被过滤。
8. 点击或键盘激活固定气泡时，按原节点与当前 scrollport 的实时坐标写入目标 `scrollTop`；普通测量和滚动跟踪不会改写滚动位置。
9. 插件停止或会话/视图改变时清除克隆、监听器、观察器和待处理动画帧。

## License

MIT
