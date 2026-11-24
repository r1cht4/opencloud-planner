/**
 * useCalendarGrid – the @event-calendar/core instance of the Calendar page.
 *
 * Extracted from `views/Calendar.vue` so the page stays wiring-only. This
 * composable owns:
 *  - the grid lifecycle (`createCalendar` / `setOption` / `destroyCalendar`),
 *  - the responsive header toolbar (media query) and the post-render event
 *    density tagging,
 *  - the "+N" cluster registry + popover (`useClusterPopover`) and the mapping
 *    of internal events to grid events (`toEcEvents`),
 *  - the typed callback shapes the grid invokes (the package ships no
 *    TypeScript declarations, so the `info` objects are described here once
 *    instead of being `any` at every call site).
 *
 * The page injects the behaviour (open event, drag, date click, …) through
 * `CalendarGridCallbacks`.
 */

import { onUnmounted, ref, type Ref } from 'vue'
import {
  createCalendar,
  destroyCalendar,
  DayGrid,
  Interaction,
  List,
  TimeGrid,
  type CalendarInstance
} from '@event-calendar/core'
import { useClusterPopover, type ClusterPopoverState } from './useClusterPopover'
import { touchGridOptions, vibrateOnInteractionStart } from './calendarTouch'
import { isTimeGridView, stackThreshold, tagEventElement, toEcEvents } from './calendarViewUtils'
import {
  applyCalendarSettingsOptions,
  type CalendarSettingsOptions
} from '../settings/calendarViewOptions'
import { formatDate, formatDateTime } from '../ics/datetime'
import type { CalendarCollection, CalendarEvent } from '../types'

// ---------------------------------------------------------------------------
// Callback info shapes (the grid library is untyped; these are the fields the
// page actually reads).
// ---------------------------------------------------------------------------

/** The grid's event object inside a callback. */
interface EcEventPayload {
  id: string
  start: Date | string
  end: Date | string
  allDay?: boolean
}

interface EcEventInfo {
  event: EcEventPayload
  el: HTMLElement
  view?: { type?: string }
  revert?: () => void
}

interface EcDateClickInfo {
  date: Date | string
  allDay?: boolean
  view?: { type?: string }
}

interface EcSelectInfo {
  start: Date | string
  end: Date | string
  allDay?: boolean
}

/** `eventDragStart` / `eventResizeStart`: the pointer that started the drag. */
interface EcDragStartInfo {
  jsEvent?: { pointerType?: string }
}

interface EcDatesSetInfo {
  start: Date
  end: Date
}

/** A drag/resize handed to the page, normalised to the model's wall clock. */
export interface EventDragRequest {
  event: CalendarEvent
  newStart: string
  newEnd: string
  isAllDay: boolean
  revert: () => void
}

export interface CalendarGridCallbacks {
  getLocale: () => string
  /** The settings-driven grid options (view, scrollTime, firstDay, …). */
  getViewOptions: () => CalendarSettingsOptions
  /** Extra options for `createCalendar` (locale, buttonText, …). */
  buildOptions: () => Record<string, unknown>
  getCalendars: () => CalendarCollection[]
  getVisible: () => Set<string>
  getEvents: () => CalendarEvent[]
  isNarrow: () => boolean
  openEvent: (event: CalendarEvent) => void
  onEventDrag: (drag: EventDragRequest) => void
  onDateClick: (start: Date, end: Date, allDay: boolean) => void
  onDateSelect: (start: Date, end: Date, allDay: boolean) => void
  onDatesSet: (range: { start: Date; end: Date }) => void
}

export interface CalendarGrid {
  calendarEl: Ref<HTMLElement | null>
  /** Synthetic "+N" stack popover state (rendered by the page). */
  stackPopover: Ref<ClusterPopoverState | null>
  cancelStackClose: () => void
  scheduleStackClose: () => void
  hideStackPopover: () => void
  isNarrow: () => boolean
  initCalendar: (initialEvents: CalendarEvent[]) => void
  /** Push a settings change into the running grid (diffed, no re-mount). */
  applyViewOptions: (next: CalendarSettingsOptions) => void
  setEvents: (list: CalendarEvent[]) => void
  setDate: (date: string) => void
  unselect: () => void
}

const desktopToolbar = {
  start: 'prev,next today',
  center: 'title',
  end: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
}
const mobileToolbar = {
  start: 'prev,next',
  center: 'title',
  end: 'today dayGridMonth,timeGridWeek,timeGridDay,listWeek'
}

