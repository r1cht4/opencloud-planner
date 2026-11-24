/**
 * Round-trip safety against data authored by *other* clients.
 *
 * Both bugs we hit in practice (the +2h move drift and editable birthdays) came
 * from foreign-origin data, not from events the app created itself. The app's own
 * e2e creates events in its own (UTC) browser, so it can't surface these. These
 * fixtures are deliberately authored the way Thunderbird / Apple Contacts write
 * them, and are pushed through the real read → edit → read cycle.
 */
import { describe, expect, it } from 'vitest'

import { parseIcsToEvent, patchIcs } from '../../src/composables/useCalendarService'
import { parseVcard, patchVcard } from '../../src/composables/useContactsService'

// ── Thunderbird-authored VEVENT: full VTIMEZONE, ORGANIZER/ATTENDEE, X-MOZ-*, VALARM ──
const THUNDERBIRD_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'CREATED:20260101T080000Z',
  'LAST-MODIFIED:20260101T080000Z',
  'DTSTAMP:20260101T080000Z',
  'UID:tb-event-1@example.org',
  'SUMMARY:Team Sync',
  'DTSTART;TZID=Europe/Berlin:20260615T140000',
  'DTEND;TZID=Europe/Berlin:20260615T150000',
  'ORGANIZER;CN=Alice:mailto:alice@example.org',
  'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.org',
  'X-MOZ-GENERATION:3',
  'X-MOZ-LASTACK:20260101T080000Z',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('foreign VEVENT (Thunderbird, VTIMEZONE) round-trip', () => {
  it('reads the zoned start to the same instant as its UTC equivalent', async () => {
    // 14:00 Europe/Berlin in June (CEST, UTC+2) == 12:00 UTC.
    const read = await parseIcsToEvent(THUNDERBIRD_ICS, 'cal-1')
    const utcEquiv = await parseIcsToEvent(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:x',
        'BEGIN:VEVENT',
        'UID:u',
        'DTSTAMP:20260101T080000Z',
        'DTSTART:20260615T120000Z',
        'DTEND:20260615T130000Z',
        'SUMMARY:X',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n'),
      'cal-1'
    )
    expect(read?.start).toBe(utcEquiv?.start)
  })

  it('renames without drifting the time and preserves VTIMEZONE/ORGANIZER/ATTENDEE/X-MOZ', async () => {
    const read1 = await parseIcsToEvent(THUNDERBIRD_ICS, 'cal-1')
    expect(read1).not.toBeNull()

    const patched = await patchIcs(THUNDERBIRD_ICS, {
      title: 'Team Sync (renamed)',
      start: read1!.start,
      end: read1!.end
    })

    // Foreign data the UI does not model must survive the edit.
    expect(patched).toContain('BEGIN:VTIMEZONE')
    expect(patched).toContain('ORGANIZER;CN=Alice:mailto:alice@example.org')
    expect(patched).toContain('ATTENDEE;CN=Bob')
    expect(patched).toContain('X-MOZ-GENERATION:3')
    expect(patched).toContain('SUMMARY:Team Sync (renamed)')

    // No time drift across the edit.
    const read2 = await parseIcsToEvent(patched, 'cal-1')
    expect(read2?.start).toBe(read1!.start)
    expect(read2?.end).toBe(read1!.end)
  })
})

// ── Apple Contacts-authored vCard: item-grouped props + X-AB labels ──
const APPLE_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//macOS 14.4//EN',
  'UID:apple-contact-1',
  'FN:Maria Schmidt',
  'N:Schmidt;Maria;;;',
  'EMAIL;type=INTERNET;type=HOME;type=pref:maria@example.org',
  'TEL;type=CELL;type=VOICE;type=pref:+49 170 1234567',
  'item1.ADR;type=HOME;type=pref:;;Hauptstr. 5;Berlin;;10115;Germany',
  'item1.X-ABADR:de',
  'item2.URL;type=pref:https://maria.example.org',
  'item2.X-ABLabel:_$!<HomePage>!$_',
  'X-ABShowAs:COMPANY',
  'END:VCARD'
].join('\r\n')

