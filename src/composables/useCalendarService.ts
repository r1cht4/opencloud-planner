/**
 * useCalendarService – CalDAV operations using direct fetch.
 *
 * The pure ICS work (event ↔ ICS conversion, patching, recurrence expansion,
 * wall-clock/zone helpers) lives in `src/ics/**`; this module keeps the DAV and
 * state part (discovery, REPORT, PUT/DELETE, loading/error bookkeeping) and
 * re-exports the moved helpers so every existing importer keeps its old path.
 */

import { computed, ref, type Ref } from 'vue'
import { useDAVClient, davFetch, davResourceName } from './useDAVClient'
import { davPropData, davPropText, parseMultistatus } from './davXml'
import { discoverCollections } from './davCollections'
import { DEFAULT_CALENDAR_COLOR, normalizeColor } from './colorUtils'
import { parseIcsToEvent } from '../ics/vevent'
import { buildIcs, patchIcs } from '../ics/icsPatch'
import type { CalendarCollection, CalendarEvent } from '../types'

/** Wall-clock formatting and zone resolution live in `src/ics/datetime.ts`. */
export { formatDate, formatDateTime, getLocalTimeZone, zonedWallClockToDate } from '../ics/datetime'
export { parseIcsToEvent } from '../ics/vevent'
export { addExdateToIcs, buildIcs, patchIcs, upsertRecurrenceOverrideIcs } from '../ics/icsPatch'
export { expandRecurringEvents } from '../ics/recurrence'

/**
 * Normalise a DAV collection colour to `#RRGGBB`.
 *
 * Apple (and therefore Thunderbird/DAVx5 via sync) writes RGBA as `#RRGGBBAA`;
 * some servers omit leading zeros with `#RGB`. Anything else — CSS keywords,
 * `rgb()`, missing values — falls back to the app default so the calendar chips
 * and events always get a real colour.
 */
