# dsh-default-workspace 技术说明

## 目标

以独立双面插件为 DSH Web 提供受管的“通用会话”默认 Workspace（`$DSH_HOME/workspaces/default`），并通过独立侧边栏入口显式创建通用会话；不修改 DSH 源码或已安装的 `@deepseek-ai/*` 包。

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
- Host 保护覆盖当前 `>=0.1.6-alpha.1 <0.1.7` 发布线的公开 Workspace RPC 路径；Host 在任何目录、Workspace 或路由副作用前从真实 CLI package 执行运行时版本门，范围外或来源不可验证时保持 inert。`engines.dsh` 与同一 range 同源，由 `test/manifest.test.js` 守卫。
- Workspace 方法保护经 `Symbol.for('dsh.workspace-method-interceptors.v1')` 注册到可摘除 dispatcher；cleanup 只撤销本插件节点并恢复安装前的 own descriptor（原方法继承自 prototype 时必须 `delete` 实例 wrapper），避免遮蔽后续 HMR。
- status route 必须先通过 `connection.requestRejection(req)` 的 trusted-host 与签名浏览器 cookie 认证；Client fetch 显式 `credentials: 'same-origin'`，不得向裸 loopback 请求暴露本机路径与运行时诊断。
- `0.1.6-alpha.1` 没有行级 capabilities，受管行仍会显示核心菜单和拖动态；保护靠方法补丁，不靠隐藏 UI。
- 不得修改受管路径之外的 Workspace；卸载不删除 Workspace、会话或目录。
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
