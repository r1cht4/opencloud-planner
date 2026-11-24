import { describe, expect, it } from 'vitest'
import {
  countIcsProperties,
  duplicateKey,
  findDuplicateEvents
} from '../../src/tools/eventDuplicates'
import type { CalendarEvent } from '../../src/types'

const CAL = 'https://cloud.example/caldav/user-1/personal/'

function ics(lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...lines,
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function vevent(uid: string, extra: string[] = []): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T100000Z',
    'DTSTART:20260301T090000Z',
    'DTEND:20260301T100000Z',
    'SUMMARY:Standup',
    ...extra,
    'END:VEVENT'
  ]
}

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: 'Standup',
    start: '2026-03-01 09:00',
    end: '2026-03-01 10:00',
    calendarId: CAL,
    href: `${CAL}${overrides.id}.ics`,
    etag: `"${overrides.id}"`,
    ...overrides
  }
}

describe('findDuplicateEvents', () => {
  it('groups identical events', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', rawIcs: ics(vevent('a')) }),
      event({ id: 'b', rawIcs: ics(vevent('b')) }),
      event({ id: 'c', title: 'Retro', rawIcs: ics(vevent('c', ['SUMMARY:Retro'])) })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].keep.id).toBe('a')
    expect(groups[0].remove.map((e) => e.id)).toEqual(['b'])
  })

  it('different start not grouped', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a' }),
      event({ id: 'b', start: '2026-03-01 09:15' })
    ])

    expect(groups).toEqual([])
  })

  it('ignores case and surrounding spaces in the summary', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', title: 'Standup' }),
      event({ id: 'b', title: '  standup ' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].remove.map((e) => e.id)).toEqual(['b'])
  })

  it('keeps richer event', () => {
    // Richer = more content lines (ATTENDEE/ORGANIZER/X-props); location and
    // description stay identical so the two are still duplicates.
    const plain = event({ id: 'plain', rawIcs: ics(vevent('plain')) })
    const rich = event({
      id: 'rich',
      rawIcs: ics(
        vevent('rich', [
          'ORGANIZER:mailto:lead@example.com',
          'ATTENDEE:mailto:maria@example.com',
          'X-CUSTOM:extra'
        ])
      )
    })

    // Order must not matter: the richer copy wins even when it comes second.
    expect(findDuplicateEvents([plain, rich])[0].keep.id).toBe('rich')
    expect(findDuplicateEvents([rich, plain])[0].keep.id).toBe('rich')
    expect(countIcsProperties(rich.rawIcs)).toBeGreaterThan(countIcsProperties(plain.rawIcs))
  })

  it('keeps the earliest DTSTAMP when both copies are equally rich', () => {
    const older = event({
      id: 'older',
      rawIcs: ics(
        vevent('older').map((line) => line.replace('20260101T100000Z', '20250101T100000Z'))
      )
    })
    const newer = event({ id: 'newer', rawIcs: ics(vevent('newer')) })

    expect(findDuplicateEvents([newer, older])[0]).toMatchObject({
      keep: { id: 'older' },
      remove: [{ id: 'newer' }]
    })
  })

  it('recurring masters with same RRULE grouped, overrides untouched', () => {
    const rrule = 'FREQ=WEEKLY'
    const masterA = event({
      id: 'series-a',
      rrule,
      rawIcs: ics(vevent('series-a', [`RRULE:${rrule}`]))
    })
    const masterB = event({
      id: 'series-b',
      rrule,
      rawIcs: ics(vevent('series-b', [`RRULE:${rrule}`]))
    })
    // Expanded occurrence + RECURRENCE-ID override of the kept series.
    const occurrence = event({ id: 'series-a_20260308', recurringEventId: 'series-a', rrule })
    const override = event({
      id: 'series-a',
      recurrenceId: '20260308T090000Z',
      rrule,
      rawIcs: ics([
        ...vevent('series-a', ['RECURRENCE-ID:20260308T090000Z']),
        ...vevent('series-a')
      ])
    })

    const groups = findDuplicateEvents([masterA, masterB, occurrence, override])

    expect(groups).toHaveLength(1)
    expect(groups[0].keep.id).toBe('series-a')
    expect(groups[0].remove.map((e) => e.id)).toEqual(['series-b'])
  })

  it('does not group events with a different RRULE', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', rrule: 'FREQ=WEEKLY', rawIcs: ics(vevent('a', ['RRULE:FREQ=WEEKLY'])) }),
      event({ id: 'b', rrule: 'FREQ=DAILY', rawIcs: ics(vevent('b', ['RRULE:FREQ=DAILY'])) })
    ])

    expect(groups).toEqual([])
  })
})

describe('duplicateKey', () => {
  it('is summary|start|end|rrule|location|description, text normalised', () => {
    expect(
      duplicateKey(
        event({
          id: 'a',
          title: ' Standup ',
          rrule: 'FREQ=WEEKLY',
          location: 'Room  1',
          description: 'Daily\n sync'
        })
      )
    ).toBe('standup|2026-03-01 09:00|2026-03-01 10:00|FREQ=WEEKLY|room 1|daily sync')
  })
})

describe('location and description are part of the identity', () => {
  it('same title/time but different LOCATION → no group', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', location: 'Room 1' }),
      event({ id: 'b', location: 'Room 2' })
    ])
    expect(groups).toEqual([])
  })

  it('same title/time but different DESCRIPTION → no group', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', description: 'Daily sync' }),
      event({ id: 'b', description: 'Weekly sync' })
    ])
    expect(groups).toEqual([])
  })

  it('location/description equal after normalisation → still grouped', () => {
    const groups = findDuplicateEvents([
      event({ id: 'a', location: 'Room 1', description: 'Daily   sync' }),
      event({ id: 'b', location: ' room 1 ', description: 'daily sync' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].remove.map((e) => e.id)).toEqual(['b'])
  })
})

describe('countIcsProperties', () => {
  it('counts the content lines of the master VEVENT only', () => {
    const raw = ics([
      ...vevent('a', ['LOCATION:Room 1']),
      ...vevent('a', ['RECURRENCE-ID:20260308T090000Z'])
    ])
    // UID, DTSTAMP, DTSTART, DTEND, SUMMARY, LOCATION
    expect(countIcsProperties(raw)).toBe(6)
    expect(countIcsProperties(undefined)).toBe(0)
  })
})
