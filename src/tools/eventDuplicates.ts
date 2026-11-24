/**
 * eventDuplicates.ts – find duplicated events inside one calendar.
 *
 * Duplicates appear when the same file is imported twice under a different UID,
 * or when two clients both materialise the same appointment. They are invisible
 * in the grid (stacked on top of each other) but clutter reminders and exports.
 *
 * Two events count as duplicates when summary, start, end, RRULE, location and
 * description (all normalised: trimmed, whitespace-collapsed, case-insensitive)
 * are identical — two events at the same time with the same title but a
 * different location or description are NOT duplicates, and deleting the
 * "poorer" copy would silently drop its unique content. Recurrence overrides and
 * expanded occurrences (`RECURRENCE-ID` / `recurringEventId`) are never
 * candidates — deleting an override would silently change a series.
 *
 * Pure module: no DAV access, no ical.js. The "richest" event is determined by
 * counting the content lines of its master VEVENT (the one with ATTENDEE,
 * ORGANIZER, VALARM, X-props wins); ties resolve to the earliest DTSTAMP, i.e.
 * the copy that most likely existed first.
 */

import type { CalendarEvent } from '../types'

export interface DuplicateGroup {
  /** The event that stays. */
  keep: CalendarEvent
  /** Its duplicates, in the order they were found. */
  remove: CalendarEvent[]
}

/** Normalise a free-text field for the duplicate key: collapse whitespace, trim, lower-case. */
function normalizeDupText(value?: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Identity of a duplicated event: `summary|start|end|rrule|location|description`
 * (all text fields normalised).
 */
export function duplicateKey(event: CalendarEvent): string {
  const summary = normalizeDupText(event.title)
  const location = normalizeDupText(event.location)
  const description = normalizeDupText(event.description)
  return [summary, event.start, event.end, event.rrule ?? '', location, description].join('|')
}

/** Unfold ICS lines (RFC 5545 §3.1) so continuation lines count as one property. */
function unfoldIcs(rawIcs: string): string[] {
  return rawIcs.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

/**
 * Number of content lines in the master VEVENT of `rawIcs` (0 when unparsable).
 * Only the first VEVENT is counted, which is the master in every file this app
 * writes; a foreign file listing an override first still produces a stable,
 * comparable number.
 */
export function countIcsProperties(rawIcs?: string): number {
  if (!rawIcs) return 0
  let inside = false
  let count = 0

  for (const line of unfoldIcs(rawIcs)) {
    const trimmed = line.trim()
    const upper = trimmed.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      inside = true
      continue
    }
    if (upper === 'END:VEVENT') {
      if (inside) break
      continue
    }
    if (inside && trimmed) count++
  }

  return count
}

/** DTSTAMP of the first VEVENT (`20260101T101500Z`), or '' when absent. */
function dtstampOf(rawIcs?: string): string {
  if (!rawIcs) return ''
  const match = /^DTSTAMP[^:]*:(\S+)/im.exec(rawIcs)
  return match?.[1] ?? ''
}

/**
 * Sort comparator: most properties first, then the earliest DTSTAMP, then the
 * input order (Array#sort is stable) — a fully consistent ordering, so identical
 * copies always resolve to the first one found.
 */
function compareRichness(a: CalendarEvent, b: CalendarEvent): number {
  const propsA = countIcsProperties(a.rawIcs)
  const propsB = countIcsProperties(b.rawIcs)
  if (propsA !== propsB) return propsB - propsA

  const stampA = dtstampOf(a.rawIcs)
  const stampB = dtstampOf(b.rawIcs)
  if (stampA === stampB) return 0
  return stampA < stampB ? -1 : 1
}

/**
 * Group duplicated events of one calendar and pick the one to keep per group.
 * Returns only groups with at least two members, in first-seen order.
 */
export function findDuplicateEvents(events: CalendarEvent[]): DuplicateGroup[] {
  const groups = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    // Recurrence overrides and expanded occurrences are part of a series, not
    // standalone duplicates.
    if (event.recurrenceId || event.recurringEventId) continue
    const key = duplicateKey(event)
    const bucket = groups.get(key)
    if (bucket) bucket.push(event)
    else groups.set(key, [event])
  }

  const result: DuplicateGroup[] = []
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    const sorted = bucket.slice().sort(compareRichness)
    result.push({ keep: sorted[0], remove: sorted.slice(1) })
  }
  return result
}
