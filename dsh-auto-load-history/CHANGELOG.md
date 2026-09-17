# 变更记录

本文件记录本项目的所有重要变更。

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
