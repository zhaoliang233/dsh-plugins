# dsh-auto-load-history 技术说明

## 边界

纯客户端插件。Host 半体只做 DSH 版本门（同工作区其它插件），**不新增路由、不改写会话日志、不写 `~/.dsh/settings.yaml`、不持久化任何 Host 侧状态**。客户端只做两件事：

1. 订阅当前会话的生命周期快照，调用公开的 `SessionFace.loadOlder()` 把历史分页补齐；
2. 在 `settings.general.item` 注册一行偏好（自动 / 手动）。

不替换核心会话视图、消息 renderer、Slot occupant，也不改 DSH 源码。

## 为什么必须“全部加载完成”

`dsh-client-ui-chat/lib/client.js`（0.1.6-alpha.1）：`:1567` 的 `processWindowReady` 要求 `compactTranscript && … && !historyIncomplete`，而 `:2553` 的 `historyIncomplete: hasMore`——即 **`hasMore` 不为 false 时，紧凑折叠对所有回合都不生效**，这正是本插件存在的理由。

清 `hasMore` 的原生路径只有两条：顶部「加载更早」按钮（`loadOlder()`，`maxMessages: 50`，`dsh-api-session-controller/lib/client.js:1801`）和回合导航未加载圆点的 `loadThrough(seq)`（每页 200、循环到覆盖目标 seq，同文件 `:1821`）。服务端 `paginate` 用 `cut > 0` 决定 `hasMore`（同包 `lib/index.js:1621`），所以“点最早回合”只是大概率清掉 `hasMore`；插件的目标必须显式定为 `hasMore === false`。

## 依赖的契约（0.1.6-alpha.1 已核对）

| 契约 | 位置 | 用途 |
|---|---|---|
| `ISession.loadOlder(): Promise<void>` | `dsh-api-session-controller/lib/types/client/contract/session.d.ts` | 唯一的写动作；`openState !== 'open'`、`!hasMore`、`loadingOlder` 三种情况下自 noexcept 跳过 |
| `SessionSnapshot.openState/removed/hasMore/loadingOlder` | 同包 `lib/types/client/contract/snapshot.d.ts` | 驱动状态机 |
| `ctx.sessions.list.getSnapshot().current` | 同包 `client/contract/sessions.d.ts` | 定位当前查看的会话 |
| `ctx.sessions.binding(id).session` / `.eventSource` | 同包 `client/sessions/service.d.ts` | 会话面 + 事件窗口（只读窗口头 seq 作为进度信号） |
| `settings.general.item`（list / root，需 `id`） | `dsh-client-ui-settings-general` 的 `settings.section` entry 声明 | 偏好行落点 |
| Slot `inject` face 非 `hooks`/`keyedHooks` 键原样透传 | `dsh-client-ui-renderer/lib/client.js:342` `bindInjectSources` | 直接传 `getEnabled/subscribeEnabled/setEnabled`，不引入 `dsh-client-store` |
| `locale: '<ns>'` 提供 `t` | 同文件 `:602` | 行文案 zh/en |
| `[data-conversation-scroll]` | 会话 shell 的 scrollport | 只用于“读者是否在底部”的判断（取不到时的 fail open 行为见「已知限制」） |

## 运行模型

不轮询：状态机只在**会话快照发布**时前进一步（`session.subscribe`）。一页在飞（自己的，或读者点的「加载更早」）时只等待；`loadOlder()` 同步把 `loadingOlder` 置真并发布快照，因此重入的 drive 会被 `loadingOlder === true` 挡掉，不会误记一次“停滞”（`pendingHead` 只在 `!loadingOlder` 时才结算）。

纯函数（可测）：`parseStoredEnabled`、`readerAtBottom`、`advanceStall`、`nextAutoLoadAction`、`windowHead`。判定顺序 `enabled → openState → removed → hasMore(done) → loadingOlder(wait) → atBottom(defer) → stalled(idle) → page`。

- **进度**：用事件窗口头 seq（`eventSource.getSnapshot().entries[0].event.seq`）判断这一页有没有真的把窗口往前推；连续 `MAX_STALLED_PAGES = 3` 页没推进就停止本次补齐，把控制权还给原生按钮，避免请求失败时无限重试。`loadOlder` 的 reject 与同步抛错都会重新调度一次（否则没有后续快照可响应），仍受同一停滞预算约束。
- **让位阅读**：`readerAtBottom(metrics, 64)` 用 scrollport 的 `scrollHeight - scrollTop - clientHeight` 判断；不在底部时进入 defer，并在 `document` 上挂捕获阶段 `scroll` 监听（scroll 不冒泡，但捕获阶段能到达 document），回到底部才继续。监听不缓存元素，Chat ↔ Trajectory 切换、scrollport 被替换都不需要重挂。
- **清理**：会话/列表/偏好订阅、定时器、scroll 监听、style 标签全部归 `ctx.effect` 与 `loader.dispose()`；`drive()` 外层 try/catch，任何异常都不会漏进会话来通知链。

