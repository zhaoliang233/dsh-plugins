# Publishing Checklist

This checkout is a local release candidate for `dsh-sticky-user-bubble@0.1.3`. Its supported DSH release line is `>=0.1.5-alpha.1 <0.1.6`; `0.1.5-alpha.1` is source-verified. Do not publish to npm without a separate package-name and version decision.

## Candidate gate

```bash
npm run publish:check
npm pack --ignore-scripts
```

The pack check uses an exact file allowlist. The package must contain the Host entry, browser bundle, profile patch, documentation, license, and manifest only.

## Local profile install

```bash
./install.sh
```

The script uses DSH's official profile manager with a `link:` dependency. It does not edit the user's profile patch directly.

## Runtime verification

After installing a composition or changing the Host/client bundle, restart `dsh web` in the user's terminal when no client-plugin watcher has been confirmed, then refresh the page. Verify the profile dump contains `dsh-sticky-user-bubble` and the Web boot graph includes `@deepseek-ai/dsh-client-ui-chat`, then check a long conversation at desktop and narrow widths.

The client must hide the pinned copy at the top of a conversation, show the corresponding user bubble only after it has fully left the painted band, hand the slot over to the next user card (keeping the message gap, never covering that card), switch in both scroll directions, navigate back to the original message when activated, clamp long copies to three lines without fourth-line leakage, restore natural content height only within the room left by the next card and the composer (`[data-composer-seat]`), keep the in-bubble scrollbar inside the bubble padding, and disappear for stale snapshots, unsupported layouts, ambiguous bubble candidates, or missing core markers. Repeat the smoke test with altered font size, line height, padding, a gradient/small-radius bubble, fixed source height, theme changes, and a narrow viewport.
