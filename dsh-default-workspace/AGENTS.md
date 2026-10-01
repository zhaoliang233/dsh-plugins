# dsh-default-workspace 技术说明

## 目标

以独立双面插件为 DSH Web 提供受管的“通用会话”默认 Workspace（`$DSH_HOME/workspaces/default`），并通过独立侧边栏入口显式创建通用会话；不修改 DSH 源码或已安装的 `@deepseek-ai/*` 包。

## 逐版本核对记录

**`0.2.0-rc.2`（2026-10-01，跨发布线：DSH 从 `0.1.7-rc.2` 升到 `0.2.0-rc.2`）**：按根 `AGENTS.md` 的「插件兼容性检查」走完。逐包比对（全树逐文件 sha256）后，本插件依赖的面**全部保持**：

- `dsh-workspace`（Host 侧 `workspaceRegistry` 与拦截器消费端）**逐字相同**——`create`/`createCanonical`/`delete`/`rename`/`insertBefore`/`initializeDefault` 的签名与语义都没动。
- `dsh-client-ui-workspace/lib/client.js` 本轮有 11 处 hunk，但**全部落在无关区域**：会话改名命令的快捷键（`KeyR`→`KeyG`）与门控（`target.blank`/modal/`activePanelId`）、标题空值处理（`displayTitle`→`title?.trim()`）、`forkSession(sessionId, onCreated)` 新增分析回调、新增 `session.untitled` 文案。补丁目标 `workspaces.rename`/`workspaces.delete`/`workspaces.insertBefore` 与 `startSession(workspaceId)`/`unarchiveSession` 的**上下文逐字相同**，四个方法的出现次数也一致（`insertBefore(1)`/`rename(4)`/`delete(6)`/`create(6)`）。
- `dsh-client-ui-sidebar/lib/client.js` 的 `sidebar.footer.action`（3 处）、`footArea`（8 处）、`footerActions`（6 处）**逐字相同**——独立入口的挂载点未变。
- `@deepseek-ai/dsh-api-workspace-controller` 改了（核心首次使用的默认工作区），但**只给解析 Documents 目录的 shell 调用加了 `"hidden"` 窗口模式参数**（osascript/`powershell.exe`/`xdg-user-dir`），路径推导与标题逻辑未动——「用户界面里会不会同时看到两个默认工作区」这条观感判断的前提不变。
- `dsh-client-connection` 的 `requestRejection`、图标集（188 个无漂移）均未变。

