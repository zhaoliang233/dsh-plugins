# 变更记录

本文件记录本项目的所有重要变更。

## [0.2.0] - 2026-10-01

### 变更

- **兼容发布线从 `>=0.1.7-alpha.1 <0.1.8` 跨到 `>=0.2.0-rc.2 <0.2.1`**：上表 10 行契约逐个在 `0.2.0-rc.2` 的实际安装包里重读确认（会话分页 `loadOlder`/`loadThrough`、`SessionSnapshot` 四字段、会话作用域 slot 与它的 `sessionId` props、`settings.general.item`、renderer 的透传与 `locale` 座位、scrollport 与行标记），**业务代码一字未改**——本轮改动只有版本门、清单与文档。隔离宿主（独立 `DSH_HOME` 与端口）+ 无头 Chrome 上跑完半离线回归：补齐到 `hasMore === false`、锚点零漂移、defer 让位、会话与视图切换，本插件全程零报错。跨到 `0.2.1` 之前必须重新读取 DSH 源码与实时契约。
- 版本门改为**从常量派生**（照抄已跨线的 `dsh-extra-context`）：`lib/index.js` 读 `DSH_RELEASE_LINE` + `DSH_RELEASE_FLOOR` + `PRERELEASE_CHANNELS`，`install.sh` 有等价的 shell 版（含 `prerelease_rank()`）。下界是 rc，所以同线内的 `alpha`/`beta`/更小的 `rc` 一律在门外，`0.2.0` 正式版在门内。
- `test/manifest.test.js` 新增一条守卫：把 `range` 反推回发布线与下界常量，并核对 `install.sh` 的五个常量与宿主清单逐字一致（改一处漏一处会变红）。

## [0.1.6] - 2026-09-28

### 变更

- **逐版本验证清单加入 `0.1.7-rc.2`**（兼容范围仍为 `>=0.1.7-alpha.1 <0.1.8`）：在 rc.2 上重新核对了会话分页、会话快照、会话作用域 slot 与 scrollport 四项契约，并做了隔离宿主 + 无头浏览器的半离线回归（补齐到 `hasMore === false`、锚点零漂移、滚动让位、会话与视图切换、全程零报错），**功能无需改动**。装在 `0.1.7-rc.2` 上不再打印"尚未逐版本验证"警告。
- rc.2 把 `loadOlder()` / `loadThrough()` 的页大小从固定的 50 / 200 条改成**按回合对齐的区间**（至少 50 / 200 条且至少 2 个回合起点，最多 500 条）。插件只依赖"一次调用推进多少条事件序号"，分批行为不变；文档与注释里的页大小描述按新语义订正。
- 顺带刷新 registry 元数据里的 `description`：0.1.5 发版时漏改了这一处，registry 上仍是旧的自述句。

### 已知边界

- 每批落地时的顿挫与 0.1.4 相同（DSH 渲染历史的成本，插件侧已无每帧工作）：rc.2 上实测最差帧间隔约 0.83 秒（该会话完整后 7.3 万 px，比 alpha.1 基线那次更大），P95 帧间隔 18ms。

## [0.1.5] - 2026-09-22

### 变更

- **兼容线移到 `>=0.1.7-alpha.1 <0.1.8`**（`0.1.7-alpha.1` 已逐版本核对）：`package.json`、`engines.dsh`、`install.sh` 版本门与 `lib/index.js` 的 `VERIFIED_DSH_VERSIONS` 四处同源更新，范围外保持 inert。
- **插件定位改为「打开会话时自动补齐整段历史」**：DSH 0.1.7 删除了 `historyIncomplete`/`compactTranscript` 门禁，紧凑排版改为按回合判断（`turnStarted || turnClosed`），"历史不全就不折叠"这个前提已不存在。补齐行为本身保留，只有文案、注释与文档不再声称它服务于折叠。
- 注释同步 0.1.7 的 `loadThrough` 语义：控制器在调用内累积 200 条/页、结算时一次性 prepend（不再每页各提交一次渲染），因此 `BATCH_EVENTS = 600` 的分批仍按"一次调用拉多少"生效。

## [0.1.4] - 2026-09-18

### 变更

- **加载改为分批拉取**：不再逐页（每次 50 条）请求，改用 DSH 的「跳到某处」加载器 `Session.loadThrough(seq)`，每批约 600 条、批与批之间等浏览器空闲（`requestIdleCallback`）再拉下一批。长会话从几十次往返变成几批连续请求（实测 13 万 px 的会话约 3 秒补齐），同时避免一次性把主线程占满。会话面没有该能力时回退逐页 `loadOlder()`。
- **修掉"加载完那一瞬间滑动会卡 1–2 秒"**：此前锚点测量（`getBoundingClientRect` 会强制同步布局）发生在每一步、乃至每个滚动帧上，大会话里直接把主线程拖死。现在每批只在发起前读一次、落地后恢复一次，找可见行用二分查找、恢复用属性选择器直接命中。实测最差帧间隔 **2989ms → 703ms**（longtask 从 1024ms → 702ms）。
- **加载过程中不再推走你的阅读位置**：每次更早的历史插入时，按 DSH 自己的锚点行（`data-chat-anchor-key`，回退 `data-turn-tail`）把视口修正回原位；实测一次 46732px 的 prepend 前后读者的 gap 完全不变（10038 → 10038），折叠后也回到同一锚点行。
- **让位改为"短暂让位"**：读者滚动时只暂停**发起**下一批，停手约 1 秒后自动继续（滚回底部则立即继续）。此前"滚一下就永久停住"会让历史停在半路，而历史不完整时紧凑排版不会折叠任何回合——这正是"等了半天思考过程也不收起"的原因。

