/**
 * useCalendarEvents – the DAV data lifecycle of the Calendar page.
 *
 * Extracted from `views/Calendar.vue`: load the calendars and the events of the
 * loaded window, expand recurrences, refetch on navigation outside the window
 * and on external changes (`useCollectionSync`), and run the birthday
 * auto-sync once per day.
 *
 * The VEVENT filter lives here: the calendar list keeps only collections whose
 * `supported-calendar-component-set` accepts VEVENT — task-only lists
 * (VTODO) must not show up as calendars.
 */

import { ref } from 'vue'
import { useDAVClient } from './useDAVClient'
import { useCalendarService, expandRecurringEvents } from './useCalendarService'
import { useCollectionSync } from './useCollectionSync'
import { useBirthdaySync } from './useBirthdaySync'
import { discoverCollections, supportsComponent } from './davCollections'
import { computeLoadedRange, mergeRefreshedEvents } from './calendarViewUtils'
import type { CalendarCollection, CalendarEvent } from '../types'

/** Component a calendar must accept to be listed in the Calendar app. */
const EVENT_COMPONENT = 'VEVENT'

export interface CalendarEvents {
  calendars: import('vue').Ref<CalendarCollection[]>
  events: import('vue').Ref<CalendarEvent[]>
  rawEvents: import('vue').Ref<CalendarEvent[]>
  loading: import('vue').Ref<boolean>
  error: import('vue').Ref<string | null>
  initialized: import('vue').Ref<boolean>
  /** Load calendars (VEVENT-capable only) + the events of the initial window. */
  loadInitial: () => Promise<void>
  /** Reload events for the loaded window (optionally only some calendars). */
  refreshCalendarEvents: (onlyUrls?: string[]) => Promise<void>
  /** The grid navigated to a range outside the loaded window — refetch. */
  handleDatesSet: (range: { start: Date; end: Date }) => Promise<void>
  /** Re-read the change markers (after our own write / the initial load). */
  markSynced: (urls?: string[]) => Promise<void>
}

export function useCalendarEvents(opts: { birthdayCalendarName: () => string }): CalendarEvents {
  const { ensureReady, getState } = useDAVClient()
  const { calendars, events, loading, error, fetchCalendars, fetchEvents } = useCalendarService()
  const { maybeAutoSync } = useBirthdaySync()

  const initialized = ref(false)
  const rawEvents = ref<CalendarEvent[]>([])
  // Window of event data currently loaded from the server (time-bounded REPORT).
  const loadedRange = ref<{ start: Date; end: Date } | null>(null)

  /**
   * fetchCalendars lists every calendar collection; keep only those whose
   * supported-calendar-component-set accepts VEVENT (an absent set means the
   * server default, which Radicale answers with VEVENT+VTODO+VJOURNAL).
   */
  async function loadCalendars(): Promise<CalendarCollection[]> {
    const cals = await fetchCalendars()
    const state = getState('calendar')
    if (!state || cals.length === 0) return calendars.value
    try {
      const origin = new URL(state.baseUrl).origin
      const discovered = await discoverCollections('calendar', state.principalUrl, { origin })
      const eventUrls = new Set(
        discovered
          .filter((collection) => supportsComponent(collection, EVENT_COMPONENT))
          .map((collection) => collection.url)
      )
      calendars.value = cals.filter((cal) => eventUrls.has(cal.url))
    } catch {
      // Discovery failed — the service already recorded the error; keep its list.
    }
    return calendars.value
  }

  function getExpansionRange(): { start: Date; end: Date } {
    if (loadedRange.value) return loadedRange.value
    const now = new Date()
    return computeLoadedRange(now, now)
  }

  async function loadInitial(): Promise<void> {
    const ready = await ensureReady('calendar')
    if (!ready) return

    const cals = await loadCalendars()

    const now = new Date()
    loadedRange.value = computeLoadedRange(now, now)
    const allEvents: CalendarEvent[] = []
    for (const cal of cals) {
      const evts = await fetchEvents(cal.url, loadedRange.value)
      allEvents.push(...evts)
    }
    rawEvents.value = allEvents
    const { start: rangeStart, end: rangeEnd } = getExpansionRange()
    events.value = await expandRecurringEvents(allEvents, rangeStart, rangeEnd)
    initialized.value = true

    // Baseline the change markers after the initial load, so the poll (and the
    // first focus check) compares against what is actually on screen.
    void markSynced()

    // Birthday auto-sync (at most once/day, only when enabled). Runs after the
    // initial render; if it changed anything, pull the new birthday events in.
    maybeAutoSync({ calendarName: opts.birthdayCalendarName() })
      .then((res) => {
        if (res && (res.created || res.updated || res.removed)) void refreshCalendarEvents()
      })
      .catch(() => {
        /* non-fatal */
      })
  }

  /**
   * Reload events for the currently loaded window.
   *
   * With `onlyUrls` only those calendars are refetched; their previously loaded
   * events are replaced in place and the grid is updated through
   * `setOption('events')` — no re-mount, so the current view/date and an open
   * dialog survive an external change (a stale save then goes through the normal
   * ETag/412 conflict handling).
   */
  async function refreshCalendarEvents(onlyUrls?: string[]): Promise<void> {
    const targets = onlyUrls?.length
      ? calendars.value.filter((cal) => onlyUrls.includes(cal.url))
      : calendars.value
    if (targets.length === 0) return

    const refreshed: CalendarEvent[] = []
    for (const cal of targets) {
      const evts = await fetchEvents(cal.url, loadedRange.value ?? undefined)
      refreshed.push(...evts)
    }

    const allEvents = mergeRefreshedEvents(
      rawEvents.value,
      refreshed,
      targets.map((cal) => cal.url)
    )
    rawEvents.value = allEvents
    const { start: rangeStart, end: rangeEnd } = getExpansionRange()
    events.value = await expandRecurringEvents(allEvents, rangeStart, rangeEnd)
  }

  // Refetch when the user navigates outside the loaded window.
  let rangeReloading = false
  async function handleDatesSet(range: { start: Date; end: Date }): Promise<void> {
    if (!initialized.value || rangeReloading) return
    const lr = loadedRange.value
    if (lr && range.start >= lr.start && range.end <= lr.end) return
    rangeReloading = true
    try {
      loadedRange.value = computeLoadedRange(range.start, range.end)
      await refreshCalendarEvents()
    } finally {
      rangeReloading = false
    }
  }

  /**
   * Pick up changes made by other clients (phone, Thunderbird, …) without a
   * reload: poll the collection change markers (ctag/sync-token) while the tab is
   * visible, on window focus and when the tab becomes visible again, then refetch
   * only the calendars that actually changed.
   */
  const { markSynced } = useCollectionSync({
    getCollections: () => calendars.value.map((cal) => cal.url),
    onChanged: async (urls) => {
      await refreshCalendarEvents(urls)
    }
  })

  return {
    calendars,
    events,
    rawEvents,
    loading,
    error,
    initialized,
    loadInitial,
    refreshCalendarEvents,
    handleDatesSet,
    markSynced
  }
}
