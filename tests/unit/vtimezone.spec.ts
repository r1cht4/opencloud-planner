import { describe, expect, it } from 'vitest'
import { generateVTimezone, zoneOffsetMsAt } from '../../src/composables/vtimezone'
import { buildIcs, parseIcsToEvent, patchIcs } from '../../src/composables/useCalendarService'

describe('zoneOffsetMsAt', () => {
  it('probes standard and daylight offsets', () => {
    expect(zoneOffsetMsAt('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(3600_000)
    expect(zoneOffsetMsAt('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(7200_000)
    expect(zoneOffsetMsAt('Asia/Tokyo', new Date('2026-07-15T12:00:00Z'))).toBe(9 * 3600_000)
    expect(zoneOffsetMsAt('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-5 * 3600_000)
  })
})

describe('generateVTimezone', () => {
  it('emits DAYLIGHT and STANDARD observances for a DST zone', () => {
    const vtz = generateVTimezone('Europe/Berlin', 2026, 2026)!
    expect(vtz).toContain('BEGIN:VTIMEZONE')
    expect(vtz).toContain('TZID:Europe/Berlin')
    // 2026: DST starts Mar 29 02:00 CET -> 03:00 CEST, ends Oct 25 03:00 CEST -> 02:00 CET
    expect(vtz).toMatch(
      /BEGIN:DAYLIGHT[\s\S]*?DTSTART:20260329T020000[\s\S]*?TZOFFSETFROM:\+0100[\s\S]*?TZOFFSETTO:\+0200[\s\S]*?END:DAYLIGHT/
    )
    expect(vtz).toMatch(
      /BEGIN:STANDARD[\s\S]*?DTSTART:20261025T030000[\s\S]*?TZOFFSETFROM:\+0200[\s\S]*?TZOFFSETTO:\+0100[\s\S]*?END:STANDARD/
    )
    expect(vtz.endsWith('END:VTIMEZONE')).toBe(true)
  })

  it('enumerates one RDATE per onset across a multi-year window', () => {
    const vtz = generateVTimezone('Europe/Berlin', 2025, 2027)!
    // DST onsets: 2025-03-30, 2026-03-29, 2027-03-28
    expect(vtz).toContain('RDATE:20250330T020000')
    expect(vtz).toContain('RDATE:20260329T020000')
    expect(vtz).toContain('RDATE:20270328T020000')
    // standard-time onsets: 2025-10-26, 2026-10-25, 2027-10-31
    expect(vtz).toContain('RDATE:20251026T030000')
    expect(vtz).toContain('RDATE:20261025T030000')
    expect(vtz).toContain('RDATE:20271031T030000')
  })

  it('emits a single fixed STANDARD observance for a no-DST zone', () => {
    const vtz = generateVTimezone('Asia/Tokyo', 2026, 2026)!
    expect(vtz).toContain('TZID:Asia/Tokyo')
    expect(vtz).toContain('BEGIN:STANDARD')
    expect(vtz).not.toContain('BEGIN:DAYLIGHT')
    expect(vtz).toMatch(/TZOFFSETFROM:\+0900[\s\S]*?TZOFFSETTO:\+0900/)
  })

  it('handles negative offsets (America/New_York)', () => {
    const vtz = generateVTimezone('America/New_York', 2026, 2026)!
    // DST starts 2026-03-08 02:00 EST -> 03:00 EDT
    expect(vtz).toMatch(
      /BEGIN:DAYLIGHT[\s\S]*?DTSTART:20260308T020000[\s\S]*?TZOFFSETFROM:-0500[\s\S]*?TZOFFSETTO:-0400/
    )
  })

  it('returns null for an unknown zone', () => {
    expect(generateVTimezone('Not/AZone', 2026, 2026)).toBeNull()
  })
})

describe('VTIMEZONE embedding in built/patched ICS', () => {
  it('buildIcs embeds a VTIMEZONE matching the DTSTART TZID (strict RFC 5545)', async () => {
    const ics = await buildIcs({
      id: 'tz-event-1',
      title: 'TZ test',
      start: '2026-07-20 10:00',
      end: '2026-07-20 11:00'
    })
    const tzid = ics.match(/DTSTART;TZID=([^:;]+):/)?.[1]
    expect(tzid).toBeTruthy()
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain(`TZID:${tzid}`)
    // VTIMEZONE must precede the VEVENT for maximum client compatibility
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'))
    // round-trip: still parses to the same local wall clock
    const evt = await parseIcsToEvent(ics, 'https://cal.example/u/default/')
    expect(evt).toMatchObject({ start: '2026-07-20 10:00', end: '2026-07-20 11:00' })
  })

  it('buildIcs does not embed VTIMEZONE for all-day events', async () => {
    const ics = await buildIcs({
      id: 'allday-1',
      title: 'All day',
      start: '2026-07-20',
      end: '2026-07-21'
    })
    expect(ics).not.toContain('BEGIN:VTIMEZONE')
  })

  it('patchIcs adds a VTIMEZONE for the local zone when none exists', async () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Foreign//Client//EN',
      'BEGIN:VEVENT',
      'UID:patch-tz-1',
      'DTSTAMP:20260601T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260720T100000',
      'DTEND;TZID=Europe/Berlin:20260720T110000',
      'SUMMARY:Old',
      'X-FOREIGN-PROP:kept',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const patched = await patchIcs(raw, {
      title: 'New title',
      start: '2026-07-20 08:00',
      end: '2026-07-20 09:00'
    })
    const tzid = patched.match(/DTSTART;TZID=([^:;]+):/)?.[1]
    expect(tzid).toBeTruthy()
    expect(patched).toContain('BEGIN:VTIMEZONE')
    expect(patched).toContain(`TZID:${tzid}`)
    expect(patched).toContain('X-FOREIGN-PROP:kept')
  })

  it('patchIcs does not duplicate an already-present VTIMEZONE for the same zone', async () => {
    const first = await buildIcs({
      id: 'tz-event-2',
      title: 'once',
      start: '2026-07-20 10:00',
      end: '2026-07-20 11:00'
    })
    const patched = await patchIcs(first, {
      title: 'twice',
      start: '2026-07-20 10:00',
      end: '2026-07-20 11:00'
    })
    expect(patched.match(/BEGIN:VTIMEZONE/g)!.length).toBe(1)
  })
})
