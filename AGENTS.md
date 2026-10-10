# dsh-plugins 工作区 — 说明文档（AGENTS.md）

> 供**新会话的 agent** 快速了解工作区。本文件只保留对**所有插件**通用、且**每轮都用得上**的知识；单个插件的细节在各自目录的 `AGENTS.md`，用户文档在各插件的 `README.md`。

**配套文档（按需读，不要塞回本文件）**：

| 文档 | 什么时候读 |
|---|---|
| [`docs/compat-log.md`](docs/compat-log.md) | 回顾某一轮兼容性检查的结论、逐包 diff 证据、踩坑与可复用技巧时 |
| [`docs/new-plugin-guide.md`](docs/new-plugin-guide.md) | 新建插件、或跨发布线重做契约时 |
| 各插件 `<插件>/AGENTS.md` | 只做那个插件时（含它自己的契约表与逐版本核对记录） |

> 本文件每轮都被整份载入上下文，**历史越长越稀释注意力**：结论、证据、过程一律写进 `docs/`，这里只沉淀跨轮有效的规则。


## 这是什么

开发 **DeepSeek Harness（DSH）插件** 的工作区：用户提需求，agent 负责调研 DSH 内部机制、实现插件、编写挂载/卸载脚本并验证。

共 **9 个插件**：其中 **8 个已发布到公共 npm registry**，用户安装走官方命令；发布流程见「发布与分发（npm / OIDC）」一节。还剩 **1 个尚未发布**（2026-10-08 已改名，新名实测未被占用），目前走 `./install.sh` 的 `link:` 源码路线：

- `dsh-mcp-console`（原名 `dsh-mcp-manager`；发布只差「用户授权 + 手动发一个占位版本 + 配 trusted publisher」，见「发布与分发」一节）

## 插件索引

| 插件 | 一句话说明 |
|---|---|
| `dsh-default-workspace/` | 创建并保护受管的“通用会话”默认 Workspace，并提供独立的新建通用会话入口 |
| `dsh-chat-archive-manager/` | 设置页的归档管理：分组浏览、批量归档、恢复与 fail-closed 永久删除，不创建额外 Workspace |
| `dsh-local-plugin-manager/` | 面向插件开发者：设置页独立分区「插件开发」，管理当前 web profile 里以 `link:` 挂载的本地源码插件 |
| `dsh-sticky-user-bubble/` | 阅读长对话时把已滚出顶部的用户气泡固定在阅读区顶部 |
| `dsh-mobile-compat/` | 为精确声明的 DSH 版本提供移动抽屉、Settings、Composer、触控与安全区兼容层 |
| `dsh-auto-load-history/` | 打开会话时自动补齐整段历史，顶部「加载更早」不再常驻（设置→通用末尾的总开关可关闭） |
| `dsh-extra-context/` | 给全部会话/子代理的 system prompt 附加一段额外说明与上下文，设置页分段维护、热生效 |
| `dsh-mcp-console/` | 设置页管理 MCP 服务器：增删改、启停、连接与工具状态、凭据走 credentials，不改 profile 配置、不重启即生效（**未发布**；2026-10-08 由 `dsh-mcp-manager` 改名） |
| `dsh-default-tuner/` | 设置页独立分区「默认设置覆盖」：把官方插件写死在 bundle 里的默认值（会话标题长度、标题模型输入上限等）变成可覆盖项，写入当前 profile 补丁并即时生效（2026-10-08 由 `dsh-default-overrides` 改名，2026-10-10 首发 `0.2.0`） |

用户安装（包名 = 目录名）：

```bash
dsh plugin --profile web add dsh-sticky-user-bubble        # 安装 / 升到 caret 范围内的最新版
dsh plugin --profile web add dsh-sticky-user-bubble@0.1.4  # 指定版本（升级必须显式写版本号）
dsh plugin --profile web remove dsh-sticky-user-bubble     # 卸载
```

改变 profile 组成的安装/卸载都要**由用户重启 `dsh web`** 并刷新页面才生效。每个插件内都有 `AGENTS.md`（技术）与 `README.md`（用户），部分还有 `PUBLISHING.md`（发布清单）与 `CHANGELOG.md`（历史）。新增插件：在本表加一行，并在新目录内建立自己的 `AGENTS.md`。

## 工作区工具（非插件）

`tools/dsh-icons/`：从已安装 DSH 提取**内置图标全集**（名字/字重档位/画布/SVG 源码/谁在用）→ 可 diff 快照 `icons.json` + 可交互预览页 `preview.html`；`check.js` 在 DSH 升级后核对漂移，并拦下“插件 require 了不存在的图标”。详见 `tools/dsh-icons/README.md`。

```bash
node tools/dsh-icons/build.js            # DSH 升/降级后重新提取
node tools/dsh-icons/check.js            # 漂移检查（0=无漂移，1=有漂移）
open tools/dsh-icons/preview.html        # 选图标：搜索/字重档位/真实尺寸/深浅背景，点卡片复制名字
node tools/dsh-icons/verify-nav-icon.js --plugin <插件> --measure   # 量设置页导航图标补丁的几何（无需真实 GUI，六项 checks 全过才退出 0）
```