export function useCalendarGrid(cb: CalendarGridCallbacks): CalendarGrid {
  const calendarEl = ref<HTMLElement | null>(null)
  let ec: CalendarInstance | null = null
  let appliedViewOptions: CalendarSettingsOptions | null = null

  const {
    clusters: stackedClusters,
    popover: stackPopover,
    setClusters: setStackedClusters,
    cancelClose: cancelStackClose,
    scheduleClose: scheduleStackClose,
    show: showStackPopover,
    toggle: toggleStackPopover,
    hide: hideStackPopover
  } = useClusterPopover()

  const toolbarMq = window.matchMedia('(max-width: 640px)')

  function applyHeaderToolbar() {
    if (ec) ec.setOption('headerToolbar', toolbarMq.matches ? mobileToolbar : desktopToolbar)
  }

  /** Map events for the grid and refresh the "+N" cluster registry. */
  function ecEvents(list: CalendarEvent[]) {
    const { events: mapped, clusters } = toEcEvents(list, {
      calendars: cb.getCalendars(),
      visible: cb.getVisible(),
      threshold: stackThreshold(cb.isNarrow())
    })
    setStackedClusters(clusters)
    return mapped
  }

  function applyEventDensity(view: { type?: string } | null | undefined) {
    const root = calendarEl.value
    if (!root) return
    const timeGrid = isTimeGridView(view)
    for (const el of root.querySelectorAll<HTMLElement>('.ec-event')) {
      tagEventElement(el, timeGrid)
    }
  }

  function initCalendar(initialEvents: CalendarEvent[]) {
    if (!calendarEl.value) return
    appliedViewOptions = cb.getViewOptions()
    ec = createCalendar(calendarEl.value, [TimeGrid, DayGrid, List, Interaction], {
      ...cb.buildOptions(),
      dayMaxEvents: true,
      // Timed events that overlap share the day column equally instead of the
      // library's default staggered/overlapping layout.
      slotEventOverlap: false,
      events: ecEvents(initialEvents),
      editable: true,
      selectable: true,
      // Touch: long press before a drag/resize/select starts, so a swipe keeps
      // scrolling. Touch-only — the mouse path never starts that timer.
      ...touchGridOptions(),
      eventDidMount: (info: EcEventInfo) => tagEventElement(info.el, isTimeGridView(info.view)),
      eventAllUpdated: (info: { view?: { type?: string } }) => applyEventDensity(info.view),
      eventClick: (info: EcEventInfo) => {
        const cluster = stackedClusters.get(info.event.id)
        if (cluster) {
          toggleStackPopover(cluster, info.el)
          return
        }
        const occurrence = cb.getEvents().find((e) => e.id === info.event.id)
        if (occurrence) cb.openEvent(occurrence)
      },
      eventMouseEnter: (info: EcEventInfo) => {
        const cluster = stackedClusters.get(info.event.id)
        if (cluster) showStackPopover(cluster, info.el)
      },
      eventMouseLeave: (info: EcEventInfo) => {
        if (stackedClusters.has(info.event.id)) scheduleStackClose()
      },
      // A drag/resize really started (long press done on touch): give a short
      // haptic tick on coarse pointers only (feature-detected, never for a mouse).
      eventDragStart: (info: EcDragStartInfo) => vibrateOnInteractionStart(info.jsEvent),
      eventResizeStart: (info: EcDragStartInfo) => vibrateOnInteractionStart(info.jsEvent),
      eventDrop: (info: EcEventInfo) => handleGridDrag(info),
      eventResize: (info: EcEventInfo) => handleGridDrag(info),
      dateClick: (info: EcDateClickInfo) => {
        const start = info.date instanceof Date ? info.date : new Date(info.date)
        const isAllDay =
          info.allDay ??
          (start.getHours() === 0 &&
            start.getMinutes() === 0 &&
            !!info.view?.type?.includes('dayGrid'))
        const end = isAllDay
          ? new Date(start.getTime() + 86400000)
          : new Date(start.getTime() + 3600000)
        cb.onDateClick(start, end, isAllDay)
      },
      select: (info: EcSelectInfo) => {
        const start = info.start instanceof Date ? info.start : new Date(info.start)
        const end = info.end instanceof Date ? info.end : new Date(info.end)
        cb.onDateSelect(start, end, info.allDay ?? false)
        ec?.unselect()
      },
      datesSet: (info: EcDatesSetInfo) => {
        cb.onDatesSet({ start: info.start, end: info.end })
      },
      headerToolbar: desktopToolbar
    })
    applyHeaderToolbar()
    toolbarMq.addEventListener('change', applyHeaderToolbar)
  }

  /**
   * Drag/resize of a grid event → normalise to the model's wall-clock strings
   * and hand the page an `EventDragRequest` (the page owns the scope question,
   * the move confirmation and the birthday guard).
   */
  function handleGridDrag(info: EcEventInfo) {
    const ev = cb.getEvents().find((e) => e.id === info.event.id)
    if (!ev) {
      info.revert?.()
      return
    }
    const isAllDay = info.event.allDay ?? ev.isAllDay ?? !ev.start.includes(' ')
    const fmtEc = (d: Date | string) => {
      if (d instanceof Date) return isAllDay ? formatDate(d) : formatDateTime(d)
      return String(d)
    }
    cb.onEventDrag({
      event: ev,
      newStart: fmtEc(info.event.start),
      newEnd: fmtEc(info.event.end),
      isAllDay,
      revert: () => info.revert?.()
    })
  }

  function applyViewOptions(next: CalendarSettingsOptions) {
    if (!ec) return
    applyCalendarSettingsOptions(ec, next, appliedViewOptions ?? next)
    appliedViewOptions = next
  }

  function setEvents(list: CalendarEvent[]) {
    if (ec) ec.setOption('events', ecEvents(list))
  }

  function setDate(date: string) {
    ec?.setOption('date', date)
  }

  function unselect() {
    ec?.unselect()
  }

  function destroy() {
    toolbarMq.removeEventListener('change', applyHeaderToolbar)
    if (ec) {
      destroyCalendar(ec)
      ec = null
    }
  }

  onUnmounted(destroy)

  return {
    calendarEl,
    stackPopover,
    cancelStackClose,
    scheduleStackClose,
    hideStackPopover,
    isNarrow: () => toolbarMq.matches,
    initCalendar,
    applyViewOptions,
    setEvents,
    setDate,
    unselect
  }
}
