# Publishing Checklist

This checkout is prepared as a release candidate for `dsh-chat-archive-manager@0.1.1`.

## Registry Status

The package was renamed from the local `dsh-archived-chats` candidate because npm already contains an unrelated project under that name. `dsh-archive-manager` is also occupied. The npm registry returned `E404` for `dsh-chat-archive-manager` during the latest check, but `E404` does not reserve the name.

Before any npm publication:

1. Run `npm view dsh-chat-archive-manager version --json` again and stop if a package now exists.
2. Add accurate `repository`, `homepage`, and `bugs` fields after the public source repository exists.
3. Replace `Unreleased` in `CHANGELOG.md` with the release date.
4. Run every validation below against the exact commit and tarball intended for publication.

Do not put npm tokens in this repository.

## Local Link Install

A source checkout uses DSH's official profile manager through `./install.sh`:

```bash
npm run publish:check
./install.sh
```

The script installs `link:<checkout-path>` into the selected Web profile. Remove the link with the same environment:

```bash
./uninstall.sh
```

Set `DSH_HOME` and `DSH_PROFILE` consistently when using an isolated profile. The installer accepts only DSH `>=0.1.6-alpha.1 <0.1.7`; `0.1.6-alpha.1` is individually verified, while later in-line versions emit a warning and still rely on runtime capability checks.

## Release Validation

Run from the package root:

```bash
npm run publish:check
npm publish --dry-run
```

`npm publish --dry-run` exercises npm's `prepublishOnly` lifecycle and package construction. It uploads nothing and does not reserve the package name.

Build and install the exact tarball in a clean DSH Home:

```bash
release_root=/tmp/dsh-chat-archive-manager-release
mkdir -p "$release_root/artifacts"
npm pack --ignore-scripts --pack-destination "$release_root/artifacts"
tarball="$release_root/artifacts/dsh-chat-archive-manager-0.1.1.tgz"
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web add "$tarball" --config.minimumReleaseAge=0
DSH_HOME="$release_root/dsh-home" \
  dsh web --dump-config
DSH_HOME="$release_root/dsh-home" \
  dsh plugin --profile web remove dsh-chat-archive-manager
```

## Destructive-Feature Gate

Before marking a candidate complete, verify all of the following against each version added to the manifest's verified list:

- `GET /dsh-chat-archive-manager/status` reports `workspaceProjection: false` and the expected deletion capability.
- The renamed package still reads `$DSH_HOME/dsh-archived-chats/deletions.json`; trash is the fixed sibling `$DSH_HOME/.dsh-archived-chats-trash`, outside the JSONL scanner root, and interrupted transactions preserve quarantine state.
- A legacy `$DSH_HOME/workspaces/archived` registration created by an earlier candidate is removed without deleting its directory, session logs, or archive accounting.
- No archive-only Workspace appears; DSH's grouped, flat, and search views continue to hide archived sessions.
- The `已归档` Settings navigation uses the archive glyph; its section keeps the count immediately after its one-line title, caps the visible count at `99+`, lists current archived sessions, and presents an explicit permanent-delete confirmation without adding a first-level sidebar action.
- Live, Agent-owned, open-handle, writer-owned, pending-materialization, migration-prepared, non-archived, missing, and parent sessions with descendants are rejected.
- Current-generation `session.v3.jsonl` and `session.v3.jsonl.zstd` artifacts pass matching `list()`/`stat()` revision, backend-header, and filesystem-identity checks; older generations fail closed until DSH migrates them, journal/trash directories are durable before rename, and source/trash share `st_dev`.
- Delete and restore are serialized by one plugin mutation coordinator; a tombstone drains admitted `create/open/stat/list` calls and rejects later per-session access before artifact rename.
- An isolated cold artifact can be deleted through the real HTTP route, clearing Workspace/archive accounting while leaving shared attachments untouched.
- A non-empty or invalid deletion journal quarantines deletion without automatic rename, rollback, roll-forward, or recursive removal.
- The exact release tarball installs through DSH's official profile manager and serves both Host status and browser client entry.

## CI

`.github/workflows/ci.yml` runs `npm run publish:check` on Node.js 20 and 22. It contains no npm publication step and requires no npm token.
