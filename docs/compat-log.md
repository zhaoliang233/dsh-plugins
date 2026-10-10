# 插件兼容性检查 — 历史与证据

> 本文件是**历史档案**，不是指令。根 `AGENTS.md` 只保留「怎么做」（分级判据、固定动作、汇报格式、当前归属），每一轮的**结论、证据、踩坑**记在这里。
> 需要回顾某一轮做了什么、为什么这么判断、哪些结论已经被实测证伪时读它；执行一次例行的「检查插件的兼容性」**不需要**读它。
> 记录按时间倒序。新的一轮写完后，请只把**跨轮有效的规则**提炼进根 `AGENTS.md`，其余留在本文件。
> 2026-10-08 起两个未发布插件改名（`dsh-mcp-manager` → `dsh-mcp-console`、`dsh-default-overrides` → `dsh-default-tuner`，见 E1）。**早于该日期的段落已按新名同步替换**，所以它们描述改名前的状态时可能读起来自相矛盾（如「包名被第三方占用」说的一定是**旧名**）——遇到这类句子请对着 E1 的对照表回读。

## 目录

| 轮次 | 版本 | 结论 |
|---|---|---|
| F1（2026-10-10） | `0.2.1-alpha.2` | L1 两个插件 `dsh-default-workspace` + `dsh-extra-context` 整体换到 `>=0.2.1-alpha.2 <0.2.2`（换线不是放宽上界）；逐包 diff 后契约面只有 `uiWorkspace.startSession` 变了（单参数=总是新建空白会话），已按 `{clearPreviousDraft:false}` 保住复用语义；换线前两条 `/status` 404、换线后 200 |
| E1（2026-10-08，改名） | `0.2.0-rc.2` | 两个未发布插件在 npm 上撞名，整体改名：`dsh-mcp-manager` → `dsh-mcp-console`、`dsh-default-overrides` → `dsh-default-tuner`（新名同日实测未被占用）；包名/条目 id/bundle 注册名/设置条目 id/路由与头名/内部前缀/文档同步，**功能与版本号未动**，两包 `publish:check` 全绿；本机 web profile 已切到新名 |
| D1（2026-10-01） | `0.2.0-rc.2` | L2 插件 `dsh-default-tuner` 跨线完成（工作区最后一个停在旧线的插件）：契约面逐项有证据、门常量照基准形状改成从常量派生、13 档矩阵 + 四处同源全过；隔离宿主实测「范围外零注册（两种形态）」与「门内可写 profile 补丁」；顺带证伪了一条假守卫（文档腿 `includes` 判据）与一条错误取证方式（靠 cordis 日志） |
| C1（2026-10-01，收口） | `0.2.0-rc.2` | 全仓一致性收口：9 个插件的四处声明逐字核对完毕、门常量形状统一、离线网全绿、7 个已发布包的 registry/provenance/GitHub Release 三件事复核通过；`dsh-default-tuner` 明确留在 0.1.7 线（跨线另立一轮），两个被占用的包名写清阻塞 |
| B6（2026-10-01） | `0.2.0-rc.2` | L3 插件 `dsh-mobile-compat` 跨线完成：业务代码一字未改，全尺寸矩阵（9 档视口）在隔离宿主上全绿；顺带实测出「合成 PointerEvent 测不出真实触摸语义」与「下界从 alpha 换成 rc 时旧判定会静默放行」 |
| B5（2026-10-01） | `0.2.0-rc.2` | L3 插件 `dsh-chat-archive-manager` 跨线完成：本轮真正改动的两个包逐行核对为「不在删除事务路径上」，隔离宿主 61+39 项全过（含中途中断与可恢复性闭环） |
| B4（2026-10-01） | `0.2.0-rc.2` | L3 插件 `dsh-sticky-user-bubble` 跨线完成：六个几何常量在隔离宿主上重新量出且与 0.1.7 全线一致；顺带实测出「版本门盖不住纯客户端插件的浏览器半体」 |
| B3（2026-10-01） | `0.2.0-rc.2` | L3 插件 `dsh-mcp-console` 跨线完成：业务代码一字未改，GUI 52/52 两轮 + 凭据/对账链路实测 |
| B2（2026-10-01） | `0.2.0-rc.2` | L2 两个插件跨线完成：契约逐行有证据、隔离宿主端到端跑通 |
| B1（2026-10-01） | `0.2.0-rc.2` | L1 两个插件跨线完成，已实机验证 |
| A1–A3（2026-10-01） | `0.1.7-rc.2 → 0.2.0-rc.2` | 只做侦察 + 补一个缺失的版本门 |
| 例行（2026-09-28） | `0.1.7-alpha.2 → 0.1.7-rc.2` | L1 两个插件推进；L2/L3 交接 |

---

## F1：L1 跨线 `dsh-default-workspace` + `dsh-extra-context`（2026-10-10）

运行版本 `0.2.1-alpha.2`，上一验证线 `>=0.2.0-rc.2 <0.2.1`（registry 上 `latest` 至今仍是 `0.2.0-rc.2`，**没有 0.2.0 正式版**，所以上一验证版本就是 rc.2）。两个 L1 插件按用户要求**整体换线**：`DSH_RELEASE_LINE='0.2.1'`、`DSH_RELEASE_FLOOR={channel:'alpha',sequence:2}`、清单 `['0.2.1-alpha.2']`、range `>=0.2.1-alpha.2 <0.2.2`。**换线不是放宽上界**：0.2.0 线整段出局（`0.2.0-rc.2`/`0.2.0` 都判 unsupported）。本轮**不改版本号、不提交、不发版**。

**逐包 diff**（`npm install @deepseek-ai/dsh@0.2.0-rc.2` 到 `/tmp/dsh-020-src`，与运行安装全树逐文件 sha256）：共同包 290 个全部随线到 `0.2.1-alpha.2`（`schemastery` `3.18.4 → 3.18.5-alpha.1`、`cordis-plugin-loader` `1.0.5 → 1.0.6-alpha.1`）；两个插件的契约包逐项结论见各自 `AGENTS.md` 的新记录，提炼成一句：**只有 `uiWorkspace.startSession` 的语义变了，其余契约面逐字相同**。

| 包 | lib/ 里真正动了什么 |
|---|---|
| `dsh-workspace` | `lib/index.js` **逐字相同**（只删了 `lib/invariant.js` 与类型） |
| `dsh-api-workspace-controller` | lib 逐字相同（只有 README 与 `package.json` 版本号） |
| `dsh-client-ui-workspace` | `lib/client.js` 大量新增（内联 `partial-json` 等无关区域）；`workspaces` 控制器关键词行、`reuseOrCreateBlank`/`reuseBlank` 逐字相同，**唯一实质变化：`startSession(workspaceId, options)`** —— 类型声明 `lib/types/client/navigation.d.ts`：单参数 = 总是新建空白会话，`{clearPreviousDraft:false}` = 复用已有空白会话 |
| `dsh-client-ui-sidebar` | `sidebar.footer.action`/`footArea`/`footerActions` 声明逐字相同（改的是 CSS 与版本号字面量） |
| `dsh-client-connection` | `requestRejection` 多两个入参（绑定地址/协议）；loopback http 的 401/403 判据与语义不变 |
| `dsh-host-webserver` | `register()`（重复路径抛错 + disposer）逐字相同 |
| `dsh-system-prompt` | 只改 runtime-context（新增 `refreshContext()`）；section 的 `interpolate:false` 分支与组装/遮蔽逐字相同 |
| `dsh-agent-loop` | `renderPrompt()` 函数体与调用点逐字相同 |
| `cordis-plugin-loader` | `_commitVolatile()` 逐字相同；`_init()` 多留一份 `moduleNamespace` 给 HMR |
| `dsh-settings` / `dsh-config-editor` / `dsh-compaction-basic` / `dsh-client-ui-settings` / `dsh-client-ui-slots` / `dsh-client-store` | lib 逐字相同（`dsh-compaction-basic/lib/index.js` 连 sha256 都一致） |
| `dsh-client-ui-primitives` | `Switch` 组件块与 `Switch.module.css` 逐字相同；新增 `CommandText`/`InlineEditor` |
| `dsh-llm` | `llm/stream` waterfall 与 `adapterStream` 读 `resolvedOptions.messages` 的行逐字相同 |
| `dsh-session` | `assertSystemHeadRewrite` / `applySurfacePlan` 逐字相同 |
| `dsh-client-ui-settings-general` | `navIcon` 逐字相同（唯一实质改动是版本号字面量与侧边栏 CSS） |

**换线发现的实质修复**：`dsh-default-workspace` 的独立入口「新建通用会话」原先靠 `startSession(workspaceId)` 拿到「已存在空白会话则复用」——0.2.1 起单参数含义变成「总是新建空白会话」，与插件 README/AGENTS.md 写明的行为不符。修法是补上 `{ clearPreviousDraft: false }`（旧线忽略多余参数，两条线同一语义），`client.js` 里留了注释、AGENTS.md 写进关键约束，别退回单参数。

**闸门与实测**：

- 两包 `npm run publish:check` 全绿（`dsh-default-workspace` 19 项 + tarball 7 文件；`dsh-extra-context` 75 项 + 8 文件）；全仓 9 个插件 `npm test` **456 项全过**。
- `node tools/dsh-icons/check.js` 无漂移（188 个，Medium/Regular 各 94）；`node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context --measure` **六项全过**（label 偏移 36/9 与壳层原生行一致、原 svg 被隐藏、mask 生效、`::before` 16×16）。
- 隔离宿主（`DSH_HOME=/tmp/dsh-line-021-home`、端口 3099、手写 profile = `dsh-base` + `dsh-web-app` + 两个插件；用户的 3080 全程未触碰，验证后已停）：**换线前两条 `/status` 都是 404**（与随机路径同码 → 版本门挡住、零注册），**换线后都是 200**。旁证：default-workspace 无 cookie 401、extra-context 有 cookie 但缺 `x-dsh-extra-context-client` 403、随机路径仍 404；两个 body 分别给出受管 Workspace（`$DSH_HOME/workspaces/default`、标题「通用会话」、`coreDefaultWorkspace:true`）与 `writable:true`（→ 0.2.1 上 `Config` schema 装载成功）；两个 client bundle 都在索引页 boot graph 里（各 5 处——与版本门无关，符合既有结论）。

**踩坑与可复用技巧**：隔离 profile 的 `cordis.patch.yml` 必须是**顶层 YAML 数组**，写注释 + 空文件会以 `must be a top-level YAML array of loader patch entries` 拒绝启动——空覆盖层要写 `[]`。

**仍未覆盖 / 交接**：

- 两个插件的**实机观感与点击**：受管 Workspace 的置顶/改名删除保护、独立入口按钮、设置页分区与导航图标实机外观（离线几何与单测已过）。
- `dsh-default-workspace` 的 `startSession` 语义修复只在源码 + 单测层面确认，隔离宿主没有开浏览器。
- **换线后这两个包的源码与 registry 上的 0.2.0 版本不再对应**：要让用户装到新线，需按发布流程 bump 版本、写 CHANGELOG、发版（本轮按用户要求没做）。
- **其余 7 个插件仍在 `0.2.0` 线，在 `0.2.1-alpha.2` 上按版本门 inert**（用户当前 3080 宿主就是这个状态），要逐插件另开一轮跨线。

---

## E1：两个未发布插件改名（2026-10-08）

两个**还没有发布过**的插件在 npm 上撞名（旧名都被第三方占着）。撞名的后果不是"难找"，而是**发布一定失败、`dsh plugin add <包名>` 还会装到别人的包上**。本轮只做改名与文案同步：**不改功能、不改版本号、不发布、不提交**。

| 插件 | 旧名 → 新名 | 旧名被占用的情况（2026-10-08 实测） |
|---|---|---|
| MCP 服务器管理 | `dsh-mcp-manager` → `dsh-mcp-console` | 0.6.0、维护者 `nichts`，描述与我们**同名同题** |
| 默认设置覆盖 | `dsh-default-overrides` → `dsh-default-tuner` | 0.5.3（当天还在更新）、维护者 `chenwei116057`、Bash/PowerShell overrides |

**新名可用性**：`npm view <名> --json` 返回 404（registry 上没有该包）。同时把候选池探过一遍，顺手排除了别人已占的同类名（`dsh-mcp-panel` / `servers` / `hub` / `studio` / `center` / `setting` 全被占）。

**改名的落点**（两个插件同形，`dsh-mcp-console/AGENTS.md` 有一张逐项表）：包名 → `cordis.patch.yml` 的条目 id/name → 浏览器 bundle 注册名（`client.js` 的 `ModuleLoader.load({ id })`）→ 宿主/客户端常量（`PLUGIN_NAME`/`SETTINGS_ENTRY`/`SECTION_ID`）→ 两条 HTTP 路由与两个固定头名 → **内部短前缀**（`dmm`→`dmc`、`ddo`→`ddt`，含 CSS 类名与导航补丁的 dataset/CSS 变量）→ 目录名 → install/uninstall 脚本与四份文档。