**选或换图标前先在预览页确认名字存在**：图标来自浏览器侧 `__ModuleLoader__` seed 的 `dsh-client-ui-primitives` 冻结导出对象，没被打进去的名字 `require` 回来是 `undefined`，组件会静默渲染成空白。**0.1.7 把旧的数字档位（`IconXxx14`/`16`/`20`）换成了字重档位 `…Medium`（描边 1.3）/`…Regular`（描边 1），同一行里的图标必须同字重档位**；换图标的取值处写候选链兜底（`iconOf()`），别直接解构。设置页分区想要自己的图标只能走 DOM 补丁（壳层 `settings.section` 没有 `icon` 选项），现成实现、关键事实与离线几何验证见该工具 README。

## 环境事实

- 部署为 web profile，宿主组成在 `~/.dsh/profiles/web/`：`cordis.yml` 只有注释和空 `[]`，实际组成 = `package.json#dsh.profile.bundles`（bundle 顺序）+ `cordis.patch.yml`。
- 插件声明 `dsh.bundle.patch` 并附带 `cordis.patch.yml`，经 `dsh plugin --profile web add/remove` 进入 profile 的依赖与 bundle 顺序。现有插件都走官方 profile 管理；不要重新引入共享 node_modules 符号链接或直接改用户 patch 的 fallback 方案。
- 两种安装形态并存：**用户机器**从 registry 装（profile 依赖是 caret 范围），**本机开发**用 `link:` 指向源码目录（改完源码需重启 `dsh web`，profile 不复制文件）。
- 凭据在 `~/.dsh/.credentials.yaml`，经 `ctx.credentials.resolve/describe/set/unset` 读写；附件库（粘贴图片）在 `~/.dsh/attachments/v1/objects/<前2位>/<sha256>`。
- DSH 源码位置以 `realpath "$(command -v dsh)"` 所属安装为准，当前为 `~/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh/`；调研机制时读该安装及其 `node_modules/@deepseek-ai/*/lib/*.js` 与 README。
- 插件代码或组成变化后，检查 Host 状态接口和浏览器 boot graph。部署配置是否热加载见下节；热加载可用时刷新页面即可，否则需要请求用户重启。

## 插件版本与兼容发布线（用户规则）

插件按**已核对契约的最窄兼容发布线**维护，不为每个 prerelease 建硬门，也不为多个版本维护分叉实现：

