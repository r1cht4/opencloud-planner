/**
 * eventSearch – pure helpers behind the calendar's event search box.
 *
 * The search runs over the events currently held in memory (the REPORT window
 * the view loaded: visible range ±6 months, including expanded recurring
 * occurrences). Nothing is fetched, so the helpers stay side-effect free and
 * unit-testable: matching, ordering/limiting and the label formatting of a
 * result row.
 */

import type { CalendarEvent } from '../types'
import { formatClock } from '../settings/formatLocale'

/** How many results the dropdown shows at most. */
export const SEARCH_RESULT_LIMIT = 20

/**
 * Matching form of a string: lower-cased and accent-stripped, so a query for
 * "muller" finds "Müller" and vice versa (`normalize('NFD')` splits the base
 * letter from its combining mark, which the regex then drops).
 */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Title + location + description, normalised once per event. */
function searchableText(event: CalendarEvent): string {
  return normalizeSearchText(
    [event.title, event.location, event.description].filter(Boolean).join(' ')
  )
}

/**
 * Does the event match every whitespace-separated term of the query? All terms
 * must appear somewhere in title/location/description (AND), each
 * case- and diacritics-insensitively.
 */
export function matchesEventQuery(event: CalendarEvent, query: string): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return false
  const haystack = searchableText(event)
  return terms.every((term) => haystack.includes(term))
}

/**
 * Events matching `query`, sorted by start (all-day first on the same day) and
 * capped at `limit`. An empty/blank query yields no results — the dropdown is
 * only shown while the user types.
 */
export function searchEvents(
  events: CalendarEvent[],
  query: string,
  opts: { limit?: number } = {}
): CalendarEvent[] {
  if (!normalizeSearchText(query).trim()) return []
  const limit = opts.limit ?? SEARCH_RESULT_LIMIT
  return events
    .filter((event) => matchesEventQuery(event, query))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit))
}

export interface SearchResultLabels {
  /** `YYYY-MM-DD` — also the value handed to `setOption('date', …)`. */
  isoDate: string
  /** Locale short date, e.g. "Mon, 15 Jun". */
  date: string
  /** `HH:mm`, empty for all-day events. */
  time: string
}

/** Date/time parts of a result row, formatted for the current locale. */
export function searchResultLabels(event: CalendarEvent, locale: string): SearchResultLabels {
  const isoDate = event.start.slice(0, 10)
  const allDay = event.isAllDay ?? !event.start.includes(' ')
  const parsed = new Date(`${isoDate}T00:00:00`)
  const date = Number.isNaN(parsed.getTime())
    ? isoDate
    : parsed.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  return { isoDate, date, time: allDay ? '' : formatClock(event.start.slice(11, 16), locale) }
}
