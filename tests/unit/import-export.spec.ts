import { describe, expect, it } from 'vitest'
import {
  collectionSlug,
  mergeIcsForExport,
  parseIcsImport,
  splitVcardsForImport
} from '../../src/composables/importExport'

const CRLF = '\r\n'

function ics(lines: string[]): string {
  return lines.join(CRLF) + CRLF
}

const BERLIN_VTZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:20260329T020000',
  'END:DAYLIGHT',
  'END:VTIMEZONE'
]

describe('parseIcsImport', () => {
  it('keeps a recurring master and its RECURRENCE-ID override in one import item', async () => {
    const text = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Foreign//Client//EN',
      'BEGIN:VEVENT',
      'UID:series-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T100000Z',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20260720T090000Z',
      'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series-1',
      'RECURRENCE-ID:20260713T090000Z',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260713T110000Z',
      'DTEND:20260713T120000Z',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:solo-2',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260708T090000Z',
      'DTEND:20260708T100000Z',
      'SUMMARY:Dentist',
      'END:VEVENT',
      'END:VCALENDAR'
    ])

    const { items } = await parseIcsImport(text)
    expect(items).toHaveLength(2)

    const series = items.find((i) => i.uid === 'series-1')!
    expect(series.ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(series.ics).toContain('RECURRENCE-ID:20260713T090000Z')
    expect(series.ics).toContain('EXDATE:20260720T090000Z')
    expect(series.summary).toBe('Standup')

    const solo = items.find((i) => i.uid === 'solo-2')!
    expect(solo.ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('preserves properties the UI does not model, verbatim', async () => {
    const text = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:rich-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T100000Z',
      'SUMMARY:Board meeting',
      'ORGANIZER;CN=Boss:mailto:boss@example.com',
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:dev@example.com',
      'CATEGORIES:WORK,IMPORTANT',
      'STATUS:CONFIRMED',
      'X-CUSTOM-PROP:keep-me',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT5M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ])

    const { items } = await parseIcsImport(text)
    expect(items).toHaveLength(1)
    const out = items[0].ics
    expect(out).toContain('ORGANIZER;CN=Boss:mailto:boss@example.com')
    expect(out).toContain('ATTENDEE;PARTSTAT=ACCEPTED:mailto:dev@example.com')
    expect(out).toContain('CATEGORIES:WORK,IMPORTANT')
    expect(out).toContain('STATUS:CONFIRMED')
    expect(out).toContain('X-CUSTOM-PROP:keep-me')
    expect(out.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(out).toContain('ACTION:EMAIL')
  })

  it('copies referenced VTIMEZONEs and drops METHOD', async () => {
    const text = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:PUBLISH',
      ...BERLIN_VTZ,
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'DTSTART:20261101T020000',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:tz-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260706T090000',
      'DTEND;TZID=Europe/Berlin:20260706T100000',
      'SUMMARY:Local meeting',
      'END:VEVENT',
      'END:VCALENDAR'
    ])

    const { items } = await parseIcsImport(text)
    const out = items[0].ics
    expect(out).toContain('TZID:Europe/Berlin')
    // Unreferenced zone is not dragged along; METHOD must not enter a CalDAV object
    expect(out).not.toContain('America/New_York')
    expect(out).not.toContain('METHOD:PUBLISH')
  })

  it('generates a UID only when the event has none; an unsafe UID is kept in the data', async () => {
    const text = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:urn:uuid:9f8e7d6c-1234-5678-abcd-000000000001',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T100000Z',
      'SUMMARY:Foreign uid',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260707T090000Z',
      'DTEND:20260707T100000Z',
      'SUMMARY:No uid',
      'END:VEVENT',
      'END:VCALENDAR'
    ])

    const { items } = await parseIcsImport(text)
    expect(items).toHaveLength(2)

    // The identity stays: an Apple/Google/Outlook UID is not replaced any more
    // (re-importing the same file must find "already exists", and iTIP/sync
    // keeps working). The URL-safe *resource name* is derived at PUT time.
    const foreign = items.find((item) => item.uid.includes('urn:uuid:'))!
    expect(foreign.ics).toContain('UID:urn:uuid:9f8e7d6c-1234-5678-abcd-000000000001')

    const generated = items.find((item) => !item.uid.includes('urn:uuid:'))!
    expect(generated.uid).toMatch(/^[A-Za-z0-9._@-]+$/)
    expect(generated.ics).toContain(`UID:${generated.uid}`)
  })

  it('groups and carries VTODO (and VJOURNAL) components, not only VEVENT', async () => {
    const text = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VTODO',
      'UID:todo-1',
      'DTSTAMP:20260101T000000Z',
      'SUMMARY:File taxes',
      'DUE:20260301T100000Z',
      'END:VTODO',
      'BEGIN:VTODO',
      'UID:shared-uid-1',
      'DTSTAMP:20260101T000000Z',
      'SUMMARY:Dual citizen',
      'DUE:20260401T100000Z',
      'END:VTODO',
      'BEGIN:VEVENT',
      'UID:shared-uid-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T100000Z',
      'SUMMARY:Dual citizen event',
      'END:VEVENT',
      'BEGIN:VJOURNAL',
      'UID:journal-1',
      'DTSTAMP:20260101T000000Z',
      'SUMMARY:Notes',
      'END:VJOURNAL',
      'END:VCALENDAR'
    ])

    const { items } = await parseIcsImport(text)

    // One item per UID, whatever the component type.
    expect(items.map((item) => item.uid).sort()).toEqual(['journal-1', 'shared-uid-1', 'todo-1'])

    const todo = items.find((item) => item.uid === 'todo-1')!
    expect(todo.ics).toContain('BEGIN:VTODO')
    expect(todo.ics).toContain('SUMMARY:File taxes')

    // A VTODO and a VEVENT sharing a UID stay in ONE resource (CalDAV stores
    // them together — without this a restore loses the task).
    const dual = items.find((item) => item.uid === 'shared-uid-1')!
    expect(dual.ics).toContain('BEGIN:VTODO')
    expect(dual.ics).toContain('BEGIN:VEVENT')

    const journal = items.find((item) => item.uid === 'journal-1')!
    expect(journal.ics).toContain('BEGIN:VJOURNAL')
  })

  it('handles concatenated VCALENDAR documents and reads X-WR-CALNAME', async () => {
    const doc = (uid: string, name?: string) =>
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...(name ? [`X-WR-CALNAME:${name}`] : []),
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'DTSTAMP:20260101T000000Z',
        'DTSTART:20260706T090000Z',
        'DTEND:20260706T100000Z',
        'SUMMARY:Evt',
        'END:VEVENT',
        'END:VCALENDAR'
      ])

    const { items, calendarName } = await parseIcsImport(doc('a-1', 'Team Calendar') + doc('b-2'))
    expect(items.map((i) => i.uid).sort()).toEqual(['a-1', 'b-2'])
    expect(calendarName).toBe('Team Calendar')
  })

  it('returns no items for junk input', async () => {
    const { items, calendarName } = await parseIcsImport('hello world, not a calendar')
    expect(items).toHaveLength(0)
    expect(calendarName).toBeNull()
  })
})

