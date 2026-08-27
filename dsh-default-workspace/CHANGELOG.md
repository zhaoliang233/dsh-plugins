# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - Unreleased

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the Workspace registry and entity, Web authentication, client Workspace controller, `uiWorkspace.startSession`, `sidebar.footer.action`, and UI primitive contracts against DSH `0.1.6-alpha.1`; the registry gained only an additive `unarchiveSession`, and the sidebar/workspace header DOM is unchanged. Moved the supported line to `>=0.1.6-alpha.1 <0.1.7`; only `0.1.6-alpha.1` is individually verified.
- Re-audited the Workspace registry and entity, Web authentication, client Workspace controller, `uiWorkspace`, sidebar slot, and UI primitive contracts against DSH `0.1.5-alpha.1`.
- Narrowed the compatible release line to `>=0.1.5-alpha.1 <0.1.6`; only `0.1.5-alpha.1` is individually verified.
- Confirmed that explicit `uiWorkspace.startSession(workspaceId)`, Workspace protection, first-position pinning, and wide/rail footer rendering require no behavioral fork on this line.

### Changed

- The local installer now runs the complete `publish:check` release gate before changing the selected DSH profile.

### Fixed

- Tags the injected stylesheet with `data-plugin="dsh-default-workspace"`. DSH claims every untagged `<style>` for whichever client bundle materializes next and its hot reload removes `style[data-plugin=<id>]`, so an untagged sheet could be handed to another plugin and then deleted — or kept after an update — and the sidebar action rendered with the previous bundle's rules until a manual refresh.

## [0.1.0] - Local candidate

### Added

- Managed `$DSH_HOME/workspaces/default` Workspace named `通用会话` for project-independent sessions.
- Dedicated `新建通用会话` action in the sidebar footer, backed by DSH's normal explicit-Workspace New Session flow, with visible busy and retry states.
- Grouped-view first-position pinning while retaining DSH's standard mixed flat session list.
- Host and browser guards for rename, delete, and reorder operations.
- Detachable Workspace interceptor dispatchers with ownership-safe cleanup in either registration or removal order.
- Official DSH profile bundle metadata and browser client graph metadata.
- Local link and exact-tarball distribution procedures through DSH's official profile manager.
- Node.js 20/22 CI, syntax and behavior checks, manifest assertions, and an exact seven-file package whitelist.

### Changed

- Renamed the unpublished local candidate from `dsh-recent-chats` to `dsh-default-workspace` so the package name matches its managed-Workspace behavior.
- Renamed the existing managed Workspace from `最近聊天` to `通用会话` in place while preserving its path, ID, session membership, logs, and cwd values; an unrelated custom title at the same path now fails closed instead of being overwritten.
- Restored DSH's native global New Session behavior by removing the previous no-argument `startSession()` redirect.
- Made Host and Client interceptor installation transactional so an incompatible read-only method shape rolls back every earlier wrapper instead of leaking a partial policy.
- Restored exact pre-install property descriptors on cleanup, including deleting inherited-method instance wrappers so later prototype HMR is not shadowed.
- Added capability preflights before setup mutations and rolled back a newly registered Workspace when entity policy installation is unsupported.

### Compatibility

- Supports the verified DeepSeek Harness Web release line `>=0.1.2-alpha.3 <0.1.3`; alpha.3 and alpha.4 are individually verified.
- Uses `uiWorkspace` for Session navigation and keeps the pure `workspaces` Controller for Workspace state and mutations, matching the alpha.3/alpha.4 client service boundary.
- In-range future versions warn and still fail closed on missing services or incompatible Workspace method shapes; Host startup resolves the real CLI package before any directory, Workspace, or route side effect and remains inert outside the range.
- This release line does not expose row-level Workspace capabilities to independent client plugins, so the standard menu and drag affordance may remain visible even though guarded operations are rejected.

### Data Retention

- Uninstalling removes the profile dependency and reversible runtime policies but keeps the managed directory, Workspace registration, and session history.
- The plugin never moves or deletes pre-existing Workspaces or sessions.
