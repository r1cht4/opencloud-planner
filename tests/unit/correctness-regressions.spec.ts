/**
 * Regression tests for four confirmed correctness bugs:
 *
 *  1. `expandRecurringEvents` counted its 365-occurrence cap from the *series
 *     start*, so a series that began more than a year before the viewed range
 *     produced zero occurrences.
 *  2. `patchIcs` patched the first VEVENT in the file. When another client
 *     lists the RECURRENCE-ID override before the master, the override got the
 *     edits (and an RRULE) while the master stayed untouched.
 *  3. Calendar colours written by Apple/Thunderbird/DAVx5 live in the Apple
 *     iCal namespace and were never requested (so never used).
 *  4. Apple's item-grouped vCard properties (`item1.EMAIL:…`) were not parsed,
 *     so those emails/phones/addresses were invisible in the UI.
 */
import { describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ accessToken: 'test-token' }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: authState.accessToken })
}))

import {
  expandRecurringEvents,
  normalizeDavColor,
  parseIcsToEvent,
  patchIcs,
  upsertRecurrenceOverrideIcs
} from '../../src/composables/useCalendarService'
import { parseVcard, patchVcard } from '../../src/composables/useContactsService'

function ics(...lines: string[]): string {
  return lines.join('\r\n')
}

async function parsedEvent(...lines: string[]) {
  const event = await parseIcsToEvent(ics(...lines), 'https://cloud.example/caldav/user/cal/')
  expect(event).not.toBeNull()
  return event!
}

// ── 1. Occurrence cap must be counted over the emitted range, not the series ──

const DAILY_SINCE_2024 = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:daily-since-2024',
  'DTSTAMP:20241101T080000Z',
  'DTSTART:20241101T090000Z',
  'DTEND:20241101T100000Z',
  'RRULE:FREQ=DAILY',
  'SUMMARY:Daily Standup',
  'END:VEVENT',
  'END:VCALENDAR'
]

const WEEKLY_SINCE_2015 = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:weekly-since-2015',
  'DTSTAMP:20150107T080000Z',
  'DTSTART:20150107T090000Z',
  'DTEND:20150107T100000Z',
  'RRULE:FREQ=WEEKLY',
  'SUMMARY:Old Weekly',
  'END:VEVENT',
  'END:VCALENDAR'
]

const YEARLY_SINCE_1990 = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:yearly-since-1990',
  'DTSTAMP:19900315T080000Z',
  'DTSTART:19900315T090000Z',
  'DTEND:19900315T100000Z',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Birthday Reminder',
  'END:VEVENT',
  'END:VCALENDAR'
]

describe('expandRecurringEvents – old series inside the viewed range', () => {
  it('expands a daily series that started two years before the range', async () => {
    const event = await parsedEvent(...DAILY_SINCE_2024)

    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-11-23T00:00:00Z'),
      new Date('2026-11-30T00:00:00Z')
    )

    expect(occurrences).toHaveLength(7)
    expect(occurrences[0].start.slice(0, 10)).toBe('2026-11-23')
    expect(occurrences[6].start.slice(0, 10)).toBe('2026-11-29')
  })

  it('expands a weekly series that started in 2015', async () => {
    const event = await parsedEvent(...WEEKLY_SINCE_2015)

    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-11-02T00:00:00Z'),
      new Date('2026-11-30T00:00:00Z')
    )

    // Four Wednesdays in [2026-11-02, 2026-11-30): 4, 11, 18, 25.
    expect(occurrences).toHaveLength(4)
  })

  it('expands a yearly series that started in 1990', async () => {
    const event = await parsedEvent(...YEARLY_SINCE_1990)

    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z')
    )

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].start.slice(0, 10)).toBe('2026-03-15')
  })

  it('caps the number of emitted occurrences for a huge range', async () => {
    const event = await parsedEvent(...DAILY_SINCE_2024)

    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2024-11-01T00:00:00Z'),
      new Date('2044-11-01T00:00:00Z')
    )

    // Bounded (no runaway rule, no unbounded memory), but far more than 365.
    expect(occurrences.length).toBeGreaterThan(365)
    expect(occurrences.length).toBeLessThanOrEqual(2000)
  })
})