describe('mergeIcsForExport', () => {
  it('produces a single VCALENDAR with all events and deduplicated VTIMEZONEs', async () => {
    const raw = (uid: string) =>
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...BERLIN_VTZ,
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'DTSTAMP:20260101T000000Z',
        'DTSTART;TZID=Europe/Berlin:20260706T090000',
        'DTEND;TZID=Europe/Berlin:20260706T100000',
        `SUMMARY:Event ${uid}`,
        'END:VEVENT',
        'END:VCALENDAR'
      ])

    const out = await mergeIcsForExport([raw('e-1'), raw('e-2')], 'My Calendar')
    expect(out.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(out.match(/END:VCALENDAR/g)).toHaveLength(1)
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(out.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
    expect(out).toContain('X-WR-CALNAME:My Calendar')
    expect(out).toContain('SUMMARY:Event e-1')
    expect(out).toContain('SUMMARY:Event e-2')
  })

  it('keeps recurrence overrides stored alongside their master', async () => {
    const raw = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:series-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T100000Z',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series-1',
      'RECURRENCE-ID:20260713T090000Z',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260713T110000Z',
      'DTEND:20260713T120000Z',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
      'END:VCALENDAR'
    ])

    const out = await mergeIcsForExport([raw])
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(out).toContain('RECURRENCE-ID:20260713T090000Z')
  })
})

