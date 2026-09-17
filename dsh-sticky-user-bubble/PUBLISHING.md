# 发布清单

`dsh-sticky-user-bubble` 已发布到公共 npm registry（`0.1.3` 起，2026-09-17）。发布由 tag 驱动：推送 `dsh-sticky-user-bubble-v<版本>` 会触发根仓库 `.github/workflows/release.yml`，经 npm trusted publishing（OIDC）带 provenance 发布，不依赖长期 token；工作流会拒绝与 `package.json` 版本不一致的 tag、拒绝 `private: true` 的包，并在发布后回查 registry 上的版本。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag

```bash
git tag dsh-sticky-user-bubble-v0.1.4
git push origin dsh-sticky-user-bubble-v0.1.4
```

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-sticky-user-bubble`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-sticky-user-bubble-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-sticky-user-bubble-0.1.4.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-sticky-user-bubble
```

## 发布后抽查

客户端行为有改动时，重启后刷新页面，在长对话里确认：

- `dsh web --dump-config` 的 bundle graph 含 `dsh-sticky-user-bubble`，boot graph 含 `@deepseek-ai/dsh-client-ui-chat`。
- 顶部初始隐藏；原气泡（含底部内边距与圆角）完全离开可视区后才出现副本。
- 让位时保留消息间距、新卡片不被遮挡；点击或键盘激活能回到原消息。
- 长内容 hover/focus 展开不越过 composer；流式回答期间展开状态不闪断。

更细的 GUI 清单见 `AGENTS.md` 的「验证」。

## CI

`.github/workflows/ci.yml` 在 Node.js 20/22 上执行 `npm run publish:check`，不发布任何东西；发布是 `.github/workflows/release.yml` 的独立作业，走 OIDC 认证。
