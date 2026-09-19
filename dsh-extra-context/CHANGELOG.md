# 变更记录

本文件记录本项目的所有变更。

## [0.1.4] - 2026-09-19

### 变更

- 开关改用 DSH 自带控件：设置页右上角的「总开关」与每一行行首的启停都由官方 `Switch`（36×20、开启态品牌色轨道、`aria-checked` 驱动配色）承担，插件样式只负责定位（总开关 `margin-left:auto` 贴右，行内开关 `flex:none`）。原先的总开关是自绘按钮、行内是原生勾选框，与新控件相比尺寸、配色、过渡都不一致。
- 「+ 添加规则」改为「+ 添加上下文」；分区内文案统一说「上下文」（空列表提示、预览的偏长提醒、开关的无障碍名）。
- 预览卡片收敛为两段——内容与 token 消耗；「它写在每次对话的最前面，优先于其他说明」上移到设置页标题下方的说明里（那里本来就是讲作用范围与生效时机的地方）。
- 体积与字数一律用「字符」：行内原写「N 字」、预览写「约 N 个字符」，同一个数字两种叫法；现在都是「字符」（行内是精确字素计数，不带「约」）。

### 移除

- 分段的 `label`（名称）字段：界面从来只显示正文摘要，这个字段没有任何入口，所以从客户端规范化、宿主规范化、状态接口与设置 schema 一并删除。老设置文件里残留的 `label:` 会被忽略（schemastery 对未知键是原样保留，插件两侧的规范化只挑 `id/enabled/text`），不会被读进来，也不会被重新提交回去。

### 测试

- 新增与改写的护栏都按"注入缺陷必红"逐条验证过：去掉总开关的 `margin-left:auto`、把开关换回自绘按钮或原生复选框、行内开关被按下 `disabled`、新增分段把 `label` 写回去、预览卡片塞回说明段、把「最前面/优先于其他说明」从标题下方的说明里删掉、行内计数退回「N 字」——各自都能让对应用例变红。

### 文档

- `AGENTS.md` 记录官方 `Switch` 的取值与渲染契约、开关的定位类、`label` 移除涉及的五处、预览分区的两段结构、计数单位的统一口径，以及上面那批注入验证结果。

## [0.1.3] - 2026-09-19

### 修复

- Windows 上设置页的「+ 添加规则」与「已开启/已关闭」按钮永久灰掉、点不动：`require.resolve` 拿到的 schemastery 绝对路径被直接交给 `import()`，Windows 会把 `C:` 当成 URL 协议并抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；异常被兜底吞掉后 schema 变成 null，settings 命名空间静默不注册，状态接口回报 `writable: false`，而客户端只用 `busy || !writable` 禁用这两个动作按钮（输入框与勾选框刻意不禁用，所以看起来"只有这两个按钮坏了"）。改为经 `pathToFileURL()` 转成 file URL 后再动态 import；macOS/Linux 上两种写法解析到同一个文件，行为不变。

### 测试

- 新增护栏：以伪 DSH 根 + 桩 schemastery 走完整 `applyCompatibleRuntime`，装载失败时 settings 命名空间不会注册；manifest 用例断言宿主必须写成 `await import(pathToFileURL(resolved).href)`。
- 修掉 Windows 上失效或假失败的用例：DSH 安装探测补 `where` 分支（原先只跑 POSIX 的 `command -v dsh`，导致"真实 schemastery 全链路"用例在 Windows 上被整体跳过，这个缺陷因此漏网）、伪造 DSH 根的目录软链改用 `junction`（`symlink(..., 'dir')` 需要开发者模式）、入口定位断言改为比较 realpath 之后的根、`cordis.patch.yml` 比较前归一化 CRLF。

### 文档

- `AGENTS.md` 记录 schemastery 装载的 file URL 契约、Windows 独有的失败面，以及"设置页分区在、但动作按钮灰掉"的排查顺序。

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
