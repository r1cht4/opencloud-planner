// @vitest-environment happy-dom
/**
 * calendarViewUtils – pure calendar-page helpers extracted from Calendar.vue.
 * Covers the @event-calendar mapping (colour, all-day detection, drag gating,
 * "+N" clustering), birthday detection and the loaded-window maths.
 */
import { describe, expect, it } from 'vitest'

import {
  computeLoadedRange,
  formatMoveDetails,
  getCalendarColor,
  isBirthdayEvent,
  isTimeGridView,
  mergeRefreshedEvents,
  stackThreshold,
  tagEventElement,
  toEcEvents
} from '../../src/composables/calendarViewUtils'
import type { CalendarCollection, CalendarEvent } from '../../src/types'

const calendars: CalendarCollection[] = [
  { url: 'cal-1', displayName: 'Personal', color: '#00677F', description: '', ctag: '' },
  { url: 'cal-2', displayName: 'No colour', color: '', description: '', ctag: '' }
]

function ev(
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {}
): CalendarEvent {
  return { id, title: `Event ${id}`, start, end, calendarId: 'cal-1', ...extra }
}

describe('getCalendarColor', () => {
  it('uses the collection colour and falls back to the OpenCloud primary', () => {
    expect(getCalendarColor(calendars, 'cal-1')).toBe('#00677F')
    expect(getCalendarColor(calendars, 'cal-2')).toBe('#00677F')
    expect(getCalendarColor(calendars, 'missing')).toBe('#00677F')
    expect(getCalendarColor([{ ...calendars[0], color: '#BADA55' }], 'cal-1')).toBe('#BADA55')
  })
})

describe('isBirthdayEvent', () => {
  it('detects birthday masters and their expanded occurrences', () => {
    expect(isBirthdayEvent(ev('bday-123', '2026-06-07', '2026-06-08'))).toBe(true)
    expect(
      isBirthdayEvent(
        ev('bday-123-20260607', '2026-06-07 00:00', '2026-06-07 00:00', {
          recurringEventId: 'bday-123'
        })
      )
    ).toBe(true)
    expect(isBirthdayEvent(ev('regular', '2026-06-07 09:00', '2026-06-07 10:00'))).toBe(false)
    expect(
      isBirthdayEvent(
        ev('occ-1', '2026-06-07 09:00', '2026-06-07 10:00', { recurringEventId: 'master-1' })
      )
    ).toBe(false)
  })
})

describe('stackThreshold', () => {
  it('collapses earlier on narrow viewports', () => {
    expect(stackThreshold(true)).toBe(2)
    expect(stackThreshold(false)).toBe(3)
  })
})

describe('toEcEvents', () => {
  it('maps events with their calendar colour and readable text colour', () => {
    const { events, clusters } = toEcEvents([ev('a', '2026-06-07 09:00', '2026-06-07 10:00')], {
      calendars,
      visible: new Set(['cal-1']),
      threshold: 3
    })

    expect(clusters.size).toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'a',
      title: 'Event a',
      backgroundColor: '#00677F',
      textColor: '#FFFFFF',
      allDay: false,
      editable: true
    })
    expect(events[0].className).toBeUndefined()
  })

  it('drops events from hidden calendars', () => {
    const { events } = toEcEvents(
      [
        ev('a', '2026-06-07 09:00', '2026-06-07 10:00'),
        ev('b', '2026-06-07 09:00', '2026-06-07 10:00', { calendarId: 'cal-2' })
      ],
      { calendars, visible: new Set(['cal-1']), threshold: 3 }
    )
    expect(events.map((e) => e.id)).toEqual(['a'])
  })

  it('detects all-day events from the date-only start', () => {
    const { events } = toEcEvents([ev('a', '2026-06-07', '2026-06-08', { isAllDay: true })], {
      calendars,
      visible: new Set(['cal-1']),
      threshold: 3
    })
    expect(events[0].allDay).toBe(true)
  })

  it('collapses same-time events into a non-draggable "+N" stack and reports the cluster', () => {
    const { events, clusters } = toEcEvents(
      [
        ev('a', '2026-06-07 09:00', '2026-06-07 10:00'),
        ev('b', '2026-06-07 09:00', '2026-06-07 10:00'),
        ev('c', '2026-06-07 09:00', '2026-06-07 10:00')
      ],
      { calendars, visible: new Set(['cal-1']), threshold: 3 }
    )

    expect(events).toHaveLength(1)
    expect(events[0].id).toMatch(/^stack:/)
    expect(events[0].className).toBe('ec-event--stack')
    expect(events[0].editable).toBe(false)
    expect(clusters.get(events[0].id)?.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps expanded recurring occurrences and birthday events non-draggable', () => {
    const { events } = toEcEvents(
      [
        ev('occ', '2026-06-07 09:00', '2026-06-07 10:00', { recurringEventId: 'master' }),
        ev('bday-1', '2026-06-07', '2026-06-08')
      ],
      { calendars, visible: new Set(['cal-1']), threshold: 3 }
    )
    expect(events.map((e) => e.editable)).toEqual([false, false])
  })
})

