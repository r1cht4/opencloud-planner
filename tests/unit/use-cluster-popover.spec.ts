// @vitest-environment happy-dom
/**
 * useClusterPopover – the "+N" stack popover state extracted from Calendar.vue
 * (cluster registry, viewport-clamped placement, hover close delay).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useClusterPopover } from '../../src/composables/useClusterPopover'
import type { CalendarEvent } from '../../src/types'

function ev(id: string): CalendarEvent {
  return {
    id,
    title: `Event ${id}`,
    start: '2026-06-07 09:00',
    end: '2026-06-07 10:00',
    calendarId: 'cal-1'
  }
}

function block(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, ...rect }) as DOMRect
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('useClusterPopover', () => {
  it('keeps the cluster registry in sync with the grid re-render', () => {
    const api = useClusterPopover()
    api.setClusters(new Map([['stack:1', [ev('a'), ev('b')]]]))
    expect(api.clusters.get('stack:1')?.map((e) => e.id)).toEqual(['a', 'b'])

    api.setClusters(new Map())
    expect(api.clusters.size).toBe(0)
  })

  it('positions the popover next to the block and clamps it to the viewport', () => {
    const api = useClusterPopover()
    const el = block({ top: 40, right: 60 })

    api.show([ev('a')], el)

    expect(api.popover.value?.events.map((e) => e.id)).toEqual(['a'])
    // right+8 → 68, comfortably inside the 1024px-wide happy-dom viewport
    expect(api.popover.value?.x).toBe(68)
    expect(api.popover.value?.y).toBe(40)
  })

  it('never places the popover off-screen', () => {
    const api = useClusterPopover()
    // A block hugging the right/bottom edges.
    const el = block({ top: window.innerHeight + 100, right: window.innerWidth + 100 })
    api.show([ev('a'), ev('b'), ev('c')], el)

    // The vertical clamp reserves the popover's own height (3 rows + padding).
    const height = 3 * 40 + 16
    expect(api.popover.value!.x).toBeGreaterThanOrEqual(8)
    expect(api.popover.value!.x + 280).toBeLessThanOrEqual(window.innerWidth)
    expect(api.popover.value!.y).toBeGreaterThanOrEqual(8)
    expect(api.popover.value!.y + height).toBeLessThanOrEqual(window.innerHeight)
  })

  it('replaces the open popover when another cluster is picked', () => {
    const api = useClusterPopover()
    const el = block({ top: 40, right: 60 })

    api.toggle([ev('a'), ev('b')], el)
    expect(api.popover.value?.events.map((e) => e.id)).toEqual(['a', 'b'])

    api.toggle([ev('c')], el)
    expect(api.popover.value?.events.map((e) => e.id)).toEqual(['c'])
    // Placement is recomputed for the new cluster.
    expect(api.popover.value?.x).toBe(68)
  })

  it('closes after the hover delay and cancels that delay when re-entered', () => {
    vi.useFakeTimers()
    const api = useClusterPopover()
    api.show([ev('a')], block({ top: 10, right: 10 }))

    api.scheduleClose()
    vi.advanceTimersByTime(249)
    expect(api.popover.value).not.toBeNull()

    api.cancelClose()
    vi.advanceTimersByTime(1000)
    expect(api.popover.value).not.toBeNull()

    api.scheduleClose()
    vi.advanceTimersByTime(250)
    expect(api.popover.value).toBeNull()
  })

  it('hide() closes immediately', () => {
    const api = useClusterPopover()
    api.show([ev('a')], block({ top: 10, right: 10 }))
    api.hide()
    expect(api.popover.value).toBeNull()
  })

  it('ignores a missing event block', () => {
    const api = useClusterPopover()
    api.show([ev('a')], undefined)
    expect(api.popover.value).toBeNull()
  })
})
