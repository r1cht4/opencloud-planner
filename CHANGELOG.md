# Changelog

All notable changes to OpenCloud Planner are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-24

First public release. One OpenCloud web extension adds **Calendar**, **Contacts** and **Tasks** to
the web UI; the browser talks CalDAV/CardDAV directly to the Radicale server that OpenCloud ships
and proxies on the same origin, so the app has no server component and no database of its own.

### Calendar

- Day, week, month and list views with per-calendar colours and visibility, week numbers, all-day
  events and dark mode.
- Drag-and-drop rescheduling and resizing, both with a confirmation that shows the old and the new
  dates; click a slot to create an event, or drag a range out of the grid.
- Recurring events (daily, weekly, monthly, yearly); a single occurrence can be edited or deleted
  without touching the rest of the series.
- Alarms (`VALARM`) stored in the event itself and selectable in the event dialog.
- Organizer and participants are shown read-only; invitation data is preserved verbatim on save.
- Event search across the loaded range (title, location, description), keyboard navigable.
- `.ics` import and export.
- Touch screens: long-press an event to drag or resize it, long-press an empty slot to drag out a new
  event, tap to open; swiping still scrolls the grid.

### Contacts

- Searchable, sortable contact list with a detail panel; create, edit and delete.
- Name, e-mail, phone, several addresses, organization, title, notes, categories, photo and birthday.
- `.vcf` import/export plus Google and Outlook CSV import/export, with a field-by-field duplicate
  merge.
- Birthday calendar: contact birthdays are materialised as yearly recurring events.

### Tasks

- Dedicated page for CalDAV **VTODO** objects in every task-capable calendar.
- Quick-add and a full dialog (title, description, due date with optional time, priority, calendar).
- Complete and reopen with one checkbox; filters for open, completed and all tasks, plus overdue
  marking.
- Edits patch the stored item, so properties written by other clients survive; conflicts with other
  clients are detected through ETags.

### Reminders

- Browser reminders for events and tasks: every alarm due in the next 24 hours fires while an
  OpenCloud tab is open.
- System notifications after an explicit _Allow_, in-app messages otherwise; one reminder across all
  open tabs.

### Settings

- Settings page (gear icon in every app header) with the tabs General, Calendar, Contacts, Tasks,
  Data, Devices and About.
- Settings are stored per user as a single document on the DAV server, so they follow the user to
  every device.
- Date and time format and the clock follow the browser's region or a fixed region, independent of
  the UI language.
- Tools: collection manager (create, rename, recolour, delete), import/export, backup and restore of
  all calendars and address books as one zip, contacts CSV, duplicate-event cleanup, birthday
  calendar and "connect your devices".
- First-run and status screen: when the DAV backend is unreachable the apps explain why and show
  administrators the fix.

### Files integration

- **Import into calendar** and **Import into contacts** in the Files app context menu for `.ics` and
  `.vcf` files.
- Calendar, Contacts and Tasks can each be pinned to the Files app sidebar, or appear as separate
  entries in the app menu; by default the app menu shows one **Planner** entry.
- Position and order of the apps in the Files sidebar and the app menu are configurable per app.
- **Back to OpenCloud** as the first entry of the in-app sidebar on every Planner page.

### Admin configuration

- Without configuration the app uses the same-origin `/caldav/` and `/carddav/` endpoints of the
  OpenCloud instance; other DAV endpoints can be configured.
- Administrators choose which apps are offered, ship defaults for every user and lock individual
  settings. All keys live under the `config:` block of the `planner` entry in OpenCloud's
  `apps.yaml`.

### Translations

- German, French and Spanish translations, using the gettext workflow of the official OpenCloud web
  extensions; the German UI addresses the user formally ("Sie"), like OpenCloud itself.
- Counts use `$ngettext` with real singular and plural forms instead of an "(s)" suffix.

[Unreleased]: https://github.com/r1cht4/opencloud-planner/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/r1cht4/opencloud-planner/releases/tag/v1.0.0