- **每条线由插件自己维护，权威来源是它的 `package.json#dshCompatibility`——本节不列版本号，列了必然过期。** 2026-10-10 起 `dsh-default-workspace`、`dsh-extra-context`（F1）、`dsh-local-plugin-manager`（G1）、`dsh-auto-load-history`、`dsh-default-tuner`（H1）、`dsh-mcp-console`（G2）、`dsh-sticky-user-bubble`（B7）与 `dsh-chat-archive-manager`（B8）已换到 `>=0.2.1-alpha.2 <0.2.2`，其余 1 个（`dsh-mobile-compat`）仍在 `>=0.2.0-rc.2 <0.2.1`：当前运行的 `0.2.1-alpha.2` 在这 8 个的门内，**在那 1 个的门外（它眼下按版本门 inert）**——跨线必须逐插件单独开一轮，别一次全动。
- 一个插件版本只服务一条线：换线的做法是把 range 整体换掉（不是放宽上界），旧线的用户留在旧插件版本。同线内未逐条核对的 prerelease 允许带警告运行，但**跨线前必须重新读取源码与实时契约**。`dsh-default-tuner` 曾声明齐全却漏了运行时门、在不支持的版本上照常写 profile 补丁——那是真实缺陷，不是可以省的步骤。
- 范围外保持 inert（零副作用），`install.sh` 也拒绝安装：**上一线的用户留在上一线的插件版本**，一个插件版本只服务一条发布线。**但版本门只作用于 Host 半体**：纯客户端插件的 client bundle 由 `dsh-client-modules` 按 `package.json#dsh.client` 直接进启动图（不看你 `apply()` 注册了什么），范围外照样在浏览器里跑——这类插件范围外的兜底只有客户端自己的能力检查（fail closed）与让用户先从 profile 移除；改版本门时别以为它顺手把 UI 也关掉了。`dsh-mobile-compat` 就是这类：宿主半体只有状态路由，门在 client bundle + `install.sh`。
- 必须始终保留结构与能力检查 fail closed；禁止无上界范围、跨发布线猜测兼容。线内未逐条验证的版本只是"带警告运行"，能力探测仍是权威判定——探测不到的能力各自降级，不要让整页 404。
- 声明必须四处同源：`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 版本门（`DSH_COMPATIBILITY_RANGE` + `DSH_VERIFIED_VERSIONS`）、插件内文档。
- **门常量的形状以已跨线的插件为基准，别再各写一套**（2026-10-01 收口轮统一过一次，跨线时照抄）：
  - lib 侧五个常量，名字固定为 `DSH_COMPATIBILITY_RANGE`、`DSH_RELEASE_LINE`、`DSH_RELEASE_FLOOR`（`{ channel, sequence }`）、`PRERELEASE_CHANNELS`、`VERIFIED_DSH_VERSIONS`——**普通字面量，不要 `Object.freeze`、也不要用 `Set`**；判定逻辑（`classifyDshVersion()`）从发布线 + 下界派生，跨线只改常量。
  - `install.sh` 侧五个常量：`DSH_COMPATIBILITY_RANGE`、`DSH_VERIFIED_VERSIONS`（多版本空格分隔）、`DSH_RELEASE_LINE`、`DSH_RELEASE_FLOOR_CHANNEL`、`DSH_RELEASE_FLOOR_SEQUENCE`，加一份 `prerelease_rank()`（channel 优先级比较；旧写法 `channel !== 'alpha' || seq >= N` 表达的是"下界是 alpha"，下界换成 rc 后会静默放行 `0.2.0-alpha.9`）。
  - 两个半体、`package.json` 与插件文档必须逐字同源，各插件自己的 `test/manifest.test.js` 是守卫；发布闸门统一叫 `npm run publish:check`（= `check` + `test` + `pack:check`），`install.sh` 也跑它。
- **按能力取资源仍是默认写法**：官方图标名、客户端服务字段、slot 契约都会随发布线改名（例：0.1.7 把图标从数字档位改成档位词），取值处写候选兜底（见 `dsh-chat-archive-manager/client.js` 的 `iconOf()`），让代码不因一个名字消失就静默变空白。

## 插件兼容性检查（用户说「检查插件的兼容性」时照此执行）

用户用「检查插件的兼容性」这类表达开启一轮时，按本节执行：**先定级，再只做低复杂度的**，高复杂度的列出清单交给用户单独开对话。

### 复杂度分级判据（看契约的性质，不看插件大小）

四条判据里**任一条命中更高一级，就取更高一级**：

| 判据 | L1 低 | L2 中 | L3 高 |
|---|---|---|---|
| 契约面 | 只用公开服务 / 条目 config / slot 声明；对 DSH 自有 DOM 的触碰是可回滚、能静默降级的装饰性补丁 | 依赖 1–2 处 DSH 自有 DOM 标记或私有运行时字段 | 大面积 patch 壳层 DOM/布局/几何，或依赖成组的私有 ABI |
| 能否离线证伪 | 读源码 + 单测 + `tools/dsh-icons` 就能定论 | 需要一个半离线手段（隔离宿主 + CDP、几何验证脚本） | 关键结论**只有真机 GUI 目视/量几何才能得到** |
| 上下文体量 | 源码 ≲ 2000 行，契约面集中 | 2000–3000 行，或契约面跨多个包 | ≳ 3000 行，或「契约核对 + 修复 + 验证」塞不进一个会话 |
| 失效代价 | 局部降级（能力探测 fail closed） | 功能不可用但可回滚 | 破坏性数据操作，或整页不可用 |

**用法**：L1 插件可以**一个会话处理 2–3 个**，全流程在当前会话做完；L3 插件**一个会话只做一个**；L2 是临时判定——先做第 2 步的逐包 diff，**命中它依赖的包就升成 L3、没命中就按 L1 批量做**。

### 当前归属

定级变了就更新本表（判据见上一节，别在这里论证）。「当前线」列只是状态速查：格子写的是该线的主版本（`0.2.0` = `>=0.2.0-rc.2 <0.2.1`，`0.1.7` = `>=0.1.7-alpha.1 <0.1.8`），范围与验证清单的权威来源仍是各插件自己的 `package.json#dshCompatibility`。

| 等级 | 插件 | 当前线 | 为什么是这个等级 |
|---|---|---|---|
| L1 | `dsh-default-workspace` | `0.2.1` | 公开 `workspaceRegistry` + 一个 slot；唯一私有触碰是客户端 `workspaces` 的 `rename/delete/insertBefore` 补丁（fail closed、可摘除） |
| L1 | `dsh-extra-context` | `0.2.1` | 条目 config + `settings.section`/`settings.action`；唯一 DOM 触碰是导航图标补丁，全程静默降级 |
| L2 | `dsh-auto-load-history` | `0.2.1` | 会话 API（`loadThrough`/`loadOlder`/`SessionSnapshot`）+ 一处 `scrollTop` 锚点补偿（几何） |
| L2 | `dsh-local-plugin-manager` | `0.2.1` | 契约面跨 `dsh-app-boot` / `dsh-plugin-manager` / `dsh-atomic-write` 三个包 |
| L2 | `dsh-default-tuner` | `0.2.1` | 1588 行本属 L1，但它**整块改写 profile 补丁**（写坏 → 目标条目 `fiber.state=3`，只能手改文件救回），且关键结论要隔离宿主 + 真实路由（cookie + CSRF）才拿得到（原名 `dsh-default-overrides`） |
| L3 | `dsh-chat-archive-manager` | `0.2.1` | 3056 行 + 3856 行测试，依赖 `AgentRegistry`/`detachEntered` 等私有运行态字段，带**永久删除事务** |
| L3 | `dsh-mcp-console` | `0.2.1` | 4108 行 / 8 模块，动态挂载 + 凭据 + 对账引擎；52 条真机 GUI 验收（原名 `dsh-mcp-manager`） |
| L3 | `dsh-sticky-user-bubble` | `0.2.1` | 气泡克隆 + 裁剪边界 + padding 等几何假设，必须靠隔离宿主量 `getBoundingClientRect()` |
| L3 | `dsh-mobile-compat` | `0.2.0` | 壳层 DOM + 几何 + 客户端包哈希矩阵；跨线必须重跑整张浏览器尺寸矩阵，**上一线结论一条都不能继承** |

