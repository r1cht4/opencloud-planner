/**
 * Collapse clusters of overlapping same-day timed events into a single
 * synthetic "+N" event. Used by the calendar time-grid view so that dense
 * clusters don't render as unreadable slivers.
 *
 * All-day and multi-day events are passed through untouched (they live in the
 * all-day row / month cells, not the timed grid).
 */
import type { CalendarEvent } from '../types'

export interface CollapseResult {
  /** Events to render: originals for sparse slots, one synthetic event per dense cluster. */
  events: CalendarEvent[]
  /** Synthetic event id → the events it stands in for. */
  clusters: Map<string, CalendarEvent[]>
}

function stackEventId(cluster: CalendarEvent[]): string {
  return `stack:${cluster.map((e) => e.id).join('|')}`
}

function makeStackEvent(cluster: CalendarEvent[]): CalendarEvent {
  const rep = cluster[0]
  const start = cluster.reduce((min, e) => (e.start < min ? e.start : min), rep.start)
  const end = cluster.reduce((max, e) => (e.end > max ? e.end : max), rep.end)
  return {
    ...rep,
    id: stackEventId(cluster),
    title: `${rep.title} +${cluster.length - 1}`,
    start,
    end,
    isAllDay: false,
    reminder: undefined,
    reminders: undefined,
    rrule: undefined,
    recurringEventId: undefined,
    recurrenceId: undefined,
    rawIcs: undefined
  }
}

export function collapseOverlappingEvents(
  events: CalendarEvent[],
  threshold: number
): CollapseResult {
  const result: CalendarEvent[] = []
  const clusters = new Map<string, CalendarEvent[]>()
  const byDay = new Map<string, CalendarEvent[]>()

  for (const e of events) {
    const isAllDay = e.isAllDay ?? !e.start.includes(' ')
    const singleDay = e.start.slice(0, 10) === e.end.slice(0, 10)
    if (isAllDay || !singleDay) {
      result.push(e)
      continue
    }
    const day = e.start.slice(0, 10)
    const list = byDay.get(day) ?? []
    list.push(e)
    byDay.set(day, list)
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start))
    let cluster: CalendarEvent[] = []
    let clusterEnd = ''
    const flush = () => {
      if (cluster.length >= threshold) {
        const stack = makeStackEvent(cluster)
        clusters.set(stack.id, cluster)
        result.push(stack)
      } else {
        result.push(...cluster)
      }
      cluster = []
      clusterEnd = ''
    }
    for (const e of list) {
      if (cluster.length > 0 && e.start < clusterEnd) {
        cluster.push(e)
        if (e.end > clusterEnd) clusterEnd = e.end
      } else {
        flush()
        cluster = [e]
        clusterEnd = e.end
      }
    }
    flush()
  }

  return { events: result, clusters }
}
