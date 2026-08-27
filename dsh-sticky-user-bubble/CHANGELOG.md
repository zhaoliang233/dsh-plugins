# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] - Unreleased

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the Session/Chat snapshot, Slot, core DOM-marker, and geometry contracts against DSH `0.1.6-alpha.1`: the chat row markup (`data-chat-flow`, `data-chat-anchor-key`/`-flow-key`/`-flow-kind`), the `.EvIC1a_*` flow CSS, `[data-conversation-scroll]`, and `[data-composer-seat]` are emitted by unchanged code; the only new DOM shape is that `@`/slash reference chips now render as a `<button>` when they activate something, which the clone already neutralizes (it clears `tabindex` and sets `tabIndex = -1` on every copied element). Moved the supported line to `>=0.1.6-alpha.1 <0.1.7`; `0.1.6-alpha.1` is individually verified.
- Audited DSH `0.1.5-alpha.1` Session, Chat, Slot, client-module, and DOM contracts; narrowed the supported line to `>=0.1.5-alpha.1 <0.1.6` with same-line capability-check warnings.

### Added

- Prefers explicit user-bubble markers when available and otherwise combines authoritative message text, paint, padding, and geometry to identify the source bubble.
- Observes the active source bubble, its bounded ancestor chain to the scrollport, theme attributes, stylesheet nodes, font loading, the visual viewport, and existing conversation geometry through one coalesced measurement scheduler.
- Records a non-visual compatibility state on the clone host and fails closed for detached sources, invalid measurements, unsupported root layouts, and geometry mismatches.

### Changed

- Hand the top slot over to the next user card instead of covering it: once that card's leading edge comes within the flow gap, the clone moves up with it, keeps that spacing, is clipped at the scrollport edge, and is gone when the card reaches the reading line.
- Cap the hover/focus expansion by the free room above the next user card: a long pinned message stops at the card's reserved gap, scrolls internally beyond it, stays collapsed when no room is left, and tightens as the card approaches even while it is already expanded.
- Measures unclamped clone content at its real width so fixed source `height` and `min-height` values do not determine three-line overflow or expanded height.
- Uses actual rendered line boxes when available, falling back to computed line height only when the browser cannot expose line rectangles.
- Copies a bounded set of computed text and visual styles to cloned descendants so ancestor-dependent styling survives the move into `shell.overlay` more reliably.
- Caps exceptionally long expanded bubbles to the available conversation viewport and makes the expanded bubble internally scrollable.

### Fixed

- Stop the collapse/expand flicker while the conversation streams. A resized flow (every token of an answer resizes it), source attribute or theme change replaced the rendered clone, and the fresh clone started collapsed until the browser's hover recompute expanded it again. Layout resizes now take the ordinary comparison path instead of forcing a rebuild, and the hover/focus intent lives in an effect-level ref that a rebuild carries over to its successor (restoring focus when the keyboard owned the expansion).
- Cap the expanded bubble by the composer, not just by the scrollport. The composer is sticky at the bottom *inside* the conversation scrollport, so a long pinned message expanded with no following card ran down over the input card and the frame's status bar. `availableHeight` now ends at the `[data-composer-seat]` top minus the usual 16px (falling back to the previous viewport limit when that seat is missing).
- Move the capped expansion's inner scrolling off the bubble root and onto the content wrapper. The scrollbar used to sit on the bubble's border, crossing the rounded corners, at the global brightness. It now stays inside the bubble's padding, uses DSH's dimmed in-card thumb (`l2`, like the composer card), and the wrapper is an input target only while it owns the scrollbar.
- Gate the pinned clone on the bubble's real paint boundary instead of the reading line. Visibility was compared against `scrollport.top + readingInset`, which sits 16px below the scrollport's clip edge in the audited layout, so the clone appeared while the original bubble's bottom padding and corners were still fully visible. The clone now waits until the bubble's bottom leaves the scrollport clip edge, narrowed by any clipping or independently scrolling ancestor.
- Pins user messages that contain an `@`/slash token: the core renderer projects the token into a reference chip that shows only the token's last path segment, so the rendered bubble text never matched the raw snapshot text and that row failed closed as `bubble-not-found`. Bubble text is now rebuilt through each chip's `title` attribute before comparing.
- Reads the audited DSH Chat target through `uiConversation.binding(id).target('chat')` instead of assuming lifecycle snapshots still contain `chat`.
- Searches the authoritative user row when the audited DSH line omits the legacy `data-time-hover-root` marker, while retaining the marker path for older bundles.
- Filters clone-host mutations from the document observer so compatibility refreshes cannot create a self-triggering render loop.

## [0.1.1]

### Added

- Makes the pinned bubble clickable and keyboard-accessible, scrolling the conversation back to the corresponding original user or steering message.
- Limits long pinned bubbles to three lines with an ellipsis, then reveals the complete content while hovered or keyboard-focused.

### Fixed

- Applies line clamping to a padding-free inner wrapper so Chromium cannot reveal part of a fourth line inside the bubble's bottom padding.

## [0.1.0]

### Added

- Pins the active user or steering message bubble at the top of the DSH Web conversation while its original bubble has scrolled above the reading edge.
- Uses live conversation/Chat snapshots to resolve message text and the core conversation data attributes to locate the rendered row.
- Reuses the rendered bubble's measured geometry and computed visual styles so the pinned copy follows the native bubble across widths and themes.
- Fails closed when the expected chat markers or a measurable text bubble are absent.
- Cleans up slot registrations, scroll listeners, observers, scheduled frames, and session subscriptions on unload.
- Adds official profile metadata, local link installation, release checks, and Node 20/22-compatible tests.

### Fixed

- Interprets measured DOMRect dimensions as border-box totals so the cloned bubble does not add the native content-box padding a second time.