**为什么内部前缀也一起改**：前缀是包名的缩写，留着就是过期命名（新读者对不上包名）；改名铺得广但全部有既有断言兜住，反倒"只改包名不改前缀"没有任何检查会发现不一致。

**闸门**：两包 `npm run publish:check` 各自全绿（`dsh-mcp-console` 104 项单测 + 打包 12 文件；`dsh-default-tuner` 44 项 + 打包 8 文件），全仓 9 个插件 **456 项单测全过**；`tools/dsh-icons/build.js` 重新生成快照后 `check.js` 无漂移（188 个图标、Medium/Regular 各 94），`verify-nav-icon.js --plugin dsh-mcp-console --measure` **六项全过**（label 偏移 36/9 与壳层原生行一致、原 svg 被隐藏、mask 生效、`::before` 恰好 16×16、壳层行未被动过）。

**profile 侧的两处坑**（都实际踩到了）：

1. **改名会同时打断 profile 的三处引用**：依赖键（`link:` 指向旧目录）、`dsh.profile.bundles` 列表、`cordis.patch.yml` 里的 `- id: <旧名>`。三处不改，重启后插件要么加载失败、要么 patch 只打印 `entry "…" not found`。
2. **顺序决定成败**：**必须在改目录名之前先 `dsh plugin remove <旧名>`**。先改目录再 remove 时，profile 的 `node_modules/<旧名>` 已悬空，`remove` 以 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS` 失败；更麻烦的是它**可能已先把依赖删掉、只把旧名留在 bundle 列表里**（本轮就是这个中间态），收尾只能手工删 bundles 里的旧项 + 删悬空符号链接。`pnpm install` 不会清理这类悬空链接（它只对账清单，输出 `Already up to date`）。

**仪器问题（未修，留给后续）**：`verify-nav-icon.js` 等无头 Chrome 公布调试地址的窗口是 **8 秒**（80 × 100ms），而这台 Intel Mac 上冷启动实测要约 **10.3 秒**——`--measure` 会以 `Chrome 没有公布调试地址` 失败。本轮用一份把窗口放宽到 40 秒的**临时副本**跑通六项（仓库里的工具没动）。要修就是那一处常量（`attempt < 80` → 更大），与插件无关。

**可复用结论**：改名不是"改一个字符串"——包名/条目 id/bundle 注册名/设置条目 id 四处必须同时改，否则症状分别是「设置页没有分区」或「插件进了 profile 但页面毫无反应」（两个插件都有守卫测试钉住）；而 profile 侧的迁移要**先卸后改名**。

---

## D1：L2 跨线 `dsh-default-tuner`（2026-10-01）

工作区里**最后一个**停在旧线的插件（`>=0.1.7-alpha.1 <0.1.8`）跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。**本轮不改 `package.json#version`、不提交、不打 tag、不改名、不发版**（包名仍被第三方占用，见 C1 第 5 节）。

### 为什么按 L2 做完而不是升成 L3

按根 `AGENTS.md` 的临时定级规则先取逐包 diff（`npm install @deepseek-ai/dsh@0.1.7-rc.2` 到临时目录 vs 本机运行安装）：它点名的契约面里**只有两处真的动了**（`dsh-config-editor` 的 `configuration()`、`dsh-app-boot` 的 `OPTIONAL_BUNDLES`），其余逐字相同；而它"整块改写 profile 补丁"的风险点全在 `ConfigEditor.edit()` 里，那一整段（文件锁 → 条目身份复核 → `internal/config` 校验 → js-yaml 原地改节点 → 原子写 → 失败回滚）**逐字未变**。所以 L2 成立，一个会话做完。

### 契约面逐项复核（读的是实际安装包，不是 CHANGELOG）

| 契约项 | 0.2.0-rc.2 现状（行号取自该版本） | 与 0.1.7-rc.2 的关系 |
|---|---|---|
| profile 补丁事务 `configEditor.edit()` | `dsh-config-editor/lib/index.js:69-135`：锁 profile 的 `package.json`（`:72`）→ 条目身份复核（`:73` "no longer available"、`:76` "changed during reload"）→ `next = change(current, inherited)`（`:77-79`）→ `fiber.state !== 2` 拒绝（`:81` "Configuration plugin is no longer active"）→ 先 `waterfall('internal/config')` + `resolveConfig()` 校验再落盘（`:82-83`）→ 原地替换 / 追加 `config`（`:98`、`:105-110`）→ `!!js` 由 `__jsExpr` 标记重建（`:111-116`）→ 候选 == 继承层时删 `config`、只剩 id/name 时连行删（`:99-104`）→ 更高层覆盖报错（`:122`）→ `writeFileAtomic(..., { mode: 384 })`（`:123`）→ reconcile 失败回写原文 + 重放旧 patches（`:124-130`） | **逐字相同** |
| `configuration()` | 只有一处 hunk（`dsh-config-editor/lib/index.js:39-53`）：不在 `overridden` 里的条目改成一次 `composeEntries()` 查表，不再逐个调 `inherited()` | A1–A3 已用 8 场景合成 profile 证明两版输出逐字相同（等价重构）；插件只消费 `{entry, inherited, override}` 这层形状，未受影响 |
| 事务的底层依赖 | `dsh-atomic-write` / `cordis-plugin-loader` / `@deepseek-ai/cordis` / `schemastery` 逐字相同；`dsh-app-boot` 只有 `OPTIONAL_BUNDLES` 加一项（`lib/index.js:552-556`） | 逐字相同（app-boot 的 compose/read/reconcile profile 三个函数未动） |
| 目标条目 schema（整块写入的前提） | `dsh-session-title-first-prompt-llm/lib/index.js:73-81` 的 5 个字段全 `.required()`；`dsh-session-title/lib/index.js:203-205` 的 3 个字段全 `.required()` | 两个包 lib 逐字相同（只有 `package.json` 的 version 变）。白名单 8 个字段都在顶层，写的是"当前生效配置 + 新值"，required 项必然齐全 |
| 标题预检口径 | `frameMessages()`（`dsh-session-title-llm/lib/index.js:157`）与插件 `TITLE_INPUT_PREFIX`（`lib/overrides.js:269`）逐字一致；超限文案在 `:193-194`，与插件正则一致；`titleInput` 投影注册在 `dsh-session-title/lib/index.js:237`、`stateOf` 在 `dsh-session-projection/lib/index.js:127` | 逐字相同 |
| 会话与标题服务 | `sessionTitle.get(session)`（`dsh-session-title/lib/index.js:281`）、`refresh(session, signal)`（`:319`）逐字相同；`dsh-session` 的 `get(id)`（`:1855` 前）与 `list()`（`:1868`）未变 | `dsh-session` 的 4 处 hunk 全在 `repair.js` 的失败工具结果恢复与导出表 |
| 状态路由与能力探测 | `dsh-host-webserver/lib/index.js:177-186`（`{kind:'exact'|'prefix', path, handler}`、重复路径抛错、返回 disposer）、`dsh-client-connection/lib/index.js:586-589`（`403` 栅栏 → `401` 未认证 → `undefined` 放行） | lib 逐字相同（只有 `package.json` 的 version 变） |
| 客户端 slot | `settings.section` 仍由 `dsh-client-ui-settings-general/lib/client.js:1111-1141` 声明为 list slot（需 `id`）；内置分区 order 仍是 −10/0/10/15/20（上限 20）；插件 `id:'default-overrides'` / `order:110` 无并列 | `dsh-client-ui-settings/lib/client.js` **逐字节相同** |
| 官方控件与图标 | `dsh-client-ui-primitives/lib/index.js` 导出表（`:12381`）里 `Button`/`Input`/`Tag`/`IconTriangleRightFillMedium`/`IconTriangleRightFillRegular` 全在；`Input` 只是包了 `forwardRef`，props 与形态不变 | `Button`/`Tag` 定义逐字相同 |
| `dsh-settings` | lib 逐字相同（只有 `package.json` 的 version 变）。本插件宿主**不消费 `settings` 服务**（`ctx.get` 清单里没有它） | 逐字相同 |
| 图标集 | `node tools/dsh-icons/check.js` 无漂移（188 个，Medium/Regular 各 94） | — |

**改动面**：`lib/index.js` 的门改成从 `DSH_RELEASE_LINE='0.2.0'` + `DSH_RELEASE_FLOOR={channel:'rc',sequence:2}` + `PRERELEASE_CHANNELS` 派生（清单 `VERIFIED_DSH_VERSIONS=['0.2.0-rc.2']`，全部普通字面量，形状照已跨线的 8 个插件）；`install.sh` 补上五个常量 + `prerelease_rank()`；`package.json`/`engines.dsh`/`README.md`/`AGENTS.md` 四处同源。**业务代码一字未改**。

### 隔离宿主实测（`DSH_HOME=/tmp/ddo-020-home`、端口 5945；验证后已停掉并删除目录，用户的 3080 全程未触碰）

手工搭的隔离 profile 只有 `dsh-base` + `dsh-web-app` + 本插件（+ 一个取证探针），不走 `dsh plugin add`。三组判据：

| 场景 | 判据 | 结果 |
|---|---|---|
| 范围外（跨线前，声明 `>=0.1.7-alpha.1 <0.1.8`） | 探针抢占两个 exact 路由 | **都抢到**（路径空闲）；插件条目 `fiber.state = 2`、`configEditor`/`sessions`/`sessionTitle` 都在；两个路由 **404**（与随机路径同码） |
| 范围外（新门第二形态：副本声明 `>=0.2.1 <0.2.2`） | 同上 + 补丁文件 md5 | 两个路由同样空闲；**profile 补丁 md5 与启动前逐字节一致**（零副作用） |
| 门内（跨线后同一宿主重启） | 探针抢占 + status/action 真实往返 | 两个路由**抢不到**（duplicate）；未认证 401；带 cookie + 客户端头的 status **200**、两个条目 `writable:true`、8 个字段默认值 4096/64/60000/5/10 与 80/5/40；apply 写 `maxInputBytes=8192` → 补丁追加**整块 config**、注释未丢 → `dsh --profile web --dump-config` 独立核对也读到 8192 → reset 后补丁**逐字节还原**、生效值回到 4096 |

离线网：本插件 `npm run publish:check`（44 项 + tarball 8 文件）通过；工作区 9 个插件 `npm test` 共 **456 项全过**；`node tools/dsh-icons/check.js` 无漂移。

**shell 侧与 lib 侧逐条一致**（单测只按行解析 `install.sh` 的常量，这里真跑一遍判定）：用桩 `dsh`（`--version` 回放被测版本）+ 桩 `pnpm`/`npm` 跑 `install.sh`，13 档矩阵的「接受且已核对 / 接受带警告 / 拒绝」与 `classifyDshVersion()` **逐行相同**，另加 `0.2.0-rc.0`、`0.3.0` 两档也一致——`0.2.0-alpha.9` 这一档正是下界从 alpha 换成 rc 后旧判定会静默放行的那个。

### 两条被实测证伪的做法（本轮新事实，跨轮有效）

- **"看日志确认插件 inert"是假证据**：cordis 的默认 logger exporter 只把消息塞进内存 ring buffer（`cordis/lib/index.js:598-601`，`bufferSize = 1000`），既不写 stdout 也不落文件——隔离宿主启动后逐字 grep 不到 `unsupported DSH …` 完全不能说明什么。可靠判据是**路由表**：`dsh-host-webserver.register()` 对重复 (kind, path) 抛错，所以让一个探针插件去抢占被测插件自己的 exact 路由，"抢到 = 没注册、抢不到（duplicate）= 已注册"；再加未认证时的 401（门内）与 404（范围外）作旁证。
- **`assert.ok(text.includes('<版本>'))` 的文档腿守卫是假的**：清单版本号恰好是 range 下界的子串，把 `AGENTS.md` / `README.md` 的兼容段整行改掉**仍然全绿**（本轮注入缺陷实测）。改成"先定位含「兼容线」/「逐版本验证」的那一行，再核对 range 与清单逐字相等"才真正拦得住（现在把任一处改掉都会红）。

### 踩坑与可复用技巧

- **隔离 profile 不必 `dsh plugin add`**：`~/.dsh/profiles/web` 只有 60K——`node_modules` 里除 11 个 `link:` 符号链接外基本是空壳，`@deepseek-ai/*` 由安装锚点解析。手写一份 `package.json`（`dsh.profile.bundles` = `dsh-base` + `dsh-web-app` + 目标插件）+ 空的 `cordis.patch.yml` + 一个指向源码目录的**绝对**符号链接即可起宿主，省掉 pnpm 安装与网络。
- **认证 cookie 从启动 URL 拿**：`dsh --profile web --port <非 3080> --no-open` 会把 `http://127.0.0.1:<p>/?token=…` 打到 stdout；`curl -c cookies.txt "<那个 URL>"`（返回 303）就拿到 `dsh-auth-…` cookie，之后带 cookie + `x-dsh-<插件>-client: 1` 才能过 `connection.requestRejection`。
- **门内/门外的判别码不同**：同一路径在门内未认证是 **401**、在范围外是 **404**——这个差值本身就是"路由有没有注册"的判据，比看日志可靠。
- **探测入口形状**：插件的 `readDshPackage(process.argv[1])` 只认 `@deepseek-ai/dsh/package.json`；用假 DSH 目录（改版本号）+ 转发到真实 `bin.js` 的做法**起不来宿主**（静默退出），想造"宿主版本不在门内"的场景不能走这条路——用探针插件副本改声明，或直接用纯函数 + `applyForVersion` 的零注册用例。

