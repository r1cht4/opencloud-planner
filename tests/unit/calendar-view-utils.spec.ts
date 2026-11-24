// @vitest-environment happy-dom
/**
 * calendarViewUtils – pure calendar-page helpers extracted from Calendar.vue.
 * Covers the @event-calendar mapping (colour, all-day detection, drag gating,
 * "+N" clustering), birthday detection and the loaded-window maths.
 */
import { describe, expect, it } from 'vitest'

import {
  computeLoadedRange,
  escapeHtml,
  eventBlockHtml,
  eventDensityMode,
  formatMoveDetails,
  getCalendarColor,
  isBirthdayEvent,
  isTimeGridView,
  mergeRefreshedEvents,
  ONE_LINE_MIN_HEIGHT,
  STACK_THRESHOLD,
  tagEventElement,
  toEcEvents,
  TWO_LINE_MIN_HEIGHT
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

describe('STACK_THRESHOLD', () => {
  it('collapses overlaps of two events into the stack on every width', () => {
    // Two overlapping events used to split the day into narrow side-by-side
    // columns on desktop (threshold 3); now they get the same "+N" block as
    // denser clusters, on narrow and wide viewports alike.
    expect(STACK_THRESHOLD).toBe(2)
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

describe('grid density modes (height → content)', () => {
  it('picks the mode from the measured block height', () => {
    // At the grid's default 48 px/hour: 15 min = 12 px, 30 min = 24 px,
    // 60 min = 48 px.
    expect(eventDensityMode(48)).toBe('two-line')
    expect(eventDensityMode(TWO_LINE_MIN_HEIGHT)).toBe('two-line')
    expect(eventDensityMode(TWO_LINE_MIN_HEIGHT - 1)).toBe('one-line')
    expect(eventDensityMode(24)).toBe('one-line')
    expect(eventDensityMode(ONE_LINE_MIN_HEIGHT)).toBe('one-line')
    expect(eventDensityMode(ONE_LINE_MIN_HEIGHT - 1)).toBe('block')
    expect(eventDensityMode(12)).toBe('block')
    expect(eventDensityMode(0)).toBe('block')
  })

  it('tags a time-grid event with its mode class after measuring', () => {
    const el = document.createElement('div')
    el.className = 'ec-event'
    const time = document.createElement('span')
    time.className = 'ec-event-time'
    el.appendChild(time)

    const setHeight = (px: number) =>
      Object.defineProperty(el, 'clientHeight', { value: px, configurable: true })

    setHeight(48)
    tagEventElement(el, true)
    expect(el.className).toBe('ec-event ec-event--two-line')

    setHeight(24)
    tagEventElement(el, true)
    expect(el.classList.contains('ec-event--two-line')).toBe(false)
    expect(el.classList.contains('ec-event--one-line')).toBe(true)

    // happy-dom reports clientHeight 0 by default → block (no text).
    setHeight(0)
    tagEventElement(el, true)
    expect(el.classList.contains('ec-event--one-line')).toBe(false)
    expect(el.classList.contains('ec-event--block')).toBe(true)

    // Leaving the time grid clears the tags again.
    tagEventElement(el, false)
    expect(el.className).toBe('ec-event')
  })

  it('does not tag events without a time line (all-day) or outside the time grid', () => {
    const el = document.createElement('div')
    el.className = 'ec-event'
    tagEventElement(el, true)
    expect(el.className).toBe('ec-event')
  })

  it('recognises time-grid views', () => {
    expect(isTimeGridView({ type: 'timeGridWeek' })).toBe(true)
    expect(isTimeGridView({ type: 'dayGridMonth' })).toBe(false)
    expect(isTimeGridView(null)).toBe(false)
    expect(isTimeGridView({})).toBe(false)
  })
})

describe('eventBlockHtml (eventContent hook)', () => {
  it('renders the range time, the start-only time and the title', () => {
    const html = eventBlockHtml('Team standup', '9:30 – 9:45', '9:30')
    expect(html).toContain('ec-event-time--range">9:30 – 9:45<')
    expect(html).toContain('ec-event-time--start">9:30<')
    expect(html).toContain('ec-event-title">Team standup<')
  })

  it('escapes user-controlled text (title may contain markup)', () => {
    const html = eventBlockHtml('<img src=x onerror=alert(1)>', '9:30 – 9:45', '9:30')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(escapeHtml(`a"b'c&d<e>f`)).toBe('a&quot;b&#39;c&amp;d&lt;e&gt;f')
  })
})

describe('toEcEvents with the stack threshold', () => {
  it('collapses two overlapping events into the "+N" stack (regression: side-by-side columns)', () => {
    const { events, clusters } = toEcEvents(
      [
        ev('a', '2026-11-24 09:00', '2026-11-24 10:00'),
        ev('b', '2026-11-24 09:30', '2026-11-24 10:30')
      ],
      { calendars, visible: new Set(['cal-1']), threshold: STACK_THRESHOLD }
    )
    expect(events).toHaveLength(1)
    expect(events[0].id).toMatch(/^stack:/)
    expect(events[0].title).toBe('Event a +1')
    expect(clusters.get(events[0].id)?.map((e) => e.id)).toEqual(['a', 'b'])
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
