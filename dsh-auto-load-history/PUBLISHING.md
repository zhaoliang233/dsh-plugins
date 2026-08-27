# Publishing Checklist

This checkout is a local release candidate for `dsh-auto-load-history@0.1.0`. Its supported DSH release line is `>=0.1.5-alpha.1 <0.1.6`; `0.1.5-alpha.1` is source-verified. Do not publish to npm without a separate package-name and version decision.

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

The script uses DSH's official profile manager with a `link:` dependency and does not edit the user's profile patch. Mounting a new bundle changes the profile composition, so restart `dsh web` before verifying in the browser.