### 仍未覆盖

- 隔离宿主里**没开浏览器目视** inert 时的客户端文案（单测与代码路径已覆盖）。
- 真机（用户 `127.0.0.1:3080`）要等用户**重启 `dsh web`**：`lib/` 属 Host 代码，重启后该插件才从"按版本门 inert"变成"门内可用"；客户端 bundle 刷新页面即可。
- 会话标题重算与"兜底会话列表"两条正向路径仍未造出（历史遗留，见本插件 `AGENTS.md`）。

---

## C1：0.2.0 线收口（全仓一致性 + 发布状态复核，2026-10-01）

八轮跨线（B1–B6，加上更早的 A1–A3）之后的一次**只做收口、不做跨线**的轮次：运行版本 `0.2.0-rc.2`，全部改动都在版本门常量形状、文档与发布闸门定义上，**没有一行业务逻辑**。

### 1. 四处声明的逐字核对（9 个插件 × 5 个落点）

核对的落点：`package.json#dshCompatibility.range`、`engines.dsh`、lib 门常量（`DSH_COMPATIBILITY_RANGE` / `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` / 清单常量）、`install.sh` 的五个常量、插件 `AGENTS.md` 与 `README.md` 的兼容段；`dsh-mobile-compat` 另加 `compatibility.json`。

- **8 个已跨线插件：五处逐字一致**，全部 `>=0.2.0-rc.2 <0.2.1` / 清单 `0.2.0-rc.2` / 发布线 `0.2.0` / 下界 `rc.2`。**没有发现「改了 `package.json` 忘了 `install.sh`」这类半跨线**——这是本轮最想证伪的东西，结果是零命中。
- `dsh-mobile-compat` 的 `compatibility.json`（`range` / `verifiedVersions` / `versions[0]` / 16 条 `contracts.versions`）与 `package.json` 同源，`scripts/check-compat.js` 每次 `npm run check` 都会强制核对（`--manifest` 离线、`--installed` 读 `dsh --version`）。
- 第 9 个 `dsh-default-tuner` **四处自洽地停在 `>=0.1.7-alpha.1 <0.1.8`**（`0.1.7-rc.2` 已核对），所以在 `0.2.0-rc.2` 上 inert。它是唯一缺 `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` 与 `install.sh` 三个派生常量的插件。
- `dsh-mobile-compat` 的宿主半体（`lib/index.js`，101 行）**不带版本门**，门在 client bundle + `install.sh`——与 B4 记下的「版本门盖不住纯客户端插件的浏览器半体」一致，是既定设计而非缺陷。

### 2. 门常量形状统一（本轮的实质改动）

统一前的形状矩阵（`lib` 侧；`install.sh` 侧 8 个已跨线插件本来就都有五个常量）：

| 插件 | 清单常量 | 下界常量 | channel 数组 |
|---|---|---|---|
| `dsh-extra-context` / `dsh-default-workspace` / `dsh-auto-load-history` / `dsh-sticky-user-bubble` / `dsh-mcp-console` | `VERIFIED_DSH_VERSIONS = ['0.2.0-rc.2']` | `{ channel: 'rc', sequence: 2 }` | ✅ |
| `dsh-chat-archive-manager` | **`DSH_VERIFIED_VERSIONS` = `Object.freeze([...])`** | **`Object.freeze({...})`** | ✅ |
| `dsh-local-plugin-manager` | `Object.freeze([...])` | **`Object.freeze({...})`** | ✅ |
| `dsh-mobile-compat`（`client.js`） | **`new Set([...])`** | `{ channel: 'rc', sequence: 2 }` | ✅ |
| `dsh-default-tuner` | `VERIFIED_DSH_VERSIONS = ['0.1.7-rc.2']` | 无 | 无 |

四处等价差异（名称前缀、`Object.freeze`、`Set`、`install.sh` 里多行 vs 单行 `if`）**行为完全相同**，但形状不同会让下一次跨线无法照一个模板机械地改 9 个包。本轮按用户选择把前三处收敛到早期插件（`dsh-extra-context`）的基准形状，`install.sh` 的排版差异只记录不改：

- `dsh-chat-archive-manager`：`DSH_VERIFIED_VERSIONS` → **`VERIFIED_DSH_VERSIONS`**，清单与下界都去掉 `Object.freeze`（`lib/index.js` + `install.sh` 注释 + `test/manifest.test.js` 三处引用同步）。
- `dsh-local-plugin-manager`：清单与下界去掉 `Object.freeze`（`lib/profile-manager.js`）。
- `dsh-mobile-compat`：`client.js` 的 `new Set(['0.2.0-rc.2'])` → `['0.2.0-rc.2']`，判定从 `.has()` 改 `.includes()`（`test/manifest.test.js` 的断言同步）。
- **等价性是独立验证过的**，不是靠「测试还是绿的」推断：对三个改过的插件 + `dsh-extra-context` 跑同一张 13 档矩阵（`0.2.0-rc.2`、`+build.1`、`0.2.0`、`rc.3`、`0.2.1`、`0.1.7-rc.2`、`alpha.1`、`alpha.9`、`beta.4`、`rc.1`、`0.1.8-alpha.1`、`undefined`、空串），四列**逐行一致**（`rc.2`/`+build.1` 接受且 verified、`0.2.0`/`rc.3` 接受带警告、其余全部 reject）。
- `install.sh` 侧仍是两种排版（`dsh-default-workspace` / `dsh-chat-archive-manager` / `dsh-mcp-console` 用多行 `if ... then return 0 fi`，其余用单行），语义等价，**刻意不动**：`install.sh` 不在 npm 发布物里（`files` 白名单不含它），改它只为排版收益太低。

### 3. 离线网（收口后重跑，全绿）

| 闸门 | 结果 |
|---|---|
| 9 个插件 `npm test` | **454 项全过**（37 + 78 + 42 + 19 + 75 + 45 + 104 + 26 + 28），0 失败 |
| `node tools/dsh-icons/build.js` + `check.js` | 无漂移（188 个图标，Medium/Regular 各 94）；build **幂等**，跑完 `git status` 干净 |
| `verify-nav-icon.js --measure`（4 个有导航图标补丁的插件） | `dsh-extra-context` / `dsh-chat-archive-manager` / `dsh-local-plugin-manager` / `dsh-mcp-console` 各 **六项全过**，`shellRow` 与 `patched` 的 `labelOffsetLeft/Top` 都是 36/9 |
| `npm run publish:check`（改动过的三个包） | `dsh-chat-archive-manager` 78 项 + tarball 9 文件；`dsh-local-plugin-manager` 45 项 + tarball 10 文件；`dsh-mobile-compat` 26 项 + tarball 9 文件 |

### 4. 发布闸门差异（顺手补齐）

`dsh-local-plugin-manager` 是 9 个里唯一**没有 `publish:check`** 的：它的 `verify` 只有 `check` + `test`，缺 tarball 白名单校验，`prepublishOnly` 绑的也是 `verify`，`install.sh` 跑的还是 `npm run verify`。本轮补上 `scripts/check-pack.js`（复制既有实现，白名单按它真实的 10 个文件写死）、`pack:check` 与 `publish:check`（= `verify` + `pack:check`），并把 `prepublishOnly` 与 `install.sh` 都改为跑 `publish:check`。

**收口后的逐包回查又抓到两处漏项**（当时「9 个同名同覆盖」这句话是错的，同日补上）：① `dsh-default-tuner` 有 `publish:check` 但不含 `pack:check`——它自己的「待办」里本来就记着"还没有 `scripts/check-pack.js`"；② `dsh-mcp-console` 的 `install.sh` 跑的是 `npm run verify` 而不是 `publish:check`。补齐后 9 个插件的发布闸门才是真的同名同覆盖：每个都有 `publish:check`（= `check` + `test` + `pack:check`），每个的 `install.sh` 都跑它。

### 5. 发布状态与包名阻塞（三件事逐包复核）

7 个名字归我们的包**已在 registry 上可见 0.2.0 线的版本**，且三件事全部通过：

| 包 | registry 版本 | `dist.attestations` | GitHub Release |
|---|---|---|---|
| `dsh-extra-context` | `0.2.0` | ✅ `slsa.dev/provenance/v1` | ✅ `dsh-extra-context-v0.2.0` |
| `dsh-default-workspace` | `0.2.0` | ✅ | ✅ `…-v0.2.0` |
| `dsh-auto-load-history` | `0.2.0` | ✅ | ✅ `…-v0.2.0` |
| `dsh-local-plugin-manager` | `0.3.0` | ✅ | ✅ `…-v0.3.0` |
| `dsh-sticky-user-bubble` | `0.2.0` | ✅ | ✅ `…-v0.2.0` |
| `dsh-mobile-compat` | `0.5.0` | ✅ | ✅ `…-v0.5.0` |
| `dsh-chat-archive-manager` | `0.2.0` | ✅ | ✅ `…-v0.2.0` |

`git tag` 与 `package.json#version` 一一对应、无未推送提交。**两个包名仍被第三方占用**（当时是 `dsh-mcp-manager` 与 `dsh-default-overrides`；2026-10-08 已改名为本条用的新名）。这一条本轮只做记录、不改名：

- `dsh-mcp-manager`（现名 `dsh-mcp-console`）：已跨到 0.2.0 线，但 registry 上的 `dsh-mcp-manager@0.6.0` 维护者是 `nichts`，描述与我们**同名同题**。它是唯一「跨线完成却发不出去」的包；用户本轮决定**不改名**，所以它继续留在本地 `link:` 路线。
- `dsh-default-overrides`（现名 `dsh-default-tuner`）：registry 上是 `0.3.6`、维护者 `chenwei116057`（Bash/PowerShell overrides）。本轮决定**不跨线**，所以它两项都欠：既在 0.1.7 线、名字也不可用。

### 6. 本轮的决定与「为什么」

- **不跨 `dsh-default-tuner`**：按工作区规则跨线是立项（重读它自己点名的契约 + 隔离宿主 + 真实路由 cookie/CSRF 验证 + 四处同源 + 测试守卫），塞进收口轮会把「一致性核对」变成「半做的跨线」。它的等级、留在旧线的理由与跨线触发条件已写进根 `AGENTS.md`。
- **只提交、不发版**：形状统一是内部命名调整，运行行为一字未变；本轮改动**不带版本号**，留到下一次真有功能改动的发版一起带上（已发布 artifact 与源码的这一处差异不影响任何用户）。
- **改名留到用户给名字之后再做**：改名要同步 `package.json#name`、插件文档的改名落点与 `test/manifest.test.js` 守卫，属于独立一轮的工作。

### 7. 同轮的两处口径订正（都是「文档写的是旧事实」）

- **`ci.yml` 的注释与矩阵不符**：注释写「每次 push / PR 校验全部插件」，矩阵实际只列 7 个（`dsh-mcp-console` 与 `dsh-default-tuner` 不在里面）。按用户选择**只改注释**：写明只校验 7 个已发布插件，未发布的两个由本机 `./install.sh` 与各自的 `publish:check` 承担。**矩阵没动**——这是有意的，两个插件都还没有可发布的包名。
- **`dsh-mobile-compat/README.md` 的升级示例是旧线版本**：写着 `add dsh-mobile-compat@0.4.0`（那是 0.1.7 线的版本），改成当前线的 `@0.5.0`，避免用户照抄装到旧线。

---


## B6：L3 跨线 `dsh-mobile-compat`（2026-10-01）

插件从 `>=0.1.7-alpha.1 <0.1.8` 换到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。它是工作区里唯一**契约面几乎全是壳层 DOM + 几何**的插件（16 条契约、93KB client bundle），按 L3 单独一轮做。**本轮不改 `package.json#version`、不提交、不打 tag、不发版**。

**业务代码一字未改**：改动只有版本门的四个常量、`compatibility.json` 全量、测试守卫与四份文档。理由不是"看起来差不多"，而是第 2 步把 16 条契约在 **0.2.0-rc.2 的实际产物里**逐条重读了一遍（见下表），再在第 5 步由隔离宿主上的真实几何断言确认。

### 契约面逐项复核（读的是实际安装包，不是当时的文档）

安装树：288 个组件 / 62 个 `dsh-client-*`；前端产物 `index-5SrrfWpU.js` + `index-BPHePDI_.css`。