### 固定动作

1. **确认版本**：从 DSH 安装的 `package.json` 取真实运行版本。范围外（`>=0.1.8`、或低于当前下界）**不要动**——那属于跨发布线，要走「重新读源码 + 重新定契约」的立项流程，不是兼容检查。
2. **取逐包 diff（不要靠 CHANGELOG）**：`npm pack` 拉下上一验证版本与当前版本的契约包，逐文件比对，至少覆盖各插件 `AGENTS.md`「已核对的契约」表里点名的包。
   ```bash
   npm view '@deepseek-ai/dsh@<版本>' dependencies --json   # 组件清单与版本提升概况
   ```
3. **跑离线网**（三条都要跑，任何一条红都算发现）：
   ```bash
   for d in dsh-*/; do (cd "$d" && npm test); done                    # 单测
   node tools/dsh-icons/build.js && node tools/dsh-icons/check.js     # 图标漂移（0 = 无漂移）
   node tools/dsh-icons/verify-nav-icon.js --plugin <插件> --measure  # 有导航图标补丁的插件，六项必须全过
   ```
   **工具自己坏了也算兼容性问题**：`tools/dsh-icons` 是整张离线网的入口，它报错就先修它（2026-09-28 的 rc.2 就是这样——提取器先炸了，后面的检查全跑不到）。
4. **做符号存在性探针**：对每个插件点名的契约符号，在 DSH 安装目录里**全仓**搜一遍确认还在：
   ```bash
   cd <dsh 安装>/node_modules/@deepseek-ai && grep -rl --include='*.js' -- '<符号>' . | head -3
   ```
   必须全仓找、不要猜文件：插件文档里记的文件名常常只是"当时读到的那个地方"（2026-09-28 靠猜文件把 `loadThrough` 误判成"已删除"，实际是记错了文件）。
5. **逐个插件判定**：L1 直接修；L2 按上面的规则临时定级；L3 只记录结论并交接。
6. **收尾（L1 的修复必须四处同源）**：`package.json#dshCompatibility.verifiedVersions`、`lib/index.js` 的 `VERIFIED_DSH_VERSIONS`、`install.sh` 的 `DSH_VERIFIED_VERSIONS`（**多版本用空格分隔**，脚本按词分割消费）、插件 `AGENTS.md` 的「逐版本核对记录」。然后跑该插件的 `npm run publish:check`。**不要自动改版本号、不要自动提交**（见「提交规范」）。

### 汇报格式（必须包含这四段）

1. 运行版本 / 上一验证版本 / 逐包 diff 概况（哪些逐字相同、哪些真的动了）。
2. 每个插件的判定：等级 + 本轮结论（通过 / 已修 / 需要实机）+ 一句话证据。
3. 本会话已修的内容：文件清单 + 跑过的闸门结果。
4. **建议单独开对话的清单**，每条写清「先读什么、跑什么命令、完成标准是什么」，让用户能直接粘给下一个会话。

### 已发生的一轮：记录在 `docs/compat-log.md`

每一轮的**结论、逐包 diff 证据、实测数据、踩坑与可复用技巧**都写在 [`docs/compat-log.md`](docs/compat-log.md)，按时间倒序。执行一次例行检查**不需要**读它。

往本文件里只沉淀**跨轮有效的规则**（当前归属表、固定动作、判据）；单轮的过程与证据留在那份档案里，别堆回这里——根 `AGENTS.md` 每轮都被整份载入，历史越长越稀释注意力。

## 发布与分发（npm / OIDC）

8 个包已发布到公共 npm registry，由 tag 驱动、经 npm trusted publishing（OIDC）带 provenance 发布，不含任何长期 token。**8 个包当前发布的版本**：`0.2.1` 线——`default-workspace` / `extra-context` = `0.3.0`、`local-plugin-manager` = `0.4.0`、`auto-load-history` = `0.3.0`、`default-tuner` = `0.2.0`、`chat-archive-manager` = `0.3.0`（均 2026-10-10 发布；`default-tuner` 是首次发布）；`0.2.0` 线——`sticky-user-bubble` = `0.2.0`、`mobile-compat` = `0.5.0`。三个发布后判据逐包核对通过：registry 可读到该版本、`dist.attestations` 有 SLSA provenance、GitHub Release 已创建。**打包形态的 `install.sh` 不在发布物里**（`files` 白名单不含它），所以改它不需要发版；改 `lib/`、`client.js`、`package.json` 或文档则要发新版本才生效。**跨线发版走 minor**（旧线用户被版本门挡在门外 = 破坏性变更，先例：`dsh-mobile-compat` 0.3.7→0.4.0、这三个包 0.2.0→0.3.0/0.4.0、`dsh-auto-load-history` 0.2.0→0.3.0）。

