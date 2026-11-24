import { describe, expect, it } from 'vitest'

import { collapseOverlappingEvents } from '../../src/composables/eventStacking'
import type { CalendarEvent } from '../../src/types'

function ev(
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {}
): CalendarEvent {
  return { id, title: `Event ${id}`, start, end, calendarId: 'cal-1', ...extra }
}

describe('collapseOverlappingEvents', () => {
  it('collapses three overlapping same-day events into one stack', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 09:15', '2026-06-01 09:45'),
      ev('c', '2026-06-01 09:30', '2026-06-01 10:30')
    ]

    const { events, clusters } = collapseOverlappingEvents(input, 3)

    expect(events).toHaveLength(1)
    expect(events[0].id).toMatch(/^stack:/)
    expect(events[0].title).toBe('Event a +2')
    // Span covers the whole cluster.
    expect(events[0].start).toBe('2026-06-01 09:00')
    expect(events[0].end).toBe('2026-06-01 10:30')
    expect(clusters.get(events[0].id)).toHaveLength(3)
  })

  it('keeps two overlapping events side by side when the threshold is 3', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 09:30', '2026-06-01 10:30')
    ]

    const { events, clusters } = collapseOverlappingEvents(input, 3)

    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(clusters.size).toBe(0)
  })

  it('collapses two overlapping events when the threshold is 2', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 09:30', '2026-06-01 10:30')
    ]

    const { events, clusters } = collapseOverlappingEvents(input, 2)

    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Event a +1')
    expect(clusters.get(events[0].id)).toHaveLength(2)
  })

  it('does not cluster non-overlapping or merely touching events', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 10:00', '2026-06-01 11:00'),
      ev('c', '2026-06-01 13:00', '2026-06-01 14:00')
    ]

    const { events } = collapseOverlappingEvents(input, 2)

    expect(events.map((e) => e.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not cluster events on different days', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-02 09:00', '2026-06-02 10:00'),
      ev('c', '2026-06-03 09:00', '2026-06-03 10:00')
    ]

    const { events } = collapseOverlappingEvents(input, 2)

    expect(events).toHaveLength(3)
  })

  it('passes all-day and multi-day events through untouched', () => {
    const input = [
      ev('allday', '2026-06-01', '2026-06-02', { isAllDay: true }),
      ev('multi', '2026-06-01 09:00', '2026-06-03 10:00'),
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 09:15', '2026-06-01 10:15'),
      ev('c', '2026-06-01 09:30', '2026-06-01 10:30')
    ]

    const { events } = collapseOverlappingEvents(input, 3)

    const ids = events.map((e) => e.id)
    expect(ids).toContain('allday')
    expect(ids).toContain('multi')
    expect(ids.filter((id) => id.startsWith('stack:'))).toHaveLength(1)
  })

  it('produces distinct stack ids for distinct clusters', () => {
    const input = [
      ev('a', '2026-06-01 09:00', '2026-06-01 10:00'),
      ev('b', '2026-06-01 09:15', '2026-06-01 10:15'),
      ev('c', '2026-06-01 09:30', '2026-06-01 10:30'),
      ev('d', '2026-06-01 14:00', '2026-06-01 15:00'),
      ev('e', '2026-06-01 14:15', '2026-06-01 15:15'),
      ev('f', '2026-06-01 14:30', '2026-06-01 15:30')
    ]

    const { events, clusters } = collapseOverlappingEvents(input, 3)

    const stacks = events.filter((e) => e.id.startsWith('stack:'))
    expect(stacks).toHaveLength(2)
    expect(clusters.size).toBe(2)
    expect(new Set(stacks.map((e) => e.id)).size).toBe(2)
  })
})