| 契约面 | `0.2.0-rc.2` 证据 |
|---|---|
| `connection.generation` | `dsh-client-connection` 与 0.1.7-rc.2 逐字相同 |
| layout Service | `ctx.layout.toggleSidebar()`（`lib/client.js:478`）与 `closeRightbar()` 仍在 `ILayout` 上 |
| AppFrame 三列 + 四个 seat | 前四个 host children 仍是 `sidebarCol` / `CenterColumn(centerCol)` / `RightbarColumn(rightbarCol`+`data-rightbar-col)` / `overlayLayer(data-shell-overlay)`；`DocumentTitle` 仍不产生 host 节点；`main` 仍是 keyed slot（`entryKey: usePanelInfo(info => info.activePanelId) ?? "conversation"`） |
| SidebarRoot | 仍是 `renderSlot("sidebar", …)` 直系承载，内联桌面宽度仍只在 `wide` 时写 |
| 侧栏导航行 | `newSession`（含 `…Content`/`…LabelMask`/`…Shortcut`）、`panelRow`、`sessionRow` 三类 class 后缀都在；会话行仍是 `role="treeitem"` 的 **`div`**（`clsx(Rows_module_css_default.sessionRow, …)`） |
| WorkspaceBrowser | 仍是 `root` > `sectionHeader` > [`sectionLabel`（`wide` 才渲染）、`searchSlot`（内含 `button[aria-expanded]`）、`headerActions`]；rail 态仍不渲染 search slot |
| Settings | 仍是 `createPortal(…, document.body)` + `role="dialog"` + `aria-modal="true"` + 直系 `nav`；`useModalLayer(panel, true, onClose)` 仍在 |
| Conversation 外层 | `ConversationRoot` 最后一个 direct child 仍是 `div.body`（`data-conversation-content`），其内仍是 direct `div.scrollBody[data-conversation-scroll]` + `WidthControls`；`data-composer-seat` / `data-composer-card` 仍在；Composer 编辑器仍是 `contenteditable` 的 **div**，带 `role="textbox"` + `aria-multiline="true"` + `data-composer-input` |
| 会话标题栏 | `ConversationSessionHeader` 仍是 `titleRow` > (`titleCluster` > `nav.crumbs` + `div.headerActions`) + `div.headerUtilities`，`div.headerCorner`（`data-conversation-header-corner`）与之并列；tabs 仍是其后的另一行（`data-conversation-tabs`） |
| 右栏 dockkit | 13 个 `data-dockkit-*` 名字逐个存活且**出现次数与 0.1.7-rc.2 完全一致**；`data-dockkit-tab-close` 的值仍是 tab id（`"data-dockkit-tab-close": y`）；压缩 CSS `_tabClose_6nhg2_417{position:absolute;top:4px;right:4px;…width:20px;height:20px}`、`_tabStrip_…{height:28px}`、`_stripChrome_…{height:28px}`、`_iconButton_…{width:28px;height:28px}` 逐字未变；`[class*='paneBody']` 仍命中 |
| 右栏层级 | 面板仍 `position:absolute; top:0; bottom:0; right:0`；`autoFullscreen = viewportWidth < 768` 仍派生 `fullscreen` 并写 `width: 100vw`；fullscreen 仍写 `--dsh-dockkit-dock-layer:40`（非 fullscreen 为 10） |
| 右栏入口 | `[data-sidebar-right-expand]` 仍是 primitives 的 `sm` Button（`_button{width:28px}` + `_button svg{width:15px;height:15px}`）画 `IconPanelLeftOutlineRegular` |
| 图标 | `IconCloseOutlineRegular` / `IconPanelLeftOutlineMedium` / `IconPanelLeftOutlineRegular` 都在 primitives 静态 seed 里；`tools/dsh-icons/check.js` 无漂移（188 个，Medium/Regular 各 94） |
| viewport | `dsh-web-frontend/dist/index.html` 仍是裸 `width=device-width, initial-scale=1` |
| 版本状态路由 | `GET /dsh-mobile-compat/status` 走 `connection.requestRejection(req)` 后返回 `{"ok":true,"package":"@deepseek-ai/dsh","version":"0.2.0-rc.2"}`（无 cookie 401、带签名 cookie 200） |

### 隔离宿主全尺寸矩阵（`DSH_HOME=/tmp/dsh-mc-020/home`、端口 5942、headless Chrome 153/CDP 9333；用户的 3080 全程未触碰，验证后按 `lsof -nP -iTCP:5942 -sTCP:LISTEN -t` 取 PID 停止）

`npm run test:browser` 一次跑通，0 条浏览器诊断：

| 视口 | grid | 抽屉 | 侧栏 position | 入口 | 入口盒 |
|---|---|---|---|---|---|
| 320x568 | `0px 320px 0px` | 收起 | absolute | flex | 44×44 |
| 390x844 | `0px 390px 0px` | 收起 | absolute | flex | 44×44 |
| 457x707 | `0px 457px 0px` | 收起 | absolute | flex | 44×44 |
| 568x320 | `0px 568px 0px` | 收起 | absolute | flex | 44×44 |
| 844x390 | `0px 844px 0px` | 收起 | absolute | flex | 44×44 |
| 901x700 | `56px 845px 0px` | 收起 | static | none | — |
| 1023x700 | `56px 967px 0px` | 收起 | static | none | — |
| 1024x700 | `280px 744px 0px` | 展开 | static | none | — |
| 1280x800（桌面） | `280px 1000px 0px` | **无 strip**（`hasStrip:false`）、`titleCluster` 高 28 ≤30（单行） | | | |

五档手机视口各跑一次**真实触摸拖动**（`Input.dispatchTouchEvent`，先注入 800px spacer 强制 strip 溢出，再 `touchStart`→5×`touchMove`(共 −72px)→`touchEnd`）：**每档都滚动 81px、strip 内 click 收到 0 个**（`clicks: []`）。

### 踩坑与可复用技巧

- **合成 `PointerEvent` 测不出"拖动后的 click 吞掉"，必须用真实输入流**。用 `strip.dispatchEvent(new PointerEvent(...))` 驱动拖动时：`scrollLeft` 会跟着走（72px 正常写入），但拖完再 `dispatchEvent(new MouseEvent('click'))` 时 `defaultPrevented` 恒为 `false`，看起来像"吞 click 失效"。换成 CDP `Input.dispatchTouchEvent` 走真实触摸链路后，`document` 上的 capture 监听器收到 **0 个** click——`pointer capture`、事件合成与 `preventDefault` 语义都只有真实输入才有。**回归脚本里凡是要验"手势副作用"的断言，一律走 `Input.dispatchTouchEvent`/`Input.dispatchMouseEvent`，不要用 `dispatchEvent` 造事件。**
- **`touch-action: pan-x` 的容器上，原生 pan 可能与 JS 的 `scrollLeft` 写入叠加**。同一段拖动在不同时序下量到 81 或 154px（JS 写 72，Chrome 再补一段原生 pan）。所以断言只能写"方向正确 + 落在合理区间（≥ 拖动量/3、≤ 拖动量×2.5）"，写"等于 72"必然间歇性红。实测 5 档 × 多次运行都稳定在 81，没有失控。
- **隔离 profile 里"没有控件可量"会让断言静默变成空转**。新 profile 的标题栏只有 DSH 自带两个控件，`strip.scrollWidth - clientWidth` 恒为 0，于是拖动分支走的是"不可滚动则不得移动"那条 else——**看起来全绿，实际一次都没验过滚动**。修法是探针自己注入一个 `width:800px` 的 spacer 强制溢出、量完在同一段脚本里 `remove()`，并额外断言 `document.querySelectorAll('[data-dockkit…]')` 之类探针痕迹为 0。
- **`dsh plugin add` 会从 registry 解析 `@deepseek-ai/*`，而 registry 上的 `dsh-experimental-agent-team-profile` 是 `0.1.5-alpha.2`（不是本机 `0.2.0-rc.2`）**：装进隔离 profile 后启动即被 `dsh-app-boot` 的 peer 预检拦下（"disabling profile plugin row"），连带 `webserver` 必需插件起不来、`dsh web` 直接启动失败。正确做法是**只往 `dsh.profile.bundles` 里写包名、不加依赖**——和用户 profile 一样走宿主自带的 `0.2.0-rc.2` 版本（`remove` 会连 bundle 项一起删掉，所以是"先 remove 再手工把包名写回 bundles"）。
- **`dsh plugin add` 之后必须先 remove 再删目录**：`rm -rf` 隔离 `DSH_HOME` 前若有残留 profile 锁，下一次 `add` 会读到半初始化状态。本轮的顺序是「新建 HOME → add → 起宿主 → 停宿主 → remove → 确认 bundles 已回滚」。
- **下界从 alpha 换成 rc 时，`channel !== 'alpha' || seq >= N` 会静默放行**：这条 B3 已经记过，本轮在 `dsh-mobile-compat` 上再次命中——它的 `classifyDshVersion()` 与 `scripts/check-compat.js` 都还是旧写法，下界一换到 `rc.2`，`0.2.0-alpha.9` 就会被判成兼容。改成 channel 优先级比较后，用假 `dsh` 跑了 11 档矩阵，**JS 门与 shell 门逐条一致**（`0.2.0-rc.2`/`+build.1` 接受无警告；`0.2.0`/`rc.3` 接受带警告；`0.2.1`/`0.1.7-rc.2`/`alpha.1`/`alpha.9`/`beta.4`/`rc.1`/`0.1.8-alpha.1` 全拒绝）。
- **停止隔离宿主前先确认端口归属**：`nohup … &` 起的进程在受管 background job 结束通知之后仍会活着（job 的"finished"只表示工具调用返回）。收尾一律 `lsof -nP -iTCP:<端口> -sTCP:LISTEN -t` 取 PID 再 `kill`，不要按进程名杀。

### 仍未覆盖

- **第 6 步的真机项一条都没覆盖**：真实 iOS/Android 软键盘弹起后的 `visualViewport` 行为、非零 notch 安全区、长会话滚动、代码/媒体块、深浅主题与 Locale 切换，全部需要用户在真机上确认。Chromium 的设备模拟不能替代这部分证据。
- 真实用户 `3080` 上的目视确认（本轮全程隔离宿主）。**注意**：3080 上现在跑的仍是 **0.4.0（0.1.7 线）**，所以在当前 `0.2.0-rc.2` 上它是 **inert 的**——用户在刷新页面后不会看到本轮的移动适配，要看到得等新版本发布并显式升级。
- 0.2.0 **正式版**尚未发布：下界 `0.2.0-rc.2` 是线内最低已核对版本，正式版发布后按判据在门内、但会带「未逐版本验证」警告，届时把它加进四处清单即可。

---

## B5：L3 跨线 `dsh-chat-archive-manager`（2026-10-01）

插件从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。**本轮不改 `package.json#version`、不提交、不打 tag、不发版**（版本号与 CHANGELOG 条目留给用户授权的发布轮）。**业务代码一字未改**：改动只有版本门（`lib/index.js` 的 `DSH_RELEASE_LINE`/`DSH_RELEASE_FLOOR`/`PRERELEASE_CHANNELS` + `install.sh` 的 shell 版含 `prerelease_rank()`，照抄 B1/B2 形状）、`package.json` 的 range/engines/清单、三条测试守卫、一句 `client.js` 注释与四份文档。

这是本轮工作区里唯一**契约包真的改了、又带破坏性数据操作**的插件，所以它的结论不能像 B1/B2 那样只靠"逐字相同"得出。

### 本轮的两个真变化，以及为什么它们够不着删除事务

`0.1.7-rc.2 → 0.2.0-rc.2` 的运行时改动就一处主题：**失败步骤的工具结果恢复**。

| 包 | 改动 | 为什么与本插件无关 |
|---|---|---|
| `dsh-session` | `openTurnClosers()` 重构出新增的 `ToolCallRecovery` 类：未答复的工具请求从 `Map<callId,{step}>` 变成 `Map<callId,{turn,step}>`，且 `tool/result` 只在 `surfaceOp === 'append'` 且 turn/step 匹配时才解除 pending（替换型结果不再误清） | 只喂给**崩溃恢复 / fork seed 的合成 closer 事件**；`SESSION_FORMAT_VERSION` 仍是 4，文件布局、`locate()/stat()/list()` 签名与返回键集、snapshot 的 `header`/`revision` 全未动 |
| `dsh-agent-loop` | `run()` 在 step 前 `ctx.on('session/event')` 建立跟踪，step 抛错时先补发合成 `tool/result` 再 rethrow，`finally` 里 `stopRecovery()` 之后才 `session.append('step/end', …)` | 新增的是**事件订阅与补发**，事件类型与 shape 一个都没变；插件也**完全不接触 session 事件追加语义** |