// ── 2. patchIcs must edit the master VEVENT, not the override ─────────────────

const OVERRIDE_FIRST_ICS_LINES = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Other Client//EN',
  'BEGIN:VEVENT',
  'UID:series-override-first',
  'DTSTAMP:20261101T080000Z',
  'RECURRENCE-ID:20261125T090000Z',
  'DTSTART:20261125T110000Z',
  'DTEND:20261125T120000Z',
  'SUMMARY:Override Title',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:series-override-first',
  'DTSTAMP:20261101T080000Z',
  'DTSTART:20241101T090000Z',
  'DTEND:20241101T100000Z',
  'RRULE:FREQ=DAILY',
  'SUMMARY:Series Title',
  'END:VEVENT',
  'END:VCALENDAR'
]

const OVERRIDE_FIRST_ICS = OVERRIDE_FIRST_ICS_LINES.join('\r\n')

/** Split an ICS string into its VEVENT blocks (BEGIN:VEVENT … END:VEVENT). */
function veventBlocks(icsText: string): string[] {
  return icsText
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((block) => `BEGIN:VEVENT${block.split('END:VEVENT')[0]}`)
}

describe('patchIcs – RECURRENCE-ID override listed before the master', () => {
  it('renames and re-rules the master, leaving the override untouched', async () => {
    const read = await parseIcsToEvent(OVERRIDE_FIRST_ICS, 'https://cloud.example/caldav/user/cal/')
    expect(read).not.toBeNull()

    const patched = await patchIcs(OVERRIDE_FIRST_ICS, {
      title: 'Renamed Series',
      start: read!.start,
      end: read!.end,
      rrule: 'FREQ=WEEKLY'
    })

    const blocks = veventBlocks(patched)
    expect(blocks).toHaveLength(2)

    const override = blocks.find((block) => block.includes('RECURRENCE-ID:20261125T090000Z'))
    const master = blocks.find((block) => block.includes('RRULE:FREQ=WEEKLY'))

    expect(override).toBeDefined()
    expect(master).toBeDefined()

    // The override keeps its own title and must not gain a series RRULE.
    expect(override).toContain('SUMMARY:Override Title')
    expect(override).not.toContain('RRULE')

    // The master carries the new title.
    expect(master).toContain('SUMMARY:Renamed Series')
  })

  it('replaces an existing override instead of appending a second one', async () => {
    const read = await parseIcsToEvent(OVERRIDE_FIRST_ICS, 'https://cloud.example/caldav/user/cal/')
    expect(read).not.toBeNull()

    const patched = await upsertRecurrenceOverrideIcs(OVERRIDE_FIRST_ICS, '2026-11-25T09:00:00Z', {
      title: 'Override Title v2',
      start: '2026-11-25 13:00',
      end: '2026-11-25 14:00'
    })

    const blocks = veventBlocks(patched)
    expect(blocks).toHaveLength(2)
    expect(patched.match(/RECURRENCE-ID/g)).toHaveLength(1)
    expect(patched).toContain('SUMMARY:Override Title v2')
    expect(patched).toContain('SUMMARY:Series Title')
  })
})

// ── 3. Colour normalisation (Apple namespace values reach the service) ────────

