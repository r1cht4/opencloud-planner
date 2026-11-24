# Architecture — Planner for OpenCloud

How the app works, why it is built this way, and the traps that are not obvious from
the code. Written for anyone picking the project up cold.

> Describes version 1.0.x.

## 1. What it is

An OpenCloud **web extension** (a Vue 3 + TypeScript bundle loaded by the OpenCloud web
UI through module federation) that gives every user a **Calendar**, **Contacts** and
**Tasks** app. There is no backend of its own: the browser talks **CalDAV/CardDAV**
directly to **Radicale**, which OpenCloud ships and proxies on the same origin.

Product decisions:

- One package (`planner`), three apps in the app drawer, each one can also show up in the
  Files app's left sidebar (per-app user setting).
- Settings are opened with a ⚙ button in each app header. There is no second sidebar, and Tools live inside Settings.
- Radicale only (what OpenCloud ships). Nothing is hardcoded, and it must work for any user on any install
  ("store-ready").
- No sharing between users yet. User-driven sharing is the documented future step.
- Browser reminders (Notification API, toast fallback).
- License Apache-2.0. Follows the official `opencloud-eu/web-extensions` release conventions.

## 2. Runtime picture

```
Browser (OpenCloud web + this extension)
   │  fetch(/caldav/…, /carddav/…)  Authorization: Bearer <OpenCloud OIDC token>
   ▼
OpenCloud proxy  ── authenticates, adds X-Remote-User: <user UUID>, strips the token
   │  routes from config/opencloud/proxy.yaml  (/caldav, /carddav, /.well-known/{cal,card}dav)
   ▼
Radicale (auth type http_x_remote_user) ── storage volume radicale-data
   collections: /caldav/<user-uuid>/<collection>/   /carddav/<user-uuid>/<collection>/
```

- The DAV user is the OpenCloud user **UUID**, not the username. Collections live under `/caldav/<uuid>/`.
- Native clients (DAVx5, Thunderbird, iOS) use username + **app token**. This needs the `auth-app` service
  and `PROXY_ENABLE_APP_AUTH=true`. See `docs/INSTALL.md`.
- Probe status mapping (used by the setup screen):
  - 207 = ok
  - 404/405 = proxy route missing
  - 502/503 = Radicale down
  - 401 = not signed in / token not ready

## 3. Host integration (module federation): the rules that bite

- **Shared host modules:** `vue`, `vue3-gettext`, `@opencloud-eu/web-pkg`, `@opencloud-eu/web-client`. They are
  provided by the host, not bundled (SDK 8's federation config marks them `import: false`; the old
  `alignOpenCloudSharedVersions` plugin is gone).
  - **`vue-router` is NOT shared.** `useRouter()`/`useRoute()` from `vue-router` return `undefined` inside the
    extension. Always use `useRouter`/`useRoute` **from `@opencloud-eu/web-pkg`**. web-pkg's `useRoute()` returns a
    _Ref_ (`route.value.query`).
  - Route names are rewritten by the host. Navigate by **path** (`/planner/<app>`), never by name.
- **Composables only at setup time.** `useGettext`, `useMessages`, `useModals`, `useClientService`, etc. use
  `inject()`. Called from a click handler, timer or Files-app action they throw ("Failed to inject gettext") and
  can break the Files app. Capture them in `setup()` and close over the results (see
  `useFileImportActions.ts`, `reminders/index.ts`).
- **The access token arrives after `setup()`.** `defineWebApplication.setup()` runs before the auth store has
  the token, so any DAV call there gets 401. Gate on `isAuthenticated()` / `watchAccessToken()`
  (`useDAVClient.ts`); the settings store does this.
- Extension points used:
  - `appMenuItem`: the three drawer entries
  - `sidebarNav` on `app.files.navItems`: Files sidebar entries; `isVisible()` is re-read on every render,
    so a settings change applies without reload
  - `action` on `global.files.context-actions`: "Import into calendar/contacts" for `.ics`/`.vcf`
- No SDK stylesheet is imported (the SDK's `tailwind.css` was dropped with SDK 8: it only added an empty layer
  declaration and AGPL CSS). The calendar needs `@event-calendar/core/index.css`, imported in `Calendar.vue`
  before our overrides (a unit test guards the order).

## 4. Source map