那条"插件不接触"是实测的：`session/event`、`append(`、`surfaceOp`、`tool/result`、`step/end`、`interruptedTurnClosers` 在 `lib/*.js` 与 `client.js` 里 **0 命中**；插件对持久层的全部读取面只有 `persistence.locate()/stat()/list()` 与 snapshot 的 `header`/`revision`。**这是 L3 跨线里唯一不能靠"包名没变"推断的一步**——所以本轮真正花时间的是它，而不是版本门。

### 契约表逐项 0.2.0 证据（读安装包 + 全仓符号探针）

| 契约 | `0.2.0-rc.2` 证据 |
|---|---|
| `dsh-agent` 私有形状 | `lib/index.js` 与 0.1.7-rc.2 **逐字相同**（只 `package.json` version 变）：`store = new Map()`（`:323`）、`detachEntered(entry)`（`:538`）、`enter()` 的 id 断言（`:512`） |
| `dsh-agent-loop` factory dispose 序列 | 全文件 5 个 hunk / 31 行；`:1687-1702` 的 `cancel({kind:'disposed'})` → `whenIdle()` → `scope.dispose()` → `handle?.close()` → `detachAgent?.()`/`detachSession?.()` **逐行未变** |
| `ReactLoopAgent` / `ReactLoopInbox` | `id`/`session`/`inbox`/`phase`/`scope`、`get status()`（`:790`，仍只返回 `idle`/`running`）、`cancel(cause, options)`（`:815`）、`whenIdle()`（`:870`）、`hasPending` getter（`:88`）全在原处。**补一条文档以前没写清的事实**：`maintenance` 阶段 `status` 也报 `idle`，插件靠同时要求 `phase.kind === 'idle'` 保持保守——两个条件一起读才安全 |
| `dsh-session` | `SESSION_FORMAT_VERSION = 4`（`:56`）、`SessionStore.store = new Map()`（`:1596`）+ `get`/`list`/`detachEntered`（`:1861`/`:1868`/`:1767`）原位 |
| `dsh-session-persistence-jsonl` | **`lib/index.js` 与 0.1.7-rc.2 sha256 完全相同**（`0845707017acc2b4…c1e31b`）；该包只改了 `lib/worker.cjs` 一行 native-code 指纹比较（LLM 请求投影）。`JsonlSessionPersistence` 的 `name`/`root`/`compression`/`coldLogMemo`/`migrationPreparations`、`JsonlBackendTracker` 的 `openHandles`/`writers`/`pending`/`hasPending`/`pendingEntries`、`locate()` 的 `{kind:'jsonl', path}` 全未变 |
| 逐字相同（仅 version） | `dsh-workspace`、`dsh-session-persistence`、`dsh-session-format`、`dsh-session-format-catalog`、`dsh-storage-domain`、`dsh-client-connection`、`dsh-client-modules`、`dsh-client-ui-settings`、`dsh-host-webserver`。`WorkspaceRegistry` 三个 Map 缓存（`:360-362`）、`unarchiveSession()` 的幂等 no-op（`:551-560`）、`Workspace.detachSession()`（`:148`）、`connection.requestRejection()`（`:586`）原位 |
| 客户端 | `SessionListState` 仍是 `ids`/`byId`/`phase`/`projectionsBySession`（唯一构造点 `dsh-api-session-controller/lib/client.js:3570`）；`(row.retainedBy.mainView ?? 0) > 0` 在 layout/workspace/session 逐字相同；`navIcon()` 映射表与未知 id 回落 `IconSettingsOutlineMedium` **逐项一致**（`archived-chats` 仍不在白名单 → DOM 补丁仍是唯一手段）；`settings.section` 仍是 `{kind:'list', scope:'root'}`、**注册选项仍无 `icon`**、内置分区上限仍 **20** |
| 唯一改动的客户端文件 | `dsh-client-ui-settings-general/lib/client.js` 8 个 hunk **全部无关**：Settings 面板 `--dsh-frame-top-clearance` 改名成 `--dsh-frame-chrome-top`/`--dsh-frame-overlay-top`、桌面更新文案、`general.currentVersion` 的版本号、快捷键 `Comma` 加 `alt` |

### 隔离宿主两轮（`DSH_HOME=/tmp/dsh-cam-020`、端口 5942；用户的 3080 全程未触碰，验证后按端口拿 PID 停止）

会话数据**本轮自己造**：只含 header 行的合法 v4/v3/v0 artifact（**零用户会话数据**），v4 用 `zlib.zstdCompressSync` 压（与 DSH 解码器同一实现）。先跑基线确认跨线前确实 inert（三个路由全 404），再改版本门重启。

**轮次 A（61 项全过）**：status 三布尔全 true 且 `dshVersionVerified: true`；restore 往返 200 → 重复 409，归档集合 6→5 且保留 W2 席位；请求边界 401/403/403/415/400/400/405；准入拒绝 409/404；仅 v3 → 501、v0 → 501（文案里的 generation 是**运行期反解**的 v3/v0，且**连 journal 文件都没创建**、status 仍三布尔 true）；v3+v4 并存与 v4 zstd 实删 200（目录消失、trash 清空、journal 归 `null`、归档集合与 Workspace 席位同步收缩）；boot graph 广告 combo URL、取回内容以源码逐字节开头仅尾部追加 `sourceMappingURL`、裸路径 404。

**轮次 B（39 项全过）——中途中断与可恢复性闭环**：

| 阶段 | 实测 |
|---|---|
| 注入中断（trash 根 `chmod 500`） | `POST /delete` → **500 `archive-delete-quarantined`**；journal 停在 `phase:"prepared"` 且带完整 witness；source 目录与 artifact 都在、trash 0 项、核心记账未动 |
| 运行期降级 | 三布尔全 false + `deletionCode: archive-delete-quarantined` / `restorationCode: deletion-recovery-required`；该会话与**其它**归档会话的 delete/restore 全 503 |
| 冷启动 | 目录 inode、日志 inode/size、journal sha 与中断前**逐项完全一致**，trash 仍空，仍 503 |
| 升级遗留事务 | 手工把 witness 写成上一代 `session.v3.jsonl.zstd` 后冷启动 → 仍被认出（503），inode 与 journal sha 未变、trash 未创建 |
| 可恢复性 | 人工清空事务 → 重启 → 三布尔恢复 true，重试删除 → 200，目录消失、trash 清空、journal 归 `null` |

这与 0.1.7-rc.2 那轮的关键区别：**中断不再是手工造 journal，而是在真实事务里注入写失败**（journal 已 durable、rename 失败），走完了 `deleteOne` 的 catch → `quarantined = true` 全路径。

### 踩坑与可复用技巧

- **同一个 JSONL root 必须压缩方式一致**：造隔离数据时把 `.jsonl`（none）与 `.jsonl.zstd` 混放，`workspace` 服务会在启动时抛 `encodingMismatch`，连带 `workspaceRegistry` 不可用、后续条目全部 pending（启动日志里 6 个 pending）。造数据前先读 profile 的 `session-persistence-jsonl` 配置。**副作用**：默认部署是 zstd，所以插件里"未压缩 header 用 `O_NOFOLLOW` 直接读"那条路径在真机上跑不到，只能由单测覆盖。
- **历史 generation 的 artifact 必须带能解码的合法 header，否则测出的是假 404**：`listArtifacts()` 走 `resolveGenerationInDirectory()` + `readGenerationHeader()`，解不开的历史 generation 会被**静默跳过**（`SessionFormatUnsupportedError`/`SessionPersistenceCorruptionError` → `continue`）；于是 `preflight()` 在 `list()` 阶段就以 `session-not-found`(404) 结束，永远走不到 `lstatCurrentGenerationArtifact()` 的 501 分支。本插件 AGENTS.md 里"仅 v3 → 501"这条**依赖 header 可解码**：v3 与 v4 的字段集完全相同、只差 `version`；v0 没有 `isSeeded`、可带 `parentSession`/`origin`。第一版占位 header（`{"type":"session","version":3}`）测出来的 404 就是这么来的。
- **注入类用例必须先断言"注入生效"**：轮次 B 第一次跑时 `chmod 500 $TRASH` 撞上"trash 根还不存在"（它只在第一次事务时由插件创建），`chmod` 静默失败 → 删除直接 200 成功 → 19 项断言变成假阳性/假阴性。改成先 `mkdir -p` 再 `chmod`，并加一条"trash 根仍可写就报错"的前置断言。
- **受管 background job 不要用管道包脚本**：`bash script | tail -N` 在脚本内部又起长期运行的隔离宿主时，管道 fd 被那个子进程持有，脚本早已跑完但工具调用一直停在 running（输出也读不到）。要么直接跑脚本，要么让脚本把输出重定向到文件。
- **按端口停实例前先核对命令行**：`pid=$(lsof -nP -iTCP:5942 -sTCP:LISTEN -t)` 之后用 `ps -o command=` 确认含 `--port 5942` 再 `kill`，顺便显式排除含 `3080` 的命令行——把"能证明归属"做成脚本里的前置断言，而不是靠自觉。
- **并行会话会撞端口，而且"端口 + `--port` 参数"不足以证明归属**：本轮收尾时 5942 上仍有一个 `dsh web --port 5942`，命令行完全匹配，但它属于**同时段另一个会话**的 `dsh-mobile-compat` 验证（`DSH_HOME=/tmp/dsh-mc-020/home`，写在 env 里、`ps` 的命令行列看不到）。差一点误杀。并行会话之间挑端口要错开（本轮另有会话在用 5911/5942 等），或用 `--port 0` 让内核分配并在日志里读实际端口；真要按端口清理时，用 `ps -E`（macOS）或读 `/proc/<pid>/environ` 把 `DSH_HOME` 一起核对，只认自己的那个。

### 仍未覆盖

- `quiesceSession()` 的**真实 GUI** 端到端（0.1.7-rc.2 那轮由用户真机确认过）。本轮只做了三层证据：源码逐行复核 dispose 序列未变、真机 `sessionQuiescenceSupported: true`（服务级探测）、单测 `fakeLiveRuntime()` 钉住顺序与四条边界。无头环境触发不了 DSH 自身"打开会话 + 归档"的交互。
- 设置页导航行与归档管理页的**纯视觉项**（图标几何已由 `verify-nav-icon.js --measure` 六项全过离线钉住；其余见插件 AGENTS.md 的 GUI 清单）。
- 0.2.0 **正式版**尚未发布；本轮下界 `0.2.0-rc.2` 是线内最低已核对版本，正式版发布后在门内但会打"未逐版本验证"警告，届时把清单加一个版本即可。
- **本轮的版本门变更尚未进入任何已发布版本**（用户本轮明确要求不改版本号）：要让它生效必须另开一轮改 `package.json#version` → 写 CHANGELOG → `publish:check` → 打 tag → 发布。

---

## B4：L3 跨线 `dsh-sticky-user-bubble`（2026-10-01）

`dsh-sticky-user-bubble` 从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。**本轮不改 `package.json#version`、不提交、不打 tag、不发版**（版本号与 CHANGELOG 条目留给用户授权的发布轮）。**业务代码一字未改**：改动只有版本门（`lib/index.js` + `install.sh`，照抄 B1/B2 的 `DSH_RELEASE_LINE` / `DSH_RELEASE_FLOOR` / `PRERELEASE_CHANNELS` 形状）、`package.json` 的 range/engines/清单、两条测试守卫与四份文档。

它比 B3 更难的地方在于**结论必须是几何数字**：插件的全部判据（出现阈值、让位清距、裁剪、折叠高、展开上限、composer 限高）都是 `getBoundingClientRect()` 之间的差值，读码只能确认公式、不能确认数值。所以本轮把「六个常量」逐条在隔离宿主上重新量了一遍，**并且量出了 0.1.7 那轮没量到的东西**（见下）。

### 契约面逐项复核（活 DOM + 静态 CSS 双证据）

| 契约面 | `0.2.0-rc.2` 现状 |
|---|---|
| 行标记 | 4350 行 / 53 个 `user` 行 / 492 个 `[data-chat-flow]`，与 0.1.7-rc.2 逐数相同；user 行 `data-chat-anchor-key`/`data-chat-flow-key`/`data-chat-node-key` **三键同值 53/53**；`data-chat-group-part` 只在 assistant-step 拆分行（1279 行，`reasoning`/`response`）；三键不等的 2486 行全是无 `kind` 的包装行或 assistant-step 行 |
| `[data-conversation-scroll]` | 仍是 `wSkVaW_scrollBody`、`overflow-y:auto`、padding/border 0、`rect.top 76`；CSS module hash 前缀未变 |
| 内层 `.EvIC1a_scroll` | 与 0.1.7-rc.2 的 CSS 规则**逐窗口逐字相同**（4 处 `EvIC1a_scroll` 出现点里 3 处是 CSS 规则，另 1 处是类名映射对象且差异只在相邻键）→ `padding:16px calc(...)`、该上下文 `overflow:visible` → `readingInset` 仍 16px |
| `[data-composer-seat]` | 仍是 scrollBody 直接子元素、`position:sticky; bottom:0`；实测 top 684.5（0.1.7 记 685） |
| overlay 层 | `.overlayLayer[data-shell-overlay]` 仍 `absolute / z-index:20 / pointer-events:none / inset:0`；`[data-slot="shell.overlay"]` 是它的子元素且 `display:contents`；插件 layer 的父链不变 |
| 绘制边界祖先链 | 与 0.1.7 逐字同构（`Sixlwa_userStack → userRow → 空 div → EvIC1a_flowItem → EvIC1a_column → EvIC1a_scroll → EvIC1a_root`(`overflow:visible clip`) `→ EvIC1a_frame → 空 div → wSkVaW_viewArea → 空 div → wSkVaW_scrollBody`），裁剪祖先顶边都在 scrollport 之上 |
| `visibleFlow()` 语义 | 文档序第 0 个 flow 就是主 flow（4350 行）；其余 491 个是 `O_Ebla_content` 折叠过程组（高度 0、不可测量）→ 仍取到主 flow |
| 副本保真 | 副本与原气泡的文本、宽度、左边界逐字相等（201.31 / 1085.42） |

