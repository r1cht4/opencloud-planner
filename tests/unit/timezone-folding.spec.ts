/**
 * Tests for timezone-aware ICS output and RFC 5545 line folding.
 *
 * Zone is forced to 'Europe/Berlin' by stubbing Intl.DateTimeFormat so that
 * getLocalTimeZone() returns a deterministic value regardless of the host machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ accessToken: 'test-token' }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: authState.accessToken })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

import {
  buildIcs,
  expandRecurringEvents,
  parseIcsToEvent,
  patchIcs
} from '../../src/composables/useCalendarService'

/** Force getLocalTimeZone() to return 'Europe/Berlin' for every test in this file. */
function stubBerlinTz() {
  vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: function () {
      return { resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }) }
    }
  } as any)
}

describe('timezone-aware ICS output', () => {
  beforeEach(() => {
    stubBerlinTz()
  })

  it('emits DTSTART;TZID=Europe/Berlin for timed events', async () => {
    const ics = await buildIcs({
      id: 'tz-event-1',
      title: 'Berlin Meeting',
      start: '2026-06-07 10:00',
      end: '2026-06-07 11:00'
    })

    expect(ics).toMatch(/DTSTART;TZID=Europe\/Berlin:20260607T100000/)
    expect(ics).toMatch(/DTEND;TZID=Europe\/Berlin:20260607T110000/)
  })

  it('wall-clock digits are NOT shifted by machine timezone', async () => {
    // Machine TZ is UTC. Europe/Berlin is UTC+2.
    // We assert the literal digits 100000 and 110000 appear after the TZID=,
    // proving the wall-clock input is preserved verbatim.
    const ics = await buildIcs({
      id: 'tz-event-2',
      title: 'Wall-clock test',
      start: '2026-06-07 10:00',
      end: '2026-06-07 11:00'
    })

    // Exact digit match: no UTC offset applied to 10:00 -> must still be 100000
    expect(ics).toMatch(/DTSTART;TZID=Europe\/Berlin:20260607T100000/)
    expect(ics).toMatch(/DTEND;TZID=Europe\/Berlin:20260607T110000/)
  })

  it('all-day events use VALUE=DATE with no TZID', async () => {
    const ics = await buildIcs({
      id: 'allday-1',
      title: 'All Day Event',
      start: '2026-06-07',
      end: '2026-06-08'
    })

    expect(ics).toContain('DTSTART;VALUE=DATE:20260607')
    expect(ics).toContain('DTEND;VALUE=DATE:20260608')
    // Must NOT contain TZID on either DTSTART or DTEND lines
    const lines = ics.split(/\r\n|\n/)
    const dtStartLine = lines.find((l) => l.startsWith('DTSTART'))
    const dtEndLine = lines.find((l) => l.startsWith('DTEND'))
    expect(dtStartLine).toBeDefined()
    expect(dtEndLine).toBeDefined()
    expect(dtStartLine).not.toContain('TZID')
    expect(dtEndLine).not.toContain('TZID')
  })
})

describe('RFC 5545 line folding', () => {
  beforeEach(() => {
    stubBerlinTz()
  })

  it('no physical line exceeds 75 octets and at least one continuation line exists', async () => {
    // Use a description long enough to force folding
    const longDescription =
      'This is a deliberately long description that will certainly exceed the seventy-five octet RFC 5545 line length limit when serialized as a DESCRIPTION property.'

    const ics = await buildIcs({
      id: 'fold-test',
      title: 'Folding Test',
      start: '2026-06-07 09:00',
      end: '2026-06-07 10:00',
      description: longDescription
    })

    const physicalLines = ics.split('\r\n')

    // Every physical line must be ≤ 75 octets (excluding the CRLF terminator)
    for (const line of physicalLines) {
      const byteLen = new TextEncoder().encode(line).length
      expect(byteLen).toBeLessThanOrEqual(75)
    }

    // At least one continuation line (starts with a space) must exist
    const hasContinuation = physicalLines.some((l) => l.startsWith(' '))
    expect(hasContinuation).toBe(true)
  })
})

describe('round-trip: buildIcs -> parseIcsToEvent', () => {
  beforeEach(() => {
    stubBerlinTz()
  })

  it('preserves wall-clock start and end after round-trip', async () => {
    const ics = await buildIcs({
      id: 'roundtrip-1',
      title: 'Round Trip',
      start: '2026-06-07 14:30',
      end: '2026-06-07 15:45'
    })

    const event = await parseIcsToEvent(ics, 'https://cloud.example/cal/')

    expect(event).not.toBeNull()
    expect(event!.start).toBe('2026-06-07 14:30')
    expect(event!.end).toBe('2026-06-07 15:45')
  })
})

describe('recurring events with TZID', () => {
  beforeEach(() => {
    stubBerlinTz()
  })

  it('expandRecurringEvents returns multiple occurrences without throwing', async () => {
    const ics = await buildIcs({
      id: 'recur-1',
      title: 'Weekly Standup',
      start: '2026-06-01 09:00',
      end: '2026-06-01 09:30',
      rrule: 'FREQ=WEEKLY'
    })

    const baseEvent = await parseIcsToEvent(ics, 'https://cloud.example/cal/')
    expect(baseEvent).not.toBeNull()

    const rangeStart = new Date('2026-06-01T00:00:00Z')
    const rangeEnd = new Date('2026-07-01T00:00:00Z')

    const occurrences = await expandRecurringEvents([baseEvent!], rangeStart, rangeEnd)
    // Weekly events from June 1 through June 30 → expect at least 4 occurrences
    expect(occurrences.length).toBeGreaterThanOrEqual(4)
  })
})