```
src/index.ts              defineWebApplication: admin config, routes (+ guards for disabled apps), drawer/Files
                          extensions, translations, connection probe, reminder start, `?open=` links
src/navigation.ts         pure builders: effective enabled apps, routes, drawer/sidebar items, host exit
                          (`isInAppPath` blocks open redirects)
src/config/               appConfig.ts (admin config from apps.yaml → sanitised), davConfig.ts (DAV base URLs)
src/settings/             schema.ts (types, defaults, validators, resolution), settingsStore.ts (load/save)
src/composables/
  useDAVClient.ts         fetch wrapper (token, headers), principal discovery per service, sanitizeUid
  davXml.ts               multistatus parsing (DOMParser, local-name matching), prop helpers
  useCalendarService.ts   VEVENT: query/parse/expand recurrences/build/patch/override/EXDATE, CRUD with ETags
  useTasksService.ts      VTODO: same pattern, task-capable collections (supported-calendar-component-set)
  useContactsService.ts   vCard: parse/patch/build, CRUD
  importExport.ts         .ics split by UID (masters + overrides together, referenced VTIMEZONEs), merge for
                          export, .vcf split
  useImport.ts            import pipeline shared by the Calendar/Contacts views, Files action and restore
  useCollections.ts       create/rename/recolor/delete collections (PROPPATCH both color namespaces)
  useCollectionSync.ts    live refresh: poll getctag/sync-token, refetch only changed collections
  useBirthdaySync.ts      contacts' BDAY → generated "birthdays" calendar (bday-<uid> events)
  useConnectionProbe.ts   setup/status probe (PROPFIND, status mapping)
  vtimezone.ts            VTIMEZONE generation from Intl (ical.js ships no tz database)
  useEventForm.ts, calendarViewUtils.ts, eventSearch.ts, eventStacking.ts, … view helpers
src/reminders/            alarmIndex.ts (VALARM → due alarms), scheduler.ts (timers, cross-tab dedupe),
                          notify.ts (Notification API / toast), index.ts (startReminders wiring)
src/setup/                connection state + diagnostics for the setup screen / About & status
src/tools/                backup.ts + zip.ts (store-only zip writer/reader), csv.ts + contactsCsv.ts (Google
                          CSV), eventDuplicates.ts
src/views/                Calendar.vue (@event-calendar/core), Contacts.vue, Tasks.vue, Settings.vue
src/components/           dialogs and cards; calendar/, settings/ (one section per app), tools/ (cards)
l10n/                   gettext catalog (official web-extensions toolchain, vue3-gettext CLIs):
                          template.pot (vue-gettext-extract), locale/{de,fr,es}/app.po,
                          translations.json (vue-gettext-compile) — scripts/check-l10n.mjs gates CI
tests/unit/*.spec.ts      vitest + @vue/test-utils (happy-dom); web-pkg/vue-router are mocked per spec
tests/e2e/*.spec.ts       Playwright against a live instance (OPENCLOUD_PASSWORD env)
scripts/release.sh        official release zip (planner/ folder) + md5/sha256 checksums
scripts/store-entry.mjs   adds a released version to the App Store list (used by release.yml)
```

## 5. Data handling principles (keep these)

- **Patch, never rebuild.** Edits change only the UI-managed properties of the stored raw ICS/vCard
  (`patchIcs`, `patchTodoIcs`, `patchVcard`). Everything else (ATTENDEE, X-*, non-DISPLAY alarms, Apple
  `itemN.` groups) is kept verbatim. The master VEVENT is found with `getMasterVevent` (files may list an
  override first).
- **Optimistic concurrency.** Updates/deletes send `If-Match: <etag>`. A 412 is shown as "modified elsewhere",
  then a reload. Creates/imports send `If-None-Match: *`, and a 412 counts as "already exists" (never overwritten).
- **Times.** Event `start`/`end` in the model are the viewer's local wall clock (`YYYY-MM-DD HH:mm`, all-day
  `YYYY-MM-DD` with exclusive end on the wire, inclusive in the form). Saving re-tags with the local TZID and
  adds a generated VTIMEZONE. A floating time with an unknown TZID is resolved via Intl (`zonedWallClockToDate`).
- **Recurrence.** `expandRecurringEvents` counts emitted occurrences (not iterations from series start), with a
  100k-step guard. Single-occurrence edit = RECURRENCE-ID override, single delete = EXDATE.
- **Colors.** Collections are read in both `urn:ietf:params:xml:ns:caldav` and `http://apple.com/ns/ical/`
  namespaces, normalised to `#RRGGBB` by one helper (`colorUtils.normalizeColor`); collection discovery is
  one module (`davCollections.ts`).
- **UIDs/URLs.** The UID inside the data is never changed. The resource name comes from `davResourceName(uid)`:
  the UID itself when it matches `[A-Za-z0-9._@-]+`, else its SHA-256 hex — so re-imports hit the same URL and
  report "already exists". Existing items are always addressed by their stored `href`.
- **Never send the token elsewhere.** All DAV traffic goes through `davFetch`/`propfind`, which refuse any origin
  other than the page and the configured caldav/carddav URLs (`assertDavOrigin`).

## 6. Settings

- One JSON document per user, stored as a WebDAV **dead property** `{urn:x-planner}settings` on the
  user's Radicale principal. It follows the user to every browser/device and needs no extra service.