### 六个几何常量（隔离宿主 + 无头 Chrome 153/CDP，视口 1512×813）

| 常量 | `0.2.0-rc.2` 实测 | 与 `0.1.7-rc.2` 的差异 |
|---|---|---|
| 出现阈值 | 边界 **76**（= `scrollRect.top`，scrollport 无 padding/border）、阅读线 **92**；底边 84（夹在两者之间）仍隐藏、77 仍隐藏、**76 → `ready`**，clone 落点 92 | 数值完全一致；本轮用 84 这一档**直接证伪了「门槛是阅读线」**（0.1.7 只有「77 隐藏 / 76 出现」两档） |
| 让位清距 | 每步 4px × 24 帧：`incomingTop − cloneBottom` **恒 16px**；push 上限 102 = 折叠高 86 + gap 16，下一帧换候选 | 数值一致，**来源变了**（见下） |
| `clip-path` | 逐帧 = `inset(push − 16)` | 完全一致 |
| 三行折叠 | 218px 源 → clone **86px** = 3×22 + 20（差 0）；wrapper 66px、`scrollHeight` 198px、`overflow:hidden` | 完全一致（同一行、同为 218/86） |
| 展开上限 | 卡片远时展开为自然全高 218；推进到 292/252/212px → 展开高 **184/144/104** = `incomingTop − 16 − 92`，底边 **276/236/196** = `incomingTop − 16`，wrapper 切 `overflow-y:auto` | 完全一致（0.1.7 单点 204 落在同一公式） |
| 展开不越过 composer | 1512×813：seat 684.5、`availableHeight` 577（限制项 = composerSeat）；**压到 1512×420** → seat 292、`availableHeight` 184 < 自然高 240 → 展开高**正好 184**、底边 **276 ≤ 292**、内部滚动 220 > 164 | 0.1.7 **没有触发过 seat 限高**（底边 310 离 685 很远，是空断言）；本轮把 seat 压成限制项后限高被真实触发 |

### 唯一一处真正的差异：核心默认 flow gap 16px → 6px

chat CSS 从 `margin-top:var(--dsh-chat-flow-gap,16px)` 变成 `…,6px)`（`--dsh-chat-flow-gap` 只在特定上下文被写成 12px/16px）。实测 53 个 user 行的 computed `margin-top`：52 个 6px、1 个 0px。

插件**行为不变**：`gap = clamp(marginTop, 16, 48)`，现在取到的是下限 `MIN_PUSH_GAP = 16`（0.1.7 时取的是行自己的 16px）。于是 `gap === readingInset === 16` 这个巧合仍然成立，「卡片刚进入顶部那一帧副本正好被完全裁掉、没有 ready 却什么都看不见的窗口」的性质保持——实测 push 上限 102、clip 82、下一帧翻 `inactive-source-visible`。

**但要记进升级清单**：这条 16px 现在由插件自己的常量兜底，不再是「核心恰好给 16px」。如果哪天核心把 gap 调到 **> 16px**，让位清距会跟着变大（`clamp` 取行值），而 `readingInset` 仍是内层 padding 的 16px —— 那时 `gap ≠ readingInset`，出现那一帧的可见窗口与 `clip-path` 的可见高度都会变，必须重新量。

### 新事实：版本门盖不住纯客户端插件的浏览器半体（实测）

`dsh-client-modules` 的启动图是按 profile 的 bundle 列表逐条读 `package.json#dsh.client` 拼的：`processOne()` 只过滤「有没有 fiber / 是否 `disabled`」，**不看 `apply()` 是否真的注册了东西**。所以 Host 半体走 inert 分支时，客户端 bundle 照样进 `window.__DSH_BOOT__` 并在页面里跑。

实测（隔离宿主）：把 profile 的 `dsh-sticky-user-bubble` 软链换成一个「一律 `supported:false` + 只打警告」的桩（模拟范围外），重开页面后 `[data-dsh-sticky-user-bubble-layer]`/`-host`/clone **依然存在**、`state=ready`、boot 图里仍有该包。测完把软链还原成源码目录。

**含义**：本插件（以及所有纯客户端插件）的「范围外保持 inert（零副作用）」只覆盖 Host 半体；范围外真正的兜底是客户端自己的能力检查（找不到核心标记就 fail closed 隐藏）与「用户先从 profile 里移除插件」。这条写进了插件 `AGENTS.md` 的「边界」一节。

### 踩坑与可复用技巧（跨轮有效）

- **单次粗跳定位在隔离宿主里必然偏 80~120px**：隔离 profile 里 `dsh-auto-load-history` 已跨线并真的在补齐历史，跳转后上方内容继续前插。正确写法是**收敛式定位**——按当前 rect 加一次 delta，等 500ms 再量、再补差，最多 6 次，并断言最终落点与目标的偏差 ≤ 0.5px（本轮脚本 `pinExact()`）。
- **让位/折叠这类相对步进的场景不受布局漂移影响**：从已稳定的位置每步 +4px，`incomingTop` 严格每步 −4、清距恒 16 —— 相对步进的样本本身就是「布局稳定」的证明。测量顺序上把「需要绝对定位的阈值」放在「相对步进」之前反而更危险。
- **想验证「不越过 composer」，必须让 seat 成为限制项**：本会话最高的用户气泡只有 240px，而 1512×813 的 `availableHeight` 是 577px —— 直接 hover 是空断言。用 `Emulation.setDeviceMetricsOverride` 把视口压到 1512×420，seat 顶降到 292、`availableHeight` 184 < 240，限高才真正被触发（实测展开高正好等于 `availableHeight`，底边 276 ≤ 292）。
- **不要按 CSS module hash 定位 UI**：0.1.7 轮用的搜索框类名（`.bhn1Oq_searchInput`）在 0.2.0 已换。改用稳定标记：侧边栏 `[data-row-key^="workspace:"]` / `session:` / `overflow:<workspaceId>`。
- **侧边栏要注意两种行**：`workspace:` 行是 **toggle**（已展开时再点会折叠 —— B2 也记过），且目标会话常被折叠在 `overflow:<workspaceId>`（「展开其余 N 个会话」）后面，要按 `aria-expanded !== 'true'` 判断后逐次点开。
- 这台机器没有 `timeout` 命令（B3 已记）；`grep -o …{0,300}` 在 BSD grep 上会报 `maximum repetition exceeds 255`，长窗口比对改用 node/python 脚本。

### 仍未覆盖（交给用户或后续会话）

- **目视观感**：滚动流畅度、真实鼠标 hover 的手感、非 1 缩放与自定义字号下的观感 —— 需要用户在 3080 上按插件 `AGENTS.md` 的「GUI 验证覆盖」看一遍。
- **含 `@` 引用 chip 的用户消息**：本会话 `[data-ref-chip]` 计数为 0，这条路径只有静态核对（`data-ref-chip` + chip `title` 在 0.2.0 的 chat/primitives 包里仍在）。
- 发布相关（版本号、CHANGELOG 条目、tag、npm）本轮按用户指示**全部未做**。

---

## B3：L3 跨线 `dsh-mcp-console`（2026-10-01）

`dsh-mcp-console` 从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。它是工作区里最大的插件（4108 行 / 8 模块 / 52 条真机 GUI 验收），按 L3 单独一轮做。**本轮不改 `package.json#version`、不提交、不打 tag、不发版**——包名 `dsh-mcp-console` 在 npm 上被第三方占用，改名之前发不出去。

**为什么不需要比 L3 更保守**：A1–A3 已经做过逐包 diff，本轮把它点名的契约面在**实际安装包**里逐项重读（不靠 CHANGELOG），结论全部成立，所以**业务代码一字未改**——改动只有版本门、`package.json` 的 range/engines/清单、测试守卫与四份文档。

### 契约面逐项复核（读的是实际安装包，不是当时的文档）

| 契约面 | 0.2.0-rc.2 现状 |
|---|---|
| `dsh-mcp-client` 的导出面与 Config 字段 | 与 0.1.7-rc.2 逐字相同；`serverName` 互斥仍在（`lib/index.js:818` 的 `already in use`）、`failOnStartupError` / `toolCallTimeoutMs` / `createMcpToolDefinition` 都在 |
| 官方动态挂载先例 | `dsh-acp` 仍是 `import * as McpClient` + `agentCtx.plugin(McpClient, config)`（`:12`/`:218`） |
| `cordis` 的 `plugin()` | 仍在（`lib/index.js:1619`），仍从插件对象读 `runtime.Config`（`:957`）与 inject |
| volatile 免重启链 | `cordis-plugin-loader` 的 `_commitVolatile()`（`:393`）仍 emit `loader/volatile-update`（`:420`）；`fiber.config` 仍是求值后的产物（`_resolveConfig`） |
| 凭据 | `dsh-credentials-local` 的 `resolve(473)` / `describe(491)` / `set(513)` / `unset(517)` 全在；`credentials/reference-updated` 仍由 `dsh-credentials/lib/index.js:124` 扇出；`writable` / `source` 字段未变 |
| 设置写入 | `dsh-config-editor` 仍 `withFileLock(<profile>/package.json)`（`:72`）+ `writeFileAtomic(..., {mode:384})`（`:123`）+ `reconcileProfilePatches`（`:75`/`:125`）；YAML Document 保注释与 `!!js` tag 还原未变 |
| 设置条目 id | `dsh-settings` 的 `describe()` 仍给 `ns: entry.options.id`（`:432`/`:443`）；`configure(presentation, owner)` 签名未变 |
| 客户端 | `dsh-client-ui-settings` 的 `configForms` 服务仍在（`:1284`）；壳层 `navIcon(id)` 白名单仍是 account/models/agent-presets/plugins，注册选项**仍无 `icon`**（DOM 补丁仍必要） |
| 路由与安全 | `dsh-host-webserver:179` 的重复路由 throw、`dsh-client-connection:586` 的 `requestRejection` 都未变 |

### 隔离宿主实测（`DSH_HOME=/tmp/dsh-mcp-020/home`、端口 5922、headless Chrome 153/CDP 9333；用户的 3080 全程未触碰，验证后按 `lsof -nP -iTCP:5922 -sTCP:LISTEN -t` 取 PID 停止）

| 判据 | 结果 |
|---|---|
| 启动装配 | `runtime=ready` / `settingsAvailable=true` / `mcpModule.strategy=loader-import` / `versionSupported=true` / `compatibilityRange=>=0.2.0-rc.2 <0.2.1` |
| `loader/volatile-update` → 对账 | 直接写 profile patch 的 `config.servers` → `reason=settings`、`mounted:["volprobe"]`、`live.state=mounted`、20 个工具 |
| 对账幂等 | 紧接着手动 `reconcile` → `mounted:[] / unmounted:[] / unchanged:["srv-volatile"]`，`live.mountedAt` **不变** |
| 凭据链 | 缺 `VOLPROBE_TOK` 的条目被拦（`blockedReason` 指名键名、`live.state=null`）→ 值写进 `.credentials.yaml` 后**无需手动对账**：`reason=credentials`、`mounted:["credprobe"]`、`blocked:[]`、20 个工具；明文在状态载荷里出现 0 次 |
| 凭据落盘由官方服务负责 | 隔离 `.credentials.yaml`（mode 0600）里出现导入动作写的 `MCP_PATCHY2_HEADERS_AUTHORIZATION` / `MCP_PATCHY2_URL_URL` 与 GUI 里「保存凭据」写的 `URL_TOK`；插件代码里**没有任何 yaml 解析**（只有一行注释提到该文件名） |
| 真机 GUI（`scripts/gui-flow.mjs`） | **52/52 连跑两轮全过**；浮层实测 `279x205` 在面板 `472x335` 内（与 rc.2 的数字逐字一致） |
| 鉴权 / CSRF | **12/12**：缺自定义客户端头 403、头值非 1 403、跨源 Origin 403、`sec-fetch-site: cross-site` 403、同源头 200、缺 CSRF 403、错 CSRF 403（body 可读 `bad-csrf`）、未知动作 400、GET 405、非 JSON 415、正确 CSRF 200 |
| `npm run verify` / `publish:check` | **104/104**；打包白名单 12 个文件全过 |
| 导航图标 | `verify-nav-icon.js --measure` 六项全过（label 偏移 36/9 与壳层原生行一致、原 svg 隐藏、mask 生效、`::before` 16×16、壳层行未被动过）；`tools/dsh-icons/check.js` 188 个图标无漂移 |

