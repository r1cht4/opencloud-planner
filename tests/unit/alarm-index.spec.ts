import { describe, expect, it } from 'vitest'
import { collectDueAlarms } from '../../src/reminders/alarmIndex'
import type { CalendarEvent, Task } from '../../src/types'

const CAL = 'https://cloud.example/caldav/user-1/personal/'

function vcalendar(body: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...body, 'END:VCALENDAR'].join(
    '\r\n'
  )
}

function valarm(trigger: string, extra: string[] = []): string[] {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER${trigger}`,
    'DESCRIPTION:Reminder',
    ...extra,
    'END:VALARM'
  ]
}

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: 'Untitled',
    start: '2026-12-01 15:00',
    end: '2026-12-01 16:00',
    calendarId: CAL,
    ...overrides
  }
}

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: 'Untitled task',
    priority: 0,
    status: 'NEEDS-ACTION',
    percentComplete: 0,
    calendarId: CAL,
    ...overrides
  }
}

describe('collectDueAlarms', () => {
  it('relative to START −15 min', async () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:meeting-1',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261201T150000',
      'DTEND:20261201T160000',
      'SUMMARY:Team sync',
      ...valarm(':-PT15M'),
      'END:VEVENT'
    ])

    const alarms = await collectDueAlarms(
      [event({ id: 'meeting-1', title: 'Team sync', rawIcs: ics, href: `${CAL}meeting-1.ics` })],
      [],
      new Date(2026, 11, 1, 10, 0),
      new Date(2026, 11, 1, 18, 0)
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 1, 14, 45))
    expect(alarms[0].key).toBe(
      `meeting-1|single|-900:DEFAULT|${new Date(2026, 11, 1, 14, 45).toISOString()}`
    )
    expect(alarms[0].kind).toBe('event')
    expect(alarms[0].title).toBe('Team sync')
    expect(alarms[0].start).toEqual(new Date(2026, 11, 1, 15, 0))
    expect(alarms[0].href).toBe(`${CAL}meeting-1.ics`)
  })

  it('relative to END', async () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:workshop-1',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261201T150000',
      'DTEND:20261201T160000',
      'SUMMARY:Workshop',
      ...valarm(';RELATED=END:-PT30M'),
      'END:VEVENT'
    ])

    const alarms = await collectDueAlarms(
      [event({ id: 'workshop-1', title: 'Workshop', rawIcs: ics })],
      [],
      new Date(2026, 11, 1, 10, 0),
      new Date(2026, 11, 1, 18, 0)
    )

    expect(alarms).toHaveLength(1)
    // 16:00 end − 30 min
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 1, 15, 30))
    expect(alarms[0].key).toBe(
      `workshop-1|single|-1800:END|${new Date(2026, 11, 1, 15, 30).toISOString()}`
    )
  })

  it('absolute trigger', async () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:flight-1',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261201T150000',
      'DTEND:20261201T160000',
      'SUMMARY:Flight',
      ...valarm(';VALUE=DATE-TIME:20261201T090000Z'),
      'END:VEVENT'
    ])

    const alarms = await collectDueAlarms(
      [event({ id: 'flight-1', title: 'Flight', rawIcs: ics })],
      [],
      new Date(Date.UTC(2026, 11, 1, 0, 0)),
      new Date(Date.UTC(2026, 11, 1, 23, 0))
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt.toISOString()).toBe('2026-12-01T09:00:00.000Z')
    expect(alarms[0].key).toBe(
      `flight-1|single|ABS:2026-12-01T09:00:00.000Z|${new Date('2026-12-01T09:00:00Z').toISOString()}`
    )
  })

  it('all-day event −1 day 09:00', async () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:holiday-1',
      'DTSTAMP:20261120T080000Z',
      'DTSTART;VALUE=DATE:20261201',
      'DTEND;VALUE=DATE:20261202',
      'SUMMARY:Holiday',
      // All-day anchors are local midnight, so -15 h lands on 09:00 the day before.
      ...valarm(':-PT15H'),
      'END:VEVENT'
    ])

    const alarms = await collectDueAlarms(
      [
        event({
          id: 'holiday-1',
          title: 'Holiday',
          start: '2026-12-01',
          end: '2026-12-02',
          isAllDay: true,
          rawIcs: ics
        })
      ],
      [],
      new Date(2026, 10, 30, 0, 0),
      new Date(2026, 11, 1, 0, 0)
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 10, 30, 9, 0))
    expect(alarms[0].start).toEqual(new Date(2026, 11, 1, 0, 0))
  })

  it('daily recurring: only occurrences in window', async () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:standup-1',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261201T090000',
      'DTEND:20261201T093000',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Standup',
      ...valarm(':-PT15M'),
      'END:VEVENT'
    ])

    const alarms = await collectDueAlarms(
      [
        event({
          id: 'standup-1',
          title: 'Standup',
          start: '2026-12-01 09:00',
          end: '2026-12-01 09:30',
          rrule: 'FREQ=DAILY',
          rawIcs: ics
        })
      ],
      [],
      new Date(2026, 11, 1, 0, 0),
      new Date(2026, 11, 2, 0, 0)
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 1, 8, 45))
    // Recurring occurrences keep their own key (master uid | occurrence | trigger | fire time).
    expect(alarms[0].key).toBe(
      `standup-1|2026-12-01T09:00:00|-900:DEFAULT|${new Date(2026, 11, 1, 8, 45).toISOString()}`
    )
  })

  it('task without VALARM: no reminder by default', async () => {
    const alarms = await collectDueAlarms(
      [],
      [task({ id: 't-1', title: 'Send invoice', due: '2026-12-03 10:00' })],
      new Date(2026, 11, 3, 9, 0),
      new Date(2026, 11, 3, 11, 0)
    )

    // An implicit reminder per dated task would flood users, so it is opt-in.
    expect(alarms).toEqual([])
  })

  it('task without VALARM + default 30 → fires 30 min before DUE', async () => {
    const alarms = await collectDueAlarms(
      [],
      [task({ id: 't-1', title: 'Send invoice', due: '2026-12-03 10:00' })],
      new Date(2026, 11, 3, 9, 0),
      new Date(2026, 11, 3, 11, 0),
      30
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 3, 9, 30))
    expect(alarms[0].kind).toBe('task')
    expect(alarms[0].key).toBe(
      `t-1|single|-1800:DEFAULT|${new Date(2026, 11, 3, 9, 30).toISOString()}`
    )
    expect(alarms[0].start).toEqual(new Date(2026, 11, 3, 10, 0))
  })

  it('task without VALARM + default 0 → fires at DUE', async () => {
    const alarms = await collectDueAlarms(
      [],
      [task({ id: 't-3', title: 'Call back', due: '2026-12-03 10:00' })],
      new Date(2026, 11, 3, 9, 0),
      new Date(2026, 11, 3, 11, 0),
      0
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 3, 10, 0))
    expect(alarms[0].key).toBe(`t-3|single|0:DEFAULT|${new Date(2026, 11, 3, 10, 0).toISOString()}`)
  })

  it('task with VALARM ignores the default', async () => {
    const ics = vcalendar([
      'BEGIN:VTODO',
      'UID:t-4',
      'DTSTAMP:20261120T080000Z',
      'SUMMARY:Book the room',
      'DUE:20261203T100000',
      ...valarm(':-PT1H'),
      'END:VTODO'
    ])

    const alarms = await collectDueAlarms(
      [],
      [task({ id: 't-4', title: 'Book the room', due: '2026-12-03 10:00', rawIcs: ics })],
      new Date(2026, 11, 3, 8, 0),
      new Date(2026, 11, 3, 12, 0),
      30
    )

    // Only the client's own alarm fires; the default must not add a second one.
    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 3, 9, 0))
    expect(alarms[0].key).toBe(
      `t-4|single|-3600:DEFAULT|${new Date(2026, 11, 3, 9, 0).toISOString()}`
    )
  })

  it('task DUE alarm (VALARM written by the client)', async () => {
    const ics = vcalendar([
      'BEGIN:VTODO',
      'UID:t-2',
      'DTSTAMP:20261120T080000Z',
      'SUMMARY:Prepare slides',
      'DUE:20261203T100000',
      ...valarm(':-PT1H'),
      'END:VTODO'
    ])

    const alarms = await collectDueAlarms(
      [],
      [task({ id: 't-2', title: 'Prepare slides', due: '2026-12-03 10:00', rawIcs: ics })],
      new Date(2026, 11, 3, 8, 0),
      new Date(2026, 11, 3, 12, 0)
    )

    expect(alarms).toHaveLength(1)
    expect(alarms[0].fireAt).toEqual(new Date(2026, 11, 3, 9, 0))
  })

  it('skips completed tasks and items outside the window', async () => {
    const alarms = await collectDueAlarms(
      [
        event({
          id: 'later-1',
          start: '2026-12-05 15:00',
          end: '2026-12-05 16:00',
          reminders: [15]
        })
      ],
      [
        task({
          id: 'done-1',
          title: 'Done already',
          due: '2026-12-03 10:00',
          status: 'COMPLETED',
          percentComplete: 100
        })
      ],
      new Date(2026, 11, 1, 0, 0),
      new Date(2026, 11, 2, 0, 0)
    )

    expect(alarms).toEqual([])
  })

  it('falls back to the model reminders when no VALARM is parseable', async () => {
    const alarms = await collectDueAlarms(
      [event({ id: 'legacy-1', title: 'Legacy', reminders: [10, 60] })],
      [],
      new Date(2026, 11, 1, 10, 0),
      new Date(2026, 11, 1, 18, 0)
    )

    expect(alarms.map((alarm) => alarm.fireAt)).toEqual([
      new Date(2026, 11, 1, 14, 0),
      new Date(2026, 11, 1, 14, 50)
    ])
  })

  // ── The alarm key includes the fire time ───────────────────────────────────

  it('a reminder whose item moved to a later time gets a new key', async () => {
    const at = (hour: number) =>
      vcalendar([
        'BEGIN:VEVENT',
        'UID:moved-1',
        'DTSTAMP:20261120T080000Z',
        `DTSTART:20261202T${String(hour).padStart(2, '0')}0000`,
        `DTEND:20261202T${String(hour + 1).padStart(2, '0')}0000`,
        'SUMMARY:Moved meeting',
        ...valarm(':-PT15M'),
        'END:VEVENT'
      ])

    const early = await collectDueAlarms(
      [
        event({
          id: 'moved-1',
          title: 'Moved meeting',
          rawIcs: at(10),
          start: '2026-12-02 10:00',
          end: '2026-12-02 11:00'
        })
      ],
      [],
      new Date(2026, 11, 2, 9, 0),
      new Date(2026, 11, 2, 14, 0)
    )
    const later = await collectDueAlarms(
      [
        event({
          id: 'moved-1',
          title: 'Moved meeting',
          rawIcs: at(14),
          start: '2026-12-02 14:00',
          end: '2026-12-02 15:00'
        })
      ],
      [],
      new Date(2026, 11, 2, 9, 0),
      new Date(2026, 11, 2, 14, 0)
    ) // fires in the window? 13:45 ≤ 14:00 yes

    expect(early[0].fireAt).toEqual(new Date(2026, 11, 2, 9, 45))
    expect(later[0].fireAt).toEqual(new Date(2026, 11, 2, 13, 45))
    // The 7-day "shown" log keyed the old alarm; the moved one must not be
    // suppressed by it, so the fire time is part of the key.
    expect(early[0].key).not.toBe(later[0].key)
    expect(later[0].key).toContain(new Date(2026, 11, 2, 13, 45).toISOString())
  })

  it('the same applies to tasks (due moved → new key)', async () => {
    const at = (hour: number) =>
      vcalendar([
        'BEGIN:VTODO',
        'UID:t-moved-1',
        'DTSTAMP:20261120T080000Z',
        'SUMMARY:Moved task',
        `DUE:20261203T${String(hour).padStart(2, '0')}0000`,
        ...valarm(':-PT30M'),
        'END:VTODO'
      ])

    const early = await collectDueAlarms(
      [],
      [task({ id: 't-moved-1', title: 'Moved task', due: '2026-12-03 10:00', rawIcs: at(10) })],
      new Date(2026, 11, 3, 8, 0),
      new Date(2026, 11, 3, 14, 0)
    )
    const later = await collectDueAlarms(
      [],
      [task({ id: 't-moved-1', title: 'Moved task', due: '2026-12-03 14:00', rawIcs: at(14) })],
      new Date(2026, 11, 3, 8, 0),
      new Date(2026, 11, 3, 14, 0)
    )

    expect(early[0].key).not.toBe(later[0].key)
    expect(later[0].key).toContain(new Date(2026, 11, 3, 13, 30).toISOString())
  })
})