describe('foreign vCard (Apple, item groups) round-trip', () => {
  it('renames while preserving item-grouped properties and X-AB labels verbatim', () => {
    const contact = parseVcard(APPLE_VCARD)
    contact.displayName = 'Maria Schmidt-Müller'

    const patched = patchVcard(APPLE_VCARD, contact)

    expect(patched).toContain('FN:Maria Schmidt-Müller')
    // Apple's item-group structure and labels are not modelled by the UI; keep them.
    expect(patched).toContain('item1.ADR;type=HOME;type=pref:;;Hauptstr. 5;Berlin;;10115;Germany')
    expect(patched).toContain('item1.X-ABADR:de')
    expect(patched).toContain('item2.URL;type=pref:https://maria.example.org')
    expect(patched).toContain('item2.X-ABLabel:_$!<HomePage>!$_')
    expect(patched).toContain('X-ABShowAs:COMPANY')
    expect(patched).toContain('UID:apple-contact-1')
  })

  // Apple item-groups are also used for *managed* properties
  // (item1.EMAIL / item2.TEL / item1.ADR). They must be visible in the UI and
  // must not be written twice (once rebuilt from the model, once preserved).
  const APPLE_GROUPED_VCARD = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//Apple Inc.//macOS 14.4//EN',
    'UID:apple-grouped-1',
    'FN:Maria Schmidt',
    'N:Schmidt;Maria;;;',
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

  const managedLines = (vcard: string, property: string) =>
    vcard.split('\r\n').filter((line) =>
      line
        .replace(/^[A-Za-z0-9-]+\./, '')
        .toUpperCase()
        .startsWith(property)
    )

  it('shows grouped EMAIL/TEL/ADR in the parsed contact', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)

    expect(contact.emails.map((email) => email.value)).toEqual(['maria@example.org'])
    expect(contact.phones.map((phone) => phone.value)).toEqual(['+491234'])
    expect(contact.addresses).toHaveLength(1)
    expect(contact.addresses[0]).toMatchObject({
      city: 'Berlin',
      postalCode: '10115',
      country: 'Germany'
    })
  })

  it('patches without duplicating managed lines and keeps the group labels', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)
    contact.displayName = 'Maria Schmidt-Müller'
    contact.organization = 'Example GmbH'

    const patched = patchVcard(APPLE_GROUPED_VCARD, contact)

    expect(managedLines(patched, 'EMAIL')).toHaveLength(1)
    expect(managedLines(patched, 'TEL')).toHaveLength(1)
    expect(managedLines(patched, 'ADR')).toHaveLength(1)
    expect(patched).toContain('item1.X-ABLabel:Work')
    expect(patched).toContain('item2.X-ABLabel:Mobile')
    expect(patched).toContain('item1.X-ABADR:de')
    expect(patched).toContain('item3.URL;type=pref:https://maria.example.org')

    // Still parses back to the same values (round-trip through the group form).
    const reparsed = parseVcard(patched)
    expect(reparsed.emails).toEqual(contact.emails)
    expect(reparsed.phones).toEqual(contact.phones)
    expect(reparsed.addresses).toHaveLength(1)
  })

  it('rewrites a changed grouped value once and drops the stale line', () => {
    const contact = parseVcard(APPLE_GROUPED_VCARD)
    contact.emails = [{ type: 'internet', value: 'maria@new.example.org' }]

    const patched = patchVcard(APPLE_GROUPED_VCARD, contact)

    expect(managedLines(patched, 'EMAIL')).toHaveLength(1)
    expect(patched).toContain('maria@new.example.org')
    expect(patched).not.toContain('maria@example.org')
    // The orphaned label line is unmanaged and therefore preserved verbatim.
    expect(patched).toContain('item1.X-ABLabel:Work')
  })
})
