// @vitest-environment happy-dom
/**
 * eventTooltip – the hover/focus details card for calendar event blocks.
 *
 * The pure parts: the lines built from the event (title, time range, calendar
 * name, location) and the placement maths (above the block, clamped to the
 * viewport). The DOM part (`useEventTooltip`) is exercised for the
 * role="tooltip" / aria-describedby contract on hover and keyboard focus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s, current: 'en' })
}))

import {
  eventTooltipLines,
  tooltipPlacement,
  useEventTooltip
} from '../../src/composables/eventTooltip'
import type { CalendarEvent } from '../../src/types'

function ev(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: 'Team standup',
    start: '2026-11-24 09:30',
    end: '2026-11-24 09:45',
    calendarId: 'cal-1',
    ...partial
  }
}

describe('eventTooltipLines', () => {
  it('shows title, date + time range and calendar name for a timed event', () => {
    const lines = eventTooltipLines(ev({ id: 'a' }), 'Personal', 'en-GB', 'All day')
    expect(lines[0]).toBe('Team standup')
    expect(lines[1]).toContain('9:30')
    expect(lines[1]).toContain('9:45')
    expect(lines[1]).toContain('Nov')
    expect(lines[1]).toContain('24')
    expect(lines[2]).toBe('Personal')
    expect(lines).toHaveLength(3)
  })

  it('adds the location when the event has one', () => {
    const lines = eventTooltipLines(ev({ id: 'a', location: 'Room 4' }), 'Work', 'en-GB', 'All day')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('Room 4')
  })

  it('omits the calendar line when the name is unknown', () => {
    const lines = eventTooltipLines(ev({ id: 'a' }), '', 'en-GB', 'All day')
    expect(lines).toHaveLength(2)
  })

  it('labels all-day events with the date and "All day"', () => {
    const lines = eventTooltipLines(
      ev({ id: 'b', start: '2026-11-24', end: '2026-11-25', isAllDay: true }),
      'Personal',
      'en-GB',
      'All day'
    )
    expect(lines[1]).toContain('All day')
    expect(lines[1]).toContain('Nov')
    expect(lines[1]).not.toContain('9:30')
  })

  it('spells out both days for a multi-day timed event', () => {
    const lines = eventTooltipLines(
      ev({ id: 'c', start: '2026-11-24 22:00', end: '2026-11-25 01:00' }),
      'Personal',
      'en-GB',
      'All day'
    )
    expect(lines[1]).toContain('24')
    expect(lines[1]).toContain('25')
    expect(lines[1]).toContain('22:00')
    expect(lines[1]).toContain('1:00')
  })
})

describe('tooltipPlacement', () => {
  const viewport = { width: 1200, height: 800 }
  const tip = { width: 200, height: 80 }

  it('centres above the block when there is room', () => {
    const { x, y } = tooltipPlacement(
      { top: 300, left: 500, right: 700, bottom: 340, width: 200, height: 40 },
      tip,
      viewport
    )
    expect(x).toBe(500 + 100 - 100) // block centre - half tooltip
    expect(y).toBe(300 - 80 - 6)
  })

  it('falls below the block when there is no room above', () => {
    const { y } = tooltipPlacement(
      { top: 40, left: 500, right: 700, bottom: 80, width: 200, height: 40 },
      tip,
      viewport
    )
    expect(y).toBe(80 + 6)
  })

  it('clamps to the viewport horizontally and falls below when above is full', () => {
    const left = tooltipPlacement(
      { top: 300, left: 0, right: 60, bottom: 340, width: 60, height: 40 },
      tip,
      viewport
    )
    expect(left.x).toBe(8)
    // Block near the top: no room above the tooltip → below the block.
    const below = tooltipPlacement(
      { top: 70, left: 500, right: 700, bottom: 79, width: 200, height: 9 },
      tip,
      viewport
    )
    expect(below.y).toBe(79 + 6)
    // Block near the bottom still fits above the tooltip.
    const nearBottom = tooltipPlacement(
      { top: 790, left: 500, right: 700, bottom: 799, width: 200, height: 9 },
      tip,
      viewport
    )
    expect(nearBottom.y).toBe(790 - 80 - 6)
  })
})

describe('useEventTooltip (DOM contract)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function makeBlock(): HTMLElement {
    const el = document.createElement('article')
    el.className = 'ec-event'
    document.body.appendChild(el)
    return el
  }

  it('shows a role="tooltip" card on hover and focus, wired via aria-describedby', () => {
    const tooltip = useEventTooltip(() => 'en-GB')
    const el = makeBlock()
    tooltip.bind(el, ev({ id: 'a', location: 'Room 4' }), 'Personal')

    const tip = document.getElementById('ec-event-tooltip')!
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(tip.hidden).toBe(true)

    el.dispatchEvent(new Event('mouseenter'))
    expect(tip.hidden).toBe(false)
    expect(el.getAttribute('aria-describedby')).toBe('ec-event-tooltip')
    expect(tip.textContent).toContain('Team standup')
    expect(tip.textContent).toContain('Personal')
    expect(tip.textContent).toContain('Room 4')

    el.dispatchEvent(new Event('mouseleave'))
    expect(tip.hidden).toBe(true)
    expect(el.getAttribute('aria-describedby')).toBeNull()

    // Keyboard focus shows it too (the grid blocks are focusable articles).
    el.dispatchEvent(new Event('focus'))
    expect(tip.hidden).toBe(false)
    expect(el.getAttribute('aria-describedby')).toBe('ec-event-tooltip')
    el.dispatchEvent(new Event('blur'))
    expect(tip.hidden).toBe(true)

    tooltip.destroy()
  })

  it('hides when its block is removed from the DOM (grid re-render)', () => {
    const tooltip = useEventTooltip(() => 'en-GB')
    const el = makeBlock()
    tooltip.bind(el, ev({ id: 'a' }), 'Personal')
    el.dispatchEvent(new Event('mouseenter'))
    expect(document.getElementById('ec-event-tooltip')!.hidden).toBe(false)

    el.remove()
    tooltip.hideIfDetached()
    expect(document.getElementById('ec-event-tooltip')!.hidden).toBe(true)
    tooltip.destroy()
  })

  it('escapes markup in event fields', () => {
    const tooltip = useEventTooltip(() => 'en-GB')
    const el = makeBlock()
    tooltip.bind(el, ev({ id: 'a', title: '<b>bold</b>' }), 'Personal')
    el.dispatchEvent(new Event('mouseenter'))
    const tip = document.getElementById('ec-event-tooltip')!
    expect(tip.innerHTML).not.toContain('<b>bold</b>')
    expect(tip.textContent).toContain('<b>bold</b>')
    tooltip.destroy()
  })
})