export function normalizeDavColor(raw?: string | null): string {
  const value = (raw ?? '').trim()
  // `#RGBA` (4 digits) is expanded like `#RGB`; ical/Apple never write it, but
  // earlier builds accepted it, so keep that edge case out of `normalizeColor`.
  if (/^#[0-9A-Fa-f]{4}$/.test(value)) {
    return `#${value
      .slice(1, 4)
      .split('')
      .map((c) => c + c)
      .join('')}`.toUpperCase()
  }
  return normalizeColor(raw)?.toUpperCase() ?? DEFAULT_CALENDAR_COLOR
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatIfMatch(etag: string): string {
  if (etag === '*' || etag.startsWith('"') || etag.startsWith('W/"')) return etag
  return `"${etag}"`
}

export interface TimeRange {
  start: Date
  end: Date
}

function fmtUtcStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * REPORT calendar-query body. With a range, the server filters VEVENTs to those
 * intersecting [start, end) — recurring masters count when any occurrence does.
 */
export function buildCalendarQueryBody(range?: TimeRange): string {
  const veventFilter = range
    ? `<c:comp-filter name="VEVENT">
        <c:time-range start="${fmtUtcStamp(range.start)}" end="${fmtUtcStamp(range.end)}"/>
      </c:comp-filter>`
    : '<c:comp-filter name="VEVENT"/>'
  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      ${veventFilter}
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

async function calendarQuery(calendarUrl: string, range?: TimeRange): Promise<string> {
  const body = buildCalendarQueryBody(range)

  const resp = await davFetch(calendarUrl, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body
  })
  if (!resp.ok && resp.status !== 207) {
    throw new Error(`REPORT calendar-query failed: ${resp.status}`)
  }
  return resp.text()
}

export function useCalendarService() {
  const { ensureReady, getState } = useDAVClient()

  const calendars: Ref<CalendarCollection[]> = ref([])
  const events: Ref<CalendarEvent[]> = ref([])
  const error: Ref<string | null> = ref(null)

  // `loading` is counter-backed: one ref per *call*, not per service. The view
  // fetches several calendars at once, so a plain boolean would flip to false as
  // soon as the first call finished while the others were still running.
  const inFlight = ref(0)
  const loading = computed(() => inFlight.value > 0)

  /**
   * Error policy (parallel-safe):
   *  - `error` is cleared only when a *fresh* top-level operation starts, i.e.
   *    when nothing else is in flight. A sibling call starting mid-batch must not
   *    erase a failure another call has already recorded.
   *  - A successful call does not clear it either; the next operation's start
   *    does. So a "modified elsewhere" or "REPORT failed" message stays visible
   *    until the user (or the view) triggers a new operation.
   */
  function beginOperation(): void {
    if (inFlight.value === 0) error.value = null
    inFlight.value++
  }

  function endOperation(): void {
    if (inFlight.value > 0) inFlight.value--
  }

  /**
   * Discover the user's calendars.
   *
   * `autoCreate` (default `true`) keeps the first-run UX: a user with no
   * calendar gets a default one created. Background consumers — the reminder
   * engine — pass `{ autoCreate: false }`: a background loop must
   * never write data, not even for a user (or on an install) where the Calendar
   * app is disabled.
   */
  async function fetchCalendars(
    options: { autoCreate?: boolean } = {}
  ): Promise<CalendarCollection[]> {
    beginOperation()
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const state = getState('calendar')!
      const origin = new URL(state.baseUrl).origin

      // Shared discovery (`davCollections`): it PROPFINDs both calendar-colour
      // namespaces (Radicale/Nextcloud answer in the CalDAV one, Apple writes the
      // iCal one) and skips the principal itself. Only child collections with a
      // <calendar/> resourcetype come back.
      const discovered = await discoverCollections('calendar', state.principalUrl, { origin })

      // Colour case and fallback stay with this service: the calendar chips and
      // event blocks paint upper-case `#RRGGBB` (see normalizeDavColor).
      const cals: CalendarCollection[] = discovered.map((collection) => ({
        url: collection.url,
        displayName: collection.displayName || 'Calendar',
        color: normalizeDavColor(collection.colorRaw),
        description: collection.description,
        ctag: collection.ctag
      }))

      // Auto-create a default calendar if none exist (opt-out for background
      // consumers, see above).
      if (cals.length === 0 && options.autoCreate !== false) {
        const calUrl = `${state.principalUrl}default-calendar/`
        await createCollection(calUrl, 'calendar', 'Calendar')
        cals.push({
          url: calUrl,
          displayName: 'Calendar',
          color: DEFAULT_CALENDAR_COLOR,
          description: '',
          ctag: ''
        })
      }

      cals.sort((a, b) => {
        const aDefault =
          /default|personal|calendar/i.test(a.displayName) &&
          !/birthday|geburtstag/i.test(a.displayName)
            ? 0
            : 1
        const bDefault =
          /default|personal|calendar/i.test(b.displayName) &&
          !/birthday|geburtstag/i.test(b.displayName)
            ? 0
            : 1
        return aDefault - bDefault
      })
      calendars.value = cals
      return cals
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] fetchCalendars error:', err)
      return []
    } finally {
      endOperation()
    }
  }

  async function fetchEvents(calendarUrl: string, range?: TimeRange): Promise<CalendarEvent[]> {
    beginOperation()
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const state = getState('calendar')!
      const origin = new URL(state.baseUrl).origin

      const xml = await calendarQuery(calendarUrl, range)
      const responses = parseMultistatus(xml)
      const parsed: CalendarEvent[] = []

      for (const resp of responses) {
        if (resp.href === calendarUrl || resp.href.endsWith('/')) continue
        if (!resp.href.endsWith('.ics')) continue

        const objUrl = resp.href.startsWith('http') ? resp.href : `${origin}${resp.href}`
        const etag = davPropText(resp.el, 'getetag') || undefined
        const icsData = davPropData(resp.el, 'calendar-data')
        if (!icsData) continue

        const evt = await parseIcsToEvent(icsData, calendarUrl, objUrl, etag)
        if (evt) parsed.push(evt)
      }

      events.value = parsed
      return parsed
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return []
    } finally {
      endOperation()
    }
  }

  async function createEvent(
    calendarUrl: string,
    event: {
      id: string
      title: string
      start: string
      end: string
      description?: string
      location?: string
      rrule?: string
      reminder?: number
      reminders?: number[]
    }
  ): Promise<CalendarEvent | null> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const ics = await buildIcs(event)
      // The UID stays in the data; the resource name is the UID when it is
      // URL-safe, else its SHA-256 (deterministic — the same event always maps
      // to the same resource).
      const url = `${calendarUrl}${await davResourceName(event.id)}.ics`

      const resp = await davFetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*'
        },
        body: ics
      })

      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)
      const etag = resp.headers.get('ETag') || undefined
      const created: CalendarEvent = {
        ...event,
        calendarId: calendarUrl,
        rawIcs: ics,
        href: url,
        etag
      }
      events.value.push(created)
      return created
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  /**
   * PUT a complete, externally produced VCALENDAR document verbatim (import path).
   * 412 means the UID already exists on the server — reported as 'exists' so the
   * caller can count skips instead of surfacing a bogus failure.
   */
  async function importEventIcs(
    calendarUrl: string,
    uid: string,
    ics: string
  ): Promise<'created' | 'exists' | 'failed'> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      // `uid` is the UID as stored in the data; the resource name is the
      // safe form (UID or its SHA-256), so re-importing the same file finds the
      // same resource and reports "already exists" instead of duplicating.
      const resp = await davFetch(`${calendarUrl}${await davResourceName(uid)}.ics`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*'
        },
        body: ics
      })
      if (resp.status === 412) return 'exists'
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)
      return 'created'
    } catch (err) {
      console.warn('[planner] Import PUT failed:', uid, err)
      return 'failed'
    }
  }

  async function updateEvent(event: CalendarEvent): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      // Patch the original ICS to preserve properties the UI does not model
      // (ATTENDEE, ORGANIZER, X-* props, additional VALARMs, etc.).
      // Fall back to a full rebuild only when no rawIcs is available.
      const ics = event.rawIcs ? await patchIcs(event.rawIcs, event) : await buildIcs(event)
      const url = event.href || `${event.calendarId}${await davResourceName(event.id)}.ics`

      const headers: Record<string, string> = {
        'Content-Type': 'text/calendar; charset=utf-8'
      }
      if (event.etag) headers['If-Match'] = formatIfMatch(event.etag)

      const resp = await davFetch(url, { method: 'PUT', headers, body: ics })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      const idx = events.value.findIndex((e) => e.id === event.id)
      if (idx !== -1)
        events.value[idx] = { ...event, rawIcs: ics, etag: resp.headers.get('ETag') || event.etag }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function updateEventIcs(event: CalendarEvent, ics: string): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const url = event.href || `${event.calendarId}${await davResourceName(event.id)}.ics`

      const headers: Record<string, string> = {
        'Content-Type': 'text/calendar; charset=utf-8'
      }
      if (event.etag) headers['If-Match'] = formatIfMatch(event.etag)

      const resp = await davFetch(url, { method: 'PUT', headers, body: ics })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      const masterId = event.recurringEventId || event.id
      const idx = events.value.findIndex((e) => e.id === masterId)
      if (idx !== -1)
        events.value[idx] = {
          ...events.value[idx],
          rawIcs: ics,
          etag: resp.headers.get('ETag') || event.etag
        }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function deleteEvent(event: CalendarEvent): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const url = event.href || `${event.calendarId}${await davResourceName(event.id)}.ics`

      const headers: Record<string, string> = {}
      if (event.etag) headers['If-Match'] = formatIfMatch(event.etag)

      const resp = await davFetch(url, { method: 'DELETE', headers })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`DELETE failed: ${resp.status}`)
      events.value = events.value.filter((e) => e.id !== event.id)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  return {
    calendars,
    events,
    loading,
    error,
    fetchCalendars,
    fetchEvents,
    createEvent,
    importEventIcs,
    updateEvent,
    updateEventIcs,
    deleteEvent
  }
}

/** Create a CalDAV calendar or CardDAV addressbook collection via MKCOL */
export async function createCollection(
  url: string,
  type: 'calendar' | 'addressbook',
  displayName: string
): Promise<void> {
  const typeEl =
    type === 'calendar'
      ? '<d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>'
      : '<d:resourcetype><d:collection/><card:addressbook xmlns:card="urn:ietf:params:xml:ns:carddav"/></d:resourcetype>'

  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:set>
    <d:prop>
      ${typeEl}
      <d:displayname>${escapeXml(displayName)}</d:displayname>
    </d:prop>
  </d:set>
</d:mkcol>`

  const resp = await davFetch(url, {
    method: 'MKCOL',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    },
    body
  })

  if (!resp.ok && resp.status !== 201) {
    throw new Error(`MKCOL ${type} failed: ${resp.status}`)
  }
  console.info(`[planner] Created ${type} collection: ${url}`)
}
