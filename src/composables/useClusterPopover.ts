/**
 * useClusterPopover – state for the popover that lists the events hidden behind
 * a collapsed "+N" stack in the calendar grid.
 *
 * Extracted from Calendar.vue. The page still decides *what* a click on an item
 * does; this composable only owns the cluster registry, the placement maths and
 * the short close delay that lets the pointer travel from the event block into
 * the popover.
 */

import { ref, type Ref } from 'vue'
import type { CalendarEvent } from '../types'

export interface ClusterPopoverState {
  events: CalendarEvent[]
  x: number
  y: number
}

/** Delay before the popover disappears once the pointer leaves (ms). */
const CLOSE_DELAY = 250
const POPOVER_WIDTH = 280
const MAX_POPOVER_HEIGHT = 320
/** Viewport margin kept free on every side (px). */
const VIEWPORT_MARGIN = 8

export interface UseClusterPopover {
  /** Synthetic stack event id → the events it stands in for. */
  clusters: Map<string, CalendarEvent[]>
  popover: Ref<ClusterPopoverState | null>
  /** Replace the cluster registry after a re-render (no close scheduled). */
  setClusters(next: Map<string, CalendarEvent[]>): void
  cancelClose(): void
  scheduleClose(): void
  show(events: CalendarEvent[], el: HTMLElement | undefined): void
  toggle(events: CalendarEvent[], el: HTMLElement | undefined): void
  hide(): void
}

export function useClusterPopover(): UseClusterPopover {
  const clusters = new Map<string, CalendarEvent[]>()
  const popover = ref<ClusterPopoverState | null>(null)
  let closeTimer: number | null = null

  function setClusters(next: Map<string, CalendarEvent[]>) {
    clusters.clear()
    for (const [id, list] of next) clusters.set(id, list)
  }

  function cancelClose() {
    if (closeTimer != null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  function scheduleClose() {
    cancelClose()
    closeTimer = window.setTimeout(() => {
      popover.value = null
    }, CLOSE_DELAY)
  }

  /** Place the popover next to the event block, clamped to the viewport. */
  function show(events: CalendarEvent[], el: HTMLElement | undefined) {
    if (!el) return
    cancelClose()
    const rect = el.getBoundingClientRect()
    const height = Math.min(events.length * 40 + 16, MAX_POPOVER_HEIGHT)
    const x = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right + VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN)
    )
    const y = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.top, window.innerHeight - height - VIEWPORT_MARGIN)
    )
    popover.value = { events, x, y }
  }

  function toggle(events: CalendarEvent[], el: HTMLElement | undefined) {
    const open = popover.value
    if (open && open.events === events) {
      popover.value = null
      return
    }
    show(events, el)
  }

  function hide() {
    cancelClose()
    popover.value = null
  }

  return { clusters, popover, setClusters, cancelClose, scheduleClose, show, toggle, hide }
}