改动：`lib/index.js` 的版本门改成**从 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` 派生**（跨线只需改这三个常量 + 清单，判定逻辑不动），`package.json`/`engines.dsh`/`install.sh`/`README.md` 四处同源更新，`install.sh` 的 shell 判定同步泛化。**插件业务代码一字未改**。

**未覆盖**：受管 Workspace 的创建、置顶、改名/删除保护，以及独立入口按钮在 0.2.0 上的**实机**行为；「会不会同时看到两个默认工作区」的观感判断——与本轮变更无关，但仍是未实机确认项。

**更早一轮（`0.1.7-rc.2`，2026-09-28）的逐包比对**：已归档到 [`docs/compat-log.md`](../docs/compat-log.md)。那一轮唯一仍然有效的结论已并入「关键约束」（`dsh-workspace` 的 `initializeDefault()` 不再被本插件调用，只作为 `coreDefaultWorkspace` 能力探测如实报出）。

## 结构

- `lib/index.js`：Host 半体。创建或接纳受管目录，经 `ctx.workspaceRegistry` 命名“通用会话”、置顶并保护，注册 `/dsh-default-workspace/status`。
- `client.js`：浏览器半体。在 `sidebar.footer.action` 注册“新建通用会话”，显式调用 `ctx.uiWorkspace.startSession(managedId)`；只补丁纯 `workspaces` Controller 的 `rename/delete/insertBefore` 做保护。注入的 `<style>` 必须打 `data-plugin="dsh-default-workspace"`（机制见根 `AGENTS.md`）。
- `cordis.patch.yml`：插件自己的 `dsh.bundle` 配置层。
- `install.sh` / `uninstall.sh`：调用官方 `dsh plugin --profile web add/remove` 管理 profile 依赖和 bundle 顺序。
- `test/*.test.js`：Node 内置测试，覆盖 Host 注册表策略、旧标题接纳、独立入口、原生新会话不被替换和浏览器保护。

## 关键约束

- Workspace 必须是真实目录：Host 先 `mkdir` 再调用 `workspaceRegistry.create`。
- 只接纳受管路径上标题为“通用会话”或历史标题“最近聊天”的 Workspace；其他标题必须 fail closed——不覆盖标题、不调整顺序、不创建第二个 Workspace、不移动会话、不改 cwd。
- 原生全局 New Session 保持 DSH 核心规则（显式 Workspace → 当前会话 Workspace → 最近活跃 Workspace）：**禁止**再拦截无参数 `startSession()`（曾用它接管原生入口，已移除）。
- “新建通用会话”注册到 list slot `sidebar.footer.action`，稳定 ID `dsh-default-workspace.new-session`、order `100`；必须经 `ctx.slots.inject()` 等待 slot 声明，并同时适配 wide 与 56px rail；解析失败必须在按钮、rail Tooltip 和 aria-label 显示可重试错误状态，不能只写控制台。
- 独立入口只用核心 `startSession(workspaceId)`，不发明第二套会话归属；导航不能用 `workspaces`（纯 Workspace Controller，不承载会话导航）。
- 核心把新 Workspace 插到列表首位，因此补丁 `workspaceRegistry.create` 后必须重新把默认 Workspace 置顶。
- Host 保护覆盖当前 `>=0.2.0-rc.2 <0.2.1` 发布线的公开 Workspace RPC 路径；Host 在任何目录、Workspace 或路由副作用前从真实 CLI package 执行运行时版本门，范围外或来源不可验证时保持 inert。版本门由 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` 派生（跨线只改这几个常量），与 `package.json`/`engines.dsh`/`install.sh` 四处同源，由 `test/manifest.test.js` 守卫。
- Workspace 方法保护经 `Symbol.for('dsh.workspace-method-interceptors.v1')` 注册到可摘除 dispatcher；cleanup 只撤销本插件节点并恢复安装前的 own descriptor（原方法继承自 prototype 时必须 `delete` 实例 wrapper），避免遮蔽后续 HMR。
- status route 必须先通过 `connection.requestRejection(req)` 的 trusted-host 与签名浏览器 cookie 认证；Client fetch 显式 `credentials: 'same-origin'`，不得向裸 loopback 请求暴露本机路径与运行时诊断。
- `0.1.6-alpha.1` 没有行级 capabilities，受管行仍会显示核心菜单和拖动态；保护靠方法补丁，不靠隐藏 UI。
- 不得修改受管路径之外的 Workspace；卸载不删除 Workspace、会话或目录。
- **不调用核心的 `workspaceRegistry.initializeDefault()`**（0.1.7 起它的签名从 `() => Promise<{path,title}>` 改成 `() => Promise<string>`）：本插件在 Host 启动阶段自己先建受管 Workspace，registry 随即不为空，核心那条「首次使用默认工作区」路径不会触发。本插件只把探测结果作为 `coreDefaultWorkspace` 如实报出——**别去调它**，否则界面上会出现第二个「默认工作区」（目录在 `~/Documents/deepseek-harness/default-workspace`，与受管的 `$DSH_HOME/workspaces/default` 不是同一个）。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-default-workspace-v<版本>` tag 后经 npm trusted publishing（OIDC，无长期 token）完成。用户安装路线是官方 `dsh plugin --profile web add dsh-default-workspace`，`./install.sh` 只是源码 `link:` 开发路线。

## 本地调试

- 官方路线 `dsh plugin --profile web add dsh-default-workspace`（卸载用 `remove`）；源码路线 `./install.sh` 安装 `link:$PLUGIN_DIR`，profile 直接读源码、不复制文件，`package.json` 或 `cordis.patch.yml` 变更后需重新执行。两条路线改变 profile 组成后都要由用户重启 `dsh web`。
- `lib/index.js` 变更后重启 `dsh web`；`client.js` 变更在没有 client-plugin watcher 时同样需要重启并刷新。
- 隔离调试：`DSH_HOME=/tmp/dsh-default-workspace-dev ./install.sh`，启动用 `dsh web --port 0 --no-open`。

```bash
npm run check && npm test && npm run publish:check
dsh web --dump-config
# 在已认证 DSH 页面控制台执行：
# await fetch('/dsh-default-workspace/status', { credentials: 'same-origin' }).then(r => r.json())
```
