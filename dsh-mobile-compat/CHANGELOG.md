# 变更记录

本文件记录本项目的所有重要变更。

## [0.3.2] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「功能 → 要求 → 安装与卸载 → 生效范围 → 注意事项」，只描述当前行为，结构探测与验证清单留在 `AGENTS.md`。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-mobile-compat`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- `PUBLISHING.md` 改中文并补上兼容矩阵校验与隔离浏览器回归的运行方式。

## [0.3.1] - 2026-09-14

首个公开发布到 npm registry 的版本。

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对 source-verified 契约矩阵：layout bundle 逐字节相同，sidebar bundle 只差构建字符串，workspace header/search/action 标记未变，settings 外壳未变，sidebar-right 面板标记未变，conversation 骨架只是拆到多个文件（`ConversationContent` 仍渲染同样的 `body > [data-conversation-scroll]` 树，没有新增 wrapper），因此所有结构探测仍然成立。已验证发布线移到 `>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 是唯一的源核对版本。

### 修复

- 停用上一代 bundle 遗留的悬浮层：每次激活给自己那份 `.dmc-layer` 打上 `data-dsh-mobile-layer-generation`，并把其他所有 layer 标为 `data-dsh-mobile-orphan`（`display:none` + `pointer-events:none`）。残留的悬浮入口会持续盖住 header，0.2.x 之前那份全屏 backdrop 会吞掉整页点击——表现就是“多了 UI 且部分 UI 失灵”。
- 样式表文本与当前 bundle 不一致时重写它，并打上 `data-plugin="dsh-mobile-compat"`。DSH 会把未打标签的 `<style>` 认领给下一个物化的客户端 bundle 并随其热更新删除，可能导致样式被交给别的插件、或升级后残留，页面一直沿用上一代规则直到手动刷新。

## [0.3.0] - 2026-09-10

- 细化移动端 header 几何：只把悬浮入口占用的通道留在 header 的**第一行**，使 `对话/轨迹` 标签行保持 DSH 原生留白（375px 实测：标签从 x=72 回到 x=28），不再被整块留白推右。
- 把悬浮入口的可视 chip 通过 `::after` 内缩到 36px，同时保留 44×44 命中盒、上移到 `top: 4px`，并把焦点环移到 chip 上：它不再压过 header 行，chip 底边 y44、命中盒底边 y48 都不会进入 y50 起的标签行。
- 不再在移动端隐藏右侧栏列：0.1.5 起右栏是该列内的绝对定位浮层（fullscreen 时 `position: fixed; inset: 0`，低于 768px 自动生效），对整列 `display:none` 会把已打开的右栏压成 0×0，手机上根本显示不出来。现在该列保留零宽 grid 轨道，对话保持全宽，原生右栏仍可打开。
- 已验证兼容线从 `>=0.1.2-alpha.3 <0.1.3` 移到 `>=0.1.5-alpha.2 <0.1.6`：`0.1.5-alpha.2` 是唯一源核对的版本，下界停在已验证版本而不是猜测 `0.1.5-alpha.1` 也匹配。
- AppFrame 结构探测改到 0.1.5 的 seat：中间列承载直接的 `main` seat（ConversationRoot occupant），右列承载直接的 `rightbar` seat；已退休的 `conversation`/`details` seat 名会让插件在 0.1.5 上完全惰性。
- 移动端只用 CSS 隐藏右列，绝不调用 0.1.5 的 `layout.closeRightbar()`，从而保留桌面右栏宽度偏好。
- 修复悬浮入口的 header 净空规则：0.1.5 把会话 header 渲染在 `display:contents` 的 Slot anchor 内，净空 padding 现在作用于 anchor 内的 header 元素，而不是 anchor 本身。
- 把 `compatibility.json#contracts` 的 owner 与预期更新到 0.1.5 AppFrame，并同步刷新运行时版本门、检查清单、安装脚本门禁、测试与文档。
- 兼容策略从过期的精确 channel 迁移到带运行时能力检查保护的版本发布线。
- 使用 `connection.generation` 就绪契约；该能力缺失时保持惰性。
- 通过可访问的 textbox 语义覆盖 contenteditable 版 Composer，包含 16px 移动端输入规则与浏览器断言。
- 把部分挂载的 AppFrame 与 Slot occupant 视为 pending，避免在已验证结构完成前误报不兼容；持续 pending 时只输出一次延迟诊断。
- 激活前要求 `layout.toggleSidebar()` 可用，并在观察 childList 之外同时观察结构属性变化，使 HMR 或 owner 属性漂移能立即停用并可恢复。

## [0.2.0] - 2026-08-28

- 引入最初的精确 channel 兼容矩阵（已被上面的发布线策略取代）。
- 增加 npm channel 与 artifact provenance 检查，以及 `compatibility.json` 中的机器可读 selector/API 契约。
- 增加由执行中的 CLI package manifest 支撑的 no-store 版本接口，并让浏览器激活依赖该精确版本与 fail-closed 的 AppFrame/Slot 结构探测。
- 通过移除移动端的 `layout.closeDetails()` 变更，保留桌面的 Details 偏好。
- 增加抽屉 modal 语义、compare-and-restore 的 `inert`/ARIA 隔离、紧凑关闭控件焦点入口、双向 Tab 环绕、竞争 modal 暂停、Escape 恢复，以及 900→901 与移动↔桌面的直接切换处理。
- 命中区提升到 44px，并让 Workspace 搜索与操作区留在移动抽屉内。
- 加入 Node 22 的 CDP 浏览器回归，覆盖移动、横屏、断点、焦点、Settings、诊断与桌面恢复。

## [0.1.0] - 2026-08-28

- 增加由公开 layout Service 与 `shell.overlay` 驱动的移动端 Sidebar 抽屉：把 inline-width 的 SidebarRoot 展开到抽屉全宽，并让 40px 的 Workspace 操作区留在 header 内。
- 增加窄屏下的 Settings、Conversation、Composer、触控命中区、viewport 与安全区兼容规则。
- 在不使用 CSS Module hash selector 的前提下同时支持最初的 textarea 与 contenteditable 两种 Composer 形态。
- 对最初支持的 DSH artifact 在移动、横屏与桌面视口下做运行时测试。
- 声明精确的 DSH 兼容元数据，并在安装时对未声明版本 fail closed。
- 记录每次 DSH 升级后必须重新验证兼容性。
