# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.5] - 2026-09-17

### 文档

- 文档保持纯中文；`README.md` 收敛为「功能 → 要求 → 安装与卸载 → 启停语义 → 卸载语义 → 安全边界」，只描述当前行为，测试与验证清单移到 `AGENTS.md`。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-local-plugin-manager`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- 明确本插件与安装的关系：装插件仍走官方命令，管理器只管理已装入 profile 的 `link:` 插件。

## [0.1.3] - 2026-09-14

### 新增

- 每行在名称下方显示该插件自己的 `package.json#description`；Host 归一化为有界的一行，客户端最多渲染两行，全文放在 tooltip 里。
- 没有可用说明的插件显示占位「未提供说明」，而不是空行。

### 修复

- 注入的样式表补打 `data-plugin="dsh-local-plugin-manager"`；当元素仍在但内容属于别的 bundle 时重写它，保证热更新后生效的总是当前 bundle 的 CSS。

### 变更

- 各工作区插件的 `description` 字段改写为中文，使列表里的说明是准确的一行摘要。
- 行内改为三段式：名称、带极淡自混底板的说明、弱化的版本与源码路径，并给文案列和行更多纵向空间。

## [0.1.2] - 2026-09-09

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 在 `0.1.6-alpha.1` 上重新核对 profile manifest、bundle patch、plugin CLI、Loader update、Web 路由认证、client module、主题 token 与 Settings Slot 契约后，兼容线移到 `>=0.1.6-alpha.1 <0.1.7`（`@deepseek-ai/cordis*` 的 loader/include/HMR 版本锁定与 `js-yaml` 行为在该线上未变）。
- 该发布线只把 `0.1.6-alpha.1` 记为逐版本验证版本；同线后续 prerelease 会给出警告，并继续受结构与能力检查保护。
- 此前同样核对后把兼容线移到 `>=0.1.5-alpha.1 <0.1.6`，只把 `0.1.5-alpha.1` 记为逐版本验证版本。

### 修复

- 把 live Loader 热切换限制在 profile 根拥有的完整 `include:<rowId>` 条目上，嵌套 Loader 树里的同名行不再被误切换。

## [0.1.1] - 2026-09-02

### 兼容性

- 用有界的 `0.1.2` 兼容线取代精确 DSH prerelease 门，并记录 alpha.3 与 alpha.4 为逐版本验证版本。
- 本地 status 与 mutation 路由复用 DSH 的浏览器认证。

## [0.1.0] - 2026-09-02

### 新增

- 最初的本地 `link:` bundle 清单、启用/禁用、受保护卸载、设置页 tab 与 profile patch 状态管理。
