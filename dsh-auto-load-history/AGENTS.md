# dsh-auto-load-history 技术说明

## 边界

纯客户端插件。Host 半体只做 DSH 版本门（同工作区其它插件），**不新增路由、不改写会话日志、不写 `~/.dsh/settings.yaml`、不持久化任何 Host 侧状态**。客户端只做三件事：

1. 在会话作用域 list slot `conversation.session.header.actions` 里放一个渲染 `null` 的驱动组件，从 slot props 拿到当前显示的 `sessionId`；
2. 订阅该会话的生命周期快照，调用公开的 `SessionFace.loadOlder()` 把历史分页补齐；
3. 在 `settings.general.item` 注册一行偏好（自动 / 手动）。

不替换核心会话视图、消息 renderer、Slot occupant，也不改 DSH 源码。

## 会话身份从哪来（0.1.6-alpha.2 的关键变更）

`ctx.sessions.list.getSnapshot().current` 在 0.1.6-alpha.2 中被**移除**：会话列表快照只剩 `items/state/phase/error/subagentsByParent/jobsBySession`，`sessions.open()/clear()` 也被 `retain()/using()` 引用模型取代，持久化选择移到 `dsh-client-ui-workspace` 私有的 `uiWorkspace.selection`（`dsh.sessions.current`）。**导航属于视图所有者**，Controller 不再对外发布"当前是哪个会话"。

因此本插件不再自行猜当前会话，而是占用一个**会话作用域 slot**：由 Conversation 把身份交给它，与 DSH 给所有 session-scope 贡献的 `sessionId`（`SessionStandardProps`）一致。落点选 `conversation.session.header.actions`（list / session）：它在 `ConversationLayout` 中随会话存在无条件渲染（`sessionId === undefined ? null : renderSlot(...)`），Chat ↔ Trajectory 切换不重挂，且 list slot 直接渲染 occupant（无包裹元素），渲染 `null` 不产生 DOM。

slot 是**契约内**的公开路径；读 `uiWorkspace.selection`（persistent store 私有字段）或推断 `sessions.retainInfo()` 的 `mainView` 引用计数都属于依赖私有实现，不采用。

## 为什么必须“全部加载完成”

`dsh-client-ui-chat/lib/client.js`（0.1.6-alpha.2）：`:1567` 的 `processWindowReady` 要求 `compactTranscript && … && !historyIncomplete`，而 `:2556` 的 `historyIncomplete: hasMore`——即 **`hasMore` 不为 false 时，紧凑折叠对所有回合都不生效**，这正是本插件存在的理由。

清 `hasMore` 的原生路径只有两条：顶部「加载更早」按钮（`loadOlder()`，`maxMessages: 50`，`dsh-api-session-controller/lib/client.js:1756`）和回合导航未加载圆点的 `loadThrough(seq)`（每页 200、循环到覆盖目标 seq，同文件 `:1775`）。服务端 `paginate` 用 `cut > 0` 决定 `hasMore`（同包 `lib/index.js:1570`），所以“点最早回合”只是大概率清掉 `hasMore`；插件的目标必须显式定为 `hasMore === false`。

## 依赖的契约（0.1.6-alpha.2 已核对）

