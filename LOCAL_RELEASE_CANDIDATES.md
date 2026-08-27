# Local Release Candidates

> **历史快照，已被取代**：本文件只记录 2026-09-02 那一轮本地候选（当时基于 `@deepseek-ai/dsh 0.1.2-alpha.4`，产物为一次性 `/tmp` 路径）。
> 其中的版本号、tarball 路径与 SHA-256 均已失效，已删除。后续兼容发布线见各插件 `AGENTS.md` 与 `CHANGELOG.md`；包名与发布状态以 registry 和各自的 `PUBLISHING.md` 为准。

## 这次快照留下的、仍然有效的约定

- 快照产物只用于本地分发与验证：**没有任何包发布到 npm**，全程未执行 `npm publish`、未打 tag，也未访问远端。
- 浏览器交互验证当时明确留给用户，快照不声称做过。
- 未读取或复制任何用户凭据，也未发起真实第三方 API 请求。
- registry 包名可用性当时未复核：出现过 `E404` 不构成占位，发布前必须重新确认。
- 数据保留、安全与发布要求以各包的 `README.md`、`PUBLISHING.md`、`AGENTS.md` 为权威。
