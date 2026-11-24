/**
 * useEventForm – the event dialog's form state, extracted from Calendar.vue.
 * These tests guard the behaviours the old view implemented inline: all-day
 * toggling with saved times, the date/time split fields, ±1 day shifting,
 * end-after-start validation and the normalisation done on save.
 */
import { describe, expect, it } from 'vitest'
import { ref, type Ref } from 'vue'

import { useEventForm, addDays, fmtLocal, roundUpTo15 } from '../../src/composables/useEventForm'
import type { CalendarEvent } from '../../src/types'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    title: 'Standup',
    start: '2026-06-07 09:00',
    end: '2026-06-07 09:30',
    calendarId: 'cal-1',
    ...overrides
  }
}

describe('useEventForm', () => {
  it('initialises a new timed event from the seed slot', () => {
    const { form } = useEventForm({ isPreview: { value: false } as any })
    const start = new Date(2026, 5, 7, 9, 0)
    const end = new Date(2026, 5, 7, 10, 0)
    // initCreate is exercised through the composable's public API below; here we
    // only assert the empty default shape.
    expect(form.title).toBe('')
    expect(form.allDay).toBe(false)
    expect(form.reminders).toEqual([])
    expect(form.calendarUrl).toBe('')

    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start, end, allDay: false }, 'cal-1')
    expect(api.form.start).toBe('2026-06-07T09:00')
    expect(api.form.end).toBe('2026-06-07T10:00')
    expect(api.form.calendarUrl).toBe('cal-1')
    expect(api.form.allDay).toBe(false)
  })

  it('rounds a default new-event start up to the next quarter hour', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 7), end: undefined }, '')
    // end defaults to start + 1h
    expect(api.form.start).toBe('2026-06-07T09:07')
    expect(api.form.end).toBe('2026-06-07T10:07')

    const rounded = roundUpTo15(new Date(2026, 5, 7, 9, 7))
    expect(fmtLocal(rounded)).toBe('2026-06-07T09:15')
  })

  it('initialises an all-day new event with date-only values', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate(
      { start: new Date(2026, 5, 7, 0, 0), end: new Date(2026, 5, 8, 0, 0), allDay: true },
      'cal-1'
    )
    expect(api.form.start).toBe('2026-06-07')
    expect(api.form.end).toBe('2026-06-08')
    expect(api.form.allDay).toBe(true)
  })

  it('loads a timed event into the form (space → T, reminders as strings)', () => {
    const api = useEventForm({ isPreview: { value: true } as any })
    api.initFromEvent(event({ reminders: [5, 30], description: 'Daily', location: 'Room 1' }))
    expect(api.form.start).toBe('2026-06-07T09:00')
    expect(api.form.end).toBe('2026-06-07T09:30')
    expect(api.form.reminders).toEqual(['5', '30'])
    expect(api.form.description).toBe('Daily')
    expect(api.form.location).toBe('Room 1')
    expect(api.form.allDay).toBe(false)
  })

  it('loads an all-day event with its exclusive end date converted to the UI value', () => {
    const api = useEventForm({ isPreview: { value: true } as any })
    api.initFromEvent(event({ start: '2026-06-07', end: '2026-06-09', isAllDay: true }))
    expect(api.form.start).toBe('2026-06-07')
    // iCal DTEND is exclusive: 2026-06-09 → last visible day 2026-06-08
    expect(api.form.end).toBe('2026-06-08')
    expect(api.form.allDay).toBe(true)
  })

  it('falls back to the legacy single reminder field', () => {
    const api = useEventForm({ isPreview: { value: true } as any })
    api.initFromEvent(event({ reminder: 60 }))
    expect(api.form.reminders).toEqual(['60'])
  })

  it('keeps the time when the start date changes and follows with the end', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) }, 'cal-1')

    api.startDate.value = '2026-06-10'
    expect(api.form.start).toBe('2026-06-10T09:00')
    // moving the start past the end pushes the end to start + 1h
    expect(api.form.end).toBe('2026-06-10T10:00')
  })

  it('writes only the time part when the time changes', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) }, 'cal-1')

    api.startTime.value = '11:45'
    expect(api.form.start).toBe('2026-06-07T11:45')
    api.endTime.value = '13:00'
    expect(api.form.end).toBe('2026-06-07T13:00')
    expect(api.endBeforeStart.value).toBe(false)
  })

  it('flags an end before the start', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) }, 'cal-1')
    api.endDate.value = '2026-06-06'
    expect(api.endBeforeStart.value).toBe(true)
  })

  it('remembers and restores times across an all-day toggle', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate(
      { start: new Date(2026, 5, 7, 9, 30), end: new Date(2026, 5, 7, 11, 15) },
      'cal-1'
    )

    api.form.allDay = true
    api.onAllDayToggle()
    expect(api.form.start).toBe('2026-06-07')
    expect(api.form.end).toBe('2026-06-07')
    expect(api.savedTimes.value).toEqual({ start: '09:30', end: '11:15' })

    api.form.allDay = false
    api.onAllDayToggle()
    expect(api.form.start).toBe('2026-06-07T09:30')
    expect(api.form.end).toBe('2026-06-07T11:15')
    expect(api.savedTimes.value).toBeNull()
  })

  it('uses 09:00/10:00 when untoggling without saved times', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate(
      { start: new Date(2026, 5, 7, 0, 0), end: new Date(2026, 5, 8, 0, 0), allDay: true },
      'cal-1'
    )
    api.form.allDay = false
    api.onAllDayToggle()
    expect(api.form.start).toBe('2026-06-07T09:00')
    expect(api.form.end).toBe('2026-06-08T10:00')
  })

  it('shifts a date by days and keeps the time (scroll wheel + day overflow)', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) }, 'cal-1')

    api.shiftDate('start', 1)
    expect(api.form.start).toBe('2026-06-08T09:00')
    api.shiftDate('start', -2)
    expect(api.form.start).toBe('2026-06-06T09:00')
    api.shiftDate('end', 1)
    expect(api.form.end).toBe('2026-06-08T10:00')
  })

  it('ignores the date wheel in preview mode', () => {
    const preview: Ref<boolean> = ref(true)
    const api = useEventForm({ isPreview: preview })
    api.initFromEvent(event())
    api.onWheelDate('start', { deltaY: -1 } as WheelEvent)
    expect(api.form.start).toBe('2026-06-07T09:00')

    preview.value = false
    api.onWheelDate('start', { deltaY: -1 } as WheelEvent)
    expect(api.form.start).toBe('2026-06-08T09:00')
  })

  it('adds and removes reminders', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.addReminder()
    api.addReminder()
    expect(api.form.reminders).toEqual(['15', '15'])
    api.removeReminder(0)
    expect(api.form.reminders).toEqual(['15'])
  })

  it('normalises the form into the payload the page persists', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate({ start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) }, 'cal-1')
    api.form.title = 'Standup'
    api.form.description = 'Daily sync'
    api.form.location = ''
    api.form.rrule = 'FREQ=WEEKLY'
    // '' parses to 0 ("at time of event"), 'abc' is dropped – unchanged behaviour.
    api.form.reminders = ['15', '', 'abc']

    expect(api.toSavePayload()).toEqual({
      title: 'Standup',
      start: '2026-06-07 09:00',
      end: '2026-06-07 10:00',
      description: 'Daily sync',
      location: undefined,
      isAllDay: false,
      rrule: 'FREQ=WEEKLY',
      reminders: [15, 0],
      calendarUrl: 'cal-1'
    })
  })

  it('writes an exclusive end date for all-day events on save', () => {
    const api = useEventForm({ isPreview: { value: false } as any })
    api.initCreate(
      { start: new Date(2026, 5, 7, 0, 0), end: new Date(2026, 5, 8, 0, 0), allDay: true },
      ''
    )
    api.form.title = 'Holiday'

    const payload = api.toSavePayload()
    expect(payload.start).toBe('2026-06-07')
    expect(payload.end).toBe('2026-06-09')
    expect(payload.isAllDay).toBe(true)
    expect(payload.rrule).toBeUndefined()
  })
})

describe('date helpers', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('fmtLocal zero-pads month, day, hour and minute', () => {
    expect(fmtLocal(new Date(2026, 0, 5, 7, 8))).toBe('2026-01-05T07:08')
  })

  it('roundUpTo15 is idempotent on a quarter hour', () => {
    expect(roundUpTo15(new Date(2026, 5, 7, 9, 0)).getMinutes()).toBe(0)
    expect(roundUpTo15(new Date(2026, 5, 7, 9, 15)).getMinutes()).toBe(15)
    expect(roundUpTo15(new Date(2026, 5, 7, 9, 0, 1)).getMinutes()).toBe(15)
  })
})
