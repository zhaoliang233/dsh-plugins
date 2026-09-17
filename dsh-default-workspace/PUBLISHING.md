# 发布清单

`dsh-default-workspace` 已发布到公共 npm registry（`0.1.1` 起，2026-09-17）。发布由 tag 驱动：推送 `dsh-default-workspace-v<版本>` 会触发根仓库 `.github/workflows/release.yml`，经 npm trusted publishing（OIDC）带 provenance 发布，不依赖长期 token；工作流会拒绝与 `package.json` 版本不一致的 tag、拒绝 `private: true` 的包，并在发布后回查 registry 上的版本。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag

```bash
git tag dsh-default-workspace-v0.1.2
git push origin dsh-default-workspace-v0.1.2
```

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-default-workspace`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-default-workspace-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-default-workspace-0.1.2.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-default-workspace
```

## 发布后冒烟

行为有改动时，用隔离 `DSH_HOME` 启动 `dsh web --port 0 --no-open` 抽查：

- `GET /dsh-default-workspace/status` 报告 `通用会话` 位于 `$DSH_HOME/workspaces/default`，boot graph 含 `dsh-default-workspace`。
- 分组视图中受管 Workspace 排第一；原生「新会话」仍按核心规则选目标。
- 侧边栏底部的「新建通用会话」在 wide 与 rail 两种布局下都指向受管 Workspace。
- 改名/删除/排序请求被拒绝；移除包后 bundle 组成被清理，Workspace 与会话数据保留。