**发版前先确认包名归我们所有**（`npm view <包名> maintainers`）：2026-10-08 把这条从"阻塞"落成了"规则"——两个未发布插件的旧名当时都被别人占着（`dsh-mcp-manager` = 0.6.0、维护者 `nichts`，描述恰好也是「从 Web 设置页管理 DSH 的 MCP 服务器」，是最坏的一种撞名；`dsh-default-overrides` = 0.5.3、维护者 `chenwei116057`、Bash/PowerShell overrides），于是整体改名为 `dsh-mcp-console` 与 `dsh-default-tuner`，**新名同日实测未被占用**。所以：① 立项和发版前都先查名（撞名时 `add <包名>` 会装到别人的包上）；② 撞名就改名，落点清单见两个插件各自的 `AGENTS.md`，**不要**在撞名的包上 bump 版本打 tag——那会在 workflow 里以无权限失败并留下一个空 release；③ **新包首发不许直接打 tag**，按下面那条三步走。

**新包首次发布：先造占位版本，再让 OIDC 发正式版**（2026-10-10 用 `dsh-default-tuner@0.2.0` 走通）。trusted publisher 只能在**已存在**的包上配置——`npm help trust` 的 Prerequisites 明写 *Package must exist*，网站那个入口也挂在包页面的 Settings → Trusted Publisher 下；而包名不存在时 `npm publish` 又被拒（实测 `E404 Not Found - PUT https://registry.npmjs.org/<包>`，provenance 签名本身是成功的）。所以三步：① 手动发一个**占位版本**（`npm login` 后在一个临时目录发 `{name, version:"0.0.1"}`，不碰插件源码）；② 配 trusted publisher（网站，或 `npm trust github <包> --file release.yml --repository zhaoliang233/dsh-plugins --allow-publish`，要求 npm ≥ 11.15 + 账号 2FA；`release.yml` 没用 environment，所以不需要 `--env`）；③ `gh workflow run release.yml -f tag=<插件>-v<版本>` 走 OIDC 发正式版。**别用"手动发正式版"代替第 ③ 步**：本地发布拿不到 provenance，而且版本一旦被占，workflow 的 `npm publish` 会冲突失败、GitHub Release 也建不出来。两次失败都不会留残骸：失败点在 npm publish，后面的「回查 registry」与「创建 GitHub Release」都没执行。`dsh-mcp-console` 是唯一还没发布的插件（已跨到 0.2.1 线、走本地 `link:` 路线），首发照这三步。

- 发布流程：改 `package.json#version` → 写 `CHANGELOG.md` 条目 → 跑该插件的 `npm run publish:check` → `git tag dsh-<插件>-v<版本>` → `git push origin HEAD && git push origin dsh-<插件>-v<版本>`。tag 必须与 `package.json#version` 完全一致；工作流还会拒绝 `private: true` 的包，并在发布后回查 registry。
- 发版必须由用户明确授权：`commit`/`tag`/`push` 都属「提交规范」里的受限操作（只读检查不受限）。
- **`release.yml` 在 `npm publish` 前必须安装依赖**：带运行时依赖的插件（现例 `dsh-local-plugin-manager` 的 `@deepseek-ai/dsh-atomic-write` 与 `yaml`）否则会在 `prepublishOnly` 门禁里以 `ERR_MODULE_NOT_FOUND` 失败——`dsh-local-plugin-manager@0.1.4` 就是这样没发出去的。也不要缩短 registry 回查窗口：可见性实测可达数分钟，曾经的 12×10s 把"发布成功"误判成失败，还跳过了 GitHub Release 创建。
- **改了运行时依赖范围就必须 `npm install` 并提交 `package-lock.json`**：CI 与 release 在存在 lockfile 时跑 `npm ci`，范围与 lock 失配会以 `EUSAGE`（`lock file's X does not satisfy Y`）在**安装依赖**这一步直接失败，tag 已推、却什么都没发布。本机的 `npm run publish:check` **看不出这个问题**（它用已经装好的 `node_modules`）——所以"改依赖 → `npm install` → 跑闸门 → 看 `git status` 里 lockfile 有没有变"是一条固定动作。先例：`dsh-local-plugin-manager@0.4.0` 首次 tag（2026-10-10）因它失败过一次。
- 认证：每个包在 npmjs.com 设置页配置 trusted publisher（组织/用户 `zhaoliang233`、仓库 `dsh-plugins`、工作流文件名 `release.yml`）。报 `ENEEDAUTH` / `Unable to authenticate` 时先核对这三个字段。
- 有硬编码版本断言的 manifest 测试要同步（现例：`dsh-local-plugin-manager`、`dsh-mobile-compat`），否则发布门禁会失败。
- 发布后核对三件事：registry 上的版本、该版本 `dist.attestations` 是否存在（证明是 OIDC 发布）、GitHub Release 是否创建。`gh` 已装在 `/usr/local/bin/gh`（brew 在这台 Intel Mac 上装不了 gh，用的是官方预编译二进制），已登录 `zhaoliang233`。
- 升级语义：profile 依赖是 caret 范围，`dsh plugin --profile web add <包名>` **不会**自动升到新版本，必须显式写 `@<版本>`。

