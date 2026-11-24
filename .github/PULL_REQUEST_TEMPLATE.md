## What this changes

<!-- User-visible behaviour first, then implementation notes if they matter. -->

## Why

<!-- Link the issue if there is one. -->

## How it was verified

- [ ] `pnpm lint && pnpm check:types && pnpm test:unit --run && pnpm build`
- [ ] `pnpm exec prettier --check .`
- [ ] Tested in a browser against a live OpenCloud (which version?):

## Checklist

- [ ] No new runtime dependencies
- [ ] User-visible strings go through `$gettext` and are translated in `l10n/locale/{de,fr,es}`
- [ ] A regression test covers the change
- [ ] `CHANGELOG.md` has an entry under `Unreleased`
- [ ] No build output committed (`dist/` is git-ignored)