| 契约 | 位置 | 用途 |
|---|---|---|
| `ISession.loadOlder(): Promise<void>` | `dsh-api-session-controller/lib/types/client/contract/session.d.ts` | 唯一的写动作；`openState !== 'open'`、`!hasMore`、`loadingOlder` 三种情况下自 noexcept 跳过 |
| `SessionSnapshot.openState/removed/hasMore/loadingOlder` | 同包 `lib/types/client/contract/snapshot.d.ts` | 驱动状态机 |
| 会话作用域 list slot `conversation.session.header.actions` | `dsh-client-ui-conversation/lib/client.js:16923` 声明、`:15423` 渲染 | **唯一的身份来源**：slot props 注入 `sessionId`（`SessionStandardProps`）；list slot 直接渲染 occupant，渲染 `null` 无 DOM |
| `ctx.sessions.binding(id).session` / `.eventSource` | 同包 `lib/types/client/sessions/service.d.ts`（`sessionId`/`session`/`eventSource`） | 会话面 + 事件窗口（只读窗口头 seq 作为进度信号）；id 由 slot 给出 |
| `ctx.slots.inject(name, register)` 等待声明 | `dsh-client-ui-slots` 的声明表 | 注册两类落点；`dsh.client.inject` 因此必列 conversation 与 settings-general 两个包 |
| `settings.general.item`（list / root，需 `id`） | `dsh-client-ui-settings-general` 的 `settings.section` entry 声明 | 偏好行落点 |
| Slot `inject` face 非 `hooks`/`keyedHooks` 键原样透传 | `dsh-client-ui-renderer/lib/client.js:424` `bindInjectSources` | 直接传 `getEnabled/subscribeEnabled/setEnabled` 与 `attach/detach`，不引入 `dsh-client-store` |
| `locale: '<ns>'` 提供 `t` | 同文件 `:724` | 行文案 zh/en |
| `[data-conversation-scroll]` | 会话 shell 的 scrollport（`dsh-client-ui-conversation/lib/client.js:15273`） | 只用于“读者是否在底部”的判断（取不到时的 fail open 行为见「已知限制」） |

**已核对为移除/不采用**：`ctx.sessions.list.getSnapshot().current`、`sessions.open()/clear()`（0.1.6-alpha.2 已删）、`uiWorkspace.selection`（私有字段）、`sessions.retainInfo()` 的 `mainView` 计数（私有记账）。

## 运行模型

不轮询：状态机只在**会话快照发布**时前进一步（`session.subscribe`）。一页在飞（自己的，或读者点的「加载更早」）时只等待；`loadOlder()` 同步把 `loadingOlder` 置真并发布快照，因此重入的 drive 会被 `loadingOlder === true` 挡掉，不会误记一次“停滞”（`pendingHead` 只在 `!loadingOlder` 时才结算）。

身份驱动：驱动组件在 `useEffect` 里 `loader.attach(sessionId)`，卸载时 `loader.detach(sessionId)`（带 id 的解绑只在身份匹配时生效，避免被替换视图的 cleanup 拆掉新会话）。`attach` 是幂等切换：同一 id 只重新 drive，不同 id 先 `detach()` 再绑定。绑定后 `step()` 通过 `resolveFace(boundSessionId)` 分类：`ready` 用 `binding.session`/`binding.eventSource`；`pending`（视图先画、Controller 尚未 retain）按 `MAX_BINDING_RETRIES = 30` 帧重试；`unsupported`（缺 `loadOlder`）直接惰性，不重试。

纯函数（可测）：`parseStoredEnabled`、`readerAtBottom`、`advanceStall`、`nextAutoLoadAction`、`windowHead`。判定顺序 `enabled → openState → removed → hasMore(done) → loadingOlder(wait) → 读者驱动且不在底部(defer) → stalled(idle) → page`。

- **进度**：用事件窗口头 seq（`eventSource.getSnapshot().entries[0].event.seq`）判断这一页有没有真的把窗口往前推；连续 `MAX_STALLED_PAGES = 3` 页没推进就停止本次补齐，把控制权还给原生按钮，避免请求失败时无限重试。`loadOlder` 的 reject 与同步抛错都会重新调度一次（否则没有后续快照可响应），仍受同一停滞预算约束。
- **让位阅读**：`readerAtBottom(metrics, 64)` 用 scrollport 的 `scrollHeight - scrollTop - clientHeight` 判断，但**只有读者自己驱动过视口**（`readerScrolled`：`USER_INTENT_EVENTS` = `wheel`/`touchstart`/`touchmove`/`pointerdown`/`keydown` 之一；`attach` 新会话时重置）**且不在底部**时才 `defer`。打开会话时的视口位置是 Conversation 自己放的，DSH 在 prepend 期间也一直在做滚动补偿——把这种"暂时不在底部"当成读者在阅读，补齐就会停住，直到读者碰巧滚回底部（0.1.2 的表现：打开长会话不滑动就不加载）。进入 defer 后在 `document` 挂捕获阶段 `scroll` 监听（scroll 不冒泡但捕获阶段到得了 document），回到底部即恢复；监听不缓存元素，Chat ↔ Trajectory 切换、scrollport 被替换都不需要重挂。
- **清理**：会话/偏好订阅、滚动与意图监听、定时器、style 标签全部归 `ctx.effect` 与 `loader.dispose()`；`drive()` 外层 try/catch，任何异常都不会漏进会话来通知链。

