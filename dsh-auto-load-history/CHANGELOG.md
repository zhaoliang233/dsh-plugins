# Changelog

## 0.1.0

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the whole contract set against DSH `0.1.6-alpha.1`: `ISession.loadOlder()` (byte-identical contract file, `maxMessages: 50`), the four `SessionSnapshot` fields, `sessions.list.current`, `binding(id).session`/`.eventSource`, the window-head progress read, the `settings.general.item` list slot, the renderer `inject`-face passthrough and `locale` seat, `[data-conversation-scroll]`, and the chat compact-fold gate (`processWindowReady ... && !historyIncomplete`, `historyIncomplete: hasMore`) are all unchanged. Moved the supported line to `>=0.1.6-alpha.1 <0.1.7` with `0.1.6-alpha.1` individually verified.
- Page a Session's whole history in when it opens, so the compact transcript can fold every completed turn without the reader hunting for "Load earlier" or jumping through the turn rail.
- Add a Settings → General preference row (`会话历史` / `Session history`) with automatic and manual modes; automatic is the default and the choice is stored per browser.
- Defer paging while the reader is scrolled away from the flow bottom, and stop after pages that do not extend the window.
