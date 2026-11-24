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

/**
 * Overlapping timed events collapse into a "+N" stack from this many events
 * on, on every viewport width: two events side by side split the day column
 * into slivers whose titles truncate to "Nachbere…", while the stack block
 * keeps the full column width and lists the events in a popover.
 */
export const STACK_THRESHOLD = 2

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
 * Short timed events can't fit both a time line and a title, so the rendered
 * block picks its content from the height it actually got (measured after
 * render, see `tagEventElement`):
 *  - `two-line` — time range on the first line, title below;
 *  - `one-line` — `start time · title` on a single line, smaller font;
 *  - `block`    — less than one line: no text, just the coloured block
 *    (details are on hover/focus via the tooltip).
 *
 * Thresholds in px of the event block (clientHeight, padding included). With
 * the grid's default `slotHeight` 24 px per 30 min (48 px/h): a 15 min event
 * is 12 px → block, 30 min is 24 px → one-line, 60 min is 48 px → two-line.
 * Two lines need 2 × ~16 px line box + 6 px padding ≈ 38 px, rounded to 40;
 * one line needs ~16 px + 6 px ≈ 22 px, rounded down to 20 so a 30 min slot
 * (24 px) still shows text.
 */
export const TWO_LINE_MIN_HEIGHT = 40
export const ONE_LINE_MIN_HEIGHT = 20

export type EventDensityMode = 'two-line' | 'one-line' | 'block'

export function eventDensityMode(heightPx: number): EventDensityMode {
  if (heightPx >= TWO_LINE_MIN_HEIGHT) return 'two-line'
  if (heightPx >= ONE_LINE_MIN_HEIGHT) return 'one-line'
  return 'block'
}

/** Escape user-controlled text for the `html` content hooks of the grid. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Content of a timed event block in the time grid (`eventContent` hook): the
 * range time and the start-only time are both rendered and the density mode
 * (CSS class set after measuring) decides which one is visible — the one-line
 * mode shows `start · title`, the two-line mode the range above the title.
 */
export function eventBlockHtml(title: string, rangeText: string, startText: string): string {
  return (
    `<span class="ec-event-time ec-event-time--range">${escapeHtml(rangeText)}</span>` +
    `<span class="ec-event-time ec-event-time--start">${escapeHtml(startText)}</span>` +
    `<h4 class="ec-event-title">${escapeHtml(title)}</h4>`
  )
}

/**
 * After render we measure each block and tag it with its density mode so CSS
 * can pick the content that fits (see `eventDensityMode`). Only timed events
 * in a time-grid view carry the time spans; everywhere else the tags are
 * removed and the library's default rendering stays.
 */
export function tagEventElement(el: HTMLElement | null | undefined, isTimeGrid: boolean): void {
  if (!el) return
  el.classList.remove('ec-event--two-line', 'ec-event--one-line', 'ec-event--block')
  if (!isTimeGrid || !el.querySelector('.ec-event-time')) return
  el.classList.add(`ec-event--${eventDensityMode(el.clientHeight)}`)
}
