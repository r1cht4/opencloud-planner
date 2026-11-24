/**
 * useBirthdaySync – materialises a "Birthdays" calendar from contact BDAY fields.
 *
 * The birthday calendar is a *derived view* of the contacts: the app owns every
 * `bday-*` event. Reconcile is idempotent — it creates missing events, updates
 * changed ones (renamed contact / changed birth date), and prunes orphans
 * (deleted contact / removed BDAY). Birthday events are non-editable in the
 * calendar UI (see isBirthdayEvent in Calendar.vue), so this reconcile is the
 * only writer.
 *
 * Enablement, target calendar and reminder come from the **synced** settings
 * (`birthdays.enabled` / `birthdays.calendar` / `birthdays.reminder`), so the
 * feature follows the user to every device; the once-per-day throttle stays
 * per-device (`localStorage`) because it is a cache, not a preference. Turning
 * the feature off only stops the auto-sync, it never deletes the calendar (that is
 * a separate explicit action, tracked for later).
 */
import { ref } from 'vue'
import { useDAVClient, davFetch, davResourceName, davUserId } from './useDAVClient'
import { buildIcs, createCollection, parseIcsToEvent, formatIfMatch } from './useCalendarService'
import { davPropData, davPropText, parseMultistatus } from './davXml'
import { useContactsService } from './useContactsService'
import { useSettings } from '../settings/settingsStore'
import { birthdayReminderLeadMinutes } from '../settings/birthdayReminder'
import type { Contact } from '../types'

/**
 * Per-device throttle stamp only. The old per-device *toggle*
 * (`cc-birthday-sync-enabled`) is imported into `birthdays.enabled` once by the
 * settings store and then removed — no reader is left for it here.
 *
 * The stamp is keyed by the DAV user — two OpenCloud accounts in
 * one browser must not skip each other's sync because the other one just ran.
 */
const LAST_KEY = 'cc-birthday-sync-last'
const DAY_MS = 24 * 60 * 60 * 1000

/** Storage key of the per-user once-per-day throttle stamp. */
function syncStampKey(): string {
  return `${LAST_KEY}:${davUserId()}`
}

export interface ReconcileResult {
  created: number
  updated: number
  removed: number
}

/**
 * Settings-backed wrappers for the (older) per-device toggle API, so callers like
 * `CollectionsCard.vue` keep working unchanged while the value now lives in the
 * synced document (`birthdays.enabled`).
 */
export function isBirthdaySyncEnabled(): boolean {
  return useSettings().settings.value.birthdays.enabled
}

export function setBirthdaySyncEnabled(value: boolean): void {
  useSettings().update('birthdays.enabled', value)
}

