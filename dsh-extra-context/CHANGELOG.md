# 变更记录

本文件记录本项目的所有重要变更。

## [0.1.2] - 2026-09-17

### 移除

- 设置页底部的构建标识行（渲染成 `dsh-extra-context · <日期.序号>`）及配套的 `CLIENT_BUILD` 常量、`.dec-version` 样式、测试出口与「页面必须显示构建版本」用例一并删除：它只是开发期核对刷新是否生效的痕迹，不是产品功能。
- 删除「模型笔记」功能：`extra_context_notes` 工具（含 read/append/clear 与 4096 字节上限）、设置里的 `notes` 字段、`appendNote`/`NOTES_MAX_BYTES` 纯函数、客户端备注输入框，以及只服务它的测试。该功能需要手改 profile 插件行的 `config: { notes: true }` 才会出现，从未在任何部署启用过，留着只是文档里的悬空承诺。`config.notes` 现在是无效配置项；老配置里残留的 `notes` 字段会被忽略（schemastery 会原样保留未知键，但插件两侧的规范化都会丢弃它），既不注入提示词也不出现在预览里，规则本身不受影响。

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「它解决什么问题 → 功能 → 什么时候生效 → 与其它机制的分工 → 安装与卸载 → 使用 → 限制」，只描述当前行为。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-extra-context`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- README 移出实机对照证据与开发命令（前者属技术结论、后者属维护者视角），统一留在 `AGENTS.md`。

## [0.1.1] - 2026-09-16

首个公开发布到公共 npm registry 的版本。

### 变更

- 发布链路改用 GitHub Actions 的 OIDC 可信发布（trusted publishing），不再依赖长期 npm token。

## [0.1.0] - 本地候选

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对 Host 与客户端契约：`systemPrompt.section`（只新增可选的 `interpolate` 标志）、`SECTION_ORDERS`、`settings.register`/`describe`（可选 `user` 键）、`tools.register`、schemastery 定位路径（仍是 `node_modules/@deepseek-ai/schemastery@3.18.2`）、`webServer.register` 与客户端 `settingsScope.bind` 契约均未变化。兼容线移到 `>=0.1.6-alpha.1 <0.1.7`。
- 核对 DSH `0.1.5-alpha.1` 源码契约（`dsh-system-prompt`、`dsh-settings`、`dsh-tools`、`dsh-agent-loop`）后声明兼容线 `>=0.1.5-alpha.1 <0.1.6`。
- 针对实际部署的 `0.1.5-rc.2` 复核同一批契约，并把它加入逐版本验证清单。

### 修复

- 打开设置面板时立刻显示专用导航图标：样式表原先由 section 组件注入，而壳层是懒渲染（`only: active`），导航补丁却挂在 `settings.action`（面板一打开就渲染），于是补丁先于 CSS 存在。样式表改由 `apply()` 注入（插件级、引用计数、跨 HMR 复用、最后一个引用释放时移除），浏览器夹具也不再替插件注入 CSS（正是那个捷径掩盖了这个缺陷）。

### 变更

- 设置导航项绘制自己的图标（`IconContextInjectionOutline16`），不再回落壳层的齿轮：`settings.section` 没有 `icon` 选项，壳层只白名单四个官方 id，因此图标来自经 `settings.action` 挂载的可逆 DOM 补丁（隐藏原 svg、用 `::before` + `mask`、`currentColor` 跟随壳层主题；所有状态引用计数，卸载时回滚）。
- 改用官方的 `PromptSection.interpolate: false`（DSH 0.1.6 新增），不再把 `{{` 改写成零宽字符形式：用户文本原样进入提示词，护栏也改为断言该标志被声明。

### 新增

- 进程级 system prompt section（`deployment:extra-context`，order 204），通过全局注册层覆盖每个会话、子代理与 workflow 子步骤。
- 分段规则模型（启用开关、文本、按数组顺序），逐段做空白/启用过滤，并支持把模型私有笔记渲染进同一个 section。
- 设置 →「额外上下文」页面：增删/启停规则、与注入文本一致的本地预览、消耗提示与生效时机说明。
- 通过 `extra-context` settings 命名空间写入 `$DSH_HOME/settings.yaml`，热生效、无需重启。
- `extra_context_notes` 工具，用于模型维护长期笔记，上限 4096 字节。
- 优雅降级：没有 settings 服务时仍按组合层值对当前进程生效；schema 加载失败时只不注册 settings 命名空间，不阻断启动。
- 只在失焦时写入：输入过程只改本地，显式动作（勾选/增删）立即写入；写入失败会保留失败内容并给出可重试的错误提示。
- 笔记默认关闭（`notes: true` 才注册）；关闭时遗留笔记既不会被注入，也不会出现在预览里。
