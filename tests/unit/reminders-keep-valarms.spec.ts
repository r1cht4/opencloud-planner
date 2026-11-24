/**
 * Regression tests — `applyReminders` (via `patchIcs`) must keep existing
 * DISPLAY VALARMs whose trigger is unchanged, so ACKNOWLEDGED / X-MOZ-LASTACK /
 * alarm UIDs from other clients (Thunderbird re-fires dismissed reminders
 * otherwise) survive a save.
 */
import { describe, expect, it } from 'vitest'
import { patchIcs } from '../../src/composables/useCalendarService'

const RAW_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Thunderbird//Calendar//EN',
  'BEGIN:VEVENT',
  'UID:alarm-uid-001',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260601T090000',
  'DTEND:20260601T100000',
  'SUMMARY:Standup',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Standup',
  'UID:alarm-abc-123',
  'ACKNOWLEDGED:20260601T080000Z',
  'X-MOZ-LASTACK:20260601T080000Z',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:EMAIL',
  'TRIGGER:-PT60M',
  'DESCRIPTION:Email reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

function valarms(ics: string): string[] {
  return ics
    .split(/\r?\nBEGIN:VALARM\r?\n/)
    .slice(1)
    .map((block) => block.split(/END:VALARM/)[0])
}

describe('patchIcs keeps unchanged VALARMs', () => {
  it('an unchanged trigger keeps the original VALARM verbatim (ACKNOWLEDGED, X-MOZ-LASTACK, UID)', async () => {
    const result = await patchIcs(RAW_ICS, {
      title: 'Standup (renamed)',
      start: '2026-06-01 09:00',
      end: '2026-06-01 10:00',
      reminders: [15]
    })

    const alarms = valarms(result)
    expect(alarms).toHaveLength(2) // DISPLAY (kept) + EMAIL (untouched)
    const display = alarms.find((a) => a.includes('ACTION:DISPLAY'))!
    expect(display).toContain('TRIGGER:-PT15M')
    expect(display).toContain('UID:alarm-abc-123')
    expect(display).toContain('ACKNOWLEDGED:20260601T080000Z')
    expect(display).toContain('X-MOZ-LASTACK:20260601T080000Z')
    // The kept alarm is not rebuilt: its description is the original one.
    expect(display).toContain('DESCRIPTION:Standup')
    expect(display).not.toContain('DESCRIPTION:Standup (renamed)')
    // The non-DISPLAY alarm survives untouched.
    expect(alarms.find((a) => a.includes('ACTION:EMAIL'))).toContain('TRIGGER:-PT60M')
  })

  it('a changed reminder replaces only that VALARM and creates the new one', async () => {
    const result = await patchIcs(RAW_ICS, {
      title: 'Standup',
      start: '2026-06-01 09:00',
      end: '2026-06-01 10:00',
      reminders: [30]
    })

    const alarms = valarms(result)
    const display = alarms.filter((a) => a.includes('ACTION:DISPLAY'))
    expect(display).toHaveLength(1)
    expect(display[0]).toContain('TRIGGER:-PT30M')
    expect(display[0]).not.toContain('X-MOZ-LASTACK')
    // EMAIL alarm untouched.
    expect(alarms.find((a) => a.includes('ACTION:EMAIL'))).toContain('TRIGGER:-PT60M')
  })

  it('clearing reminders ([]) removes the DISPLAY alarm but keeps EMAIL', async () => {
    const result = await patchIcs(RAW_ICS, {
      title: 'Standup',
      start: '2026-06-01 09:00',
      end: '2026-06-01 10:00',
      reminders: []
    })

    const alarms = valarms(result)
    expect(alarms).toHaveLength(1)
    expect(alarms[0]).toContain('ACTION:EMAIL')
  })

  it('a mix of kept and new reminders keeps the matching one and adds the other', async () => {
    const result = await patchIcs(RAW_ICS, {
      title: 'Standup',
      start: '2026-06-01 09:00',
      end: '2026-06-01 10:00',
      reminders: [60, 15]
    })

    const alarms = valarms(result)
    const display = alarms.filter((a) => a.includes('ACTION:DISPLAY'))
    expect(display).toHaveLength(2)
    // The -PT15M alarm is the ORIGINAL one (X-MOZ-LASTACK still there).
    const kept = display.find((a) => a.includes('TRIGGER:-PT15M'))!
    expect(kept).toContain('X-MOZ-LASTACK:20260601T080000Z')
    // The 60-minute reminder is freshly created (no X-MOZ-LASTACK); ical.js
    // serialises -PT60M as -PT1H.
    const created = display.find((a) => a !== kept)!
    expect(created).toContain('TRIGGER:-PT1H')
    expect(created).not.toContain('X-MOZ-LASTACK')
  })

  it('undefined reminders leave all VALARMs untouched', async () => {
    const result = await patchIcs(RAW_ICS, {
      title: 'Standup (renamed)',
      start: '2026-06-01 09:00',
      end: '2026-06-01 10:00'
      // no reminders key at all
    })

    expect(valarms(result)).toHaveLength(2)
    expect(result).toContain('X-MOZ-LASTACK:20260601T080000Z')
  })
})
