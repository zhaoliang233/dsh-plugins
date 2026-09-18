# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.3] - 2026-09-18

### 修复

- **打开长会话时不滑动就不补齐**：让位判定原先只看视口是否在底部，而打开会话时的视口位置由 DSH 自己决定、补齐期间 DSH 又一直在做滚动补偿，于是这种"暂时不在底部"被误当成"读者正在阅读"，分页停在半路，直到读者碰巧滚回底部。现在只有**读者自己驱动过视口**（`wheel`/`touchstart`/`touchmove`/`pointerdown`/`keydown`，document 捕获阶段识别；新会话重新判定）**且**离开底部时才让位；其余情况一律继续补齐。"读者滚动后让位、滚回底部恢复"的行为不变。
- **DSH `0.1.6-alpha.2` 下自动补齐完全失效**：该版本从会话列表快照中移除了 `current`（`sessions.open()/clear()` 也被 `retain()/using()` 引用模型取代，导航改由视图所有者持有），而插件原先靠 `sessions.list.getSnapshot().current` 定位「当前查看的会话」，于是永远拿不到身份、静默不动——表现是打开长会话后顶部「加载更早」常驻、历史始终只有一页。现在改为在会话作用域 list slot `conversation.session.header.actions` 放置一个渲染 `null` 的驱动组件，由 Conversation 通过 slot props 交出 `sessionId`（`SessionStandardProps`），再用 `ctx.sessions.binding(id)` 取会话面分页。该 slot 声明与 `binding(id)` 在 `0.1.6-alpha.1` / `alpha.2` 一致，兼容范围不变。

### 变更

- 视图先画、Controller 尚未 retain 该会话时，按帧重试绑定（`MAX_BINDING_RETRIES = 30`），超时即停止，不做轮询；身份切换用带 id 的 `detach`，被替换视图的卸载不会解绑新会话。
- `package.json#dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-conversation`（插件在该包声明的 slot 上注册）。
- 逐版本验证版本更新为 `0.1.6-alpha.2`（兼容范围仍为 `>=0.1.6-alpha.1 <0.1.7`）。

## [0.1.2] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「为什么需要它 → 行为 → 设置 → 安装与卸载 → 要求 → 已知限制」。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-auto-load-history`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- 要求一节的兼容范围更正为 `>=0.1.6-alpha.1 <0.1.7`（此前文档仍写着旧的 `0.1.5` 发布线，与 manifest 不一致）。

## [0.1.1] - 2026-09-17

首个公开发布到 npm registry 的版本。

### 变更

- 改用 GitHub Actions 的 OIDC 可信发布（trusted publishing）自动发布，不再依赖长期 npm token。

## [0.1.0] - 2026-09-17

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对整套契约：`ISession.loadOlder()`（契约文件逐字节相同，`maxMessages: 50`）、`SessionSnapshot` 的四个字段、`sessions.list.current`、`binding(id).session`/`.eventSource`、窗口头进度读取、`settings.general.item` list slot、renderer 的 `inject` face 透传与 `locale` 座位、`[data-conversation-scroll]`，以及紧凑折叠门禁（`processWindowReady ... && !historyIncomplete`，`historyIncomplete: hasMore`）均未变化。兼容线移到 `>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 逐版本验证。

### 新增

- 会话打开时把整段历史分页补齐，使紧凑排版能折叠每个已完成回合，无需读者反复点「加载更早」或在回合导航里翻找。
- 增加设置 → 通用的偏好行（`会话历史`），提供自动与手动两种模式，默认自动，选择按浏览器保存。
- 读者滚离流底部时暂停分页；连续多页没有推进窗口时停止。
