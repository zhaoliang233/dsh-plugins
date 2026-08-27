# Local Release Candidate Checklist

This checkout is prepared as an unpublished local release candidate for `dsh-default-workspace@0.1.1`. It replaces the unpublished `dsh-recent-chats` candidate. Do not run a real `npm publish` for this candidate.

## Registry Status

The npm registry returned `E404` for `dsh-default-workspace` on 2026-08-28: no published versions or dist-tags existed. An `E404` does not reserve the package name.

Before any future npm release:

1. Recheck the package-name state.
2. Create the public source repository.
3. Add accurate `repository`, `homepage`, and `bugs` fields to `package.json`.
4. Replace `Unreleased` in `CHANGELOG.md` with the release date.
5. Confirm the tested DSH version and compatibility line, then rerun all runtime checks.
6. Complete a separate explicit publication review.

Do not put npm tokens in this repository.

## Rename Migration

The old candidate was never published, so no npm compatibility package is produced. A linked local profile must remove the old identity before adding the new one:

```bash
dsh plugin --profile web remove dsh-recent-chats --config.minimumReleaseAge=0
./install.sh
```

The persisted migration boundary is `$DSH_HOME/workspaces/default`: the new package adopts a Workspace titled `最近聊天` or `通用会话` at that path and changes only the legacy display title. Any other existing title is a fail-closed conflict. Migration must not move the directory, create a replacement Workspace, alter session membership, or change cwd values.

## Local Link Install

A source checkout uses `./install.sh`, which enforces DSH `>=0.1.6-alpha.1 <0.1.7`, runs the complete release gate, and then delegates to DSH's official profile manager with `link:<checkout-path>`. Only `0.1.6-alpha.1` is individually verified; later in-line versions warn and remain guarded by runtime capability checks:

```bash
npm run publish:check
./install.sh
```

Remove the local link with the same `DSH_HOME` and `DSH_PROFILE` environment:

```bash
./uninstall.sh
```

## Release Validation

Run from the package root:

```bash
npm run publish:check
npm publish --dry-run
```

`npm publish --dry-run` executes `prepublishOnly` and constructs the package without uploading it.

Build and test the exact local tarball in a disposable DSH Home:

```bash
release_root="$(mktemp -d /tmp/dsh-default-workspace-release.XXXXXX)"
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-default-workspace-0.1.1.tgz"
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" \
  dsh web --dump-config
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web remove dsh-default-workspace
```

For the runtime smoke, start `dsh web --port 0 --no-open` with the disposable `DSH_HOME`, then verify:

- `GET /dsh-default-workspace/status` reports `通用会话` at `$DSH_HOME/workspaces/default`.
- The authenticated `/plugins/??...` combo bundle is served and contains the `dsh-default-workspace` module registration.
- The browser boot graph contains `dsh-default-workspace`, client runtime, the sidebar provider, and UI primitives.
- The managed Workspace is first in grouped view.
- The native global New Session action retains DSH's current/recent Workspace behavior.
- The dedicated `新建通用会话` footer action targets the managed Workspace in wide and rail layouts.
- Rename, delete, and reorder requests are rejected.
- Removing the package clears the bundle composition but preserves Workspace and session data.

## CI

`.github/workflows/ci.yml` runs `npm run publish:check` on Node.js 20 and 22. It has no publication job and requires no npm token. The package has no runtime or development dependencies; tests use Node built-ins.