function lastSyncedAt(): number {
  try {
    return Number(localStorage.getItem(syncStampKey()) || 0)
  } catch {
    return 0
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(syncStampKey(), String(Date.now()))
  } catch {
    /* ignore */
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Title is age-free on purpose: the event recurs yearly, so a baked-in age
 *  would be wrong for every year except the one it was synced in. */
function birthdayTitle(c: Contact): string {
  return `🎂 ${c.displayName}`
}

/**
 * Deterministic, URL-safe event UID for a contact's birthday: the contact
 * UID stays the identity, and the *resource name* comes from the shared
 * `davResourceName` helper (UID as-is when safe, else its SHA-256) — never a
 * random UUID, which would defeat the create/update/prune matching.
 */
async function birthdayUid(contactId: string): Promise<string> {
  return `bday-${await davResourceName(contactId)}`
}

/** Derive an all-day start/end (DTEND is exclusive, +1 day) from a BDAY. */
function birthdayDates(bday: string): { start: string; end: string; mmdd: string } | null {
  const m = bday.match(/(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, month, day] = m
  const year = new Date().getFullYear()
  const start = `${year}-${month}-${day}`
  const endDate = new Date(year, Number(month) - 1, Number(day) + 1)
  const end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`
  return { start, end, mmdd: `${month}-${day}` }
}

const PROPFIND_RESOURCETYPE =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'

const CALENDAR_DATA_REPORT = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`

interface ExistingBday {
  href: string
  etag?: string
  title: string
  mmdd: string
  /** Lead times (minutes) of the DISPLAY alarms currently stored. */
  reminders: number[]
}

export function useBirthdaySync() {
  const { ensureReady, getState } = useDAVClient()
  const { fetchAddressBooks, fetchContacts, error: contactsError } = useContactsService()

  const syncing = ref(false)

  /**
   * Calendar the birthday events go into: `birthdays.calendar` when the user
   * picked one, else the app's own `birthdays/` collection on the principal.
   */
  function birthdayCalendarUrl(): string | null {
    const state = getState('calendar')
    const configured = useSettings().settings.value.birthdays.calendar
    if (configured) return configured.endsWith('/') ? configured : `${configured}/`
    return state ? `${state.principalUrl}birthdays/` : null
  }

  /** Reminder lead (minutes) `birthdays.reminder` maps to, or null for "none". */
  function birthdayReminderLead(): number | null {
    return birthdayReminderLeadMinutes(useSettings().settings.value.birthdays.reminder)
  }

  /** Side-effect-free read of existing `bday-*` events (does NOT touch the shared
   *  calendar-service `events` ref, unlike fetchEvents). */
  async function fetchExistingBirthdays(calUrl: string): Promise<Map<string, ExistingBday>> {
    const map = new Map<string, ExistingBday>()
    const resp = await davFetch(calUrl, {
      method: 'REPORT',
      headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
      body: CALENDAR_DATA_REPORT
    })
    if (!resp.ok && resp.status !== 207) return map

    const state = getState('calendar')!
    const origin = new URL(state.baseUrl).origin
    const xml = await resp.text()
    for (const r of parseMultistatus(xml)) {
      if (!r.href.endsWith('.ics')) continue
      const ics = davPropData(r.el, 'calendar-data')
      if (!ics) continue
      const objUrl = r.href.startsWith('http') ? r.href : `${origin}${r.href}`
      const evt = await parseIcsToEvent(
        ics,
        calUrl,
        objUrl,
        davPropText(r.el, 'getetag') || undefined
      )
      if (!evt || !evt.id.startsWith('bday-')) continue
      map.set(evt.id, {
        href: objUrl,
        etag: evt.etag,
        title: evt.title,
        mmdd: evt.start.slice(5, 10),
        reminders: [...(evt.reminders ?? [])].sort((a, b) => a - b)
      })
    }
    return map
  }

  /**
   * Full reconcile: contacts → birthday calendar. Idempotent.
   * @param opts.calendarName display name used when the calendar must be created.
   */
  async function reconcile(opts: { calendarName?: string } = {}): Promise<ReconcileResult | null> {
    if (syncing.value) return null
    if (!(await ensureReady('calendar')) || !(await ensureReady('contacts'))) return null

    const calUrl = birthdayCalendarUrl()
    if (!calUrl) return null

    syncing.value = true
    try {
      // Gather all contacts with a birthday (use return values, not the shared
      // ref). A single failing address book is tracked: its
      // birthdays must not look like orphans and be pruned.
      const books = await fetchAddressBooks()
      const contacts: Contact[] = []
      let anyBookFailed = false
      for (const book of books) {
        try {
          contacts.push(...(await fetchContacts(book.url)))
          if (contactsError.value) anyBookFailed = true
        } catch (err) {
          anyBookFailed = true
          console.warn('[planner] birthday sync: book fetch failed:', book.url, err)
        }
      }
      const withBday = contacts.filter((c) => c.birthday)

      // Build the desired set (reminder lead included, so a changed
      // `birthdays.reminder` updates the existing events on the next sync).
      const reminderLead = birthdayReminderLead()
      const desiredReminders = reminderLead === null ? [] : [reminderLead]
      const desired = new Map<
        string,
        { title: string; start: string; end: string; mmdd: string; reminders: number[] }
      >()
      for (const c of withBday) {
        const dates = birthdayDates(c.birthday!)
        if (!dates) continue
        desired.set(await birthdayUid(c.id), {
          title: birthdayTitle(c),
          ...dates,
          reminders: desiredReminders
        })
      }

      // Ensure the calendar exists (create only if there is something to sync).
      const check = await davFetch(calUrl, {
        method: 'PROPFIND',
        headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
        body: PROPFIND_RESOURCETYPE
      })
      if (check.status === 404) {
        if (desired.size === 0) {
          markSynced()
          return { created: 0, updated: 0, removed: 0 }
        }
        await createCollection(calUrl, 'calendar', opts.calendarName || 'Birthdays')
      }

      const existing = await fetchExistingBirthdays(calUrl)
      let created = 0
      let updated = 0
      let removed = 0

      // Create + update.
      const sameReminders = (a: number[], b: number[]): boolean =>
        a.length === b.length && a.every((minutes, index) => minutes === b[index])

      for (const [uid, d] of desired) {
        const ex = existing.get(uid)
        if (
          ex &&
          ex.title === d.title &&
          ex.mmdd === d.mmdd &&
          sameReminders(ex.reminders, d.reminders)
        ) {
          continue
        }

        const ics = await buildIcs({
          id: uid,
          title: d.title,
          start: d.start,
          end: d.end,
          rrule: 'FREQ=YEARLY',
          // Exactly one DISPLAY alarm per birthday event (or none).
          reminders: d.reminders
        })
        if (!ex) {
          const r = await davFetch(`${calUrl}${uid}.ics`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
            body: ics
          })
          if (r.ok || r.status === 201) created++
        } else {
          const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' }
          if (ex.etag) headers['If-Match'] = formatIfMatch(ex.etag)
          const r = await davFetch(ex.href, { method: 'PUT', headers, body: ics })
          if (r.ok) updated++
        }
      }

      // Prune orphans (contact or BDAY removed). Safety: an empty desired set with
      // existing events present almost always means a transient contacts-fetch
      // failure, not that the user removed every birthday — skip pruning then,
      // rather than wipe the whole calendar (that also applies when
      // only *one* of several books failed: its birthdays are not orphans).
      const safeToPrune = (desired.size > 0 || existing.size === 0) && !anyBookFailed
      if (safeToPrune) {
        for (const [uid, ex] of existing) {
          if (desired.has(uid)) continue
          const headers: Record<string, string> = {}
          if (ex.etag) headers['If-Match'] = formatIfMatch(ex.etag)
          const r = await davFetch(ex.href, { method: 'DELETE', headers })
          if (r.ok || r.status === 204) removed++
        }
      }

      markSynced()
      return { created, updated, removed }
    } finally {
      syncing.value = false
    }
  }

  /** Auto-sync entry point for app load: runs at most once per day when enabled. */
  async function maybeAutoSync(
    opts: { calendarName?: string } = {}
  ): Promise<ReconcileResult | null> {
    if (!isBirthdaySyncEnabled()) return null
    if (Date.now() - lastSyncedAt() < DAY_MS) return null
    try {
      return await reconcile(opts)
    } catch (err) {
      console.warn('[planner] birthday auto-sync failed:', err)
      return null
    }
  }

  return { syncing, reconcile, maybeAutoSync }
}