## 当前 DSH Web 进程（重要）

当前 Web GUI 与 agent 工具连接由用户在 Warp 中**前台**运行的 `dsh web` 承载，进程所有权必须始终属于用户并保持在可见终端中。

- **禁止** agent 停止、重启或替换当前 `127.0.0.1:3080` 的监听进程。
- **禁止**用 `launchctl`、`nohup`、`setsid`、后台 shell、受管 background job 或其他守护机制启动当前 DSH Web。
- 确实需要重启时：agent 先做完所有无需重启的检查，再说明原因并请用户在 Warp 中执行 `Ctrl+C` 和 `dsh web --no-open`。
- 请求重启时**不得调用 `ask_user_question`**：该交互句柄属于即将退出的 Host 进程，重启后旧按钮失效。应结束当前工作轮，用普通消息交接重启步骤，请用户重连后发“已重启”或“继续”开启新一轮验证。
- 用户确认已重启后，agent 只读检查端口监听进程、Host 状态接口和浏览器 boot graph，不接管进程所有权。
- `--port 0` 启动的隔离测试服务器不承载当前 GUI，可以继续用受管 background job，并在验证后正常停止。
- 需要请求用户重启 Host 的变化：Host 代码、bundle/profile 组成。仅改文档不需要重启；仅改 client bundle 时先确认 client-plugin watcher 是否正在构建，没有 watcher 时请用户重启并刷新页面。

## 测试资源与进程隔离（重要）

**禁止按进程名杀进程。** 2026-09-19 事故：agent 为清理自己的无头 Chrome，反复执行 `Get-Process chrome | Stop-Process -Force`，**11 次杀掉用户正在使用的浏览器**（`Stop-Process -Force` 走 `TerminateProcess`，Crashpad/WER 全无痕迹，所以第一轮排查还误判为「没有崩溃」）。`taskkill /IM`、`pkill -f chrome`、`Stop-Process -Name <同名>` 同理禁止。

- 同类规则适用于一切共享资源：只结束**本会话创建、且能按命令行/端口/锁文件证明归属**的进程；不能证明归属时改用隔离资源（独立端口、独立 `DSH_HOME`、独立 profile），而不是"清理"别人的进程。
- 隔离验证用 `dsh --profile web --port <非 3080> --no-open` 起受管 background job，验证后停止；用户自己的 `127.0.0.1:3080` 永不触碰。
- **禁止用 `git checkout-index` / `git checkout -- <path>` / `git restore` 处理行尾或索引问题**：它们会用索引内容**覆盖工作区的未提交改动**（2026-09-19 实际发生过，一次操作清空了整个会话的未提交成果，且无法从 git/npm 恢复）。行尾统一靠 `.gitattributes`（`* text=auto eol=lf`）在**下一次 checkout 时**生效；要立即改写工作区行尾，必须先提交或备份，再单独确认。

## DSH 插件开发通用手册

### 挂载/卸载脚本模式

**分发主路线是 npm 官方安装**（见「发布与分发（npm / OIDC）」），`install.sh` / `uninstall.sh` 只服务开发与本机联调。每个插件都带这两个脚本，默认 `DSH_PROFILE=web`：

- package 声明 `dsh.bundle.patch`；install 先跑校验，再调用 `dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR"`；uninstall 调用官方 remove。
- `cordis.patch.yml` 属于插件发布物；profile 的 `cordis.patch.yml` 属于用户覆盖层，安装脚本不得直接改写。

### 宿主插件要点

- 插件对象 `export default { name, inject, apply(ctx) }`；`inject` **必须声明**要用到的服务（如 `['tools','systemPrompt']`），否则 apply 在 services 就绪前运行、注册被静默跳过（踩过此坑）。
- **要导出 `Config`（0.1.7 起插件设置的 schema）时必须同时挂在 default 对象上**：`Loader.unwrapExports()` 对"既有 default 又有命名导出"的模块返回 **default 对象**，而 `registry.plugin()` 只从那个对象读 `runtime.Config`。只写 `export const Config` 会让 `settings.describe()` 认定该条目没有 schema → 条目进不了配置表单 → 状态接口 `writable:false`、设置页动作控件永久禁用、所有写入被拒（2026-09-22 用户实测反馈）。`dsh-extra-context` 有回归守卫（`test/manifest.test.js`）。
- 只在部分 profile 出现的服务不要放进顶层 `inject`：需随服务出现/替换自动重绑时用 `ctx.inject(['name'], childCtx => ...)`，只做一次性探测才用 `ctx.get('name')`。
- **字节级 base64 必须自实现**（查表法）：宿主 `btoa` 是 `Buffer.from(s,'utf-8')` 实现，会把二进制当 UTF-8 文本二次编码、损坏图片字节（踩过此坑）。
- Cordis 4 没有 `service/ready` 事件；新代码用动态 `ctx.inject` 管理生命周期。
- 所有副作用必须可逆：补丁/路由/disposer 进 `ctx.effect`，事件监听 `ctx.on` 随 fiber 自动移除——保证不侵入 dsh 源码、运行时全可逆、能干净卸载。

### 双面插件（浏览器 UI）

