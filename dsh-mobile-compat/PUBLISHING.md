# 发布清单

`dsh-mobile-compat` 已发布到公共 npm registry（`0.3.1` 起，2026-09-14）。发布由 tag 驱动：推送 `dsh-mobile-compat-v<版本>` 会触发根仓库 `.github/workflows/release.yml`，经 npm trusted publishing（OIDC）带 provenance 发布，不依赖长期 token；工作流会拒绝与 `package.json` 版本不一致的 tag、拒绝 `private: true` 的包，并在发布后回查 registry 上的版本。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单（含兼容矩阵校验）
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag

```bash
git tag dsh-mobile-compat-v0.3.2        # 换成本次发布的版本，必须与 package.json#version 完全一致
git push origin dsh-mobile-compat-v0.3.2
```

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-mobile-compat`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-mobile-compat-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-mobile-compat-0.3.2.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-mobile-compat
```

## 兼容性与浏览器证据

兼容发布线由 `compatibility.json` 的机器可读矩阵声明（`package.json#dshCompatibility` 指向它）；只有逐版本读过 DSH 源码并核对契约的版本才能写进 `verifiedVersions`，跨发布线或收录未核对版本都必须先重新读源码。发布前必须：

```bash
npm run compatibility:check    # 与当前安装的 dsh --version 比对
node scripts/check-compat.js --manifest
```

新增已验证版本、跨发布线或改动结构探测时，浏览器回归必须重跑——两个 URL 显式指向隔离 DSH Home 的随机端口 server 与隔离 Chrome，绝不连接用户自己的 3080 GUI：

```bash
DSH_MOBILE_DEVTOOLS=http://127.0.0.1:9333 \
DSH_MOBILE_SMOKE_URL=http://127.0.0.1:<isolated-port>/ \
DSH_MOBILE_SMOKE_PREFIX=/tmp/dsh-mobile-compat \
npm run test:browser
```

覆盖 320x568、390x844、457x707、568x320、844x390、900/901px、1023/1024px 与桌面布局。真实软键盘、安全区、长会话、代码/媒体、主题与 Locale 仍需人工实机复核；Chromium 模拟不算证据。更细的清单见 `AGENTS.md`。

## CI

`.github/workflows/ci.yml` 在 Node.js 20/22 上执行 `npm run publish:check`，不发布任何东西；发布是 `.github/workflows/release.yml` 的独立作业，走 OIDC 认证。