## 偏好存储

`localStorage['dsh-auto-load-history.enabled']`，默认 `true`；`typeof localStorage` 守卫 + 读写 try/catch（拒绝/配额都不影响内存值）。选 localStorage 而非 settings namespace：这是**浏览器端阅读习惯**，DSH 自己的客户端偏好（会话草稿、transcript 宽度）也用 localStorage；同时避免依赖 `@deepseek-ai/schemastery`（Host 半体在 profile 里解析不到该包）以及跨插件读 `ui-chat` 私有命名空间。`storage` 事件让多标签页保持一致。

## 样式与设置行

CSS 文本按核心 `TranscriptViewRow.module.css` / `PermissionRow.module.css` 的同一套声明复刻（`.dshalh_row/rowText/title/desc/selector/chevron`），只用 `--dsw-alias-*` token；`<style data-plugin-css="dsh-auto-load-history/AutoLoadHistoryRow.css">` 挂在 head，卸载时移除。控件用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu` + `IconChevronDownOutline14`，与 transcript-view / permission 两行同构；`package.json#dsh.client.inject` 因此不必单列 primitives——它是浏览器**平台静态 seed** 的词之一，`require` 直接命中 seed，不依赖 boot graph 里有没有别的包带它。行顺序 `order: 13`，紧跟 `transcript-view: 12`（它服务的就是那个排版选项）。

## 已知限制与升级策略

- 只处理**当前查看会话**，不预加载后台会话；分页在会话打开后立即开始，长会话可能需要数秒，期间读者向上滚即暂停（defer）。
- defer 依赖 `[data-conversation-scroll]`：DSH 改名后 `metrics()` 返回 null，`readerAtBottom` 视为“在底部”继续分页，只是不再让位阅读（fail open，退回 v0 语义）。
- 进度信号依赖 `binding.eventSource` 的窗口头；取不到时不结算停滞（`advanceStall` 原样返回），此时完全靠 `hasMore` 变化驱动，最坏情况是补不齐而不是死循环。
- 不读 `ui-chat.transcriptView`：行为与排版无关（普通排版下把历史带起来也无害），避免跨插件读私有设置命名空间。
- DSH 升级后必须重新核对上表每个契约（紧凑折叠判断、`SessionSnapshot` 四字段、`loadOlder` 语义与页大小、`settings.general.item` 注册契约、scrollport 标记），再声明兼容。

## 发布线

`>=0.1.6-alpha.1 <0.1.7`，`0.1.6-alpha.1` 已逐版本核对；同线后续版本带警告运行，客户端能力检查（`loadOlder` 是否存在）是最终依据。`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 版本门与本文必须同源。

## 发布与安装路线

- 用户路线是官方命令 `dsh plugin --profile web add dsh-auto-load-history`（卸载用 `remove`）；升级必须显式写版本号（profile 依赖是 caret 范围）；`./install.sh` 只保留为源码 `link:` 开发路线。
- 发布：`npm run publish:check` 是唯一闸门（语法、测试、`scripts/check-pack.js` 的 tarball 白名单），`install.sh` 也必须先跑完整闸门；`.github/workflows/ci.yml` 只验证 Node 20/22，发布由根仓库 `.github/workflows/release.yml` 收到 `dsh-auto-load-history-v<版本>` tag 后经 npm trusted publishing（OIDC）完成。

## 验证

```bash
npm run publish:check     # check + test + pack:check
./install.sh
```

单元测试覆盖：偏好解析/降级、底部判定、停滞计分、状态机判定矩阵、窗口头防御读取、整段补齐（4 页到 `hasMore === false`）、关→开恢复、运行中关闭停止、defer/回到底部恢复、停滞 3 页放弃、`openState` 未开时等待、缺少 `loadOlder` 时惰性、reject/同步抛错后重试到停滞上限、dispose 后不再动作、apply 的注册与清理标签。

GUI 验证清单（挂载并重启后）：

1. 打开历史很长的会话：顶部「加载更早」按钮消失（`hasMore` 已清），紧凑排版立即折叠每个回合的思考过程；
2. 设置 → 通用出现「会话历史」行，切到「手动」后新开会话不再自动补齐、切回「自动」后当前会话继续补齐；
3. 会话打开后立刻向上滚动：分页暂停（内容不被挤走），滚回底部后继续；
4. 刷新页面后偏好保持；另一个标签页切换偏好后本页跟随；
5. Chat ↔ Trajectory 切换、会话切换、流式回答期间无报错、无重复分页。