describe('mergeIcsForExport carries tasks', () => {
  it('keeps VTODO components, not only VEVENT', async () => {
    const todo = ics([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VTODO',
      'UID:todo-export-1',
      'DTSTAMP:20260101T000000Z',
      'SUMMARY:File taxes',
      'DUE:20260301T100000Z',
      'END:VTODO',
      'END:VCALENDAR'
    ])

    const merged = await mergeIcsForExport([todo], 'Exported')
    expect(merged).toContain('BEGIN:VTODO')
    expect(merged).toContain('SUMMARY:File taxes')
    expect(merged).toContain('X-WR-CALNAME:Exported')
  })
})

describe('splitVcardsForImport', () => {
  it('splits multiple cards and keeps unmodeled properties verbatim', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:card-1',
      'FN:Ada Lovelace',
      'N:Lovelace;Ada;;;',
      'X-SOCIALPROFILE;TYPE=twitter:https://twitter.com/ada',
      'item1.ADR;TYPE=HOME:;;1 Math Lane;London;;;UK',
      'item1.X-ABLabel:Home sweet home',
      'IMPP:xmpp:ada@example.com',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:card-2',
      'FN:Charles Babbage',
      'END:VCARD'
    ].join(CRLF)

    const items = splitVcardsForImport(text)
    expect(items).toHaveLength(2)
    expect(items[0].uid).toBe('card-1')
    expect(items[0].displayName).toBe('Ada Lovelace')
    expect(items[0].vcard).toContain('X-SOCIALPROFILE;TYPE=twitter:https://twitter.com/ada')
    expect(items[0].vcard).toContain('item1.X-ABLabel:Home sweet home')
    expect(items[0].vcard).toContain('IMPP:xmpp:ada@example.com')
    expect(items[1].uid).toBe('card-2')
  })

  it('injects a generated UID when missing; an unsafe UID is kept verbatim', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:No Uid',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:urn:uuid:9f8e7d6c-1234-5678-abcd-000000000002',
      'FN:Bad Uid',
      'END:VCARD'
    ].join('\n')

    const items = splitVcardsForImport(text)
    expect(items).toHaveLength(2)
    // Missing UID → generated and injected.
    expect(items[0].uid).toMatch(/^[A-Za-z0-9._@-]+$/)
    expect(items[0].vcard).toContain(`UID:${items[0].uid}`)
    // Unsafe UID → kept in the data (identity with the source); only the
    // resource name is derived at PUT time.
    expect(items[1].uid).toBe('urn:uuid:9f8e7d6c-1234-5678-abcd-000000000002')
    expect(items[1].vcard).toContain('UID:urn:uuid:9f8e7d6c-1234-5678-abcd-000000000002')
  })

  it('skips blocks without a name and junk input', () => {
    const text = ['BEGIN:VCARD', 'VERSION:3.0', 'UID:nameless', 'TEL:+491234', 'END:VCARD'].join(
      CRLF
    )

    expect(splitVcardsForImport(text)).toHaveLength(0)
    expect(splitVcardsForImport('not a vcard at all')).toHaveLength(0)
  })
})

describe('collectionSlug', () => {
  it('derives a URL-safe slug and falls back for empty input', () => {
    expect(collectionSlug('Team Calendar 2026')).toBe('team-calendar-2026')
    expect(collectionSlug('Geburtstage & Feiertage')).toBe('geburtstage-feiertage')
    expect(collectionSlug('   ')).toBe('collection')
    expect(collectionSlug('///')).toBe('collection')
  })
})
