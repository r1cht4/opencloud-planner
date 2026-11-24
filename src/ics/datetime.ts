/**
 * datetime.ts – wall-clock formatting and zone resolution shared by the event
 * and task code (moved out of `useCalendarService`, same behaviour).
 *
 * The event/task models store *wall-clock* strings (`YYYY-MM-DD` for all-day
 * values, `YYYY-MM-DD HH:mm` for timed ones). ical.js ships no tz database, so a
 * timed property with `TZID=<IANA>` but no embedded VTIMEZONE parses as
 * *floating*; the helpers here resolve those to the right absolute instant via
 * Intl offset probing.
 */

import type { IcalTime } from './ical'
import { zoneOffsetMsAt } from '../composables/vtimezone'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `Date` → `YYYY-MM-DD HH:mm` (the model's timed value). */
export function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `Date` → `YYYY-MM-DD` (the model's all-day value). */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The browser's IANA zone, falling back to UTC where Intl cannot tell. */
export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Resolve a wall-clock reading in an IANA zone to the correct absolute instant
 * (a JS Date), via Intl offset-probing — no tz database needed. Returns null if
 * the zone is unknown to the runtime. Two-pass to settle DST transitions.
 */
export function zonedWallClockToDate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tzid: string
): Date | null {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0)
    const off = zoneOffsetMsAt(tzid, new Date(guess))
    let utc = guess - off
    const off2 = zoneOffsetMsAt(tzid, new Date(utc))
    if (off2 !== off) utc = guess - off2
    return new Date(utc)
  } catch {
    return null
  }
}

/**
 * Convert an ICAL.Time to a JS Date that carries the correct absolute instant.
 *
 * ical.js ships no tz database, so a timed property with `TZID=<IANA>` but no
 * embedded VTIMEZONE parses as *floating* — `toJSDate()` would then read the
 * digits as local time and a cross-zone event shows the wrong wall clock. When
 * we detect that case (floating zone + a TZID parameter), we resolve the instant
 * ourselves via Intl. UTC and VTIMEZONE-resolved times are left to ical.js.
 */
export function icalTimeToDate(time: IcalTime, tzidParam?: string | null): Date {
  if (time.isDate) return time.toJSDate()
  const zoneId: string | undefined = time.zone?.tzid
  const unresolved = (!zoneId || zoneId === 'floating') && !!tzidParam && tzidParam !== 'UTC'
  if (unresolved) {
    const d = zonedWallClockToDate(
      time.year,
      time.month,
      time.day,
      time.hour,
      time.minute,
      tzidParam as string
    )
    if (d) return d
  }
  return time.toJSDate()
}

/**
 * Convert a parsed ICAL.Time to the model's wall-clock string (`icalTimeToDate`
 * + `formatDate`/`formatDateTime`).
 */
export function icalTimeToLocalString(time: IcalTime, tzidParam?: string | null): string {
  if (time.isDate) return formatDate(time.toJSDate())
  return formatDateTime(icalTimeToDate(time, tzidParam))
}