describe('normalizeDavColor', () => {
  it('strips an alpha channel', () => {
    expect(normalizeDavColor('#E5484DFF')).toBe('#E5484D')
    expect(normalizeDavColor('#0082c9FF')).toBe('#0082C9')
  })

  it('expands shorthand hex', () => {
    expect(normalizeDavColor('#abc')).toBe('#AABBCC')
  })

  it('keeps a plain hex colour', () => {
    expect(normalizeDavColor('#00677F')).toBe('#00677F')
  })

  it('falls back to the default for unparseable values', () => {
    expect(normalizeDavColor('')).toBe('#00677F')
    expect(normalizeDavColor(undefined)).toBe('#00677F')
    expect(normalizeDavColor('rebeccapurple')).toBe('#00677F')
    expect(normalizeDavColor('rgb(1,2,3)')).toBe('#00677F')
    expect(normalizeDavColor('#12345')).toBe('#00677F')
  })
})

// ── 4. Apple item-grouped vCard properties ───────────────────────────────────

const APPLE_GROUPED_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//macOS 14.4//EN',
  'UID:apple-grouped-1',
  'FN:Maria Example',
  'N:Example;Maria;;;',
  'item1.EMAIL;type=INTERNET:maria@example.org',
  'item1.X-ABLabel:Work',
  'item2.TEL:+491234',
  'item2.X-ABLabel:Mobile',
  'item1.ADR;type=HOME:;;Hauptstr. 5;Berlin;;10115;Germany',
  'item1.X-ABADR:de',
  'item3.URL;type=pref:https://maria.example.org',
  'item3.X-ABLabel:_$!<HomePage>!$_',
  'END:VCARD'
].join('\r\n')

function countLines(vcard: string, property: string): number {
  return vcard.split('\r\n').filter((line) =>
    line
      .replace(/^[A-Za-z0-9-]+\./, '')
      .toUpperCase()
      .startsWith(`${property}`)
  ).length
}

describe('Apple item-grouped vCard properties', () => {
  it('parses grouped EMAIL, TEL and ADR into the contact model', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)

    expect(contact.emails).toEqual([{ type: 'internet', value: 'maria@example.org' }])
    expect(contact.phones).toEqual([{ type: 'other', value: '+491234' }])
    expect(contact.addresses).toHaveLength(1)
    expect(contact.addresses[0]).toMatchObject({
      type: 'home',
      street: 'Hauptstr. 5',
      city: 'Berlin',
      postalCode: '10115',
      country: 'Germany'
    })
  })

  it('does not duplicate grouped managed properties when patching', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)
    contact.displayName = 'Maria Example-Müller'

    const patched = patchVcard(APPLE_GROUPED_VCARD, contact)

    expect(patched).toContain('FN:Maria Example-Müller')
    expect(countLines(patched, 'EMAIL')).toBe(1)
    expect(countLines(patched, 'TEL')).toBe(1)
    expect(countLines(patched, 'ADR')).toBe(1)

    // Apple's label linkage survives because the unchanged lines are kept verbatim.
    expect(patched).toContain('item1.X-ABLabel:Work')
    expect(patched).toContain('item1.X-ABADR:de')
    expect(patched).toContain('item3.X-ABLabel:_$!<HomePage>!$_')
    expect(patched).toContain('item3.URL;type=pref:https://maria.example.org')

    // And the patched card still parses back to the same contact data.
    const reparsed = parseVcard(patched)
    expect(reparsed.emails).toEqual([{ type: 'internet', value: 'maria@example.org' }])
    expect(reparsed.phones).toEqual([{ type: 'other', value: '+491234' }])
    expect(reparsed.addresses).toHaveLength(1)
  })

  it('rewrites a changed grouped property exactly once', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)
    contact.emails = [{ type: 'internet', value: 'maria@new.example.org' }]
    contact.phones = [{ type: 'cell', value: '+49999' }]

    const patched = patchVcard(APPLE_GROUPED_VCARD, contact)

    expect(countLines(patched, 'EMAIL')).toBe(1)
    expect(countLines(patched, 'TEL')).toBe(1)
    expect(patched).toContain('maria@new.example.org')
    expect(patched).toContain('+49999')
    expect(patched).not.toContain('maria@example.org')
    expect(patched).not.toContain('+491234')
  })
})
