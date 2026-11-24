/**
 * Multiple VALARM reminders (RFC 5545 §3.6.6): the UI models reminders as
 * ACTION:DISPLAY alarms and must round-trip any number of them while leaving
 * non-DISPLAY alarms from other clients untouched.
 */
import { describe, expect, it } from 'vitest'

import { buildIcs, parseIcsToEvent, patchIcs } from '../../src/composables/useCalendarService'

describe('multiple reminders', () => {
  it('buildIcs emits one DISPLAY VALARM per reminder', async () => {
    const ics = await buildIcs({
      id: 'multi-reminder-1',
      title: 'Standup',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:30',
      reminders: [15, 60, 1440]
    })

    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3)
    expect(ics).toContain('TRIGGER:-PT15M')
    expect(ics).toContain('TRIGGER:-PT1H')
    expect(ics).toContain('TRIGGER:-PT24H')
  })

  it('round-trips all reminders through parseIcsToEvent', async () => {
    const ics = await buildIcs({
      id: 'multi-reminder-2',
      title: 'Standup',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:30',
      reminders: [5, 30]
    })

    const event = await parseIcsToEvent(ics, 'cal-1')
    expect(event?.reminders).toEqual([5, 30])
    // Legacy single-value field mirrors the first reminder.
    expect(event?.reminder).toBe(5)
  })

  it('patchIcs replaces DISPLAY alarms and preserves a foreign EMAIL alarm', async () => {
    const rawIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Thunderbird//EN',
      'BEGIN:VEVENT',
      'UID:multi-reminder-3',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260607T090000',
      'DTEND:20260607T093000',
      'SUMMARY:Original',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT10M',
      'DESCRIPTION:Old display alarm',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'TRIGGER:-PT60M',
      'DESCRIPTION:Email reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const patched = await patchIcs(rawIcs, {
      title: 'Updated',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:30',
      reminders: [15, 30]
    })

    // The two requested DISPLAY alarms exist…
    expect(patched.match(/BEGIN:VALARM/g)).toHaveLength(3)
    expect(patched).toContain('TRIGGER:-PT15M')
    expect(patched).toContain('TRIGGER:-PT30M')
    // …the stale DISPLAY alarm is gone…
    expect(patched).not.toContain('TRIGGER:-PT10M')
    // …and the foreign EMAIL alarm survives.
    expect(patched).toContain('ACTION:EMAIL')
    expect(patched).toContain('Email reminder')
  })

  it('patchIcs with an empty reminder list clears only DISPLAY alarms', async () => {
    const rawIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Thunderbird//EN',
      'BEGIN:VEVENT',
      'UID:multi-reminder-4',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260607T090000',
      'DTEND:20260607T093000',
      'SUMMARY:Original',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT10M',
      'DESCRIPTION:Display alarm',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'TRIGGER:-PT60M',
      'DESCRIPTION:Email reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const patched = await patchIcs(rawIcs, {
      title: 'Updated',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:30',
      reminders: []
    })

    expect(patched.match(/BEGIN:VALARM/g)).toHaveLength(1)
    expect(patched).not.toContain('TRIGGER:-PT10M')
    expect(patched).toContain('ACTION:EMAIL')
  })
})
