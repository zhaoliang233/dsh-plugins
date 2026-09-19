# dsh-mobile-compat

一个面向 DeepSeek Harness Web 的移动端兼容插件：手机视口下把三栏 Shell 重排为全宽对话并把侧边栏变成抽屉，同时修好设置界面、输入区、触控命中区与安全区。插件不替换任何核心 occupant，只做外壳级、可逆的适配；所有行为都由已逐版本核对的公开能力与精确结构探测把关。

## 功能

- 手机视口下把三栏 Shell 重排为全宽 Conversation，Sidebar 变成带遮罩的**全屏**抽屉（与右栏在 <768px 自动全屏的形态一致；横屏大屏上仍保留抽屉宽度）。
- 让 SidebarRoot 填满抽屉，修复 Workspace 搜索与操作区在触控布局下被裁切的问题。
- 在 `shell.overlay` 提供 44px 的 Sidebar 入口，外观与位置按手机 header 自身的 20px 留白来做：28×28 裸图标框、图标 15px，与右侧栏入口距各自边缘的距离一致、同一行；抽屉内所有增强命中区至少 44px。
- 手机会话标题栏保留标题与两侧所有操作入口（任务 / 日程 / 智能体预设 / 终端、模式、智能体团队、更多菜单）：它们在一条横向可滑动的 strip 里，滑块隐藏、不占高度，标题栏总高度与原生一致；拖动 strip 即可够到右侧被挡住的部分，拖动后松手不会误触底下的按钮。
- 抽屉打开时把焦点移入 Sidebar、隔离被覆盖的 Conversation/Rightbar、双向约束 Tab、支持 Escape，关闭后恢复入口焦点；出现其他 modal 时暂停这套隔离。
- 把 Settings 两列弹窗重排为 `100dvh` 全屏界面，Section 导航改为横向滚动标签。
- 缩小 Conversation/Composer 的横向留白，约束代码与媒体溢出；Composer 文本编辑器字号至少 16px（避免 iOS 聚焦时缩放）。Composer 操作行（附件、模式、模型、发送）保持 44px 触控尺寸，但**待发送附件的缩略图条保持 DSH 原生尺寸**（缩略图 64px、右上角删除键 18px），放大命中区用不可见靶区实现，不改变外观。
- 可逆地补充 `viewport-fit=cover`，并使用 `dvh`、安全区与 reduced-motion 能力。
- 手机上右侧栏保留为零宽 grid 轨道，并让它的原生浮层在其中全屏显示：不再对整列 `display:none`，因此手机右栏仍可打开，也不清空桌面的右栏宽度偏好。右侧栏面板在手机上补齐安全区、44px 控制条与内容列惯性滚动。
- 抽屉入口与右栏面板互斥：点左侧入口时，若右栏面板正开着就先收起它再打开抽屉；右栏原本关着时不会去碰它（面板自己的收起键是**对称切换**，盲点一下反而会把它打开、进而全屏盖住抽屉）。
- 用可见视口高度（`visualViewport`）约束 `aria-modal` 对话框与 `role=menu`/`listbox` 弹层，避免 iOS 软键盘把它们底部吞掉。
- 每次激活都会停用上一代插件遗留的悬浮层（标记 `data-dsh-mobile-orphan` 后隐藏并停止接收点击），避免长时间打开或反复热更新后留下多余的入口和点不动的遮挡层。

## 要求

- DeepSeek Harness Web `>=0.1.6-alpha.1 <0.1.7`；`0.1.6-alpha.1` 与 `0.1.6-alpha.2` 已逐版本核对（两者的客户端产物逐文件比对只差 `agent-preset` 与 `cordis` 两个包）。同线后续 alpha/beta/rc/正式版允许带警告运行，并继续由公开能力与精确 DOM 结构检查 fail closed；跨到 `0.1.7`、低于 `0.1.6-alpha.1` 或落在其他发布线时拒绝运行。
- 浏览器需要支持 `:has()`：建议 iOS Safari 15.4 或同等能力的 Chromium。
- Node.js 20 或更高版本（仅安装与发布检查需要）。

## 安装与卸载

```bash
dsh plugin --profile web add dsh-mobile-compat        # 安装
dsh plugin --profile web add dsh-mobile-compat@0.3.6  # 升级到指定版本
dsh plugin --profile web remove dsh-mobile-compat     # 卸载
```

已发布为 [`dsh-mobile-compat`](https://www.npmjs.com/package/dsh-mobile-compat)。profile 依赖是 caret 范围，升级需要显式写版本号。安装会向 profile 增加 bundle，而 bundle 列表只在启动时读取，因此**需要重启 `dsh web` 并刷新页面**。

从源码运行：`./install.sh` 会先检查当前 DSH 版本与 `web` profile、运行完整发布闸门，再通过官方 profile manager 安装 `link:<源码目录>`（不直接改写用户的 `cordis.patch.yml`）；`./uninstall.sh` 移除。卸载只移除 profile 依赖和 bundle 层，不修改 DSH 源码、会话、Workspace 或用户设置。

## 生效范围

- viewport 宽度不超过 720px；或 coarse pointer 且宽度不超过 900px（手机横屏）。
- 真实软键盘、非零 notch 安全区与不同 WebView 的行为仍需在实机上逐版本复核；Chromium 模拟不能替代这部分证据。

## 注意事项

- DSH 的 CSS Module 类名与部分 DOM 结构不是公共 ABI：插件不使用类名 hash、不读取 `window.__DSH_BOOT__`，只按已核对的结构与公开能力探测；任一能力、状态接口或结构探测失败时都不会安装 CSS、viewport 修改或 Slot 入口，并保留原生布局（必要时输出一次诊断）。
- 启动时会用 `GET /dsh-mobile-compat/status` 读取真实运行的 DSH 版本（接口先通过 DSH trusted-host 与签名浏览器 cookie 认证），范围外保持惰性。
- 这是外壳级兼容层，不会把 DSH 私有 DOM 变成公共 ABI：公开能力、结构契约或发布线上界改变时，正确做法是 fail closed、重新验证并发布新版本，而不是猜测兼容。
- 768–900px 的粗指针设备上右侧栏覆盖在 Conversation 之上，而不是把中间栏挤窄。
- Settings 内各插件自己的复杂 Section 仍需自行保证响应式；320px 下模型名称的完整展示属于 Composer 所有者，本插件不修补。

## License

MIT
