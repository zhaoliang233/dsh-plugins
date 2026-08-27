# Changelog

## 0.3.1 - 2026-09-14

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the source-verified contract matrix against DSH `0.1.6-alpha.1`: the layout bundle is byte-identical, the sidebar bundle differs only in its build string, the workspace header/search/action markup is unchanged, the settings shell is unchanged, the sidebar-right panel markup is unchanged, and the conversation skeleton was only split across files (`ConversationContent` still renders the same `body > [data-conversation-scroll]` tree, with no new wrapper), so every structural probe still resolves. Moved the verified line to `>=0.1.6-alpha.1 <0.1.7` with `0.1.6-alpha.1` as the single source-verified version.
- Park a floating layer left behind by an earlier bundle generation: each activation stamps its own `.dmc-layer` with `data-dsh-mobile-layer-generation` and marks every other layer `data-dsh-mobile-orphan` (`display:none` plus `pointer-events:none`). A stale chip kept painting over the header, and the pre-0.2.x layer's full-screen backdrop swallowed clicks for the entire page — reported as extra UI plus parts of the UI no longer responding after client updates.
- Rewrite a `<style>` element whose text does not match the running bundle, and tag it `data-plugin="dsh-mobile-compat"`. DSH claims every untagged sheet for whichever client bundle materializes next and its hot reload removes `style[data-plugin=<id>]`, so an untagged sheet could be handed to another plugin, then deleted with it or kept across an update — the page kept the previous bundle's rules until a manual refresh.

## 0.3.0 - 2026-09-10

- Refine the mobile header geometry: reserve the floating toggle's lane on the header's FIRST row only, so the `对话/轨迹` tab row keeps DSH's native gutter (measured at 375px: tabs move from x=72 back to x=28) instead of being indented by the whole reserve.
- Shrink the floating toggle's visual chip to 36px through a `::after` inset while keeping its 44x44 hit box, move it to `top: 4px`, and move the focus ring onto the chip: it no longer dominates the header row, and neither the chip (bottom y44) nor the hit box (bottom y48) reaches into the tab row that starts at y50.
- Stop hiding the rightbar column on mobile: in 0.1.5 the right panel is an absolutely positioned overlay inside that column (and `position: fixed; inset: 0` in fullscreen, which is automatic below 768px), so `display:none` on the column collapsed the open right sidebar to 0x0 and made it impossible to display on phones. The column now keeps its zero-width grid track so the conversation stays full width while the native right sidebar can still open.
- Move the verified compatibility line from `>=0.1.2-alpha.3 <0.1.3` to `>=0.1.5-alpha.2 <0.1.6`: `0.1.5-alpha.2` is the only source-verified version, and the lower bound stops at that verified release instead of guessing that `0.1.5-alpha.1` matches.
- Retarget the AppFrame structure probe to the 0.1.5 seats: the center column now carries the direct `main` seat (ConversationRoot occupant) and the right column the direct `rightbar` seat; the retired `conversation`/`details` seat names made the plugin inert on 0.1.5.
- Keep hiding the right column on mobile through CSS only; never call the 0.1.5 `layout.closeRightbar()` so the desktop rightbar width preference is preserved.
- Fix the toggle header-clearance rule: 0.1.5 renders the session header inside a `display:contents` Slot anchor, so the clearance padding now targets the header element inside that anchor instead of the anchor itself.
- Update `compatibility.json#contracts` owners and expectations to the 0.1.5 AppFrame, and refresh the runtime version gate, checklist, installer gate, tests, and docs together.
- Migrate compatibility from the stale exact-channel policy to a versioned release line, with the release line guarded by runtime capability checks.
- Use the `connection.generation` readiness contract and stay inert when that capability is absent.
- Cover the contenteditable Composer through its accessible textbox semantics, including the 16px mobile input rule and browser assertion.
- Treat partially mounted AppFrame and Slot occupants as pending so startup does not emit a false incompatibility warning before the validated structure completes; persistent pending states now emit one delayed diagnostic.
- Require `layout.toggleSidebar()` before activation and observe structural attribute changes as well as child mounts so HMR or owner attribute drift immediately deactivates and can recover compatibility effects.

## 0.2.0 - 2026-08-28

- Introduce the original exact-channel compatibility matrix, superseded by the current release-line policy above.
- Add npm channel and artifact-provenance checks plus a machine-readable selector/API contract in `compatibility.json`.
- Add a no-store Host version endpoint backed by the executing CLI package manifest, then gate browser activation on that exact version and a fail-closed AppFrame/Slot structure probe.
- Preserve the desktop Details preference by removing the mobile `layout.closeDetails()` mutation.
- Add Drawer modal semantics, compare-and-restore `inert`/ARIA isolation, compact close-control focus entry, bidirectional Tab wrap, competing-modal suspension, Escape restoration, and direct 900→901 / mobile→desktop reconciliation.
- Increase touch targets to 44px and keep Workspace search/actions inside the mobile Drawer.
- Check in a Node 22 CDP browser regression covering mobile, landscape, breakpoint, focus, Settings, diagnostics, and desktop recovery.

## 0.1.0 - 2026-08-28

- Add a mobile Sidebar drawer driven by the public layout Service and `shell.overlay`, with its inline-width SidebarRoot expanded to the full drawer width and 40px Workspace actions kept inside the header.
- Add narrow-screen Settings, Conversation, Composer, touch-target, viewport, and safe-area compatibility rules.
- Support the initial textarea and contenteditable Composer variants without CSS Module hash selectors.
- Runtime-test the initial supported DSH artifacts across mobile, landscape, and desktop viewports.
- Declare exact DSH compatibility metadata and fail closed on undeclared versions during installation.
- Document mandatory compatibility revalidation after every DSH upgrade.
