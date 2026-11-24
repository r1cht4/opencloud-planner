# Admin configuration — Planner

How an OpenCloud admin passes configuration to the app: DAV endpoint overrides, which apps are
offered, default settings for all users, and settings users may not change.

All of it is optional — with no configuration at all the app works out of the box against the
same-origin `/caldav/` and `/carddav/` endpoints.

---

## 1. How the config reaches the app

OpenCloud web reads an **application config file** on the server — by default
`/etc/opencloud/apps.yaml` (override the path with the `WEB_UI_CONFIG_FILE` environment variable
of the `opencloud` service). The file is a YAML map keyed by **app id**:

```yaml
# /etc/opencloud/apps.yaml
planner:
  config:
    caldavUrl: /caldav
    carddavUrl: /carddav
```

(The app itself needs no entry here — it is discovered from its `manifest.json` in the apps
folder; the entry above only exists to carry `config`.)

OpenCloud serves the `config:` block of the `planner` entry to the web UI
(`config.json` → `external_apps[].config`), and the web UI hands exactly that block to the app as
`applicationConfig` in `defineWebApplication.setup(args)` (`ApplicationSetupOptions`,
`@opencloud-eu/web-pkg`; the official extensions read it the same way). This app passes it to
`setAdminConfig(args.applicationConfig)` in `src/index.ts`. Verified on OpenCloud 9.2: the keys
below appear in `https://<host>/config.json` under `external_apps` → `planner` → `config`.

So **every key documented below lives under `config:` of the `planner` entry** in
`apps.yaml`. After editing the file, restart OpenCloud (`docker compose restart opencloud`) and
hard-reload the browser.

The raw YAML object is treated as untrusted input: unknown keys and mistyped values are dropped
before they reach the app (`src/config/appConfig.ts`).

---

## 2. Keys

| Key            | Type                                      | Meaning                                                                                                               |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `caldavUrl`    | string                                    | CalDAV base URL. Default: same-origin `/caldav`                                                                       |
| `carddavUrl`   | string                                    | CardDAV base URL. Default: same-origin `/carddav`                                                                     |
| `enabledApps`  | `('calendar' \| 'contacts' \| 'tasks')[]` | Apps offered at all. A user can disable more, never re-enable these. Also written into `defaults.general.enabledApps` |
| `filesSidebar` | app list (`[]` = none)                    | Shortcut for `defaults.general.filesSidebar`: which apps appear in the Files app's left sidebar by default            |
| `defaults`     | object                                    | Admin defaults for any settings path (see §3). `enabledApps`/`filesSidebar` above are folded into this tree           |
| `locked`       | settings-path list                        | Paths the user cannot change; the admin default is the effective value (see §4)                                       |