- 包声明 `exports["./client"]`（字符串路径）+ `dsh.client: { platform: 'web' }` → `dsh-client-modules` 的 Node 半体自动把 client bundle 加进 `window.__DSH_BOOT__`，并在它注册的 `prefix /plugins` 路由上按自己广告的 combo URL（`/plugins/??<包名>/client.js&rev=<rev>`）服务，**插件行不用改**；裸 `/plugins/<包名>/client.js` 不在应答表里（未广告路径一律 404）。
- 浏览器 bundle 必须是 `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => {...} })`，factory 里 `var module={exports:{}}; var exports=module.exports;`，最后 `exports.inject=...; exports.apply=...; return module.exports`（照抄任一 `dsh-client-ui-*` 包 `lib/client.js` 的壳）。bundle 是 CJS lazy 模型，`require` 先查平台静态 seed（`react`/`react-dom`/`@deepseek-ai/cordis`/`dsh-client-store`/`dsh-client-ui-slots`/`dsh-client-ui-primitives`/`dsh-client-ui-dockkit` 等 9 个词），再查 boot graph 包名；组件用 `React.createElement`，无 JSX/TS/import。
- 插件对象的 `inject` 是**服务名数组**（如 `['slots']`）；`package.json#dsh.client.inject` 是 bundle 依赖的 client 包名（只 require react 可省略）。
- **自己注入的 `<style>` 必须打 `data-plugin="<包名>"`**（官方 `dsh-client-ui-*` 由构建期 CSS 注入助手代打）。`dsh-client-modules` 在 materialize 时会把当前**所有未打标签**的 style 认领给“下一个 materialize 的 bundle”，而 `dsh-client-hmr` 热更新只删 `style[data-plugin=<id>]`：不打标签的样式表会被记到别的插件名下，于是“别人更新 → 你的样式被删”“你更新 → 旧样式留下”，页面上就是样式不符预期、刷新才恢复。写了标签后按引用计数自清理，并在元素存活但文本过期时重写文本。
- 宿主给浏览器暴露 HTTP：`ctx.webServer.register({ kind: 'exact'|'prefix', path, handler(req,res) })`（node:http）；重复路径会 throw（路由表是组合级契约）；返回 disposer，client 端同源 `fetch` 调用。
- 写凭据用服务 API `credentials.set/unset/describe`：内部 yaml Document 编辑会保留注释、文件 watcher 自动重载，别自己解析 yaml。

### Slot 系统（客户端 UI 落点）

- 全局 Slot：`shell.overlay`（`dsh-client-ui-layout` 声明，`{kind:'list', scope:'root'}`，AppFrame 渲染为绝对定位全屏层，z-index 20，`pointer-events:none`、子元素 auto）——全局弹窗/横幅的落点；`sidebar.footer.action` 可放侧边栏底部按钮。
- 子 Slot 由父 entry 的 `children` 表在运行期声明：注册方必须用 `ctx.slots.inject('<slot>', () => ctx.slots.register({ name: '<slot>', ... }, Component))` 等待声明，不要直接 `register` 或依赖 client bundle 顺序。两者的副作用都归调用方 fiber，随插件卸载清理。
- 注册规则（按 slot 类型）：list slot **必须带 `id`**（否则 apply 抛 `list slot "..." requires options.id`，插件加载失败、浏览器显示 "Failed to load plugins"）；single slot 不需要额外字段；keyed slot 需要 `key`；chain slot 需要 `select`。
- **设置入口一律排在 DSH 自带项之后（用户规则）**：插件贡献的 `settings.section` / `settings.general.item` / `settings.plugins.tab` 的 `order` 都 **≥ 100**。DSH `0.2.0-rc.2` 实测内置项——**分区**（`settings.section`）account −10 / general 0 / models 10 / plugins 15 / agent-presets 20，上限 **20**（与 0.1.7 一致）；**通用行**（`settings.general.item`，**是另一个 slot，别拿 20 当它的上限**）permission −20 / language 0 / appearance 10 / font-size 11 / transcript-view 12 / developer-tools 15 / shortcuts 16 / link-opening 17 / composer-enter 20 / performance-usage 30 / settings-session-log 90 / current-version 100，上限**已到 100**；插件页 tab all 10。同一个 slot 里多个插件不要复用同一档 order（壳层是 `sort((a,b) => a.order - b.order)` 的稳定排序，并列时只能靠注册顺序决胜）；需要固定次序就 100 / 110 / 120 往上排。**升级 DSH 后重新读一遍内置项的 order 上限**（两个 slot 分别读），别把插件行插到内置行中间。

### 子代理委派纪律

