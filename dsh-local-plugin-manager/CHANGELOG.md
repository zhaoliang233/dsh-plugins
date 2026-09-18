# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.6] - 2026-09-18

> `0.1.5` 与 DSH `0.1.6-alpha.2` 起自带的插件管理页（侧边栏「插件」）在同一个 profile patch 上各写一份记账，会互相回滚开关状态；本版把写入对齐到官方实现后两者可并存。仍在使用 `0.1.5` 的 profile 请显式升级到本版。

### 变更

- **启停改为写 DSH 官方的行覆盖项**：在 profile 的 `cordis.patch.yml` 写顶层 `- id: <行 id>` + `disabled:` 条目，启用时写显式 `disabled: false`（不再删除条目）。DSH `0.1.6-alpha.2` 起 `dsh-base` 默认启用自带的 `plugin-manager`，侧边栏「插件」页会启停同一批行；对齐后两边读的是同一个状态，能就地接管对方写的条目，不会互相回滚。
- **写入进入官方同一把 profile 写锁**：读—改—提交包在 `withFileLock(<profile>/package.json)` 内（与官方 plugin-manager、`dsh plugin` CLI 串行化），提交改用官方 `writeFileAtomic`；并发修改不再报冲突，而是合并保留。
- **运行时依赖更换**：去掉 `js-yaml`，改用官方同款 `yaml`（Document API 才能保注释地就地改值），并新增 `@deepseek-ai/dsh-atomic-write`（写锁与原子提交）。
- **热生效不再直接操作 Loader**：写完 patch 后由 profile 配置重载（`patchReload: live` / `dsh-hmr`）重组 loader 树，Host 侧只读轮询目标行的 fiber 状态来判断「已生效 / 需要重启」。
- **逐版本验证版本改为 `0.1.6-alpha.2`**：兼容发布线仍是 `>=0.1.6-alpha.1 <0.1.7`，但本版只在 `0.1.6-alpha.2` 上做过真机验证。

### 移除

- 移除 `cordis.patch.yml` 里的受管区块（`# >>> dsh-local-plugin-manager (managed)` 标记与整块重渲染）。旧标记会在启动时一次性清理，区块内的条目原地保留为普通覆盖项，原有禁用状态不丢失。
- 移除 `state.json` 的 `disabled` 字段（schema `1` → `2`）：禁用状态的真源只有 profile patch，避免出现两份会分叉的记账。旧 v1 文件仍可读，会迁移后写成 v2。
- 移除对 Loader 私有接口 `entry.update(...)` 的写入调用，避免与官方 plugin-manager 和 HMR 的重组并发改同一批行。

### 修复

- 卸载成功后的墓碑清理会一并删除该插件遗留的覆盖项；此前若把覆盖项一直留在文件里，插件将来被重新安装时会被这条陈旧覆盖项继续禁用。

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