An admin list that sanitises down to nothing (e.g. `enabledApps: [bogus]`) is ignored rather than
bricking the UI; an **empty** `filesSidebar: []` is a valid choice ("no app entries in the Files
sidebar").

---

## 3. Settings paths (`defaults.*` and `locked`)

`defaults` mirrors the personal settings tree, addressed by dot path. Every path and its allowed
values (`src/settings/schema.ts`):

| Path                           | Allowed values                                                                                                                          | Built-in default                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `general.navigation`           | `drawerOnly` (one entry in the app drawer) \| `filesSidebar` (the apps also appear in the Files sidebar)                                | `drawerOnly`                        |
| `general.defaultApp`           | `calendar` \| `contacts` \| `tasks` (must be an enabled app, otherwise the first enabled one is used)                                   | `calendar`                          |
| `general.filesSidebar`         | list of `calendar`/`contacts`/`tasks` (`[]` allowed; legacy `true`/`false` accepted); only used with `general.navigation: filesSidebar` | all three                           |
| `general.filesSidebarPosition` | per app `personal` \| `favorites` \| `shares` \| `spaces` \| `deleted` (slot after that Files entry; partial maps allowed)              | all three `spaces`                  |
| `general.appDrawer`            | `single` (one _Planner_ entry in the app drawer) \| `individual` (one entry per app from `general.appDrawerApps`)                       | `single`                            |
| `general.appDrawerApps`        | list of `calendar`/`contacts`/`tasks` (only used with `general.appDrawer: individual`)                                                  | all enabled apps                    |
| `general.appDrawerPosition`    | per app `first` \| `afterFiles` \| `afterApps` \| `afterSettings` \| `last` (slot in the app menu; partial maps allowed)                | all three `afterFiles`              |
| `general.enabledApps`          | non-empty list of app keys                                                                                                              | all three                           |
| `general.formatRegion`         | `auto` (browser's format region) or an ISO 3166 region code (`DE`, `US`, …)                                                             | `auto`                              |
| `general.timeFormat`           | `auto` (as in the region) \| `24h` \| `12h`                                                                                             | `auto`                              |
| `calendar.defaultView`         | `month` \| `week` \| `day` \| `list`                                                                                                    | `week`                              |
| `calendar.dayStart`            | `HH:MM` (00:00–23:59)                                                                                                                   | `06:00`                             |
| `calendar.weekStart`           | `0`–`6` (0 = Sunday) or `locale` (follows the format region)                                                                            | `locale`                            |
| `calendar.weekNumbers`         | boolean                                                                                                                                 | `true`                              |
| `calendar.showWeekends`        | boolean                                                                                                                                 | `true`                              |
| `calendar.defaultCalendar`     | collection URL (optional)                                                                                                               | — (first calendar)                  |
| `calendar.defaultDuration`     | minutes, 1–10080                                                                                                                        | `60`                                |
| `calendar.defaultReminders`    | list of minutes, each 0–10080                                                                                                           | `[]`                                |
| `contacts.defaultAddressBook`  | address-book URL (optional)                                                                                                             | — (first address book)              |
| `contacts.sortBy`              | `firstName` \| `lastName`                                                                                                               | `lastName`                          |
| `contacts.displayOrder`        | `firstLast` \| `lastFirst`                                                                                                              | `firstLast`                         |
| `tasks.defaultCalendar`        | collection URL (optional)                                                                                                               | — (first task-capable calendar)     |
| `tasks.showCompleted`          | boolean                                                                                                                                 | `false`                             |
| `tasks.defaultReminder`        | minutes 0–10080, or absent (= no reminder)                                                                                              | absent                              |
| `birthdays.enabled`            | boolean                                                                                                                                 | `false`                             |
| `birthdays.calendar`           | collection URL (optional)                                                                                                               | — (generated `birthdays/` calendar) |
| `birthdays.reminder`           | minutes 0–10080 (optional)                                                                                                              | — (no reminder)                     |
| `reminders.enabled`            | boolean                                                                                                                                 | `true`                              |

Collection URLs (`defaultCalendar`, `defaultAddressBook`, `tasks.defaultCalendar`,
`birthdays.calendar`) are full DAV paths as returned by the server, e.g.
`/caldav/<user-uuid>/personal/` — never a display name, because collections can be renamed.

---

## 4. Precedence

Per settings path, the effective value is the first valid candidate of:

- **normal path:** user value → admin default (`defaults.*`) → built-in default
- **locked path** (`locked: [...]`): admin default → user value is ignored; if the admin default
  is missing or invalid, the built-in default applies. A locked setting renders read-only and
  carries a lock icon ("Set by your administrator.") next to its label in the Settings page.

User settings live in one JSON document in a dead property on the user's Radicale principal, so
they follow the user across devices; the admin config applies on top of whatever the user stored.
Values of the wrong type never reach the app — they fall through to the next level.

---

## 5. Examples

### 5.1 Contacts-only install

Only the Contacts app is offered; no Files-sidebar entries:

```yaml
# /etc/opencloud/apps.yaml
planner:
  config:
    enabledApps: [contacts]
    filesSidebar: []
```

### 5.2 Locked Files sidebar

All three apps, the Files-sidebar mode is enforced and every user sees exactly the calendar in the
Files app sidebar, right below _Favorites_ — locked, so the mode select, the checkbox and the
position select are read-only in Settings:

```yaml
planner:
  config:
    defaults:
      general:
        navigation: filesSidebar
        filesSidebarPosition:
          calendar: favorites
    filesSidebar: [calendar]
    locked:
      - general.navigation
      - general.filesSidebar
      - general.filesSidebarPosition
```

The slot names the OpenCloud entry the app sits _behind_: `personal` (10), `favorites` (20),
`shares` (30), `spaces` (40, the default) or `deleted` (50). Our entries use the priority right
after that entry (41–43 for `spaces`), so they never reorder an OpenCloud entry, and two apps in
the same slot keep the order Calendar, Contacts, Tasks. The host re-reads the priorities, so a
change applies without a reload.

`general.appDrawerPosition` does the same for the **app menu** (the app switcher in the top bar).
The host sorts it by `priority`, and its own entries use Files 10, Contacts/Mail/App Store 30 and
Admin Settings 40 (everything without a priority sorts last), so the slots are `first` (1–9),
`afterFiles` (11–19, the default), `afterApps` (31–39), `afterSettings` (41–49) and `last` (no
priority at all). In `single` mode the one entry takes the slot of `general.defaultApp`, because
that is the app it opens.

Without `defaults.general.navigation: filesSidebar` the apps are not listed in the Files sidebar at
all (the default mode is `drawerOnly`: one _Planner_ entry in the app drawer) and `filesSidebar` /
`filesSidebarPosition` have no visible effect.

### 5.3 Company defaults

Monday week start, day grid starting at 08:00, default event reminders of 15 and 60 minutes, and
Contacts as the app every user lands on first:

```yaml
planner:
  config:
    defaults:
      general:
        defaultApp: contacts
      calendar:
        weekStart: 1
        dayStart: '08:00'
        defaultReminders: [15, 60]
```

Lock `general.defaultApp` to keep it (users can otherwise pick another enabled app in
Settings → General).

Users can still change all of these themselves; add the paths to `locked` to prevent that.

---

## See also

- [docs/INSTALL.md](INSTALL.md) — server setup (Radicale, proxy routes, app tokens) and app install
- `src/config/appConfig.ts` — sanitising of the raw config
- `src/settings/schema.ts` — settings types, validators and resolution
