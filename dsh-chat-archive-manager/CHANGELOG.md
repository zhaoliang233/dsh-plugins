# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - Unreleased

### Changed

- Route Session restore through the public `WorkspaceRegistry.unarchiveSession()` API instead of writing registry state directly: the private writer is no longer a precondition, restore stays serialized behind destructive transactions, and an unarchived id still reports 409 `session-not-archived`.
- Shapes every archived row like DSH's own archived-session page: no separators, an 8px-radius card that highlights on hover, a 13px title, and 12px tertiary meta. The hover token is `--dsw-alias-interactive-bg-hover` rather than the native page's `--dsw-alias-bg-layer-1`, which resolves to the panel's own white in the light theme and therefore highlights nothing there.
- Replaces the absolute timestamp with a relative last-activity label (`20 天`, `1 个月`) using DSH's own thresholds, and drops the restore position and directory name from row meta; the Workspace name now leads the meta in `单列表` only.
- Separates Workspace groups by spacing instead of horizontal rules and removes the nested group's vertical guide line, so the group header alone distinguishes a Workspace.
- Renames the Settings entry and page heading from `已归档` to `归档管理` (one `SECTION_TITLE` constant behind the nav label, the heading, and the nav-icon patch, which matches that exact text).
- Moves the page paragraph directly under the heading and the controls (search, view, sort) below it, so the page reads as title → explanation → controls → actions → list.
- Moves `批量归档` out of the toolbar to the left end of the single row above the list, keeping `展开全部/折叠全部` at its right end; that row now always renders, and only the collapse toggle is conditional.
- Gives the search box the shell's own search glyph (absolutely positioned inside the field, with the input inset by 36px) instead of a bare input.
- Rewrites the page paragraph: `按工作区分组或单列表浏览归档聊天；批量归档支持按时间条件筛选。恢复会回到原来的工作区，原 Workspace 已删除时进入未分组；永久删除会移除会话日志，但不删除共享附件。` It now names both list views, drops the redundant "由你手动发起" (bulk archiving is a feature name, not a scheduling promise), states that restore returns to the original Workspace instead of the vague "回到普通列表", and joins restore and deletion into one sentence while both work.

### Added

- Adds `批量删除` next to `批量归档` in the row above the list: the same three-step dialog, but over the archived chats themselves and ending in permanent deletion. It is error-colored like the per-row `永久删除` action, keeps an 8px gap from `批量归档`, disables itself when the Host reports no usable deletion route, always requires the acknowledgment checkbox, runs one durable deletion per chat with progress and abort, and offers no undo because deletion cannot be rolled back.

