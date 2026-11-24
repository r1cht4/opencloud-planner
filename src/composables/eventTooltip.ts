/**
 * eventTooltip – the hover/focus details card for calendar event blocks.
 *
 * Every timed event block (including the ones too short to show any text)
 * shows its details when hovered or keyboard-focused: title, time range,
 * calendar name and location if any. The tooltip is a single shared element
 * with `role="tooltip"`; the hovered block gets `aria-describedby` pointing at
 * it while the tooltip is visible.
 *
 * The line building and the placement maths are pure (`eventTooltipLines`,
 * `tooltipPlacement`) so they are unit-tested without a DOM; `useEventTooltip`
 * owns the one tooltip element and the listeners on the event blocks.
 */

import { useGettext } from 'vue3-gettext'

import { escapeHtml } from './calendarViewUtils'
import { formatClock } from '../settings/formatLocale'
import type { CalendarEvent } from '../types'

/** Lines of the details card: title, when, calendar, location (if any). */
export function eventTooltipLines(
  event: CalendarEvent,
  calendarName: string,
  locale: string,
  allDayLabel: string
): string[] {
  const lines: string[] = [event.title]
  const allDay = event.isAllDay ?? !event.start.includes(' ')
  const dateLabel = (wallClock: string): string => {
    const parsed = new Date(`${wallClock.slice(0, 10)}T00:00:00`)
    return Number.isNaN(parsed.getTime())
      ? wallClock.slice(0, 10)
      : parsed.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const timeLabel = (wallClock: string): string =>
    wallClock.includes(' ') ? formatClock(wallClock.slice(11, 16), locale) : ''

  if (allDay) {
    lines.push(`${dateLabel(event.start)} · ${allDayLabel}`)
  } else {
    const sameDay = event.start.slice(0, 10) === event.end.slice(0, 10)
    const range = `${timeLabel(event.start)} – ${timeLabel(event.end)}`
    lines.push(
      sameDay
        ? `${dateLabel(event.start)}, ${range}`
        : `${dateLabel(event.start)}, ${timeLabel(event.start)} – ${dateLabel(event.end)}, ${timeLabel(event.end)}`
    )
  }
  if (calendarName) lines.push(calendarName)
  if (event.location) lines.push(event.location)
  return lines
}

export interface Rect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * Place the tooltip above the target block, centred on it; below when there is
 * no room above, and clamped to the viewport on all sides. Pure.
 */
export function tooltipPlacement(
  target: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8
): { x: number; y: number } {
  const x = Math.min(
    Math.max(margin, target.left + target.width / 2 - tip.width / 2),
    viewport.width - tip.width - margin
  )
  const above = target.top - tip.height - 6
  const y =
    above >= margin ? above : Math.min(target.bottom + 6, viewport.height - tip.height - margin)
  return { x: Math.max(margin, x), y: Math.max(margin, y) }
}

export interface EventTooltip {
  /** Attach hover/focus listeners to one event block. */
  bind: (el: HTMLElement, event: CalendarEvent, calendarName: string) => void
  hide: () => void
  /** Hide when the block the tooltip belongs to is gone (grid re-render). */
  hideIfDetached: () => void
  destroy: () => void
}

/**
 * One shared tooltip element. `bind` is called from the grid's
 * `eventDidMount`; the listeners live on the block element, so they are
 * garbage-collected with it when the grid re-renders.
 */
export function useEventTooltip(getLocale: () => string): EventTooltip {
  const { $gettext } = useGettext()
  const tip = document.createElement('div')
  tip.id = 'ec-event-tooltip'
  tip.className = 'ec-event-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  document.body.appendChild(tip)

  let host: HTMLElement | null = null

  function show(el: HTMLElement, event: CalendarEvent, calendarName: string): void {
    const lines = eventTooltipLines(event, calendarName, getLocale(), $gettext('All day'))
    tip.innerHTML = lines
      .map((line) => `<div class="ec-event-tooltip-line">${escapeHtml(line)}</div>`)
      .join('')
    tip.hidden = false
    const rect = el.getBoundingClientRect()
    const placement = tooltipPlacement(
      {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    )
    tip.style.left = `${placement.x}px`
    tip.style.top = `${placement.y}px`
    host = el
    el.setAttribute('aria-describedby', tip.id)
  }

  function hide(): void {
    tip.hidden = true
    host?.removeAttribute('aria-describedby')
    host = null
  }

  /** Hide when the block the tooltip belongs to is gone (grid re-render). */
  function hideIfDetached(): void {
    if (host && !document.contains(host)) hide()
  }

  function bind(el: HTMLElement, event: CalendarEvent, calendarName: string): void {
    el.addEventListener('mouseenter', () => show(el, event, calendarName))
    el.addEventListener('mouseleave', hide)
    el.addEventListener('focus', () => show(el, event, calendarName))
    el.addEventListener('blur', hide)
  }

  // The tooltip is fixed-positioned: any scroll (the grid's or the page's)
  // moves the anchor block away, so the tooltip goes with it.
  const onScroll = (): void => hide()
  document.addEventListener('scroll', onScroll, true)

  function destroy(): void {
    document.removeEventListener('scroll', onScroll, true)
    hide()
    tip.remove()
  }

  return { bind, hide, hideIfDetached, destroy }
}
