# dsh-default-workspace

给 DeepSeek Harness Web 用的插件：提供一个受管的默认 Workspace（「通用会话」）承载非项目会话，并在侧边栏底部增加独立的「新建通用会话」入口。

## 功能

- 首次运行创建 `$DSH_HOME/workspaces/default`，并作为真实 DSH Workspace「通用会话」注册。
- 在分组视图中把它固定在 Workspace 列表首位。
- 在侧边栏底部、设置入口旁增加「新建通用会话」：打开「通用会话」中的空白会话，已存在则直接复用。
- 不改变 DSH 原生「新会话」的选择规则（当前 Workspace → 最近活跃 Workspace），项目分组上的新建入口也仍然进入对应项目。
- Host 与浏览器两层拒绝对受管 Workspace 的改名、删除和排序操作。
- 不移动、不删除任何已有 Workspace、会话或目录。

独立入口走的仍是 DSH 核心 `startSession(workspaceId)`，空白会话复用、Host 侧创建、导航、Fork 和持久化都保持核心行为。

## 要求

- DeepSeek Harness Web `>=0.1.7-alpha.1 <0.1.8`；`0.1.7-alpha.1` 已逐版本验证。同一发布线的后续版本会给出警告，并继续受服务与方法结构检查保护；范围外保持 inert。
- DSH 0.1.7 起核心自带「默认工作区」：只有在**工作区列表与会话历史都为空**时才会自动建一个标题「默认工作区」的工作区（目录在 `~/Documents/deepseek-harness/` 下），它没有重命名/删除保护，也没有独立的新建入口。本插件的受管「通用会话」在启动阶段先建好并置顶，因此那条路径通常不会触发；两者不是同一个目录，也不互相改写。
- Node.js 20 或更高版本。

## 安装与卸载

```bash
dsh plugin --profile web add dsh-default-workspace       # 安装
dsh plugin --profile web remove dsh-default-workspace    # 卸载
```

已发布为 [`dsh-default-workspace`](https://www.npmjs.com/package/dsh-default-workspace)；需要固定版本时追加 `@<版本>`。安装会向 profile 增加 bundle，而 bundle 列表只在启动时读取，因此**需要重启 `dsh web` 并刷新页面**。卸载只移除 profile 依赖和 bundle 层，受管目录、Workspace 注册和历史会话都会保留。

从源码运行：`./install.sh` 安装 `link:<源码目录>`，`./uninstall.sh` 移除，两者都走同一个官方 profile manager。

## 使用

- 「新会话」——DSH 原生目标选择（当前 Workspace → 最近活跃 Workspace）。
- 「新建通用会话」——侧边栏底部，显式打开或复用「通用会话」中的空白会话。
- 项目分组上的新建入口——进入对应项目。

受管 Workspace 解析期间的连续点击会合并为一次启动。解析失败时入口显示「新建失败，点击重试」，收起态 Tooltip 与无障碍标签表达同一状态。

## 注意事项

- 受管目录决定会话 cwd 和 `workspace-write` 写入边界；它不限制 DSH 与操作系统允许的绝对路径读取，写到目录之外仍需会话权限或一次性批准。
- DSH 尚未向独立客户端插件开放 Workspace 行级 capabilities，因此受管行仍可能显示普通的改名/删除菜单和拖动态；执行这些操作会被拒绝，且不改动任何数据。
- 状态接口要求 DSH trusted-host 与签名浏览器 cookie 认证，客户端显式携带同源凭据；裸 loopback `curl` 读不到受管路径和运行时诊断。

## License

MIT