- 启动前先答清三个问题：交付什么独立结果、影响主流程的哪个具体决策、失败后主流程怎么处理；答不清就不启动。
- 不按插件或目录数机械拆分。要求顺序修改、分别验证、分别提交，且主代理仍须完整读取同一批源码的任务，默认由主代理直接完成；只有高风险私有 ABI 的独立复核、大量互不依赖的检索、能直接解除阻塞的工作才值得委派。
- 委派 prompt 必须写清当前 DSH 版本、准确源码路径、只读/可写边界、预期交付格式和完成标准；禁止“审计这个插件”这类无法验收的宽泛目标。
- 后台子代理不阻塞无关工作，但依据其结果实施或提交前必须收取并复核。失败且无有效输出时按零贡献处理并立即剔除；只有仍存在明确缺口、且新尝试采用不同策略时才重试。
- 子代理不能替代主代理的源码契约核对、工作树审查和真实验证：采用其发现时必须自己定位到源码或测试独立确认，并在结论里说明哪些被采用；失败代理不计入“已审计/已验证”。
- 收尾前核对子代理是否改过共享工作区（`git diff`、测试、提交范围确认归属）；未进入最终实现或验证证据的委派记为无收益，作为后续少开代理的依据。

### 调研路径（新插件立项流程）

新建插件、或跨发布线重做契约时才需要：见 [新插件立项流程](docs/new-plugin-guide.md)。

## 常用操作

```bash
cd ~/Documents/dsh-plugins && ./install-all.sh       # 开发路线：用 link: 挂载全部插件
cd ~/Documents/dsh-plugins && ./uninstall-all.sh     # 卸载全部
cd ~/Documents/dsh-plugins/<插件名> && ./install.sh  # 单个插件（幂等）
cd ~/Documents/dsh-plugins/<插件名> && ./uninstall.sh
node --check <插件名>/lib/*.js                       # 改动宿主代码后逐文件语法检查

dsh plugin --profile web add dsh-extra-context       # 用户路线：装 registry 上的版本
dsh plugin --profile web add dsh-extra-context@0.1.2 # 升级（caret 范围不会自动升）
dsh plugin --profile web remove dsh-extra-context    # 卸载
```

批量脚本扫描一级子目录中的对应脚本，默认使用 `DSH_PROFILE=web`（可被调用方覆盖）；单个插件失败会继续处理其余插件，最后汇总并返回非零退出码。所有卸载脚本都给 pnpm 传 `--config.minimumReleaseAge=0`，避免卸载时 profile 重算被刚发布的其他包卡住；该参数只对当前命令生效，不改持久配置。

若 DSH 因某个插件加载失败而无法启动，可在插件目录外执行官方移除命令：

```bash
dsh plugin --profile web remove <插件名> --config.minimumReleaseAge=0
```

**卸载原则**：官方 bundle 插件只移除 profile 依赖和 bundle 层，运行时补丁必须可逆；不改 dsh 源码与 `@deepseek-ai/*` 包，也不自动删除插件创建的用户数据。

## 文档分工与语言（用户规则）

每个插件的文档固定四类职责，**全部纯中文**（不再维护中英双语）：

| 文档 | 面向谁 | 只写什么 |
|---|---|---|
| `README.md` | 使用者（npm 页面 / GitHub 访客） | 当前功能、要求（含兼容范围）、安装与卸载、使用方法、注意事项与已知边界 |
| `AGENTS.md` | 后续 agent / 维护者 | 技术契约、结构与实现约束、历史沿革与决策理由、踩坑、发布与安装路线 |
| `PUBLISHING.md` | 发布者 | 该插件的发布闸门、打 tag、tarball 隔离验证、发布后抽查；没有就不要新建，除非确有插件专有清单 |
| `CHANGELOG.md` | 历史记录 | 每个版本的变更（含"移除了什么、为什么"） |

- **README 不写沿革、不写决策**：例如"本包由 X 改名而来""曾用 Y 方案已移除""当时是未发布候选"这类内容属于 `AGENTS.md` / `CHANGELOG.md`，不进入 README。
- **写之前先判断必要性**：不写会不会让后人踩坑？不会就不写；一句话能说清就别写一段；别处已解释过的机制只留指向（如指向根 `AGENTS.md`）。
- 安装段固定给官方命令（`dsh plugin --profile web add/remove <包名>`，升级写成 `@<版本>`），源码 `./install.sh` 只作为开发路线一句话带过；并写明安装改变 bundle 列表需要重启 `dsh web`。
- 机器可读的数据文件（如 `dsh-mobile-compat/compatibility.json`）不属于"文档"，保留英文；改它必须同步 `scripts/check-compat.js` 与相关测试。

## 提交规范（用户规则）

- 标题 `<type>(<scope>): <祈使句概括>`。详情最多 **10 行**，只写必要的“为什么/影响面”，每行精炼，不逐文件罗列、不叙述排查与试错过程；一个 commit 只做一件事。
- **禁止自动提交**：agent 不得自行 `git commit`（含“顺手提交”“阶段性收尾提交”）。只有用户明确要求时才执行；不确定就先问一句，并说明待提交的文件范围。
- **一次性授权不构成后续授权**：用户某一轮说“提交”只覆盖**那一轮明确提到的改动**，之后每轮都要重新得到明确指示，不得把历史授权当长期模式（踩过：一次“提交代码”之后，后续几轮都自行提交了）。除非用户明说“以后都自动提交”。
- 未经明确指示，也不得自行执行其他改写历史的 git 操作（`reset`/`rebase`/`amend`/`cherry-pick`/`revert`/打 tag，以及 push/pull）；只读检查（`status`/`diff`/`log`/`show`/`blame`）不受限。
