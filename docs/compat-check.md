# 插件兼容性检查 — 操作手册

> 用户说「检查插件的兼容性」时读本文。根 `AGENTS.md` 只留一句指针，因为这份细则只在那一类轮次里用到。
> 每一轮的结论、证据、踩坑记在 [`compat-log.md`](compat-log.md)，不回流到本文或根文档。

用户用「检查插件的兼容性」这类表达开启一轮时，按本文执行：**先定级，再只做低复杂度的**，高复杂度的列出清单交给用户单独开对话。

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

定级变了就更新本表（判据见上一节，别在这里论证）。「当前线」列只是状态速查：格子写该线的主版本；范围与验证清单的权威来源是各插件自己的 `package.json#dshCompatibility`。

| 等级 | 插件 | 当前线 | 为什么是这个等级 |
|---|---|---|---|
| L1 | `dsh-default-workspace` | `0.2.1` | 公开 `workspaceRegistry` + 一个 slot；唯一私有触碰是客户端 `workspaces` 的 `rename/delete/insertBefore` 补丁（fail closed、可摘除） |
| L1 | `dsh-extra-context` | `0.2.1` | 条目 config + `settings.section`/`settings.action`；唯一 DOM 触碰是导航图标补丁，全程静默降级 |
| L2 | `dsh-auto-load-history` | `0.2.1` | 会话 API（`loadThrough`/`loadOlder`/`SessionSnapshot`）+ 一处 `scrollTop` 锚点补偿（几何） |
| L2 | `dsh-local-plugin-manager` | `0.2.1` | 契约面跨 `dsh-app-boot` / `dsh-plugin-manager` / `dsh-atomic-write` 三个包 |
| L2 | `dsh-default-tuner` | `0.2.1` | 代码量本属 L1，但它**整块改写 profile 补丁**（写坏 → 目标条目 `fiber.state=3`，只能手改文件救回），且关键结论要隔离宿主 + 真实路由（cookie + CSRF）才拿得到（原名 `dsh-default-overrides`） |
| L3 | `dsh-chat-archive-manager` | `0.2.1` | 依赖 `AgentRegistry`/`detachEntered` 等私有运行态字段，带**永久删除事务** |
| L3 | `dsh-mcp-console` | `0.2.1` | 动态挂载 + 凭据 + 对账引擎；52 条真机 GUI 验收（原名 `dsh-mcp-manager`） |
| L3 | `dsh-sticky-user-bubble` | `0.2.1` | 气泡克隆 + 裁剪边界 + padding 等几何假设，必须靠隔离宿主量 `getBoundingClientRect()` |
| L3 | `dsh-mobile-compat` | `0.2.0` | 壳层 DOM + 几何 + 客户端包哈希矩阵；跨线必须重跑整张浏览器尺寸矩阵，**上一线结论一条都不能继承** |

### 固定动作

1. **确认版本**：从 DSH 安装的 `package.json` 取真实运行版本。范围外（高于当前线的上界、或低于当前下界）**不要动**——那属于跨发布线，要走「重新读源码 + 重新定契约」的立项流程，不是兼容检查。
2. **取逐包 diff（不要靠 CHANGELOG）**：`npm pack` 拉下上一验证版本与当前版本的契约包，逐文件比对，至少覆盖各插件 `AGENTS.md`「已核对的契约」表里点名的包。
   ```bash
   npm view '@deepseek-ai/dsh@<版本>' dependencies --json   # 组件清单与版本提升概况
   ```
   **比对前必须先抹掉版本号**（`sed -E 's/0\.2\.1-(alpha\.2|rc\.2)/<VER>/g'`）：每个 `.js` 都嵌着版本字符串，不抹的话 `diff -rq` 会把几十个包全报成「已改动」，而那个结论是假的；判据是「规范化后仍不同」。**多个同前缀包（如 `dsh-session-title` / `-first-prompt-llm` / `-all-prompts-llm`）必须各解到独立目录**，否则后者覆盖前者会搜出「字段不存在」的假结论。
3. **跑离线网**（三条都要跑，任何一条红都算发现）：
   ```bash
   for d in dsh-*/; do (cd "$d" && npm test); done                    # 单测
   node tools/dsh-icons/build.js && node tools/dsh-icons/check.js     # 图标漂移（0 = 无漂移）
   # 有导航图标补丁的是 4 个：extra-context / chat-archive-manager / local-plugin-manager / mcp-console
   for p in dsh-extra-context dsh-chat-archive-manager dsh-local-plugin-manager dsh-mcp-console; do
     node tools/dsh-icons/verify-nav-icon.js --plugin "$p" --measure; done   # 六项必须全过
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

### 验收脚本"大面积红"时的第一判据（跨轮有效）

L3 插件的真机验收一次红几十项时，**先分清"仪器坏了"还是"被测对象坏了"**，顺序不能反——2026-10-19（J3）46 项红里没有一项是插件缺陷：

- **先看宿主侧**：状态路由/断言若全过，宿主半体就没问题，别再往插件代码里找。
- **再确认 bundle 进了启动图**：解析页面里的 `__DSH_BOOT__`，看条目 `<id>`、`url`（combo `plugins/??<包名>/client.js`）与 `inject` 是否齐全。齐了说明装配没丢插件。
- **然后抓控制台**：0 error 却断言全红，基本就是**脚本的 DOM 假设过时**（选择器、文案、入口位置），不是渲染坏了。
- **最后才怀疑环境前置**：隔离 `DSH_HOME` 是全新的，很多页面前置要自己补齐。GUI 验收最常缺的是「环境未进已配置状态」——页面停在欢迎页（只有「添加 API Key / 登录」），**连设置入口都不存在**，于是所有依赖设置面板的断言一起红。补一个占位模型凭据（`.credentials.yaml` 的 **`refs:`** 段，不是顶层裸键）即可；GUI 验收不调模型，占位值够用。
- **写断言前先在真 DOM 里确认入口形态**：`rc` 线里设置入口在**账号菜单**（`settings-account` 的 `AccountMenu` items 首项）里，未展开菜单时 DOM 里没有该按钮，`textContent` 还带快捷键后缀（`设置⌥⌘,`）。脚本要写成「先直接点、点不到再展开菜单」，别写死单一形态。
- **判"是不是本轮回归"要用 alpha 版实测对照**：`npm pack` 拉回上一个验证版本的同名包，`sed` 抹掉版本号后比对该段代码；逐字相同就说明是脚本/环境的老缺口，**不要记成新版本的破坏性变更**。