### 已知边界

- 单批加载由 Controller 服务、不可中断；读者在批中途滚动不会取消它，位置由锚点补偿保证稳定。
- 补齐完成瞬间 DSH 折叠所有已关闭回合，内容高度会骤降一次（实测 130794px → 56250px），读者在中部阅读时仍能感到这次收缩——属 DSH 渲染行为。
- 极大会话每批落地时仍可能有几百毫秒顿挫（最差帧间隔约 0.7 秒）：这是 DSH 渲染大量历史的成本，插件侧已无每帧工作；再缩小批量（试到 400 条）没有进一步改善。

## [0.1.3] - 2026-09-18

### 修复

- **打开长会话时不滑动就不补齐**：让位判定原先只看视口是否在底部，而打开会话时的视口位置由 DSH 自己决定、补齐期间 DSH 又一直在做滚动补偿，于是这种"暂时不在底部"被误当成"读者正在阅读"，分页停在半路，直到读者碰巧滚回底部。现在只有**读者自己驱动过视口**（`wheel`/`touchstart`/`touchmove`/`pointerdown`/`keydown`，document 捕获阶段识别；新会话重新判定）**且**离开底部时才让位；其余情况一律继续补齐。"读者滚动后让位、滚回底部恢复"的行为不变。
- **DSH `0.1.6-alpha.2` 下自动补齐完全失效**：该版本从会话列表快照中移除了 `current`（`sessions.open()/clear()` 也被 `retain()/using()` 引用模型取代，导航改由视图所有者持有），而插件原先靠 `sessions.list.getSnapshot().current` 定位「当前查看的会话」，于是永远拿不到身份、静默不动——表现是打开长会话后顶部「加载更早」常驻、历史始终只有一页。现在改为在会话作用域 list slot `conversation.session.header.actions` 放置一个渲染 `null` 的驱动组件，由 Conversation 通过 slot props 交出 `sessionId`（`SessionStandardProps`），再用 `ctx.sessions.binding(id)` 取会话面分页。该 slot 声明与 `binding(id)` 在 `0.1.6-alpha.1` / `alpha.2` 一致，兼容范围不变。

### 变更

- 视图先画、Controller 尚未 retain 该会话时，按帧重试绑定（`MAX_BINDING_RETRIES = 30`），超时即停止，不做轮询；身份切换用带 id 的 `detach`，被替换视图的卸载不会解绑新会话。
- `package.json#dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-conversation`（插件在该包声明的 slot 上注册）。
- 逐版本验证版本更新为 `0.1.6-alpha.2`（兼容范围仍为 `>=0.1.6-alpha.1 <0.1.7`）。

## [0.1.2] - 2026-09-17

### 文档

- 全部文档改为纯中文，不再维护中英双语；`README.md` 收敛为「为什么需要它 → 行为 → 设置 → 安装与卸载 → 要求 → 已知限制」。
- 安装入口改为官方命令 `dsh plugin --profile web add/remove dsh-auto-load-history`，并补上升级方式（profile 依赖是 caret 范围，需显式写版本号）；`./install.sh` 明确为源码 `link:` 开发路线。
- 要求一节的兼容范围更正为 `>=0.1.6-alpha.1 <0.1.7`（此前文档仍写着旧的 `0.1.5` 发布线，与 manifest 不一致）。

## [0.1.1] - 2026-09-17

首个公开发布到 npm registry 的版本。

### 变更

- 改用 GitHub Actions 的 OIDC 可信发布（trusted publishing）自动发布，不再依赖长期 npm token。

## [0.1.0] - 2026-09-17

### 兼容性

- 在官方新增的 `package.json#engines.dsh` 字段第二次声明 DSH 兼容范围，并在 manifest 测试中守卫同源。
- 针对 DSH `0.1.6-alpha.1` 重新核对整套契约：`ISession.loadOlder()`（契约文件逐字节相同，`maxMessages: 50`）、`SessionSnapshot` 的四个字段、`sessions.list.current`、`binding(id).session`/`.eventSource`、窗口头进度读取、`settings.general.item` list slot、renderer 的 `inject` face 透传与 `locale` 座位、`[data-conversation-scroll]`，以及紧凑折叠门禁（`processWindowReady ... && !historyIncomplete`，`historyIncomplete: hasMore`）均未变化。兼容线移到 `>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 逐版本验证。

### 新增

- 会话打开时把整段历史分页补齐，使紧凑排版能折叠每个已完成回合，无需读者反复点「加载更早」或在回合导航里翻找。
- 增加设置 → 通用的偏好行（`会话历史`），提供自动与手动两种模式，默认自动，选择按浏览器保存。
- 读者滚离流底部时暂停分页；连续多页没有推进窗口时停止。
