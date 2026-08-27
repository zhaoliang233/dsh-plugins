# dsh-default-workspace

A DeepSeek Harness Web plugin that provides a managed default Workspace for project-independent sessions and an explicit `New General Session` sidebar action.

[简体中文](#简体中文)

## Features

- Creates `$DSH_HOME/workspaces/default`, or reuses the known managed Workspace at that path, as a real DSH Workspace named `通用会话`.
- Keeps the managed Workspace first in grouped view.
- Adds a dedicated `新建通用会话` action beside Settings in the sidebar footer.
- Leaves DSH's native global New Session behavior unchanged: it still follows the current or most recently active Workspace.
- Preserves each project row's explicit New Session action and the standard mixed flat view.
- Rejects rename, delete, and reorder operations for the managed Workspace in both Host and browser layers.
- Never moves or deletes pre-existing Workspaces, sessions, or directories.

The dedicated action uses DSH's normal `startSession(workspaceId)` flow, including blank-session reuse, Host-owned session creation, navigation, Fork behavior, and persistence. The plugin does not implement a second session system.

## Requirements

- DeepSeek Harness Web `>=0.1.6-alpha.1 <0.1.7`.
- Individually verified DSH versions: `0.1.6-alpha.1`.
- Node.js 20 or newer.

The client follows the current service boundary: `workspaces` owns Workspace state and mutations, while `uiWorkspace` owns Session navigation. In-range future versions warn and remain guarded by service and method-shape checks; Host startup resolves the real DSH CLI package before any directory, Workspace, or route side effect and stays inert outside the range. Crossing into `0.1.6` requires a new compatibility audit.

## Rename Migration

This package replaces the unpublished local candidate `dsh-recent-chats`.

- The managed path remains `$DSH_HOME/workspaces/default`.
- An existing Workspace at that path is adopted only when its title is already `通用会话` or the legacy `最近聊天`; the legacy title is changed in place.
- A different existing title is treated as a conflict and is never overwritten. Startup fails with the conflicting path and title so the owner can resolve it explicitly.
- For an accepted migration, the Workspace ID, session membership, session logs, cwd values, and directory are preserved.
- The old package identity and `/dsh-recent-chats/status` route are not retained. Remove the old profile dependency before installing this package.

For a linked local installation:

```bash
dsh plugin --profile web remove dsh-recent-chats --config.minimumReleaseAge=0
./install.sh
```

Restart `dsh web` after the profile change, then refresh the browser.

## Distribution Status

This checkout is an unpublished local `0.1.1` candidate. The npm registry returned `E404` for `dsh-default-workspace` on 2026-08-28; an `E404` does not reserve the name.

## Local Install

From this source checkout:

```bash
npm run publish:check
./install.sh
```

`install.sh` runs the complete `publish:check` gate, then delegates to DSH's official profile manager and installs `link:<checkout-path>` into the selected Web profile. It does not copy plugin files.

A packed local candidate can be installed by exact tarball path:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-default-workspace-0.1.1.tgz --config.minimumReleaseAge=0
```

## Usage

- Use DSH's existing `新会话` control to continue following the current or most recently active Workspace.
- Use `新建通用会话` at the sidebar foot to explicitly create or reuse a blank session in `通用会话`.
- Use a project row's New Session action to target that project directly.

Repeated activation while the managed Workspace is being resolved is coalesced into one start operation. If resolution fails, the action changes to `新建失败，点击重试`; its rail tooltip and accessible label expose the same state.

## Uninstall

```bash
./uninstall.sh
```

Uninstalling removes the profile dependency and bundle layer but deliberately keeps the managed directory, Workspace registration, and session history.

## File Access

The managed directory controls the session cwd and the `workspace-write` mutation boundary. It does not restrict reads of absolute paths that DSH and the operating system allow. Writing outside the managed Workspace still requires the appropriate session permission or one-time approval.

## UI Limitation

The verified `0.1.6` release line does not expose row-level Workspace capabilities to independent client plugins. The managed row can therefore still display the standard rename/delete menu and drag affordance. Invoking those operations is rejected and does not change data.

The status route requires DSH trusted-host and signed browser-cookie authentication. The Client explicitly sends same-origin credentials; a bare loopback `curl` cannot read the managed filesystem path or runtime diagnostics.

## Local Development

Useful checks:

```bash
npm run publish:check
dsh web --dump-config
# Run from the authenticated DSH page console:
# await fetch('/dsh-default-workspace/status', { credentials: 'same-origin' }).then(r => r.json())
```

Activation rules:

- `lib/index.js`: restart `dsh web`.
- `client.js`: restart `dsh web` and refresh unless a DSH client-plugin watcher is rebuilding the bundle.
- `package.json` or `cordis.patch.yml`: run `./install.sh` again, then restart and refresh.
- Tests and documentation: no DSH restart is required.

Use another existing Web-capable profile when needed:

```bash
DSH_PROFILE=custom-web ./install.sh
DSH_PROFILE=custom-web ./uninstall.sh
```

For an isolated DSH Home:

```bash
DSH_HOME=/tmp/dsh-default-workspace-dev ./install.sh
DSH_HOME=/tmp/dsh-default-workspace-dev dsh web --port 0 --no-open
DSH_HOME=/tmp/dsh-default-workspace-dev ./uninstall.sh
```

`--port 0` prints a temporary URL. Uninstalling only removes the linked profile dependency; it does not remove Workspace or session data.

## 简体中文

`dsh-default-workspace` 为 DeepSeek Harness Web 提供一个用于非项目会话的受管默认 Workspace，并增加独立的“新建通用会话”入口。

兼容范围为 DSH `>=0.1.6-alpha.1 <0.1.7`，其中 `0.1.6-alpha.1` 已逐版本验证。同发布线后续版本会警告，并继续依赖服务和 Workspace 方法结构检查；Host 启动会在任何目录、Workspace 或路由副作用前核对真实 DSH CLI package，范围外保持 inert。进入 `0.1.7` 前必须重新审计。

### 主要行为

- 创建 `$DSH_HOME/workspaces/default`，或接纳该路径上标题为“通用会话”/旧标题“最近聊天”的已知受管 Workspace。
- 在分组模式中固定于 Workspace 列表首位；单列表模式继续正常混排全部会话。
- 在侧边栏底部、设置入口旁增加“新建通用会话”。
- 不再拦截 DSH 原生“新会话”：原生入口仍跟随当前 Workspace，再回退到最近活跃 Workspace。
- 项目分组上的新建按钮仍进入对应项目。
- Host 和浏览器两层拒绝对受管 Workspace 的改名、删除和排序操作。
- 不移动、不删除任何已有 Workspace、会话或目录。

独立入口仍调用 DSH 核心 `startSession(workspaceId)`，因此继续使用核心的空白会话复用、Host 会话创建、导航、Fork 和持久化逻辑。状态接口先通过 DSH trusted-host 与签名浏览器 cookie 认证，Client 显式携带同源凭据；裸 loopback 请求不能读取受管路径或运行时诊断。

### 从旧候选迁移

本包替代未发布的本地候选 `dsh-recent-chats`。受管路径保持不变；该路径上标题为“最近聊天”的旧 Workspace 会被原地接纳并改名为“通用会话”。Workspace ID、成员关系、会话日志、cwd 和目录均不改变。如果同一路径已经注册为其他自定义标题，插件会拒绝启动并报告冲突，不会覆盖标题或调整顺序。

本地链接迁移：

```bash
dsh plugin --profile web remove dsh-recent-chats --config.minimumReleaseAge=0
./install.sh
```

profile 变化后需要重启 `dsh web`，再刷新浏览器。旧包身份和 `/dsh-recent-chats/status` 路由不再保留。

### 分发状态与安装

当前源码是未发布到 npm 的本地 `0.1.1` 候选。2026-08-28 查询 npm registry 时，`dsh-default-workspace` 返回 `E404`；名称在真实发布前不会被保留。

```bash
npm run publish:check
./install.sh
```

也可以通过最终本地 tarball 的绝对路径安装：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-default-workspace-0.1.1.tgz --config.minimumReleaseAge=0
```

卸载使用 `./uninstall.sh`。它不会删除受管目录、Workspace 注册或历史会话。

### 使用与边界

- 普通“新会话”继续采用 DSH 原生目标选择规则。
- 点击侧边栏底部的“新建通用会话”，显式进入“通用会话”。
- 点击项目分组的新建入口，显式进入对应项目。

解析受管 Workspace 失败时，入口会显示“新建失败，点击重试”；收起态的错误色、Tooltip 和无障碍标签表达同一状态。连续点击产生的解析过程会合并为一次启动。

受管目录决定会话 cwd 和 `workspace-write` 写入边界。它不会限制 DSH 和操作系统允许的绝对路径读取；写入受管目录之外仍需相应会话权限或一次性批准。

已验证的 DSH `0.1.6` 发布线尚未向独立插件开放 Workspace 行级 capabilities，因此受管行仍可能显示普通 Workspace 的菜单和拖动样式，但相应操作会被拒绝。

### 本地调试

```bash
npm run publish:check
dsh web --dump-config
# Run from the authenticated DSH page console:
# await fetch('/dsh-default-workspace/status', { credentials: 'same-origin' }).then(r => r.json())
```

修改 `lib/index.js` 后需要重启 `dsh web`。修改 `client.js` 后，如没有 client-plugin watcher，也需要重启并刷新。修改 `package.json` 或 `cordis.patch.yml` 后先重新执行 `./install.sh`，再重启并刷新。

## License

MIT
