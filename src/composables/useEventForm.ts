/**
 * useEventForm – state + derived values for the calendar event dialog.
 *
 * Extracted from Calendar.vue. The dialog component owns the form (fields,
 * all-day toggle, scroll wheels, validation), the page keeps the DAV side
 * effects: it receives a normalised `EventSavePayload` from `toSavePayload()`.
 *
 * Form field values follow the `input[type=date]` / `input[type=time]` shapes:
 * `YYYY-MM-DD` for all-day events and `YYYY-MM-DDTHH:mm` for timed events.
 */

import {
  computed,
  reactive,
  ref,
  type ComputedRef,
  type Reactive,
  type Ref,
  type WritableComputedRef
} from 'vue'
import { formatDate } from './useCalendarService'
import type { CalendarEvent } from '../types'

interface EventFormState {
  title: string
  start: string
  end: string
  description: string
  location: string
  calendarUrl: string
  allDay: boolean
  rrule: string
  reminders: string[]
}

/** Initial date/slot for a new event (both optional; now + 1h by default). */
export interface EventFormSeed {
  start?: Date
  end?: Date
  allDay?: boolean
}

/** Normalised event data handed to the page when the form is saved. */
export interface EventSavePayload {
  title: string
  /** `YYYY-MM-DD HH:mm` for timed events, `YYYY-MM-DD` for all-day events. */
  start: string
  end: string
  description?: string
  location?: string
  isAllDay: boolean
  rrule?: string
  reminders: number[]
  calendarUrl: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local wall-clock string in `input[type=datetime-local]` shape. */
export function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Add days to a `YYYY-MM-DD` string. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

/** Round a point in time up to the next quarter hour (new-event default). */
export function roundUpTo15(d: Date): Date {
  const ms = 15 * 60 * 1000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

function emptyEventForm(): EventFormState {
  return {
    title: '',
    start: '',
    end: '',
    description: '',
    location: '',
    calendarUrl: '',
    allDay: false,
    rrule: '',
    reminders: []
  }
}

export interface UseEventForm {
  /** Reactive form state (mutated in place so `v-model` on nested fields works). */
  form: Reactive<EventFormState>
  /** Times remembered across an all-day toggle so untoggling restores them. */
  savedTimes: Ref<{ start: string; end: string } | null>
  startDate: WritableComputedRef<string>
  startTime: WritableComputedRef<string>
  endDate: WritableComputedRef<string>
  endTime: WritableComputedRef<string>
  endBeforeStart: ComputedRef<boolean>
  onAllDayToggle: () => void
  addReminder: () => void
  removeReminder: (idx: number) => void
  onWheelDate: (field: 'start' | 'end', e: WheelEvent) => void
  shiftDate: (field: 'start' | 'end', offset: number) => void
  initCreate: (seed?: EventFormSeed, defaultCalendarUrl?: string) => void
  initFromEvent: (event: CalendarEvent) => void
  toSavePayload: () => EventSavePayload
}

/**
 * Defaults for a **new** event, taken from the synced `calendar.*` settings
 * (`views/Calendar.vue` maps them): `defaultDuration`, `defaultReminders` and the
 * `defaultCalendar` URL. Read lazily on every `initCreate()`, so a settings change
 * applies to the next event without re-creating the dialog.
 */
export interface EventFormDefaults {
  /** `calendar.defaultCalendar` — used when the seed does not name a calendar. */
  calendarUrl?: string
  /** `calendar.defaultDuration` in minutes (60 when unset/invalid). */
  durationMinutes?: number
  /** `calendar.defaultReminders` — lead times (minutes) pre-filled into the form. */
  reminders?: number[]
}

/** Fallback duration when the setting is missing or unusable. */
const DEFAULT_EVENT_DURATION_MINUTES = 60

/**
 * @param opts.isPreview read-only preview mode (existing event opened for
 *   viewing); suppresses the date scroll wheels just like the old view did.
 * @param opts.defaults getter for the new-event defaults (settings-backed).
 */
export function useEventForm(opts: {
  isPreview: Ref<boolean>
  defaults?: () => EventFormDefaults
}): UseEventForm {
  const form = reactive<EventFormState>(emptyEventForm())
  const savedTimes = ref<{ start: string; end: string } | null>(null)

  function onAllDayToggle() {
    const f = form
    if (f.allDay) {
      savedTimes.value = {
        start: f.start.includes('T') ? f.start.split('T')[1] : '09:00',
        end: f.end.includes('T') ? f.end.split('T')[1] : '10:00'
      }
      f.start = f.start.includes('T') ? f.start.split('T')[0] : f.start
      f.end = f.end.includes('T') ? f.end.split('T')[0] : f.end
    } else {
      const st = savedTimes.value?.start || '09:00'
      const et = savedTimes.value?.end || '10:00'
      f.start = f.start.includes('T') ? f.start : f.start + 'T' + st
      f.end = f.end.includes('T') ? f.end : f.end + 'T' + et
      savedTimes.value = null
    }
  }

  function addReminder() {
    form.reminders.push('15')
  }

  function removeReminder(idx: number) {
    form.reminders.splice(idx, 1)
  }

  const startDate = computed({
    get: () => form.start.split('T')[0],
    set: (v: string) => {
      const time = form.start.includes('T') ? form.start.split('T')[1] : '09:00'
      form.start = form.allDay ? v : `${v}T${time}`
      onStartChange()
    }
  })

  const startTime = computed({
    get: () => (form.start.includes('T') ? form.start.split('T')[1] : '09:00'),
    set: (v: string) => {
      const date = form.start.split('T')[0]
      form.start = `${date}T${v}`
      onStartChange()
    }
  })

  const endDate = computed({
    get: () => form.end.split('T')[0],
    set: (v: string) => {
      const time = form.end.includes('T') ? form.end.split('T')[1] : '10:00'
      form.end = form.allDay ? v : `${v}T${time}`
    }
  })

  const endTime = computed({
    get: () => (form.end.includes('T') ? form.end.split('T')[1] : '10:00'),
    set: (v: string) => {
      const date = form.end.split('T')[0]
      form.end = `${date}T${v}`
    }
  })

  function onWheelDate(field: 'start' | 'end', e: WheelEvent) {
    if (opts.isPreview.value) return
    shiftDate(field, e.deltaY < 0 ? 1 : -1)
  }

  function shiftDate(field: 'start' | 'end', offset: number) {
    const key = field === 'start' ? 'start' : 'end'
    const val = form[key]
    const datePart = val.split('T')[0]
    const timePart = val.includes('T') ? val.split('T')[1] : ''
    const d = new Date(datePart + 'T00:00:00')
    d.setDate(d.getDate() + offset)
    const newDate = formatDate(d)
    form[key] = timePart ? `${newDate}T${timePart}` : newDate
  }

  const endBeforeStart = computed(() => {
    if (!form.start || !form.end) return false
    return form.end < form.start
  })

  function onStartChange() {
    if (!form.end || form.end < form.start) {
      if (form.allDay) {
        form.end = form.start
      } else {
        const s = new Date(form.start.replace('T', ' '))
        s.setHours(s.getHours() + 1)
        form.end = fmtLocal(s)
      }
    }
  }

  /** Reset the form for a new event. */
  function initCreate(seed: EventFormSeed = {}, defaultCalendarUrl = '') {
    savedTimes.value = null
    const defaults = opts.defaults?.() ?? {}
    const duration = defaults.durationMinutes
    const durationMinutes =
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? duration
        : DEFAULT_EVENT_DURATION_MINUTES
    const s = seed.start ?? roundUpTo15(new Date())
    const e = seed.end ?? new Date(s.getTime() + durationMinutes * 60000)
    const isAllDay = seed.allDay ?? false
    Object.assign(form, {
      title: '',
      description: '',
      location: '',
      calendarUrl: defaultCalendarUrl || defaults.calendarUrl || '',
      allDay: isAllDay,
      rrule: '',
      reminders: (defaults.reminders ?? [])
        .filter((minutes) => Number.isFinite(minutes) && minutes >= 0)
        .map(String),
      start: isAllDay ? fmtLocal(s).split('T')[0] : fmtLocal(s),
      end: isAllDay ? fmtLocal(e).split('T')[0] : fmtLocal(e)
    })
  }

  /** Fill the form from an existing event (opens in preview mode). */
  function initFromEvent(event: CalendarEvent) {
    savedTimes.value = null
    const isAllDay = event.isAllDay ?? !event.start.includes(' ')
    Object.assign(form, {
      title: event.title,
      start: isAllDay ? event.start : event.start.replace(' ', 'T'),
      end: isAllDay ? addDays(event.end, -1) : event.end.replace(' ', 'T'),
      description: event.description || '',
      location: event.location || '',
      calendarUrl: event.calendarId,
      allDay: isAllDay,
      rrule: event.rrule || '',
      reminders: (event.reminders ?? (event.reminder != null ? [event.reminder] : [])).map(String)
    })
  }

  /** Convert the form into the server-side event shape. */
  function toSavePayload(): EventSavePayload {
    const f = form
    return {
      title: f.title,
      start: f.allDay ? f.start : f.start.replace('T', ' '),
      end: f.allDay ? addDays(f.end, 1) : f.end.replace('T', ' '),
      description: f.description || undefined,
      location: f.location || undefined,
      isAllDay: f.allDay,
      rrule: f.rrule || undefined,
      reminders: f.reminders.map((r) => Number(r)).filter((n) => Number.isFinite(n) && n >= 0),
      calendarUrl: f.calendarUrl
    }
  }

  return {
    form,
    savedTimes,
    startDate,
    startTime,
    endDate,
    endTime,
    endBeforeStart,
    onAllDayToggle,
    addReminder,
    removeReminder,
    onWheelDate,
    shiftDate,
    initCreate,
    initFromEvent,
    toSavePayload
  }
}
