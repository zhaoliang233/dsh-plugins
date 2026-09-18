# 发布清单

`dsh-auto-load-history` 已发布到公共 npm registry（`0.1.1` 起，2026-09-17）。发布由 tag 驱动：推送 `dsh-auto-load-history-v<版本>` 会触发根仓库 `.github/workflows/release.yml`，经 npm trusted publishing（OIDC）带 provenance 发布，不依赖长期 token；工作流会拒绝与 `package.json` 版本不一致的 tag、拒绝 `private: true` 的包，并在发布后回查 registry 上的版本。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag

```bash
git tag dsh-auto-load-history-v0.1.3
git push origin dsh-auto-load-history-v0.1.3
```

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-auto-load-history`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-auto-load-history-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-auto-load-history-0.1.2.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-auto-load-history
```

## 发布后抽查

打开一个历史很长的会话，确认：顶部的「加载更早」消失且紧凑排版立即折叠每个回合；设置 → 通用出现「会话历史」行，切到「手动」后新开会话不再自动补齐；会话打开后立刻向上滚动时分页暂停，回到底部继续；刷新页面后偏好保持。

更细的契约与验证清单见 `AGENTS.md`。

## CI

`.github/workflows/ci.yml` 在 Node.js 20/22 上执行 `npm run publish:check`，不发布任何东西；发布是 `.github/workflows/release.yml` 的独立作业，走 OIDC 认证。
