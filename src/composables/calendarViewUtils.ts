/**
 * calendarViewUtils – pure helpers for the calendar page.
 *
 * Extracted from `Calendar.vue` so the page component stays wiring-only and
 * these mappings can be unit-tested without a DOM or a DAV server:
 *   - calendar colour lookup + @event-calendar event mapping (incl. clustering)
 *   - birthday-event detection
 *   - move-confirmation date formatting
 *   - the time-bounded REPORT window
 *   - post-render density tagging for short timed events
 *   - merging a partial (per-calendar) reload into the loaded events
 */

import { contrastTextColor, DEFAULT_CALENDAR_COLOR } from './colorUtils'
import { collapseOverlappingEvents } from './eventStacking'
import type { CalendarCollection, CalendarEvent } from '../types'

/** Shape @event-calendar consumes for one event block. */
export interface EcEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  backgroundColor: string
  textColor: string
  editable: boolean
  className?: string
}

/** Same-time events per cluster before they collapse into a "+N" block. */
export function stackThreshold(isNarrow: boolean): number {
  return isNarrow ? 2 : 3
}

export function getCalendarColor(calendars: CalendarCollection[], calendarUrl: string): string {
  return calendars.find((c) => c.url === calendarUrl)?.color || DEFAULT_CALENDAR_COLOR
}

/** Birthday events are synced from contacts (UID prefix `bday-`) and must be
 *  edited in the contact, not the calendar. Detect master and expanded occurrences. */
export function isBirthdayEvent(e: CalendarEvent): boolean {
  return e.id.startsWith('bday-') || !!e.recurringEventId?.startsWith('bday-')
}

/**
 * Map internal events to @event-calendar event objects: hidden calendars are
 * dropped, overlapping same-time events collapse into a "+N" stack event, and
 * foreign (birthday / recurring-expanded / synthetic) events are not draggable.
 *
 * Returns the clusters that the synthetic stack events stand in for, so the page
 * can open the popover on click/hover.
 */
export function toEcEvents(
  evts: CalendarEvent[],
  opts: { calendars: CalendarCollection[]; visible: Set<string>; threshold: number }
): { events: EcEvent[]; clusters: Map<string, CalendarEvent[]> } {
  const { events, clusters } = collapseOverlappingEvents(
    evts.filter((e) => opts.visible.has(e.calendarId)),
    opts.threshold
  )

  const mapped = events.map((e) => {
    const bg = getCalendarColor(opts.calendars, e.calendarId)
    const isStack = e.id.startsWith('stack:')
    return {
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.isAllDay ?? !e.start.includes(' '),
      backgroundColor: bg,
      textColor: contrastTextColor(bg),
      editable: !isStack && !e.recurringEventId && !isBirthdayEvent(e),
      className: isStack ? 'ec-event--stack' : undefined
    }
  })

  return { events: mapped, clusters }
}

/** First/second line of the "from → to" comparison in the move dialog. */
export function formatMoveDetails(
  start: string,
  end: string,
  isAllDay: boolean,
  locale: string
): { line1: string; line2: string } {
  const df = (d: Date) =>
    d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })
  const tf = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (isAllDay) {
    return { line1: df(new Date(start + 'T00:00:00')), line2: '' }
  }
  const s = new Date(start.replace(' ', 'T'))
  const e = new Date(end.replace(' ', 'T'))
  if (s.toDateString() === e.toDateString()) {
    return { line1: df(s), line2: `${tf(s)} – ${tf(e)}` }
  }
  return { line1: `${df(s)}, ${tf(s)}`, line2: `${df(e)}, ${tf(e)}` }
}

/**
 * Window of event data loaded from the server (time-bounded REPORT): the visible
 * range ±6 months, so ordinary navigation never waits on a refetch.
 */
export function computeLoadedRange(viewStart: Date, viewEnd: Date): { start: Date; end: Date } {
  const start = new Date(viewStart.getFullYear(), viewStart.getMonth() - 6, 1)
  const end = new Date(viewEnd.getFullYear(), viewEnd.getMonth() + 7, 0)
  return { start, end }
}

export function isTimeGridView(view: { type?: unknown } | null | undefined): boolean {
  return typeof view?.type === 'string' && view.type.startsWith('timeGrid')
}

/**
 * Merge a reload of `refetchedUrls` into the already loaded (master) events.
 *
 * A live refresh triggered by one calendar's ctag must only replace that
 * calendar's events — keeping every other collection's events means the grid is
 * never blanked or re-rendered from a partial set. Passing all loaded URLs gives
 * a plain full refresh.
 */
export function mergeRefreshedEvents(
  previous: CalendarEvent[],
  refreshed: CalendarEvent[],
  refetchedUrls: string[]
): CalendarEvent[] {
  if (refetchedUrls.length === 0) return [...previous]
  const replaced = new Set(refetchedUrls)
  return [...previous.filter((ev) => !replaced.has(ev.calendarId)), ...refreshed]
}

/**
 * Short timed events can't fit both a time line and a title. After render we
 * measure each block and tag it so CSS can drop the time and give the title the
 * full area (and shrink it for the tiniest slots).
 */
export function tagEventElement(el: HTMLElement | null | undefined, isTimeGrid: boolean): void {
  if (!el) return
  if (!isTimeGrid || !el.querySelector('.ec-event-time')) {
    el.classList.remove('ec-event--compact', 'ec-event--tiny')
    return
  }
  const h = el.clientHeight
  el.classList.toggle('ec-event--compact', h < 46)
  el.classList.toggle('ec-event--tiny', h < 20)
}
