# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] - 2026-09-14

### Added

- Every row now shows the plugin's own `package.json#description` under its name; the Host normalizes it to one bounded line and the client renders up to two lines with the full text in the tooltip.
- A plugin without a usable description shows the placeholder `未提供说明` instead of an empty line.

### Fixed

- Tags the injected stylesheet with `data-plugin="dsh-local-plugin-manager"` and rewrites it when a surviving element still holds another bundle's rules, so a hot reload always lands on the running bundle's CSS instead of the previous one.

### Changed

- Rewrote the workspace plugins' `description` fields in Chinese so the list reads as accurate one-line summaries (the manager's own copy now names what it manages).
- Split the row into three deliberate steps — name, description on a faint self-mixed surface, then version and source path as quiet `label-tertiary` metadata — and gave the copy column and rows more vertical room.

## [0.1.2] - 2026-09-09

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Moved the supported DeepSeek Harness Web release line to `>=0.1.6-alpha.1 <0.1.7` after revalidating the profile manifest, bundle patch, plugin CLI, Loader update, Web route authentication, client module, theme token, and Settings slot contracts on `0.1.6-alpha.1` (the `@deepseek-ai/cordis*` loader/include/HMR pins and `js-yaml` behaviour are unchanged on this line).
- Records `0.1.6-alpha.1` as the only individually verified DSH version on this release line; later in-range prereleases warn and remain guarded by structural and capability checks.
- Moved the supported DeepSeek Harness Web release line to `>=0.1.5-alpha.1 <0.1.6` after revalidating the profile manifest, bundle patch, plugin CLI, Loader update, Web route authentication, client module, theme token, and Settings slot contracts.
- Records `0.1.5-alpha.1` as the only individually verified DSH version on this release line; later in-range prereleases warn and remain guarded by structural and capability checks.

### Fixed

- Restricted live Loader toggles to the complete `include:<rowId>` entries owned by the profile root so unrelated same-name rows in nested Loader trees are never toggled.

## [0.1.1] - 2026-09-02

### Compatibility

- Replaced the exact DSH prerelease gate with the bounded `0.1.2` compatible release line and recorded alpha.3 and alpha.4 as individually verified versions.
- Reused DSH browser authentication for the local status and mutation routes.

## [0.1.0] - 2026-09-02

### Added

- Initial local `link:` bundle inventory, enable/disable, protected uninstall, Settings tab, and profile patch state management.
