# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.2] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语。
- `README.md` 收敛为「功能 → 要求 → 安装与卸载 → 使用 → 注意事项」，只描述当前行为。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-default-workspace`；`./install.sh` 明确为源码 `link:` 开发路线。兼容说明中的发布线常量由 `0.1.6` 更正为 `0.1.7`。

## [0.1.1] - 2026-09-17

首个公开发布到 npm registry 的版本。

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫它与 `dshCompatibility.range` 同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对 Workspace registry 与 entity、Web 认证、客户端 Workspace controller、`uiWorkspace.startSession`、`sidebar.footer.action` 与 UI primitives 契约：registry 只新增了 `unarchiveSession`，侧边栏与 workspace header 的 DOM 未变。兼容线下移到 `>=0.1.6-alpha.1 <0.1.7`，仅 `0.1.6-alpha.1` 逐版本验证。
- 兼容线收窄为 `>=0.1.5-alpha.1 <0.1.6`，仅 `0.1.5-alpha.1` 逐版本验证；确认显式 `uiWorkspace.startSession(workspaceId)`、Workspace 保护、首位固定与 wide/rail 底部布局不需要行为分叉。

### 变更

- 本地安装脚本在改动目标 DSH profile 之前先运行完整的 `publish:check` 发布闸门。

### 修复

- 注入的样式表补打 `data-plugin="dsh-default-workspace"`。DSH 会把未打标签的 `<style>` 认领给下一个物化的客户端 bundle，而热更新只删除 `style[data-plugin=<id>]`：未打标签的样式可能被交给别的插件随后被删除，或在升级后残留，表现为侧边栏入口一直沿用上一代 bundle 的规则，直到手动刷新才恢复。

## [0.1.0] - 本地候选

### 新增

- 为项目无关的会话提供受管 Workspace `$DSH_HOME/workspaces/default`，标题为 `通用会话`。
- 侧边栏底部的「新建通用会话」入口，走 DSH 原生的显式 Workspace 新建流程，并带可见的忙碌与重试状态。
- 分组视图首位固定，同时保留 DSH 标准的混排单列表。
- Host 与浏览器两侧对改名、删除、排序操作的保护。
- 可摘除的 Workspace interceptor dispatcher，注册顺序或移除顺序下清理都不越权。
- 官方 DSH profile bundle 元数据与浏览器客户端图元数据。
- 通过官方 profile manager 的本地 link 与准确 tarball 分发流程。
- Node.js 20/22 CI、语法与行为检查、manifest 断言，以及精确的七文件打包白名单。

### 变更

- 未公开的本地候选由 `dsh-recent-chats` 更名为 `dsh-default-workspace`。
- 把已存在的受管 Workspace 由「最近聊天」原地改名为「通用会话」，路径、ID、成员关系、日志与 cwd 全部保留；同路径上的其他自定义标题改为 fail closed，不再被覆盖。
- 移除此前对无参数 `startSession()` 的重定向，恢复 DSH 原生全局「新会话」行为。
- 清理时精确恢复安装前的 property descriptor，包括删除继承自 prototype 的实例 wrapper，避免遮蔽后续的 prototype HMR。

### 兼容性

- 支持已验证的 DeepSeek Harness Web 发布线 `>=0.1.2-alpha.3 <0.1.3`，其中 alpha.3 与 alpha.4 逐版本验证。
- 会话导航使用 `uiWorkspace`，Workspace 状态与变更保留给纯 `workspaces` Controller。
- 该发布线未向独立客户端插件开放行级 Workspace capabilities，因此标准菜单与拖动态可能仍然可见，但相应操作会被拒绝。

### 数据保留

- 卸载只移除 profile 依赖与可逆运行时策略，受管目录、Workspace 注册和历史会话保留。
