# Publishing Checklist

This checkout is a local release candidate. Do not publish it without a separate package-name and version decision.

## Compatibility gate

`compatibility.json` is the machine-readable contract matrix and `package.json#dshCompatibility` points to it. The compatible release line is `>=0.1.6-alpha.1 <0.1.7`; `0.1.6-alpha.1` is individually source-verified.

Later alpha, beta, rc, and final versions on the same `0.1.6` line may run with a warning only while the runtime version gate, public capability checks, and exact structural probes all pass. Never use an unbounded range, lower the bound below `0.1.6-alpha.1`, or cross into `0.1.6` without reading the published source and updating the range, verified list, contract matrix, runtime gate, installer, docs, and tests together.

Run:

```bash
node scripts/check-compat.js --manifest
node scripts/check-compat.js --installed
```

## Runtime gate

The Host reads the actual executing CLI's `@deepseek-ai/dsh/package.json` and exposes only `{ package, version }` at the no-store `GET /dsh-mobile-compat/status` route after DSH `connection.requestRejection(req)` browser authentication. The Client sends same-origin credentials and uses `connection.generation.getSnapshot()/subscribe()` only as a connected/retry trigger before reading the plugin route for the release version. A missing generation capability, failed status request, or version outside the compatible release line leaves the plugin inert.

A compatible version is still insufficient by itself. AppFrame, direct Slot seats, SidebarRoot, Workspace header, Settings dialog, the direct ConversationRoot/body/scroll relationship, Conversation outer attributes, and the Composer's accessible textbox must match the probed contract before style, viewport, Locale, or `shell.overlay` contributions activate. Safe-area and header-clearance CSS must target the owned ConversationRoot marker, not an ancestor selected only through `:has()`. A failed probe must preserve native layout and emit one diagnostic.

## Candidate gate

```bash
npm run publish:check
npm pack --ignore-scripts
```

The pack check uses an exact allowlist. The package must contain the Host entry, browser bundle, compatibility matrix, profile patch, user documentation, changelog, publishing notes, license, and manifest only.

## Upgrade review

1. Read the actual candidate npm artifacts and record the exact package versions reviewed.
2. Recheck `connection.generation`, `layout.toggleSidebar()`, AppFrame direct host children, direct `sidebar`/`main`/`rightbar` Slot seats, SidebarRoot inline width, `shell.overlay`, Workspace header/search/actions, Settings dialog/direct nav, Conversation outer attributes, Composer textbox semantics, client dependency graph, viewport metadata, and overlay stacking.
3. Update `compatibility.json#contracts` so every private structural dependency names its owner, expected relation, and individually verified versions.
4. Verify unsupported-version, missing-capability, and structure-mismatch paths leave no style, body marker, viewport patch, Slot entry, or ARIA/inert mutation.
5. Verify mobile mode never calls `layout.closeRightbar()` and a desktop-mobile-desktop round trip preserves the native rightbar preference.

Never accept CSS Module hashes, `window.__DSH_BOOT__`, or deep Conversation DOM as compatibility evidence.

## Browser evidence

Use an isolated profile/server and isolated Chrome target; never replace the user-owned GUI. Run `test/browser-regression.mjs` at minimum across 320x568, 390x844, 457x707, 568x320, 844x390, 900/901px, 1023/1024px, and desktop.

Required assertions include runtime and structure markers, Sidebar width parity, touch targets, Workspace controls, Drawer accessibility and cleanup, breakpoint reconciliation, Settings geometry, a 16px native or contenteditable Composer, overflow, console errors, uncaught page errors, and failed requests.

Also manually validate long conversations, code/media overflow, theme and locale switching, reduced motion, real iOS/Android software keyboards, landscape drawer scrolling, and nonzero safe-area insets. Chromium emulation is not evidence for real keyboard or notch behavior.

## Local profile install

```bash
./install.sh
```

The script validates the installed version and `web` profile, runs all release gates, and uses DSH's official profile manager with a `link:` dependency. It does not edit the user's patch layer directly.
