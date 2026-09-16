# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-09-16

### Changed

- 首个发布到公共 npm registry 的版本，发布链路改用 GitHub Actions 的 OIDC 可信发布（trusted publishing），不再依赖长期 npm token。


## [0.1.0] - Unreleased

### Compatibility

- Declare the DSH compatibility range a second time in the official `package.json#engines.dsh` field (new in DSH 0.1.6) and guard it against `dshCompatibility.range` in the manifest test.

- Re-audited the Host and client contracts against DSH `0.1.6-alpha.1`: `systemPrompt.section` (only an additive optional `interpolate` flag), `SECTION_ORDERS`, `settings.register`/`describe` (optional `user` key), `tools.register`, the schemastery resolution path (still `node_modules/@deepseek-ai/schemastery@3.18.2`), `webServer.register`, and the client `settingsScope.bind` contract are unchanged. Moved the supported line to `>=0.1.6-alpha.1 <0.1.7`.
- Audited DSH `0.1.5-alpha.1` source contracts (`dsh-system-prompt`, `dsh-settings`, `dsh-tools`, `dsh-agent-loop`) and declared the supported line `>=0.1.5-alpha.1 <0.1.6`; same-line later versions run with capability-check warnings.
- Re-audited the same contracts against `0.1.5-rc.2` (the version actually deployed) and added it to the individually verified list (`VERIFIED_DSH_VERSIONS`): `systemPrompt.section`, `SECTION_ORDERS`, `settings.register` / `describe` (optional `user` key), `webServer.register`, and the client `settingsScope.decode(view.value)` contract are unchanged.

### Fixed

- Opening the settings panel now shows the dedicated nav icon right away: the stylesheet was injected by the section component, which the shell renders lazily (`only: active`), while the nav patch lives on `settings.action` (rendered as soon as the panel opens) — so the marker ran before any CSS existed. The stylesheet is now injected by `apply()` (plugin-level, reference-counted, reused across HMR rematerializations, removed when the last reference goes away), and the browser fixture no longer injects the plugin CSS on the plugin's behalf (that shortcut is exactly what hid this bug).

### Changed

- The settings nav entry now paints its own icon (`IconContextInjectionOutline16`) instead of the shell's fallback gear: `settings.section` has no `icon` option and the shell maps only four official ids, so the icon comes from a reversible DOM patch mounted through `settings.action` (original svg hidden, `::before` + `mask`, `currentColor` so active/hover theming keeps following the shell; all state is reference-counted and rolled back on unmount).

- Rely on the official `PromptSection.interpolate: false` (new in DSH 0.1.6) instead of rewriting `{{` into `{`+zero-width-space+`{`: user text now reaches the model verbatim, and the guard asserts the flag is declared rather than that the escape exists.

### Added

- Process-wide system prompt section (`deployment:extra-context`, order 204) that reaches every session, subagent, and workflow child through the global registration layer.
- Segmented rule model (enable switch, text, in array order) with per-segment blank/enabled filtering, plus private model notes rendered inside the same section.
- Settings → 「额外上下文」page: add/remove/enable rules, local preview that always matches the injected text, token-consumption hint, and effect-timing guidance.
- Runtime edits through the `extra-context` settings namespace in `$DSH_HOME/settings.yaml` (live, no restart).
- `extra_context_notes` tool for model-maintained long-term notes with a 4096-byte cap.
- Graceful degradation: without a settings service the section still works from the composition-layer value for the current process; a failed schema load leaves the settings namespace unregistered instead of breaking startup.
- Blur-save only: typing updates the panel locally, leaving the field writes; explicit actions (toggle/add/remove) write immediately. Write failures keep the failed patch and surface an error with a real retry path.
- Notes are opt-in (`notes: true`); when disabled, leftover notes are neither injected nor shown in the preview.