## 偏好存储

`localStorage['dsh-auto-load-history.enabled']`，默认 `true`；`typeof localStorage` 守卫 + 读写 try/catch（拒绝/配额都不影响内存值）。选 localStorage 而非 settings namespace：这是**浏览器端阅读习惯**，DSH 自己的客户端偏好（会话草稿、transcript 宽度）也用 localStorage；同时避免依赖 `@deepseek-ai/schemastery`（Host 半体在 profile 里解析不到该包）以及跨插件读 `ui-chat` 私有命名空间。`storage` 事件让多标签页保持一致。

## 样式与设置行

CSS 文本按核心 `TranscriptViewRow.module.css` / `PermissionRow.module.css` 的同一套声明复刻（`.dshalh_row/rowText/title/desc/selector/chevron`），只用 `--dsw-alias-*` token；`<style data-plugin-css="dsh-auto-load-history/AutoLoadHistoryRow.css">` 挂在 head，卸载时移除。控件用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu` + `IconChevronDownOutline14`，与 transcript-view / permission 两行同构；`package.json#dsh.client.inject` 因此不必单列 primitives——它是浏览器**平台静态 seed** 的词之一，`require` 直接命中 seed，不依赖 boot graph 里有没有别的包带它。行顺序 `order: 13`，紧跟 `transcript-view: 12`（它服务的就是那个排版选项）。

## 切回会话为何会重新分页（0.1.6-alpha.2 的 DSH 行为，非本插件所致）

0.1.6-alpha.2 用引用计数管理会话生命周期：`uiWorkspace.replaceMain()` 切会话时先 `retain(新会话)` 再 `previous?.release()`（`dsh-client-ui-workspace/lib/client.js:189`、`:213`），而 `SessionReference.release()` 的契约是「Release once; **the final reference starts local scope and history teardown**」。于是离开会话即拆除其历史窗口，切回时 `hasMore` 回到 `true`、必须重新分页补齐（观感就是"之前加载好的又要加载一遍"；补齐期间 `hasMore` 未清、紧凑折叠还不生效，高度会短暂变大）。alpha.1 的 `pruneScopes()` 只在会话「no-longer-eligible」（被移除/归档）时拆除、`watched` 还延迟拆除，普通切换不拆——所以旧版切回是完整的。

**本插件刻意不 `retain`**：只借用 `binding(id)`（契约注明不延长生命周期）、调 `loadOlder()`，保持引用计数与 DSH 语义不变。**不要为了"切回不重新加载"去 retain 会话**（2026-09-18 与用户确认保持现状）：那会让插件成为生命周期持有者——多留一个会话窗口的内存，并把归档/删除会话的本地拆除推迟到插件放手。

实测记录（`--port 0` 隔离服务器 + headless CDP，2026-09-18）：A 补齐后 43760px → 切到 B 6588px → 切回 A 的高度曲线 `25772 → 42680（「加载更早」出现）→ 56653 → 75072 → 43760`，确认窗口被重置后由插件重新补齐。

## 已知限制与升级策略

