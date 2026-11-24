/**
 * seriesEdit.ts – pure "shift the whole series" math.
 *
 * When the user edits or drags ONE occurrence of a recurring series with scope
 * "entire series", the master VEVENT must move by the same delta — otherwise
 * the series gets re-anchored at the clicked occurrence and every earlier
 * occurrence disappears.
 *
 * The delta is computed in *wall-clock* space (the model's `YYYY-MM-DD HH:mm`
 * strings are the viewer's local wall clock), not in absolute time, so a shift
 * across a DST boundary keeps the wall-clock time of day — exactly what a user
 * means by "move this series one hour later".
 *
 * Unchanged times come back unchanged (`changed === false`), so the caller can
 * leave the master's DTSTART/DTEND alone.
 */

import { formatDate, formatDateTime } from './datetime'

/** Wall-clock strings of the model: `YYYY-MM-DD HH:mm` (timed) or `YYYY-MM-DD` (all-day). */
export interface SeriesShiftInput {
  /** DTSTART of the master, in the model's wall-clock shape. */
  masterStart: string
  /** DTEND of the master, in the model's wall-clock shape. */
  masterEnd: string
  /** Start of the occurrence the user actually edited/dragged (old position). */
  oldOccStart: string
  /** New start of that occurrence (where the form/drag put it). */
  newOccStart: string
  /** New end of that occurrence (the form/drag keeps the duration). */
  newOccEnd: string
  /** All-day series use date-only values. */
  isAllDay: boolean
}

export interface SeriesShiftResult {
  /** New master DTSTART (wall-clock string, same shape as `masterStart`). */
  start: string
  /** New master DTEND. */
  end: string
  /** False when neither start nor end moved — leave DTSTART/DTEND untouched. */
  changed: boolean
}

/**
 * `YYYY-MM-DD[ HH:mm]` → minutes since the epoch read as if the wall clock
 * were UTC. Pure wall-clock arithmetic: no zone, no DST, no absolute time.
 */
function wallClockToMinutes(value: string): number {
  const [datePart, timePart] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour = 0, minute = 0] = (timePart ?? '').split(':').map(Number)
  return Date.UTC(year, month - 1, day, hour, minute) / 60000
}

/** Inverse of `wallClockToMinutes`; keeps the date-only shape for all-day values. */
function minutesToWallClock(minutes: number, isAllDay: boolean): string {
  const ms = minutes * 60000
  const d = new Date(ms)
  return isAllDay ? formatDate(d) : formatDateTime(d)
}

/**
 * Compute the master's new start/end for a series-wide edit of one occurrence.
 *
 * - `newMasterStart = masterStart + (newOccStart − oldOccStart)`
 * - the master keeps the duration the form/drag produced:
 *   `newMasterEnd = newMasterStart + (newOccEnd − newOccStart)`
 *
 * All-day values are shifted by whole days through the same wall-clock math
 * (midnight-based), which stays correct across DST because the wall clock of
 * a date-only value is always 00:00.
 */
export function shiftSeriesTimes(input: SeriesShiftInput): SeriesShiftResult {
  const { masterStart, masterEnd, oldOccStart, newOccStart, newOccEnd, isAllDay } = input

  const delta = wallClockToMinutes(newOccStart) - wallClockToMinutes(oldOccStart)
  const newMasterStartMinutes = wallClockToMinutes(masterStart) + delta
  const duration = wallClockToMinutes(newOccEnd) - wallClockToMinutes(newOccStart)
  const newMasterEndMinutes = newMasterStartMinutes + duration

  const start = minutesToWallClock(newMasterStartMinutes, isAllDay)
  const end = minutesToWallClock(newMasterEndMinutes, isAllDay)

  return { start, end, changed: start !== masterStart || end !== masterEnd }
}