describe('formatMoveDetails', () => {
  it('shows one line per day for an all-day move', () => {
    const { line1, line2 } = formatMoveDetails('2026-06-07', '2026-06-08', true, 'de-DE')
    expect(line1).toContain('7')
    expect(line2).toBe('')
  })

  it('shows the time range for a same-day timed move', () => {
    const { line1, line2 } = formatMoveDetails(
      '2026-06-07 09:00',
      '2026-06-07 10:00',
      false,
      'de-DE'
    )
    expect(line1).toContain('7')
    expect(line2).toContain('09:00')
    expect(line2).toContain('10:00')
  })

  it('repeats the date when the event moves across days', () => {
    const { line1, line2 } = formatMoveDetails(
      '2026-06-07 22:00',
      '2026-06-08 01:00',
      false,
      'de-DE'
    )
    expect(line1).toContain('7.')
    expect(line2).toContain('8.')
  })
})

describe('computeLoadedRange', () => {
  it('covers the view ±6 months', () => {
    const { start, end } = computeLoadedRange(new Date(2026, 5, 7), new Date(2026, 5, 13))
    // first of the month six months before the view start
    expect(start.getFullYear()).toBe(2025)
    expect(start.getMonth()).toBe(11)
    expect(start.getDate()).toBe(1)
    // last day of the sixth month after the view end
    expect(end.getFullYear()).toBe(2026)
    expect(end.getMonth()).toBe(11)
    expect(end.getDate()).toBe(31)
  })
})

describe('grid density tagging', () => {
  it('only tags time-grid events that render a time line', () => {
    const el = document.createElement('div')
    el.className = 'ec-event'
    // No .ec-event-time → nothing to hide.
    tagEventElement(el, true)
    expect(el.classList.contains('ec-event--compact')).toBe(false)

    const time = document.createElement('span')
    time.className = 'ec-event-time'
    el.appendChild(time)
    // happy-dom reports clientHeight 0 → "tiny" slot.
    tagEventElement(el, true)
    expect(el.classList.contains('ec-event--compact')).toBe(true)
    expect(el.classList.contains('ec-event--tiny')).toBe(true)

    // Leaving the time grid clears the tags again.
    tagEventElement(el, false)
    expect(el.classList.contains('ec-event--compact')).toBe(false)
    expect(el.classList.contains('ec-event--tiny')).toBe(false)
  })

  it('recognises time-grid views', () => {
    expect(isTimeGridView({ type: 'timeGridWeek' })).toBe(true)
    expect(isTimeGridView({ type: 'dayGridMonth' })).toBe(false)
    expect(isTimeGridView(null)).toBe(false)
    expect(isTimeGridView({})).toBe(false)
  })
})

describe('mergeRefreshedEvents', () => {
  const personal = [
    ev('p1', '2026-03-01 09:00', '2026-03-01 10:00'),
    ev('p2', '2026-03-02 09:00', '2026-03-02 10:00')
  ]
  const work = [ev('w1', '2026-03-01 11:00', '2026-03-01 12:00', { calendarId: 'cal-2' })]

  it('replaces only the events of the refetched calendar', () => {
    const merged = mergeRefreshedEvents(
      [...personal, ...work],
      [ev('p1', '2026-03-01 09:00', '2026-03-01 10:30')],
      ['cal-1']
    )

    expect(merged.map((e) => e.id).sort()).toEqual(['p1', 'w1'])
    // The refreshed event wins over the stale copy, foreign calendar untouched.
    expect(merged.find((e) => e.id === 'p1')?.end).toBe('2026-03-01 10:30')
    expect(merged.find((e) => e.id === 'w1')).toBe(work[0])
  })

  it('drops events deleted by the other client in the refetched calendar', () => {
    const merged = mergeRefreshedEvents([...personal, ...work], [], ['cal-1'])
    expect(merged.map((e) => e.id)).toEqual(['w1'])
  })

  it('treats a full refetch (all URLs) as a plain replacement', () => {
    // Everything the server no longer has (p1/p2 deleted elsewhere) is gone.
    const merged = mergeRefreshedEvents([...personal, ...work], [work[0]], ['cal-1', 'cal-2'])
    expect(merged.map((e) => e.id)).toEqual(['w1'])
  })

  it('keeps the loaded events when nothing was refetched', () => {
    const previous = [...personal, ...work]
    const merged = mergeRefreshedEvents(previous, [], [])
    expect(merged).toEqual(previous)
    expect(merged).not.toBe(previous)
  })
})
