# dsh-chat-archive-manager

A DeepSeek Harness Web plugin that adds an archived-chat page to Settings with restoration and conservative permanent deletion, without modifying DSH source code or installed `@deepseek-ai/*` packages.

[简体中文](#简体中文)

## Features

- Adds an `归档管理` (archive management) page with the archive glyph to the Settings side navigation, including a compact count immediately after the title (`99+` above 99 chats), one-click restoration, and explicit confirmation before permanent deletion.
- Groups archived chats by their owning Workspace in DSH's own group order, with one Ungrouped bucket, a search box, and recency or archive-order sorting.
- Batch-archives chats whose last update precedes a chosen cutoff (24 hours, 1, 7, 15, 30, or 90 days, or a custom date) through a preview, an explicit confirmation above 50 chats, and a one-click undo of that batch. The scope (all chats, one Workspace, or Ungrouped) is chosen inside that dialog.
- Adds no first-level sidebar action, so DSH's dynamic `Cordis Plugin` footer control remains independent during plugin debugging.
- Reads DSH's `archivedSessionIds` directly without creating a separate Workspace or projecting synthetic session rows.
- Restores a session to its prior Workspace position when that Workspace still exists, otherwise to Ungrouped.
- Keeps sessions hidden in DSH's grouped, flat, and search views until they are restored.
- On upgrade, unregisters the exact legacy `$DSH_HOME/workspaces/archived` Workspace created by earlier candidates while preserving its directory, session logs, original Workspace accounting, and archive set.
- Removes a selected session log and core accounting while retaining content-addressed attachments that may be shared by other sessions.

## Requirements

- DeepSeek Harness Web `>=0.1.6-alpha.1 <0.1.7`.
- Individually verified DSH versions: `0.1.6-alpha.1`.
- Node.js 20 or newer.
- `session-persistence-jsonl` for permanent deletion.

Grouping and batch archiving stay entirely in the browser bundle: the page reads `workspaces.list` and `sessions.list` and archives through DSH's own `workspaces.archiveSession()` command, so neither feature adds a Host route, private-ABI access, or Workspace accounting rewrite. Batch archiving archives one chat per durable Host operation, serially; it never terminates a running Agent, and a chat that gained activity between the preview and the execution is skipped and reported instead of archived. When the client controller does not expose `archiveSession`, batch archiving disables itself and grouping remains available.

Archive listing uses the current DSH Session and Workspace client controllers without patching their snapshots or commands. Its React subscriptions preserve the receiver required by the Workspace class store. Restoration is serialized through the Workspace registry, preserves the session log and any existing accounting slot, and never recreates a deleted Workspace. Permanent deletion is a strict private-ABI compatibility layer and is enabled only when the tested JSONL backend, Workspace registry, handle tracker, migration tasks, and cache structures match. Both current v3 plaintext `session.v3.jsonl` and zstd-compressed `session.v3.jsonl.zstd` artifacts are supported; older generations must first be migrated by DSH itself. A chat whose log has not been migrated yet is refused with an explicit migration message instead of a generic retry failure, and nothing on disk is touched.

Later versions within the declared release line may install with an unverified-version warning and still must pass the runtime capability checks. Versions outside the line are rejected by `install.sh`; widening the range requires a new source and contract audit. When the JSONL deletion runtime does not match the verified contract, listing and restoration remain available while deletion fails closed. An unresolved deletion journal disables both mutation paths until it is inspected. The status endpoint reports each capability independently. Mutation routes additionally require the same-origin browser client marker and `application/json` as a defense-in-depth CSRF fence on top of DSH browser authentication.

## Registry Status

This package was renamed from the local `dsh-archived-chats` candidate because npm already contains an unrelated project under that name. At the latest check, npm returned `E404` for `dsh-chat-archive-manager`; `E404` is not a reservation, so verify availability again immediately before publication. See `PUBLISHING.md` for the remaining release gates.

## Local Install

From this source checkout:

```bash
npm run publish:check
./install.sh
```

`install.sh` first rejects DSH versions outside the declared release line and runs the complete publish check (syntax, tests, and tarball contents). It then delegates to DSH's official profile manager and adds `link:<checkout-path>` to the `web` profile without copying plugin files. Use another existing Web-capable profile when needed:

```bash
DSH_PROFILE=custom-web ./install.sh
DSH_PROFILE=custom-web ./uninstall.sh
```

Restart `dsh web` after Host changes, then refresh the browser. Package or Cordis patch changes require running `./install.sh` again before restart.

## Usage

1. Archive a chat through DSH's normal session action.
2. Open Settings and select `归档管理` from its left navigation.
3. Select the restore action to return it to the normal chat list, or select the red permanent-delete action and confirm it in the dialog.
4. The single row above the list holds `批量归档` and `批量删除` (the destructive one in the error color) at its left end, the collapse toggle (`展开全部`/`折叠全部`) at its right end, and the search box carries the shell's own search glyph. Switch between `按工作区分组` and `单列表` and sort by recency or archive order. Every chat is a borderless card shaped like DSH's own archived-session page, and its secondary line is the relative last activity (`20 天`, `1 个月`) — the Workspace name leads it in `单列表`, while a group header already names the Workspace. Groups start collapsed: click a workspace row (folder icon + name) to expand it.
5. Select `批量归档`, choose a scope (all chats, one Workspace, or Ungrouped) and a time condition, exclude or include running, blank, and currently open chats, then review the frozen list before archiving. The preview arrives fully selected, so you can deselect individual rows or clear the list with the inline `全不选` button; above 50 selected chats an explicit acknowledgment is required. When the run finishes, `撤销本次归档` restores exactly that batch.
6. Select `批量删除` for the same three-step flow over the archived chats themselves, ending in permanent deletion: it is offered only while the Host reports a usable deletion route, it always requires the acknowledgment checkbox no matter how few chats are selected, and the result step offers no undo.

The dialog keeps its title and action buttons visible at all times: only the chat list itself scrolls.

`24 小时前` is a rolling window; `1 天前` starts at local midnight today (yesterday and earlier), so it is not a duplicate of the rolling window; the remaining presets are rolling N×24-hour windows, and a custom date starts at local midnight of that day.

Batch archiving default-excludes running/completing chats, blank chats, the currently open chat, and every subagent session. The cutoff is evaluated against the `updatedAt` DSH itself shows in its list — the later of the session's creation time and your last prompt — so a chat whose projection cache is unavailable can look older than it is; the preview exists to make that decision reviewable row by row. Every archived chat keeps its Workspace slot, so a normal restore puts it back where it was.

Restoration removes only the selected ID from `archivedSessionIds`; the session log and existing Workspace accounting remain unchanged. If the original Workspace still exists, its slot and manual ordering restore the previous position. If that Workspace was deleted, the plugin does not recreate it and DSH displays the restored chat under Ungrouped. The session's original `cwd` remains in its header.

A session that is still live, Agent-owned, held by an open JSONL handle, pending materialization, or under migration preparation is rejected with a restart-required response only for permanent deletion. A parent session with persisted or live descendants cannot be deleted by itself.

## Deletion Semantics

A successful permanent deletion:

- Verifies the persisted header through the JSONL backend and binds it to the physical log identity.
- Atomically renames the session directory into a same-filesystem trash directory.
- Removes the session ID from Workspace accounting and `archivedSessionIds`.
- Best-effort clears projection cache, message feedback, and search-index state.
- Revalidates the moved artifact before recursively removing its trash directory.

It does not remove `$DSH_HOME/attachments/v1/objects`. Attachments are content-addressed and may be shared by multiple sessions, so per-session ownership cannot be inferred safely.

The durable transaction journal is stored at:

```text
$DSH_HOME/dsh-archived-chats/deletions.json
```

Temporary trash is stored beside, never below, the JSONL persistence root:

```text
$DSH_HOME/.dsh-archived-chats-trash/
```

These two storage names intentionally retain the pre-rename identifier. They are a persisted safety ABI: changing them could hide an incomplete transaction and bypass deletion quarantine. Keeping trash outside the JSONL scan root also lets a cold Host boot safely after an interrupted rename.

Before the first rename, the plugin durably creates the journal and trash directories and verifies that source and trash are on the same device. It checks the session lifecycle, directory inode, log inode, and log size before and after the rename and again before final removal. Delete and restore share one mutation coordinator; deletion tombstones the session, drains already-admitted persistence calls, then renames. A non-empty journal on startup quarantines deletion for manual inspection. The plugin never automatically renames, rolls back, rolls forward, or recursively removes paths based on journal contents.

## Uninstall

```bash
./uninstall.sh
```

Uninstalling removes the linked profile dependency and reversible runtime hooks. It deliberately keeps undeleted sessions, attachments, the legacy archive directory, and the deletion journal.

## Local Validation

```bash
npm run publish:check
dsh web --dump-config
# In the authenticated DSH page console:
# await fetch('/dsh-chat-archive-manager/status', { credentials: 'same-origin' }).then(r => r.json())
```

For an isolated DSH Home:

```bash
DSH_HOME=/tmp/dsh-chat-archive-manager-dev ./install.sh
DSH_HOME=/tmp/dsh-chat-archive-manager-dev dsh web --port 0 --no-open
DSH_HOME=/tmp/dsh-chat-archive-manager-dev ./uninstall.sh
```

`npm run publish:check` performs syntax checks, unit tests, lifecycle and interoperability tests, and an exact npm tarball-content check. It does not publish anything.

## 简体中文

`dsh-chat-archive-manager` 以纯插件方式在 DeepSeek Harness Web 的设置页中增加“归档管理”页面、恢复和保守的永久删除能力，不修改 DSH 源码或已安装的 `@deepseek-ai/*` 包。

### 主要行为

- 在“设置”弹窗左侧菜单中以归档图标提供“归档管理”页面；计数紧跟页面标题，超过 99 时显示“99+ 条聊天”，并提供一键恢复和带明确确认的永久删除。
- 归档列表按 DSH 自己的工作区顺序分组，只有一个“未分组”桶，并提供搜索框以及“最近更新/归档先后”排序。会话行是与 DSH 自带归档页一致的卡片，副标题用相对最近更新（“20 天”“1 个月”），分组视图里工作区由组头表达、组与组之间只用间距区分，不再画横线。
- 支持批量归档：按 24 小时 / 1 天 / 7 天 / 15 天 / 30 天 / 90 天预设或自定义日期筛选，经过预览清单、超过 50 条时的显式确认，执行后还能一键“撤销本次归档”；范围（全部会话 / 某个工作区 / 未分组）在该弹窗内选择。
- 支持批量删除（危险色按钮，紧挨“批量归档”）：候选只来自归档集合，条件、预览与逐条取消与批量归档一致，但无论条数都必须显式勾选确认，执行逐条串行、可中止，结果页不提供撤销；删除能力不可用时按钮整体禁用。
- 不添加侧边栏一级入口，调试插件时出现的 `Cordis Plugin` 底部菜单保持独立。
- 直接读取 DSH 核心 `archivedSessionIds`，不创建额外 Workspace，也不投影 synthetic 会话行。
- 恢复只移除归档集合成员关系；原 Workspace 存在时回到原位置，已删除时进入“未分组”。
- DSH 原生分组、单列表和搜索继续隐藏尚未恢复的归档会话。
- 升级时只注销旧候选版本创建且 `sessionIds` 为空的 `$DSH_HOME/workspaces/archived` Workspace 注册；同路径同标题但仍有会话的 Workspace 会保留。目录、会话日志、原 Workspace 记账和归档集合均不改写。
- 删除会话日志与核心记账，但保留可能由多个会话共享的内容寻址附件。

### 兼容性

- DeepSeek Harness Web `>=0.1.6-alpha.1 <0.1.7`。
- 已逐版本验证：`0.1.6-alpha.1`。
- Node.js 20 或更高版本。
- 永久删除要求 `session-persistence-jsonl`。

分组与批量归档全部停留在浏览器 bundle 内：页面读取 `workspaces.list` 与 `sessions.list`，归档通过 DSH 自带的 `workspaces.archiveSession()` 客户端命令完成，因此两项功能都不新增宿主路由、不触碰私有 ABI、也不改写 Workspace 记账。批量归档按条串行执行（每条对应一次宿主持久化操作），不会终止正在运行的 Agent；预览之后出现新活动的聊天会被跳过并列出，而不是被归档。客户端 controller 未暴露 `archiveSession` 时，批量入口自动禁用，分组浏览仍可使用。

归档列表使用当前 DSH 的 Session 与 Workspace client controller，不改写其 snapshot 或命令；React 订阅会保留 Workspace class store 所需的接收者。恢复通过 Workspace registry 串行写入，保留会话日志和仍存在的记账位置，绝不重建已删除的 Workspace。永久删除是严格的私有 ABI 兼容层，仅在 JSONL backend、Workspace registry、handle tracker、迁移任务和缓存结构符合已验证版本时开放；为避免“必须重启 `dsh web`”成为唯一出路，删除前还会在结构校验全部通过后卸载本进程打开过、且当前完全空闲的 live 会话。当前 v3 的未压缩 `session.v3.jsonl` 和 zstd 压缩 `session.v3.jsonl.zstd` 均受支持；更早 generation 必须先由 DSH 自身迁移。日志尚未迁移的聊天会得到明确的迁移提示，而不是笼统的“重启后重试”，且删除不会触碰磁盘上的任何文件。

同一兼容发布线内的后续版本可带“未逐版本验证”警告运行，但仍必须通过结构与能力检查；installer 和 Host 启动都执行版本门，范围外在任何迁移、私有 ABI 初始化或路由注册前保持 inert。JSONL 删除运行时不匹配时，归档列表与恢复仍可使用，删除会 fail closed；存在未处理的删除 journal 时，恢复和删除都会暂停。状态接口会分别返回两个能力的可用性和原因。状态、恢复与删除都先复用 DSH `connection.requestRejection()` 的 trusted-host 与签名浏览器 cookie 认证；两个 mutation 再附加同源客户端标记和 `application/json` 校验。

### Registry 状态

由于 npm 已存在同名但无关的项目，本包已从本地候选名 `dsh-archived-chats` 更名为 `dsh-chat-archive-manager`。最近一次查询中，新名称返回 `E404`；但 `E404` 不代表名称已保留，真实发布前必须再次确认。其余发布闸门见 `PUBLISHING.md`。

### 本地安装

```bash
npm run publish:check
./install.sh
```

`install.sh` 会先拒绝兼容范围外的 DSH，并运行完整发布闸门（语法、测试和 tarball 内容），再通过 DSH 官方 profile manager 把 `link:<源码目录>` 加入 `web` profile；它不复制插件文件。Host 代码变化后需重启 `dsh web` 并刷新浏览器；`package.json` 或 `cordis.patch.yml` 变化后应先重新运行 `./install.sh`。

### 使用、恢复和删除边界

1. 通过 DSH 原生操作归档会话。
2. 打开“设置”，在左侧菜单中选择“归档管理”。
3. 点击恢复按钮使聊天回到普通列表，或点击红色永久删除按钮并在弹窗中确认；若该聊天仍开在当前 `dsh web` 中且完全空闲，删除会先关闭它的会话，再移除日志。
4. 列表上方唯一一行里，“批量归档”和“批量删除”（危险色）在最左、“展开全部/折叠全部”在最右，搜索框左侧是 DSH 自带的搜索图标；在“按工作区分组/单列表”之间切换，按“最近更新/归档先后”排序，并用搜索框过滤。每行都是与 DSH 自带归档页一致的卡片（无分隔线、hover 出现底色），副标题显示相对最近更新（“20 天”“1 个月”）：单列表里以工作区名开头，分组视图里工作区已由组头表达。分组默认折叠:点击工作区行(文件夹图标 + 名称)展开。
5. 点击“批量归档”，选择范围（全部会话、某个工作区或未分组）和时间条件，决定是否包含运行中、空白和当前打开的会话，然后在冻结的预览清单中逐条核对后再执行；预览默认全选，可逐条取消或用汇总行里的“全不选”按钮清空；超过 50 条需要显式勾选确认。执行完成后可用“撤销本次归档”精确恢复这一批。
6. 点击“批量删除”会用同样的三步流程处理归档聊天本身，最后是永久删除：宿主没有可用删除能力时按钮禁用；无论选中几条都必须勾选确认才能执行；结果页不提供撤销。

弹窗的标题栏与操作按钮始终可见，只有中间的聊天列表滚动。

“24 小时前”是滚动 24 小时；“1 天前”从本地今天 00:00 起算（即昨天及更早），刻意不等同于滚动窗口；其余预设为滚动 N×24 小时，自定义日期取所选日期的本地 00:00。

批量归档默认排除运行中/等待交互、空白、当前打开以及全部子代理会话。时间条件比较的是 DSH 列表自身显示的“最近更新”（创建时间与最后一次你的输入中较晚者），因此投影缓存不可用的冷会话可能显得比实际更旧；预览清单就是为了让这一判断可以逐条复核。归档不会改动工作区记账，正常恢复会回到原位置。

恢复只从 `archivedSessionIds` 移除目标 ID，不改写会话日志或现有 Workspace 记账。原 Workspace 仍存在时，会话按保留的席位和手动顺序回到原位置；原 Workspace 已删除时，插件不会重建它，DSH 会把恢复后的聊天显示在“未分组”中，会话 header 中原有的 `cwd` 仍保留。

本进程打开过、且当前完全空闲的 live 会话会在永久删除前先被安全卸载，因此这类归档聊天不再需要重启 `dsh web`。卸载严格复刻 DSH agent factory 自身的 teardown 顺序（取消 driver、等待活动结束、dispose agent scope、释放 JSONL 写租约、摘除 registry 条目），并在真正动手前重新确认会话仍然空闲。仍在运行或有排队输入的会话返回“会话忙”拒绝；运行时结构不符合已验证契约、存在开放 JSONL handle、等待物化或正在迁移准备的会话仍返回需要重启的拒绝结果。存在持久化或 live 后代的父会话不能单独删除。

成功删除会验证 backend 返回的会话 header 和物理日志 identity，共享 coordinator 串行阻止恢复竞态，tombstone 并等待已经准入的 persistence 调用结束，再把会话目录原子移动到同文件系统 trash；随后清理 Workspace 与 `archivedSessionIds` 记账，尽力清理 projection cache、message feedback 和搜索索引，再次复核后删除 trash。`$DSH_HOME/attachments/v1/objects` 不会被删除。

journal 位于 `$DSH_HOME/dsh-archived-chats/deletions.json`，trash 位于 JSONL persistence root 的同级 `$DSH_HOME/.dsh-archived-chats-trash/`，不会被 session scanner 扫描。首次事务会 durable 创建两者并预检 `st_dev` 相同。这两个旧命名是重命名前已经落盘的安全 ABI；继续读取它们可以避免漏掉未完成事务并绕过 quarantine。启动时发现非空 journal 会禁用删除，插件不会根据 journal 自动 rename、回滚、前滚或递归删除路径。

### 卸载与校验

```bash
./uninstall.sh
npm run publish:check
```

卸载只移除 profile 中的本地链接和可逆运行时挂载，不删除未删除会话、附件、旧版 archive 目录或 journal。`publish:check` 只执行语法、测试和 tarball 内容校验，不会发布包。

## License

MIT