### 两个新事实（升级顺带带来的，不影响本插件）

- **0.2.0 新增的 `ui-settings-session-log` 挂在 `settings.general.item`（order 90），不是 `settings.section`**。`settings.section` 的内置项与 0.1.7 完全一致（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），所以本插件的 **110 仍排在全部内置分区之后**——但 `settings.general.item` 的上限已经到 100（`current-version`），**两个 slot 不要混着看**。
- 0.2.0 新增的 `dsh-otel` / `dsh-host-product-telemetry-otel` / `dsh-client-ui-schedule` 等包与插件契约无关；`dsh-web-app/cordis.patch.yml` 的多处新增只是 bundle 组成变化。

### 踩坑与可复用技巧

- **下界从 alpha 换成 rc 时，旧判定写法会静默放行**：`channel !== 'alpha' || seq >= N` 表达的是「下界是 alpha」，下界换成 `rc.2` 后 `0.2.0-alpha.9` 会被判成兼容。改成 channel 优先级比较（`DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`），再加一组版本矩阵把它钉住（本插件新增的 `test/manifest.test.js`）——与 B1/B2 的四个插件同源。
- **`grep -o "…{0,300}"` 在 BSD grep 上报 `maximum repetition exceeds 255`**：数内置 `settings.section` / `settings.general.item` 时改用 node 脚本（`new RegExp(..., 'g')` + `while (m = re.exec(s))`）才可靠。另外这台机器**没有 `timeout` 命令**，长命令要用工具层超时。
- **GUI 脚本的「导入」按钮会真的写入凭据库**（不是纯读）：它触发宿主 `action:'import'`，宿主把明文经 `ctx.credentials.set` 落盘、只把脱敏草稿回给浏览器。所以验证「凭据是否走官方服务」时，隔离 `DSH_HOME` 的 `.credentials.yaml` 里出现 `MCP_<SERVER>_HEADERS_AUTHORIZATION` 这类键就是直接证据。
- **只读块的第一个条目决定「导入」断言的锚点**：`gui-flow.mjs` 按**第一个只读行**取期望的服务器名与凭据键名。隔离 profile 的第一行必须是「服务器名 `patchy2` + URL 带 token + `Authorization` 请求头」，第二行随便（stdio fixture）——顺序放反会让导入那两条假失败。
- **`npm test` 分文件统计比只看总数更有用**：把分布（本插件 `host 14 / client 40 / manifest 5`）写进文档，下次跑完能立刻看出哪一批用例变了；总数只说明"没少跑"。
- **`dsh plugin --profile web add link:<目录>` 在全新的 `DSH_HOME` 下会自己初始化 profile**（打印 `initialized profile web at …`）——不需要先手工跑一次 `dsh web` 生成 profile，B2 那条"隔离 home 不能直接 cp 用户 profile"的坑因此可以绕开。

### 仍未覆盖

- 真实用户 `3080` 上的目视确认（本轮全程隔离宿主；设置页观感与真实输入手感仍需用户在刷新页面后看一眼）。
- 0.2.0 **正式版**尚未发布：下界 `0.2.0-rc.2` 是线内最低已核对版本，正式版发布后按判据在门内、但会带「未逐版本验证」警告，届时把它加进四处清单即可。
- 本插件**仍未发布**（当时包名 `dsh-mcp-manager` 被第三方占用；2026-10-08 已改名为 `dsh-mcp-console`）：改名要同步的 8 处落点见插件 `AGENTS.md` 的「发布与安装路线」。

---

## B2：L2 跨线 `dsh-auto-load-history` + `dsh-local-plugin-manager`（2026-10-01）

两个插件从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**，运行版本 `0.2.0-rc.2`。

**为什么按 L2 而不是升成 L3**：A1–A3 的启发式「L2 命中它依赖的包就升 L3」只是"你还没看过"的替代品——`dsh-auto-load-history` 的契约包 `dsh-api-session-controller` 确实变了，但本轮把 `loadThrough`/`loadOlder`/`SessionSnapshot` 三处逐个在安装包里读了一遍，改动全在「失败步骤的工具结果恢复」等与分页无关的地方，**上下文逐字相同**，所以 L2 成立、两个插件同一轮做完。

### 逐项复核（读的是实际安装包，不是 CHANGELOG）

`dsh-auto-load-history` 契约表 10 行全部成立。行号在 0.2.0-rc.2 上普遍位移，文档已按新行号订正：`session.d.ts:127`（`loadOlder`）/`:140`（`loadThrough`）、`session.js:313`/`:338`/`:392`、`snapshot.d.ts:68-72`、`service.d.ts:76-83`、conversation 的 slot 声明 `:18268` 与渲染 `:16502`、`[data-conversation-scroll]` 在 `:16338`、客户端按钮条件 `hasMore && …` 在 `ui-chat:5271`、服务端 `paginate` 的 `cut > 0` 在 `history.js:425`（0.1.7 时是 `:445`）。renderer 的 `bindInjectSources`（`:424`）与 `locale` 座位（`:724`）逐字未变。

`dsh-local-plugin-manager` 契约表 7 项全部成立：`dsh-plugin-manager`/`dsh-atomic-write`/`dsh-hmr` 与 0.1.7-rc.2 逐字相同（只有 `version` 变），`dsh-app-boot` 只多了 `OPTIONAL_BUNDLES` 里的一项。锁路径/mode/`waitMs`、`writePluginEnabled` 的四条覆盖项语义、`include:<rowId>`（含 `EntryTree.sep === ':'`）、hmr 的 `reconcileProfilePatches`、`settings.section`/`settings.action` 的声明、`requestRejection`、`webServer.register` 全部逐字或语义等价；peerDependencies 预检仍在但不门禁本包（本工作区插件都没声明它）。

### 两个新事实（都是"文档写错了"而不是"DSH 变了"）

- **`settings.general.item` 的内置 order 上限已经不是 20**：0.2.0-rc.2 上是 `settings-session-log` 90、`current-version` 100（此外 `link-opening` 17、`performance-usage` 30、`shortcuts` 16）。`dsh-auto-load-history` 的 `order: 110` 仍排在全部内置项之后，**无并列冲突**——但插件 AGENTS.md 里那句「内置行最大是 composer-enter 20」已作废，已订正。`settings.section` 的内置上限**仍是 20**（account −10 / general 0 / models 10 / plugins 15 / agent-presets 20），所以 `dsh-local-plugin-manager` 的 100 不受影响。
- `settings.section` 的注册选项仍无 `icon`，壳层 `navIcon(id)` 白名单是 account/models/agent-presets/plugins/archived-sessions——DOM 补丁依旧必要。

### 版本门从常量派生（照抄 B1 的 `dsh-extra-context`）

lib 侧 `DSH_RELEASE_LINE='0.2.0'` + `DSH_RELEASE_FLOOR={channel:'rc',sequence:2}` + `PRERELEASE_CHANNELS`，`install.sh` 有一份等价的 shell 版（含 `prerelease_rank()`）。下界是 rc 时，同线内的 alpha/beta/更低 rc 必须靠 channel 优先级比较挡住——旧的 `channel !== 'alpha' || seq >= 1` 写法会把 `0.2.0-alpha.9` 判成兼容。两个插件的 `test/manifest.test.js` 各新增一条守卫：把 range 反推回发布线与下界、并核对 `install.sh` 的五个常量。`dsh-local-plugin-manager` 的运行时依赖 `@deepseek-ai/dsh-atomic-write` 同时由 `~0.1.7-alpha.1` 升到 `~0.2.0-rc.2`（两版逐字相同，升它只是让写锁与宿主用同一条线的实现）。

### 隔离宿主实机（`DSH_HOME=/tmp/dsh-020-home`、端口 5911、headless Chrome 153/CDP 9344；用户的 3080 全程未触碰，验证后按 `lsof -nP -iTCP:<端口> -sTCP:LISTEN -t` 拿 PID 停止）

`dsh-auto-load-history`（脚本在 `/tmp/dsh-alh-020/`，非发布物）：

| 判据 | 结果 |
|---|---|
| 补齐到 `hasMore === false` | 大会话 `f8e6ec6b` 5 批（+4514 / +6035 / +19446 / +28264 / +13334 px）→ 4350 行 / 71704px，顶部按钮消失 |
| 反向对照（偏好 `false`） | 停在 200 行 / 5307px，按钮常驻 27.6 秒 |
| 锚点零漂移 | 只钉一次视口：同一 `data-chat-anchor-key` 行停留 2524 帧、top 恒 −226（跨度 0、相邻帧位移 0） |
| defer 让位 | 4 秒 `wheel` 突发（19 次）窗口内 **0 批**，停手后 **1470ms** 恢复 |
| 会话切换 A→B→A | `920768ca`（250 行）↔ 切回 A 重新分页到 4350 行 |
| 视图切换 | Chat ↔ Trajectory：slot 全程 4167 帧不重挂，切回后 4350 行保持 |
| console | 本插件 0 个 error/warning/exception |

`dsh-local-plugin-manager`：`npm run verify` **45 项全过**；`npm run gui:check` **20 项全过**；「与官方插件管理并存」双向往返——管理器禁用 → 官方详情页读到 `aria-checked=false` → 官方就地启用 → patch 里**同一条覆盖项**被改写为 `disabled: false`（条目数恒为 1）→ 管理器再读为已启用，反向亦然；运行态用 boot graph 判据：禁用后该包的 client bundle 消失、重新启用后回来。

### 踩坑与可复用技巧

- **隔离 `DSH_HOME` 不能直接 `cp -a` 用户 profile**：profile 的 `node_modules/<包名>` 是**相对**符号链接（`../../../../Documents/dsh-plugins/<包名>`），复制到 `/tmp` 后全部解析失败，宿主启动时把 9 个 link 插件逐个 skip 掉。修法是在隔离 profile 的 `node_modules/` 里把这些链接重建为绝对路径（或改用官方 `dsh plugin add link:`）。症状很好认：启动日志里一串 `skipping profile bundle ... cannot resolve`。
- **官方插件页的行级开关必须"进详情"才能点**：同一页里 `aria-label="启用 <包名>"`（列表上的 **bundle 选择**，`setBundleEnabled`）与 `aria-label="启用组件 <包名>"`（详情里的行级 `setPluginEnabled`）会同时存在，按前者定位会点到错的那个。
- **侧边栏的 workspace 行是 toggle**：点一次展开该 workspace 的会话列表、再点一次折叠。脚本里"先无脑点一次 workspace"会在列表已展开时把它折叠掉，于是"找不到会话行"。要先判断目标行是否已可见，再决定点不点。
- **`gui-check.mjs` 的一条断言在多插件环境里必然失败**：「本分区排在 DSH 自带项之后」原写成 `indexOf === length - 1`（要求它是**最后一行**），而别的插件同样贡献 ≥100 的 `settings.section`（extra-context 100、default-overrides/mcp-manager 110、chat-archive-manager 120）。已改为按内置 label 白名单定位最后一个自带项再比较——**断言要度量契约，别度量环境巧合**。
- **锚点漂移的两种测法要分清**：只钉一次视口（读者不干预）时 top 恒定、跨度 0；若每帧强推 `scrollTop`（defer 场景必须这样做，否则插件按 fail-open 继续补齐），同一锚点行的 top 会在 17px 内摆动——那是「插件补偿」与「外部每帧重新定位」的合成结果，不是补偿漂移。写断言前先确认自己测的是哪一种。
- **`npm test` 偶发一项失败**：本轮有 1 次在与另一个 npm 任务并行、CPU 繁忙时出现 1 项失败，随后串行连跑 8 次（含 5 次完整 `publish:check`）全绿。`test/client.test.js` 用真实定时器（`BATCH_GAP_MS=32`、`READER_IDLE_MS=1000`），高负载下的时序敏感是可疑点；没有复现证据，先记为观察项。

### 仍未覆盖

- 两个插件的主观流畅度与真实输入手感（滚轮/触控板连续滚动、真机触控）——按各自 README/AGENTS.md 的 GUI 验证清单请用户在 3080 上看一眼。
- `dsh-local-plugin-manager` 的**卸载**路径（真机 `dsh plugin remove` + 墓碑清理）本轮没跑：它会在隔离 profile 里真删依赖，属于可破坏操作，留待需要时单独做。
- 0.2.0 **正式版**尚未发布，本轮的下界 `0.2.0-rc.2` 是线内最低已核对版本；正式版发布后按判据它在门内、但会打「未逐版本验证」的警告，届时把清单加一个版本即可。

