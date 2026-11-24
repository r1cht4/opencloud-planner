# Roadmap

Where OpenCloud Planner is heading. Everything listed under _Planned_ is an intention, not a promise;
release history is in [CHANGELOG.md](CHANGELOG.md).

## Principles

- **Lean**: native browser APIs first, no new runtime dependencies, no polyfills for things the
  platform or the browser already solves.
- **No data loss**: stored calendar and contact data is patched, never rebuilt, so properties written
  by other clients survive every edit.
- **Works on any install**: nothing is hardcoded to a specific server, user or domain.

## Planned

- **Sharing**: subscribe to external calendars by URL, share calendars and address books between
  OpenCloud users, and CalDAV free/busy lookup.
- **Invitations**: organising events with guests, answering invitations (`PARTSTAT`) and sending
  replies. Until then invitation data is displayed read-only and preserved verbatim.
- **Offline and undo**: offline mode with optimistic updates and undo for deletes.
- **Reminder editing**: alarms are shown and can be chosen for new events; editing the alarms of
  existing events and tasks in the UI is still missing (extra alarms are preserved, just not
  editable).
- **Search beyond the loaded range**: server-side calendar search through a CalDAV text match
  instead of the events already loaded in the browser.
- **Smaller initial download**: split the calendar and settings bundles into per-view chunks.

## Known limitations

- Reminders only fire while OpenCloud is open in a browser tab; there is no push service.
- The app requires a CalDAV/CardDAV backend on the same origin. Radicale, as shipped by
  `opencloud-compose`, is the supported setup.
- Translations cover German, French and Spanish; new strings must be added to all three catalogs.