- Groups archived chats by their owning Workspace in DSH's own Workspace order, with one Ungrouped bucket, empty groups omitted, and a per-group count. A Workspace's archived chats keep their `sessionIds` slot, so a restore returns to the original position.
- Adds a search box (title, directory, Workspace), a `按工作区分组`/`单列表` view switch, and `最近更新`/`归档先后` sorting. Archive order comes from the append order of `archivedSessionIds`, because DSH stores no archive timestamp.
- Adds batch archiving from a three-step flow: scope (all chats, one Workspace, or Ungrouped) plus a cutoff preset of 24 hours, 1, 7, 15, 30, or 90 days or a custom local-midnight date; a frozen preview where every row can be deselected; and an execution step with progress, abort, per-chat failure reporting, and a one-click `撤销本次归档` for the batch just archived. The scope is chosen inside that dialog, so the page adds no per-Workspace duplicate entry.
- Labels the bulk entry point `批量归档` without an ellipsis so it cannot read as an in-progress operation, and resolves `1 天前` from local midnight today rather than duplicating the rolling 24-hour window.
- Keeps the batch dialog's title and action buttons visible: the actions moved into the Modal `footer` slot and only the chat list scrolls, with a tighter header and body margin.
- Renders each workspace group header as DSH's own workspace row: folder icon that switches with the expanded state, a chevron that replaces it on hover and rotates when open, the title, and a muted count on one 34px row that toggles on click; nested session cards align their text with the group title.
- Collapses every workspace group by default, with `展开全部/折叠全部` as a small button on the row directly above the list instead of the title row or toolbar.
- Draws its own select and date indicators instead of relying on the browser: the arrow keeps a symmetric inset from the right edge, and the date field matches the select styling with a themed calendar glyph and a full-surface picker hit area.
- Declares those mask glyphs on the control itself and percent-encodes the SVG payloads, fixing the solid-square indicators the portaled batch dialog showed when the variable could not be inherited.
- Merges the page notes into one paragraph and rewrites the bulk sentence so it no longer reads like an automatic job.
- Moves `折叠全部/展开全部` from the crowded toolbar row to the right end of the title row, and renders count-bearing action labels with half-width parentheses (`开始归档(3)`).
- Shows the preview fully selected by storing deselected ids instead of selected ones, and moves `全选/全不选` onto the summary row as a compact 26px button rather than a row of its own; an empty selection now says so and disables the archive action.
- Default-excludes running/waiting, blank, currently open, and all subagent chats from batch candidates; each exclusion is an explicit checkbox and the counts of eligible and excluded chats are shown live.
- Skips a chat that gained activity between the preview and the execution, and reports it instead of archiving it. Above 50 selected chats the preview requires an explicit acknowledgment.
- Reports archived ids whose session summary is currently unreadable instead of dropping them silently.

### Fixed

- Tags the injected stylesheet with `data-plugin="dsh-chat-archive-manager"`. DSH claims every untagged `<style>` for whichever client bundle materializes next and its hot reload removes `style[data-plugin=<id>]`, so an untagged sheet could be handed to another plugin and then deleted — or kept after an update — and the page showed the previous bundle's rules until a manual refresh.
- Permanently deletes an archived chat that this `dsh web` process has opened but is no longer using, instead of refusing with "restart dsh web". DSH registers every resumed Session through a process-lifetime `ctx.effect` and keeps its JSONL write lease open, and no Host API closes a Session, so an idle archived chat could previously only be deleted after a restart. The delete path now unloads exactly that one idle Session in the agent factory's own disposal order (cancel the driver, await the settled activity, dispose the agent scope, release the write lease, detach both registry entries) after every read-only check has passed, and re-checks idleness immediately before unloading. A running Session or one with queued input is refused as `session-busy`; a runtime whose private structure does not match the verified shape keeps the previous fail-closed refusal, and cold-Session deletion is unaffected either way.
- Confirms in the permanent-deletion dialog that a chat still open in the current `dsh web` has its Session closed first.

### Notes

- Both features are client-bundle changes only: archiving uses DSH's own `workspaces.archiveSession()` client command, so no Host route, private ABI access, or Workspace accounting rewrite was added. Batch archiving runs one durable Host operation per chat, serially.
- Batch archiving and the undo action disable themselves when the client controller does not expose `archiveSession`, and undo also requires the existing restore route to be available; grouping stays available in both cases.

## [0.1.1] - Unreleased

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the Host, client, Web authentication, Settings slot, Workspace registry, Session controller, and JSONL persistence contracts against DSH `0.1.6-alpha.1`; the JSONL backend gained only the message-projection argument on `Session.fromRestore`, so the fail-closed deletion runtime still resolves and the isolated host reports `deletionSupported`/`restorationSupported` as true. Moved the compatible release line to `>=0.1.6-alpha.1 <0.1.7`; only `0.1.6-alpha.1` is individually verified.
- Re-audited the Host, client, Web authentication, Settings slot, Workspace registry, Session controller, and JSONL persistence contracts against DSH `0.1.5-alpha.1`.
- Narrowed the compatible release line to `>=0.1.5-alpha.1 <0.1.6`; only `0.1.5-alpha.1` is individually verified.
- Re-checked the deletion ABI source against the locally running DSH `0.1.5-rc.1`: Workspace registry caches, `JsonlBackendTracker` sets/maps, `migrationPreparations`/`coldLogMemo`, and the generation-blind `locate()` contract are unchanged. `0.1.5-rc.1` is deliberately **not** added to `verifiedVersions` because no full end-to-end delete/restore run was performed on it.

