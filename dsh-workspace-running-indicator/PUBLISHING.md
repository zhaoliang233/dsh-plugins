# 发布清单

`dsh-workspace-running-indicator` 已于 **2026-11-09 首发 `0.1.0`**（占位 `0.0.1` → trusted publisher → tag 触发 OIDC，三项判据通过）。后续发版走根 `AGENTS.md` 的常规流程：改版本号 → 写 CHANGELOG → `npm run publish:check` → 打 `<包名>-v<版本>` tag → push。

## 发布前先查包名

```bash
npm view dsh-workspace-running-indicator maintainers
```

2026-11-04 查得该名未被占用（`E404`）。发布前必须重查——历史上两个插件的旧名都在"查过之后"被别人占用。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag（正式发布）

```bash
git tag dsh-workspace-running-indicator-v0.1.0
git push origin HEAD && git push origin dsh-workspace-running-indicator-v0.1.0
```

tag 必须与 `package.json#version` 完全一致；工作流会拒绝 `private: true` 的包，并在发布后回查 registry。

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-workspace-running-indicator`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-workspace-running-indicator-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-workspace-running-indicator-0.1.0.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-workspace-running-indicator
```

## 发布后抽查

客户端行为有改动时，重启后刷新页面，在侧边栏确认：

- `dsh web --dump-config` 的 bundle graph 含 `dsh-workspace-running-indicator`。
- 有会话在跑的工作区，收起后标题行尾出现转圈；展开后转圈消失、会话行保留原生状态提示。
- 鼠标移入工作区行：背景高亮、展开箭头、行尾菜单与新建按钮行为与未装插件时一致；整行点击仍能展开/收起。
- 最后一条会话结束后，收起状态的转圈自动消失。
- 卸载插件后，行上不再残留 `data-dsh-workspace-running` 属性与样式表。

更细的验证说明见 `AGENTS.md`。

## CI

`.github/workflows/ci.yml` 在 Node.js 20/22 上执行 `npm run publish:check`，不发布任何东西；发布是 `.github/workflows/release.yml` 的独立作业，走 OIDC 认证。