---

## B1：L1 跨线 `dsh-extra-context` + `dsh-default-workspace`（2026-10-01）

两个插件从 `>=0.1.7-alpha.1 <0.1.8` 跨到 **`>=0.2.0-rc.2 <0.2.1`**。

**静态逐项复核结论**：契约面**全部保持**——`dsh-system-prompt`/`dsh-settings`/`cordis-plugin-loader`/`schemastery`/`dsh-workspace`/`dsh-client-ui-slots`/`dsh-client-ui-settings` 逐字相同；`dsh-agent-loop`/`dsh-session` 只改了失败步骤的工具结果恢复（`renderPrompt`/`assertSystemHeadRewrite`/`applySurfacePlan` 上下文逐字相同）；`dsh-client-ui-workspace` 的 11 处 hunk 全在会话改名/分叉/快捷键/未命名标题；`dsh-api-workspace-controller` 只给 Documents 目录探测的 shell 调用加了 `"hidden"` 参数。因此**两个插件的业务代码一字未改**，改动只有版本门本身。

**实机验证**（隔离 `DSH_HOME=/tmp/dsh-b1-home`、独立端口、验证后停止，全程未碰用户的 3080）：两个插件的 `/dsh-…/status` 都返回 200（`writable:true` 证明 `Config` schema 装载成功；受管 Workspace 路径与标题正确）→ 写探针分段触发 profile 热重载 → `rendered` 字段给出完整注入口径 → `dsh headless` 发出的真实请求里 system prompt 带着探针文本；两个 client bundle 都进了页面启动图。

**未覆盖**：设置页与侧边栏按钮的目视确认（导航图标补丁已由 `verify-nav-icon.js` 离线量过六项全过）；受管 Workspace 的改名/删除保护与独立入口按钮的实机点击（`headless` profile 没有 workspace 服务，插件在那里按设计保持 pending）；压缩摘要补充指令在 0.2.0 上的真实路由 A/B。

### 可复用技巧（跨轮有效）

- **`range` 的下界可以是 prerelease**：`>=0.2.0-rc.2 <0.2.1` 的语义就是「同线内 `>= 0.2.0-rc.2` 且 `< 0.2.1`」，所以 `rc.1`/`beta.*`/`alpha.*` 全在门外，而 `0.2.0` 正式版在门内。旧的写法 `channel !== 'alpha' || seq >= N` 只能表达「下界是 alpha」，下界换成 rc 时必须改成 channel 优先级比较（实现见两个插件的 `lib/index.js`：`DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`，`install.sh` 里有一份等价的 shell 版）。
- **隔离宿主启动要指定 profile**：`dsh headless "<任务>"` 引导的是 `headless` profile，**不是** `web`。把插件与探针配在 `web` 上再跑 `headless`，得到的「探针没进 prompt、`baseURL` 不生效」全是**假阴性**。要在 CLI 里跑真实会话，就把插件装进对应的那个 profile。
- **抓真实模型请求的方法**：给 profile patch 写 `- id: llm-deepseek` + `config: { baseURL: http://127.0.0.1:<port> }`，起一个记录请求体的桩 HTTP 服务，然后 `DEEPSEEK_API_KEY=dummy DSH_HOME=<隔离> dsh headless "<探针>"`。请求是 Anthropic 风格的 `POST /v1/messages`（system prompt 在顶层 `system` 字段），桩服务不必返回正确格式——请求体已经拿到了。
- **验证「插件是否 inert」不用起宿主**：直接调用插件自己导出的 `classifyDshVersion('<版本>')`。旁证是运行中 Host 的 `/dsh-<插件>/status`：门内注册路由的返回 401、路由只在兼容分支注册的返回 404。

---

## A1–A3：`0.1.7-rc.2 → 0.2.0-rc.2` 侦察轮（2026-10-01）

用户升级 DSH 到 `0.2.0-rc.2` 后说「检查插件的兼容性」。固定动作走完第 1–4 步，第 5 步**故意停住**：`0.2.0` 已跨出全部 9 个插件的声明范围，第 1 条明写「范围外不要动」，所以本轮**没有扩大任何范围**。

**版本关系**：运行 `0.2.0-rc.2` / 上一验证版本 `0.1.7-rc.2` / 工作区线当时是 `>=0.1.7-alpha.1 <0.1.8`。**8 个插件按版本门保持 inert**（用各自导出的 `classifyDshVersion('0.2.0-rc.2')` 逐个实调 + 运行中 Host 的状态路由旁证）；第 9 个 `dsh-default-tuner` 当时**根本没有运行时门**，是唯一在未核对地基上照常运行的插件——该缺陷已同日补上（见其 `AGENTS.md`）。

**逐包 diff**（`npm install @deepseek-ai/dsh@0.1.7-rc.2` 到临时目录，与运行安装全树逐文件 sha256 比对）：共同包 283 个，0.2.0 新增 5 个（`dsh-otel`、`dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`、`dsh-experimental-schedule-bundle`、`dsh-client-ui-settings-session-log`）；文件级逐字相同 4638 / 变化 681 / 新增 35 / 移除 88；**72 个包有运行时 JS 变化**。

**逐字相同的契约包**（只有 `version` 字段变）：`dsh-client-ui-slots`、`dsh-client-store`、`dsh-client-ui-settings`、`dsh-settings`、`dsh-system-prompt`、`dsh-plugin-manager`、`dsh-atomic-write`、`dsh-hmr`、`dsh-client-modules`、`dsh-client-hmr`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-mcp-client`、`dsh-credentials`、`dsh-session-persistence`、`dsh-storage-domain`、`dsh-agent`、`dsh-compaction-basic`、`dsh-workspace`、`dsh-tools`。

**真的动了、且插件依赖的**只有四处，及其结论：

| 包 | 改动 | 对插件的影响 |
|---|---|---|
| `dsh-config-editor/lib/index.js` | `configuration()` 由「每条目重新全量合成」改成「一次合成 + 记忆化」，并加了 `overridden` 分支 | **已证伪为等价重构**（见下）。`dsh-extra-context`/`dsh-default-tuner`/`dsh-local-plugin-manager` 不受影响 |
| `dsh-app-boot/lib/index.js` | 只给 `OPTIONAL_BUNDLES` 追加 `@deepseek-ai/dsh-experimental-schedule-bundle` | 插件兼容预检逻辑**一行未改**，`dsh-local-plugin-manager` 不受影响 |
| `dsh-session` + `dsh-agent-loop` | 失败步骤的工具结果恢复重写（新增 `ToolCallRecovery`，所有权从 scheduler 交给 owning step） | `renderPrompt`、`assertSystemHeadRewrite`、`applySurfacePlan`、全部 `system/message` 处理点上下文逐字相同 |
| 各 `dsh-client-ui-*` 打包产物 | 随版本重建 | 逐个标记探针：所有插件关注的 DOM 标记在**全部出现位置**上上下文逐字相同；dockkit 那组在 `dsh-web-frontend` 里因压缩改名上下文不同，但出现次数完全一致 |

**`configuration()` 等价重构的证明**：用一个合成 profile（假 bundle 层 + 用户补丁层，覆盖「有 config 的用户行 / 只有 disabled 的行 / 完全没有用户行 / 同 id 两行 / insert 进来的行 / 从未碰过的行 / 空 config 对象 / group 行」8 个场景）直接调用两个版本真实的 `ConfigEditor.prototype.configuration()`，输出逐字相同。可证明：id 在 `overridden` 里时两边都走 `inherited()`；不在时配置剥离是空操作，两边都等于 `flatten(composeEntries(...)).find(id).config`。真实动机是把 O(n) 次全量合成降成一次。

**同轮新增的两个事实**：

- `dsh-client-ui-settings-general` 的 `navIcon` 白名单函数与 0.1.7-rc.2 **逐字相同**；`settings.section` 内置 order 未变（上限仍 20），但 `settings.general.item` 重排了并新增一条 90——插件侧全部 ≥100，**无并列冲突**。
- 客户端 DOM 标记存活清单：`data-conversation-scroll`、`data-composer-seat`、`data-dockkit-strip(-chrome)`、`data-dockkit-tab-close`、`data-shell-overlay`、`data-sidebar-right-expand`/`-toggle`。符号探针仍命中的清单见下（含 `requestRejection`、`loadThrough`、`loadOlder`、`SessionSnapshot`、`AgentRegistry`、`detachEntered`、`setBundleEnabled`、`writePluginEnabled`、`commitVolatile`）。

**离线网**：9 个插件 `npm test` 共 438 项全过；`tools/dsh-icons` 在 0.2.0 上**没有坏**（188 个图标无漂移），只是快照元数据与 `usedBy` 归属随版本更新（已重跑 `build.js`，`icons.json`/`preview.html` 因此有改动）；4 个带导航图标补丁的插件六项几何全过。

---

## 例行：`0.1.7-alpha.2 → 0.1.7-rc.2`（2026-09-28）

rc.2 是**全仓版本提升**（72 个组件改版本号，新增 `@deepseek-ai/dsh-experimental-auto-review`）。插件真正依赖的面里，`dsh-settings`、`dsh-config-editor`、`dsh-system-prompt`、`dsh-llm`、`dsh-compaction-basic`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-client-store`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-mcp-client`、`dsh-credentials`、`dsh-session-persistence`、`dsh-storage-domain`、`dsh-session-format*` 逐字相同。

**rc.2 带来的两个机制**（跨轮有效）：

- `dsh-app-boot` 自带**插件兼容预检**：读 bundle 的 `peerDependencies`（`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`），不满足就**在 profile 装配时抛错**，除非 profile 目录下的 `compatibility.json` 里有精确版本豁免（`dsh plugin allow-version`）。本工作区插件**都没声明 `peerDependencies`**，所以不受它门禁；将来要接入先读 `dsh-app-boot/lib/types/plugin-compatibility.d.ts` 与 `profile-compatibility.d.ts`。
- `dsh-base/cordis.patch.yml` 把 `llm-deepseek` 换成 `llm-deepseek-api-key` 并新增 `llm-deepseek-account` 行（部署组成变化，与插件无关）。

**本轮结果**：图标集无删名（188 个），4 个带导航图标补丁的插件六项几何全过；修复 `tools/dsh-icons` 两个缺陷（见该工具 README）；L1 两个插件把 `0.1.7-rc.2` 加入验证清单，`publish:check` 全过。

**其余插件的处置**：

- `dsh-auto-load-history`：`0.1.7-rc.2` 上隔离宿主 + 无头 Chromium 半离线回归全过（补齐到 `hasMore === false`、锚点零漂移、defer 生效、会话/视图切换无报错），代码无需适配，仅把版本加入四处清单并订正文档里的页大小描述（rc.2 已把 `loadOlder`/`loadThrough` 的固定 50/200 改成 turn 对齐区间）。
- `dsh-local-plugin-manager`：rc.2 的 `dsh-atomic-write`/`dsh-plugin-manager`/`dsh-app-boot` 改动逐项核对后**无需适配**（写锁路径/mode/waitMs 未变、`writePluginEnabled` 四条语义全在、`include:<rowId>` 仍成立、`settings.section` 内置 order 上限仍是 20）；隔离宿主上 `npm run verify`（44）与 `npm run gui:check`（21）全过，并额外跑通「与官方插件管理并存」的真 GUI 双向往返。**两条跨轮有效的结论**：热重载的真源是 `dsh-hmr` 的 profile 配置监听，**不是** profile 里的 `patchReload` 字段（写入后约 3 秒生效）；官方插件页列表上的「启用 <包名>」开关是 bundle 选择（`setBundleEnabled`），行级启停要点进「查看 <包名>」详情页用「启用组件 <包名>」。
- `dsh-sticky-user-bubble`：chat/conversation/layout/primitives 改动逐项核对后**无需适配**——行标记齐全（user 行三键同值、`groupPart` 只在 assistant-step 拆分行上）、`[data-conversation-scroll]` 仍是 scrollport 且内层 padding 仍 16px、`[data-composer-seat]` 仍是直接子元素且 sticky、overlay 层与 `retainedBy.mainView` 未变；唯一新事实是 `.EvIC1a_root` 多了 `overflow:visible clip`（实测不改变绘制边界）。隔离宿主 + 无头 Chrome 量到：出现阈值 = scrollport clip 边 76（不是阅读线 92）、让位清距恒 16px 且 `clip-path = inset(push − 16)`、三行折叠 = 3×22 + 20 = 86px、展开上限随下一张卡收到 `incomingTop − 16`、展开不越过 composer seat（685）。
- **本轮仍未实机验证**（交接给后续 L2/L3 会话）：`dsh-default-workspace` 的受管 Workspace 行为（B1 已补）、`dsh-chat-archive-manager` 的删除事务、`dsh-mcp-console` 的 GUI 验收。
