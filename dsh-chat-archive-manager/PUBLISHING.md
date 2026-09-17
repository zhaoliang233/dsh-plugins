# 发布清单

`dsh-chat-archive-manager` 已发布到公共 npm registry（`0.1.2` 起，2026-09-17）。发布由 tag 驱动：推送 `dsh-chat-archive-manager-v<版本>` 会触发根仓库 `.github/workflows/release.yml`，经 npm trusted publishing（OIDC）带 provenance 发布，不依赖长期 token；工作流会拒绝与 `package.json` 版本不一致的 tag、拒绝 `private: true` 的包，并在发布后回查 registry 上的版本。

## 发布闸门

```bash
npm run publish:check      # 语法检查 + 单元测试 + tarball 内容白名单
npm publish --dry-run      # 跑 prepublishOnly 并构造包，不上传
```

## 打 tag

```bash
git tag dsh-chat-archive-manager-v0.1.3
git push origin dsh-chat-archive-manager-v0.1.3
```

## 安装路线

用户路线是官方 profile manager 直接装 registry 上的包（`dsh plugin --profile web add dsh-chat-archive-manager`，卸载用 `remove`）；源码 checkout 保留本地 `link:` 路线 `./install.sh` / `./uninstall.sh`（同样先跑完整 `publish:check`）。

发布前用隔离 DSH Home 验证准确 tarball：

```bash
release_root="$(mktemp -d /tmp/dsh-chat-archive-manager-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-chat-archive-manager-0.1.3.tgz"   # 换成本次发布的版本
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" dsh web --dump-config
DSH_HOME="$release_root/dsh-home" dsh plugin --profile web remove dsh-chat-archive-manager
```

## 涉及破坏性能力时的发布前核对

只在版本新增到 manifest 的已验证清单、或改动了删除事务时执行；逐项针对被加入清单的每个 DSH 版本：

- `GET /dsh-chat-archive-manager/status` 报告 `workspaceProjection: false` 与预期的删除能力。
- 隔离 profile 的 cold JSONL 能通过真实 HTTP 路由实删，并清掉 Workspace 与归档记账，同时不动共享附件。
- 本进程打开过的空闲 live 会话：卸载后实删成功，且 `lsof` 不再持有该会话的 `session.lock`；运行中或有排队输入的会话返回 `session-busy` 且零副作用。
- 未归档、不存在、open handle/writer/pending materialization、迁移准备中、有后代的会话都被拒绝。
- 当前 generation 的 `session.v3.jsonl` 与 `session.v3.jsonl.zstd` 通过 revision/header/identity 校验；更早 generation fail closed；journal 与 trash 目录在 rename 前 durable 且同一 `st_dev`。
- 非空或损坏的事务日志只进入 quarantine，不做自动 rename、回滚、前滚或递归删除。
- 旧版 `$DSH_HOME/workspaces/archived` 空壳注册被注销，目录、会话日志与记账保留；不出现归档专用 Workspace。

更细的 GUI 交互清单见 `AGENTS.md` 的「验证」。

## CI

`.github/workflows/ci.yml` 在 Node.js 20/22 上执行 `npm run publish:check`，不发布任何东西；发布是 `.github/workflows/release.yml` 的独立作业，走 OIDC 认证。