### Fixed

- Refuse a Session log that DSH has not migrated to the current v3 generation (`session.jsonl[.zstd]`, `session.vN.jsonl[.zstd]`) with an explicit `unsupported-artifact` migration message. `JsonlSessionPersistence.locate()` is generation-blind, so the previous code probed an absent v3 path and leaked a raw `ENOENT` into a generic "restart dsh web and retry" failure that could never succeed.
- Report an artifact that vanished between listing and validation as `session-not-found` (404) instead of an internal error.
- Test fixtures now mirror the real generation-blind `locate()` contract, and the legacy-generation regression covers both plaintext and zstd artifacts so this failure mode can no longer hide.
- Migrated permanent deletion from the removed coordinator and direct persistence methods to the `0.1.5-alpha.1` `create/open/stat/list` handle model.
- Added fail-closed probes for `JsonlBackendTracker`, open writers and handles, pending materialization, migration preparation, compression mode, and cold-log cache shape.
- Bound plaintext and zstd deletion witnesses to matching `list()` and `stat()` revisions, backend-decoded headers, and physical inode/size observations.
- Tombstone guards now drain admitted per-session operations and global listings before rename, reject later create/open/stat access, and restore exact descriptors on disposal.

## [0.1.0] - Local candidate

### Added

- Settings-section archive manager backed directly by DSH's authoritative `archivedSessionIds`.
- One-click restoration through a serialized Host route, preserving existing accounting or falling back to Ungrouped.
- Explicit permanent-delete confirmation and current archived-chat count without a duplicate Workspace group.
- Plain and zstd JSONL deletion through the DSH `>=0.1.2-alpha.3 <0.1.3` compatible release line, individually verified on alpha.3 and alpha.4.
- Durable same-filesystem deletion transaction with source/trash identity witnesses and fail-closed quarantine.
- Cold-session, coordinator-cache, descendant, path, symlink, and journal validation.
- Best-effort derived-state cleanup while preserving content-addressed attachments.
- Node.js 20/22 CI, manifest checks, exact package-content validation, and local publishing checklist.

### Changed

- Renamed the package and plugin identity from the conflicting local candidate `dsh-archived-chats` to `dsh-chat-archive-manager`.
- Moved archive management out of the first-level sidebar footer and into Settings navigation, leaving the dynamic Cordis plugin control independent.
- Reused the archive glyph in Settings navigation, placed the compact count immediately after the one-line title, and capped it at `99+ chats`.
- Added row-level red permanent-delete styling and a restore action immediately after it.
- Removed synthetic grouped-view archive projection and all Host/browser Workspace command interceptors.
- Upgrades unregister the exact legacy `$DSH_HOME/workspaces/archived` Workspace while retaining its directory, session logs, original Workspace accounting, and archive set.

### Fixed

- Preserved the receiver of the DSH alpha.3/alpha.4 Workspace class store when subscribing from React, preventing the archived Settings page from rendering blank.
- Replaced the removed `dsh-client-runtime` manifest edge with the current Session and Workspace controller packages.
- Declared the bounded compatible release line and alpha.3/alpha.4 verification list; local installation and Host startup now reject out-of-line DSH versions before any migration, private ABI initialization, or route registration.
- Rejected non-object JSON roots as client errors instead of surfacing an internal failure.

### Security

- A non-empty deletion journal never triggers automatic rename, rollback, roll-forward, or recursive removal.
- Runtime-private deletion support disables itself when the tested backend, registry, coordinator, or cache ABI does not match.
- Restoration and deletion reuse DSH `connection.requestRejection()` for trusted-host and signed browser-cookie authentication, then require same-origin marked JSON requests as an additional CSRF fence.