describe('patchIcs TZID preservation', () => {
  beforeEach(() => {
    stubBerlinTz()
  })

  it('re-tags an edited event with the local zone (not the original foreign TZID)', async () => {
    // start/end here are the VIEWER'S LOCAL wall clock (what parseIcsToEvent produced).
    // On save we must tag them with the local zone — re-using the original foreign
    // TZID would reinterpret the local digits in New York and shift the event.
    const rawIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//Test//EN',
      'BEGIN:VEVENT',
      'UID:foreign-tz-1',
      'DTSTAMP:20260609T120000Z',
      'SUMMARY:Original',
      'DTSTART;TZID=America/New_York:20260607T100000',
      'DTEND;TZID=America/New_York:20260607T110000',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const patched = await patchIcs(rawIcs, {
      title: 'Updated',
      start: '2026-06-07 12:00',
      end: '2026-06-07 13:00'
    })

    // Local wall-clock digits are tagged with the local zone, not New York.
    expect(patched).toMatch(/DTSTART;TZID=Europe\/Berlin:20260607T120000/)
    expect(patched).not.toContain('TZID=America/New_York')
  })

  it('keeps the local wall-clock digits when editing a UTC-stored event (regression: +2h on move)', async () => {
    // Reproduces the reported "+2h on move" bug: an event stored in UTC is read into
    // the viewer's LOCAL wall clock (e.g. 06:00 in Berlin). Saving that local wall
    // clock must re-tag it with the local zone and keep the SAME digits — the old
    // code re-applied TZID=UTC to the local digits, drifting the event by the offset.
    const rawIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//Test//EN',
      'BEGIN:VEVENT',
      'UID:utc-roundtrip-1',
      'DTSTAMP:20260609T120000Z',
      'SUMMARY:UTC event',
      'DTSTART;TZID=UTC:20260609T040000',
      'DTEND;TZID=UTC:20260609T050000',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    // The viewer's local wall clock for this event (what parseIcsToEvent yields).
    const patched = await patchIcs(rawIcs, {
      title: 'UTC event',
      start: '2026-06-09 06:00',
      end: '2026-06-09 07:00'
    })

    // Digits unchanged + tagged with the local zone (Berlin), never re-tagged as UTC.
    expect(patched).toMatch(/DTSTART;TZID=Europe\/Berlin:20260609T060000/)
    expect(patched).toMatch(/DTEND;TZID=Europe\/Berlin:20260609T070000/)
    expect(patched).not.toMatch(/TZID=UTC/)
  })

  it('adds local TZID (Europe/Berlin) when original DTSTART was floating', async () => {
    const rawIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//Test//EN',
      'BEGIN:VEVENT',
      'UID:floating-1',
      'DTSTAMP:20260609T120000Z',
      'SUMMARY:Floating',
      'DTSTART:20260607T100000',
      'DTEND:20260607T110000',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const patched = await patchIcs(rawIcs, {
      title: 'Updated',
      start: '2026-06-07 12:00',
      end: '2026-06-07 13:00'
    })

    // Local timezone should be added
    expect(patched).toMatch(/TZID=Europe\/Berlin/)
  })
})

/**
 * Cross-zone read resolution. A timed property with `TZID=<IANA>` but no embedded
 * VTIMEZONE parses as floating in ical.js (no tz database). parseIcsToEvent must
 * still resolve it to the correct absolute instant via Intl offset-probing.
 *
 * NOTE: no Intl stub here — we need the real Intl. Assertions are machine-TZ
 * independent: a foreign-zone reading must yield the SAME local wall clock as its
 * UTC-equivalent (`...Z`) reading, since both describe the same instant.
 */
describe('cross-zone read resolution (foreign TZID, no VTIMEZONE)', () => {
  function ev(dtstart: string, dtend: string): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//Test//EN',
      'BEGIN:VEVENT',
      'UID:xz-1',
      'DTSTAMP:20260101T000000Z',
      `DTSTART${dtstart}`,
      `DTEND${dtend}`,
      'SUMMARY:X',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
  }
  async function readStart(dtstart: string, dtend: string): Promise<string | undefined> {
    return (await parseIcsToEvent(ev(dtstart, dtend), 'cal-1'))?.start
  }

  it('resolves a bare America/New_York TZID to the same instant as its UTC equivalent', async () => {
    // June → New York is EDT (UTC-4): 10:00 NY == 14:00 UTC.
    const foreign = await readStart(
      ';TZID=America/New_York:20260609T100000',
      ';TZID=America/New_York:20260609T110000'
    )
    const utcEquiv = await readStart(':20260609T140000Z', ':20260609T150000Z')
    expect(foreign).toBe(utcEquiv)
  })

  it('applies Europe/Berlin summer DST (CEST = UTC+2)', async () => {
    const foreign = await readStart(
      ';TZID=Europe/Berlin:20260615T100000',
      ';TZID=Europe/Berlin:20260615T110000'
    )
    const utcEquiv = await readStart(':20260615T080000Z', ':20260615T090000Z')
    expect(foreign).toBe(utcEquiv)
  })

  it('applies Europe/Berlin winter (CET = UTC+1)', async () => {
    const foreign = await readStart(
      ';TZID=Europe/Berlin:20260115T100000',
      ';TZID=Europe/Berlin:20260115T110000'
    )
    const utcEquiv = await readStart(':20260115T090000Z', ':20260115T100000Z')
    expect(foreign).toBe(utcEquiv)
  })

  it('leaves a genuinely floating time (no TZID) as wall-clock digits', async () => {
    expect(await readStart(':20260609T100000', ':20260609T110000')).toBe('2026-06-09 10:00')
  })
})
