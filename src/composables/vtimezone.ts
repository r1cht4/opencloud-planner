/**
 * Self-generated VTIMEZONE components via Intl offset-probing (no tz database).
 *
 * RFC 5545 §3.6.5: each observance's DTSTART is the onset wall-clock in the
 * offset in effect immediately BEFORE the transition; onsets in the covered
 * window are enumerated as RDATEs (no RRULE guessing).
 */

import type { IcalApi, IcalComponent } from '../ics/ical'

/** Offset (ms) of an IANA zone at a given absolute instant: local = utc + offset. */
export function zoneOffsetMsAt(tzid: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const p: Record<string, number> = {}
  for (const { type, value } of dtf.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - instant.getTime()
}

const DAY_MS = 86400_000
const MINUTE_MS = 60_000

interface Transition {
  at: number // first instant (ms UTC) with the new offset
  from: number // offset ms before
  to: number // offset ms after
}

/** Locate transitions in [fromUtc, toUtc): coarse daily scan + binary search to the minute. */
function findTransitions(tzid: string, fromUtc: number, toUtc: number): Transition[] {
  const transitions: Transition[] = []
  let prevT = fromUtc
  let prevOff = zoneOffsetMsAt(tzid, new Date(prevT))
  for (let t = fromUtc + DAY_MS; t <= toUtc; t += DAY_MS) {
    const off = zoneOffsetMsAt(tzid, new Date(t))
    if (off !== prevOff) {
      let lo = prevT
      let hi = t
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS
        if (zoneOffsetMsAt(tzid, new Date(mid)) === prevOff) lo = mid
        else hi = mid
      }
      transitions.push({ at: hi, from: prevOff, to: off })
    }
    prevT = t
    prevOff = off
  }
  return transitions
}

function fmtOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600_000)
  const m = Math.floor((abs % 3600_000) / MINUTE_MS)
  return `${sign}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`
}

/** Onset wall clock: the transition instant expressed in the offset in effect before it. */
function fmtOnset(atMs: number, offsetBeforeMs: number): string {
  const d = new Date(atMs + offsetBeforeMs)
  return (
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
    `T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00`
  )
}

function tzName(tzid: string, instant: Date): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tzid, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')
    return part?.value ?? null
  } catch {
    return null
  }
}

/**
 * Generate a VTIMEZONE component (CRLF-joined `BEGIN:VTIMEZONE…END:VTIMEZONE`)
 * covering [Jan 1 fromYear, Jan 1 toYear+1). Returns null for unknown zones.
 */
export function generateVTimezone(tzid: string, fromYear: number, toYear: number): string | null {
  let transitions: Transition[]
  try {
    transitions = findTransitions(tzid, Date.UTC(fromYear, 0, 1), Date.UTC(toYear + 1, 0, 1))
  } catch {
    return null
  }

  const lines: string[] = ['BEGIN:VTIMEZONE', `TZID:${tzid}`]

  if (transitions.length === 0) {
    const off = zoneOffsetMsAt(tzid, new Date(Date.UTC(fromYear, 0, 1)))
    const name = tzName(tzid, new Date(Date.UTC(fromYear, 0, 1)))
    lines.push('BEGIN:STANDARD')
    lines.push('DTSTART:19700101T000000')
    lines.push(`TZOFFSETFROM:${fmtOffset(off)}`)
    lines.push(`TZOFFSETTO:${fmtOffset(off)}`)
    if (name) lines.push(`TZNAME:${name}`)
    lines.push('END:STANDARD')
  } else {
    // One observance per distinct (from, to) pair; all its onsets become RDATEs.
    const groups = new Map<string, Transition[]>()
    for (const tr of transitions) {
      const key = `${tr.from}|${tr.to}`
      const list = groups.get(key) ?? []
      list.push(tr)
      groups.set(key, list)
    }
    for (const group of groups.values()) {
      const kind = group[0].to > group[0].from ? 'DAYLIGHT' : 'STANDARD'
      const name = tzName(tzid, new Date(group[0].at + MINUTE_MS))
      lines.push(`BEGIN:${kind}`)
      lines.push(`DTSTART:${fmtOnset(group[0].at, group[0].from)}`)
      lines.push(`TZOFFSETFROM:${fmtOffset(group[0].from)}`)
      lines.push(`TZOFFSETTO:${fmtOffset(group[0].to)}`)
      if (name) lines.push(`TZNAME:${name}`)
      for (const tr of group) {
        lines.push(`RDATE:${fmtOnset(tr.at, tr.from)}`)
      }
      lines.push(`END:${kind}`)
    }
  }

  lines.push('END:VTIMEZONE')
  return lines.join('\r\n')
}

/**
 * Ensure `comp` (a VCALENDAR) carries a VTIMEZONE for `tzid`, generating one via
 * Intl offset-probing when it is missing. Window: `year` .. +4, which covers the
 * typical display horizon of recurrences without bloating the ICS.
 *
 * Shared by the event and the task writer — both store a local wall clock and
 * therefore have to ship the zone.
 */
export function ensureVtimezone(
  ical: IcalApi,
  comp: IcalComponent,
  tzid: string,
  year: number
): void {
  const existing = comp
    .getAllSubcomponents('vtimezone')
    .some((tz) => tz.getFirstPropertyValue('tzid') === tzid)
  if (existing) return
  const vtzText = generateVTimezone(tzid, year, year + 4)
  if (!vtzText) return
  comp.addSubcomponent(new ical.Component(ical.parse(vtzText)))
}