- `schema.ts` holds the typed `Settings`, defaults, a validator per dotted path (`calendar.defaultView`, …) and
  `resolveSettings(userDoc, adminConfig)`. Precedence: user value → admin default → built-in default. Locked
  paths: admin default only (a lock without default keeps the built-in default). Unknown
  keys and newer `version`s are preserved and never downgraded.
- `settingsStore.ts` is a module singleton: `useSettings()` → `{ settings, loaded, error, update, isLocked,
reload }`. `update()` is optimistic plus a 500 ms debounced PROPPATCH, with a `pagehide` flush. It migrates the
  legacy boolean `general.filesSidebar` and the old localStorage birthday toggle. Saving is
  read-merge-write: the stored document is re-read, only the locally changed paths are applied, one save at a
  time; when the read fails nothing is written (the change stays queued).
- Admin configuration: the app's `config:` block in OpenCloud's `apps.yaml`, handed to `setup()` as
  `applicationConfig` itself (not `.config`)
  (`caldavUrl`, `carddavUrl`, `enabledApps`, `filesSidebar`, `defaults`, `locked`). It is sanitised in
  `appConfig.ts`. Documented (and verified live) in `docs/ADMIN-CONFIG.md`.

## 7. Feature mechanics

- **Live refresh** (`useCollectionSync`): every 60 s while visible, plus on focus/visibility change (throttled).
  PROPFIND `getctag`/`sync-token`, refetch only changed collections. Own writes re-baseline via `markSynced`.
- **Reminders** (`src/reminders`):
  - Every 15 min (and after local writes via `refresh()`), fetch the next 24 h (+7 days lead for "1 day
    before" alarms).
  - Expand recurrences and read DISPLAY VALARMs (relative START/END and absolute triggers).
  - Fire with `setTimeout` inside a 15 min grace window.
  - Cross-tab dedupe: a localStorage "shown" log plus a BroadcastChannel.
  - Delivery: Notification API, or a toast when permission is not granted.
  - Tasks without VALARM only get a reminder when `tasks.defaultReminder` is set (opt-in).
- **Setup screen / status** (`useConnectionProbe`, `ConnectionGate`, `SetupState`, `AboutStatus`): when DAV is
  unreachable the apps show an explanation with admin steps instead of an empty UI. Settings stays reachable.
- **Birthdays:** a generated `birthdays/` calendar with yearly `bday-<contact uid>` events. Reconcile is idempotent
  and prunes orphans, and never prunes when any address book failed to load.
- **Tools** (inside Settings → Tools):
  - collections manager
  - "Connect your devices" (DAV URLs, link to OpenCloud's app-token page)
  - import/export
  - backup zip + restore
  - Google CSV import/export for contacts
  - duplicate event cleanup
  - birthday calendar

## 8. Build, test, release

- `pnpm lint && pnpm check:types && pnpm exec vitest run && pnpm l10n:check && pnpm build`: what
  `.github/workflows/ci.yml` runs, and what must be green.
  `dist/` is build output, git-ignored and rebuilt on every CI run — installs come from the release
  zip, and from a clone you run `pnpm install && pnpm build`.
- Unit tests mock `@opencloud-eu/web-pkg` per spec (see `tests/unit/settings-page.spec.ts` for the router mock
  shape). Fake timers plus a pinned clock for anything time-based.
- E2E (`tests/e2e/`) logs into a real OpenCloud. Keep the existing selectors stable: `.modal-panel`,
  `.scroll-time-input`, `.date-nav-input`, the role/name-based buttons.
- Release: `bash scripts/release.sh` → `release/planner-<version>.zip` (one folder
  `planner/` with manifest, js, assets, LICENSE, THIRD-PARTY-LICENSES) + `md5sum.txt`/`sha256sum.txt`.
  Install = extract into OpenCloud's apps folder and restart. `.github/workflows/release.yml` runs it
  on `v*` tags (`-alpha.`/`-beta.`/`-rc.` = pre-release).
  Its second job (`store-pr`) adds the version to Planner's App Store entry in
  `opencloud-eu/awesome-apps` (`scripts/store-entry.mjs`) and opens a pull request from the owner's fork;
  it needs the secret `STORE_PR_TOKEN` (classic token, `public_repo` scope) and skips pre-releases.

## 9. Conventions

- Lean: no new runtime dependencies. Use native browser APIs and ical.js / @event-calendar/core.
- Every UI string goes through `$gettext`, counts through `$ngettext`. Use interpolation (`%{name}`),
  not string concatenation. Translations live in the gettext catalog: new strings →
  `pnpm l10n:extract`, translate `l10n/locale/{de,fr,es}/app.po`, then `pnpm l10n:compile`
  (`pnpm l10n:check` = the CI gate).
- Dialogs follow `role="dialog"`, `aria-modal`, `aria-labelledby`, `useModalA11y`. Icon-only buttons need
  `aria-label`.
- Every fix comes with a regression test and a `CHANGELOG.md` entry under `Unreleased`.
- Prettier: 2 spaces, no semicolons, single quotes.