- 只处理**当前查看会话**，不预加载后台会话；分页在会话打开后立即开始，长会话可能需要数秒；只有读者自己滚动过并且离开了底部才会暂停（defer）。
- defer 依赖 `[data-conversation-scroll]`：DSH 改名后 `metrics()` 返回 null，`readerAtBottom` 视为“在底部”继续分页，只是不再让位阅读（fail open，退回 v0 语义）。
- 读者意图靠 `USER_INTENT_EVENTS` 判断（document 捕获阶段、passive）：滚动条拖动会触发 `pointerdown`、点击会话内容也算，因此"点了某处之后又不在底部"会让位（可接受：读者确实在交互）；反过来，非常规的视口驱动方式（脚本滚动、DSH 自身的滚动）一律不算读者意图，插件继续补齐而不是停住——宁可补完，也不要停在半路。
- 进度信号依赖 `binding.eventSource` 的窗口头；取不到时不结算停滞（`advanceStall` 原样返回），此时完全靠 `hasMore` 变化驱动，最坏情况是补不齐而不是死循环。
- 不读 `ui-chat.transcriptView`：行为与排版无关（普通排版下把历史带起来也无害），避免跨插件读私有设置命名空间。
- 身份依赖 `conversation.session.header.actions` 这一 slot 声明：DSH 若删掉该 slot 或改其 scope，`slots.inject` 回调不再触发、驱动组件永不挂载，插件会**静默失效**（不报错）——这是 `loadOlder` 能力检查之外唯一的硬依赖，升级时必须连同上表一起复核。
- DSH 升级后必须重新核对上表每个契约（紧凑折叠判断、`SessionSnapshot` 四字段、`loadOlder` 语义与页大小、会话作用域 slot 的声明与 props、`settings.general.item` 注册契约、scrollport 标记），再声明兼容。

## 发布线

`>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.2` 已逐版本核对并在真实浏览器中验证（0.1.2 版实现曾验证 `0.1.6-alpha.1`，其 slot 声明与 `binding(id)` 已静态核对与 alpha.2 一致，但当前实现未在 alpha.1 上运行验证）；同线后续版本带警告运行，客户端能力检查（`loadOlder` 是否存在）是最终依据。`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 版本门与本文必须同源。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-auto-load-history`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-auto-load-history-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。

## 验证

```bash
npm run publish:check     # check + test + pack:check
./install.sh
```

单元测试覆盖（29 个）：偏好解析/降级、底部判定、停滞计分、状态机判定矩阵（含"不在底部但读者没驱动过视口仍 page"与"读者驱动过且不在底部才 defer"）、窗口头防御读取、整段补齐（4 页到 `hasMore === false`）、关→开恢复、运行中关闭停止、读者驱动离底后 defer 再回底恢复、**视口不在底部但从未发生读者意图时仍补齐**、**重新 attach 不继承上一次的读者意图**、停滞 3 页放弃、`openState` 未开时等待、缺少 `loadOlder` 时惰性、未 retain 身份的绑定重试、身份切换（attach/detach，含 id 不匹配的解绑不生效）、reject/同步抛错后重试到停滞上限、dispose 后不再动作、apply 的注册（两类落点）与清理标签、驱动组件挂载/卸载调用 attach/detach。harness 的 `loadOlder` 每页占一个宏任务（模拟真实往返），使运行可被中断，避免微任务链把整段历史一次跑完。

真实浏览器验证（`0.1.6-alpha.2`，`--port 0` 隔离服务器 + headless CDP，2026-09-18）：

| 场景 | 结果 |
|---|---|
| 打开长会话（标题「检查插件安装与文档发布」） | 3 秒内「加载更早」消失，内容高度 14929 → 43760（0.1.2 故障时按钮常驻、高度停在 14929） |
| 连续打开两个长会话 | 各自独立补齐，按钮均消失 |
| 偏好置为 `false` 后刷新再开会话 | 按钮保留、历史不补齐 |
| 偏好恢复 `true` 后刷新再开会话 | 按钮消失、整段补齐 |
| 切走再切回后，**持续把视口钉在顶部**（`gap ≈ 7048px`、无任何用户输入） | 仍然补齐到 `hasMore === false`（按钮消失）——0.1.2 会在这里停住 |
| 切走再切回后，先派发真实 `wheel` 再把视口放在中部（`gap ≈ 1356px`） | 分页暂停、按钮保留；随后滚回底部立即恢复并补齐 |

GUI 验证清单（挂载并重启后）：

1. 打开历史很长的会话：顶部「加载更早」按钮消失（`hasMore` 已清），紧凑排版立即折叠每个回合的思考过程；
2. 设置 → 通用出现「会话历史」行，切到「手动」后新开会话不再自动补齐、切回「自动」后当前会话继续补齐；
3. 会话打开后立刻向上滚动：分页暂停（内容不被挤走），滚回底部后继续；
4. 刷新页面后偏好保持；另一个标签页切换偏好后本页跟随；
5. Chat ↔ Trajectory 切换、会话切换、流式回答期间无报错、无重复分页。
