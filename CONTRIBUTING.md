# Contributing

Thanks for helping with OpenCloud Planner. This is a web extension for
[OpenCloud](https://opencloud.eu) that adds Calendar, Contacts and Tasks, so most work happens in the
browser between the web UI and a CalDAV/CardDAV server.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It documents the host integration rules and the
  data-handling principles that every change has to respect.
- For anything larger than a bug fix, open an issue first so the approach can be agreed on.

## Development setup

Node.js 20 or newer and pnpm (via `corepack enable`) are required.

```bash
pnpm install
pnpm build:w          # rebuild on change into dist/
pnpm test:unit        # vitest, watch mode
pnpm lint             # eslint
pnpm check:types      # vue-tsc --noEmit
pnpm format:write     # prettier
```

A local OpenCloud plus Radicale setup is in `docker-compose.yml`; it serves the build output `dist/` as
the app folder, so run `pnpm install && pnpm build` once (or keep `pnpm build:w` running) before
opening the web UI. `dist/` is not committed — only the release zip ships a build, and the GitHub
Actions workflow (`.github/workflows/ci.yml`) builds it on every run.

End-to-end tests run against a live instance and need environment variables:

| Variable             | Default                  | Meaning                                                                |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `OPENCLOUD_URL`      | `https://localhost:9200` | Base URL of the instance (`playwright.config.ts` `baseURL`)            |
| `OPENCLOUD_USERNAME` | `admin`                  | Login of the test account                                              |
| `OPENCLOUD_PASSWORD` | _(unset)_                | Password of that account; the deployed e2e specs skip when it is unset |

The dev compose stack publishes OpenCloud on `https://host.docker.internal:9200` (self-signed
certificate), so point `OPENCLOUD_URL` there when you run the e2e suite against it:

```bash
OPENCLOUD_URL=https://host.docker.internal:9200 OPENCLOUD_USERNAME=admin OPENCLOUD_PASSWORD=admin \
  pnpm test:e2e
```

## Rules for a pull request

- **No behaviour change without a reason, and no unreviewed behaviour change**: describe what users
  will notice.
- **No new runtime dependencies.** `ical.js` and `@event-calendar/core` are the only ones.
- **Never rebuild stored data.** Edits patch the raw ICS/vCard so properties written by other
  clients survive.
- **Every user-visible string** goes through `$gettext` (`$ngettext` for counts) and is translated in
  `l10n/locale/{de,fr,es}/app.po`; the CI gate is `pnpm l10n:check`.
- **Every fix comes with a regression test** in `tests/unit/`.
- **Do not commit build output.** `dist/` is git-ignored and rebuilt by CI (and by
  `bash scripts/release.sh` for a release); installs come from the release zip, so a change ships as
  source only.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for anything user-visible.
- Keep the diff focused; unrelated cleanups belong in their own pull request.

## Checks

All of these must pass:

```bash
pnpm lint && pnpm check:types && pnpm test:unit --run && pnpm build
pnpm exec prettier --check .
```

## Translations

```bash
pnpm l10n:extract    # new strings -> l10n/template.pot, merged into the .po files
pnpm l10n:compile    # .po -> l10n/translations.json (ships with the app)
pnpm l10n:check      # what CI runs
```

`pnpm l10n:extract` needs the GNU gettext binaries (`msgmerge`, `msginit`) on the `PATH`.

The German UI addresses the user with the formal **"Sie"**, like OpenCloud's own German UI. Counts use
`$ngettext` (singular and plural msgids, `msgstr[0]`/`msgstr[1]` in the catalog), never an "(s)".

## Reporting bugs

Include the OpenCloud version, the Planner version, the browser, and what you did before the problem
appeared. Settings → About & status shows server reachability, collection counts and copyable
diagnostics — that block is usually the fastest way to describe the setup. Security issues go through
the process in [SECURITY.md](SECURITY.md), not through a public issue.

## Licence

Contributions are accepted under the Apache-2.0 licence of this project (see [LICENSE](LICENSE)).
