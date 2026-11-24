/**
 * vtodo.ts – pure VTODO (task) ↔ ICS conversions and list shaping, moved out of
 * `useTasksService` (same behaviour, same code).
 */

import { asIcalTime, getICAL, paramText, type IcalApi, type IcalComponent } from './ical'
import { getLocalTimeZone, icalTimeToLocalString } from './datetime'
import { ensureVtimezone } from '../composables/vtimezone'
import { parseSupportedComponents } from '../composables/davCollections'
import type { Task, TaskStatus } from '../types'

/** The ICS component this module reads and writes. */
export const TASK_COMPONENT = 'VTODO'

export type TaskFilter = 'open' | 'completed' | 'all'

/** Tasks the user is done with — completed or cancelled. */
export function isTaskDone(task: Task): boolean {
  return task.status === 'COMPLETED' || task.status === 'CANCELLED'
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  if (filter === 'all') return tasks.slice()
  if (filter === 'completed') return tasks.filter(isTaskDone)
  return tasks.filter((task) => !isTaskDone(task))
}

/**
 * Sort by due date ascending with undated tasks last, then by priority
 * (1 = highest, 0 = none sorts last), then by title.
 */
export function sortTasks(tasks: Task[]): Task[] {
  const dueKey = (task: Task) => task.due || '9999-99-99'
  const priorityRank = (priority: number) => (priority >= 1 && priority <= 9 ? priority : 10)
  return tasks.slice().sort((a, b) => {
    const byDue = dueKey(a).localeCompare(dueKey(b))
    if (byDue !== 0) return byDue
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    return a.title.localeCompare(b.title)
  })
}

/** A `due`/`start` value is date-only exactly when it carries no time part. */
function isDateOnly(value: string): boolean {
  return !value.includes(' ')
}

function normalizeStatus(raw: unknown, hasCompleted: boolean): TaskStatus {
  const value = String(raw ?? '').toUpperCase()
  if (
    value === 'COMPLETED' ||
    value === 'CANCELLED' ||
    value === 'IN-PROCESS' ||
    value === 'NEEDS-ACTION'
  ) {
    return value
  }
  // RFC 5545 §3.8.1.11: no STATUS defaults to NEEDS-ACTION. A COMPLETED stamp
  // from another client is a strong hint that the task is done.
  return hasCompleted ? 'COMPLETED' : 'NEEDS-ACTION'
}

/** All CATEGORIES values (the property is multi-valued). */
function readCategories(vtodo: IcalComponent): string[] | undefined {
  const categories: string[] = []
  for (const prop of vtodo.getAllProperties('categories') ?? []) {
    const values: unknown[] = prop.getValues()
    for (const value of values) {
      if (typeof value === 'string') {
        categories.push(...value.split(',').map((v) => v.trim()))
      }
    }
  }
  const cleaned = categories.filter(Boolean)
  return cleaned.length ? cleaned : undefined
}

/** The VTODO to read/write: the master when the resource holds overrides. */
function getMasterVtodo(comp: IcalComponent): IcalComponent | null {
  const vtodos = comp.getAllSubcomponents('vtodo')
  return vtodos.find((vtodo) => !vtodo.hasProperty('recurrence-id')) || vtodos[0] || null
}

/**
 * Parse a VTODO resource into the internal task model. Returns null when the
 * document holds no VTODO (a calendar can mix events and tasks).
 */
export async function parseVtodoToTask(
  icsString: string,
  calendarId: string,
  href?: string,
  etag?: string
): Promise<Task | null> {
  try {
    const ical = await getICAL()
    const comp = new ical.Component(ical.parse(icsString))
    const vtodo = getMasterVtodo(comp)
    if (!vtodo) return null

    const dueProp = vtodo.getFirstProperty('due')
    const dueValue = asIcalTime(dueProp?.getFirstValue())
    const startProp = vtodo.getFirstProperty('dtstart')
    const startValue = asIcalTime(startProp?.getFirstValue())
    const completedValue = asIcalTime(vtodo.getFirstPropertyValue('completed'))
    const status = normalizeStatus(vtodo.getFirstPropertyValue('status'), !!completedValue)

    const percentRaw = vtodo.getFirstPropertyValue('percent-complete')
    const percentComplete =
      percentRaw === null || percentRaw === undefined || percentRaw === ''
        ? status === 'COMPLETED'
          ? 100
          : 0
        : Number(percentRaw) || 0

    const uid =
      String(vtodo.getFirstPropertyValue('uid') || '') ||
      (href
        ? decodeURIComponent(href.split('/').filter(Boolean).pop() || '').replace(/\.ics$/, '')
        : '')

    return {
      id: uid,
      title: String(vtodo.getFirstPropertyValue('summary') || '(untitled)'),
      description: String(vtodo.getFirstPropertyValue('description') || '') || undefined,
      due: dueValue
        ? icalTimeToLocalString(dueValue, paramText(dueProp?.getParameter('tzid')))
        : undefined,
      start: startValue
        ? icalTimeToLocalString(startValue, paramText(startProp?.getParameter('tzid')))
        : undefined,
      priority: Number(vtodo.getFirstPropertyValue('priority') ?? 0) || 0,
      status,
      completed: completedValue ? icalTimeToLocalString(completedValue, null) : undefined,
      percentComplete,
      categories: readCategories(vtodo),
      calendarId,
      href,
      etag,
      rawIcs: icsString
    }
  } catch (err) {
    console.warn('[planner] Failed to parse VTODO:', err)
    return null
  }
}

/**
 * True when a PROPFIND response describes a collection that can hold VTODOs.
 *
 * An absent (or empty) `supported-calendar-component-set` means the server
 * default applies, which we accept; an explicit set must list VTODO.
 */
export function supportsTasks(el: Element): boolean {
  const components = parseSupportedComponents(el)
  if (components.length === 0) return true
  return components.includes(TASK_COMPONENT)
}

/** REPORT body selecting VTODOs (no time-range: tasks are not time-bounded). */
export function buildTaskQueryBody(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="${TASK_COMPONENT}"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

/**
 * (Re)write a date / date-time property. Timed values are tagged with the local
 * zone (the model holds the viewer's wall clock) and VALUE=DATE otherwise.
 */
function setTimeProperty(ical: IcalApi, comp: IcalComponent, name: string, value: string): void {
  comp.removeProperty(name)
  const prop = new ical.Property(name, comp)
  if (isDateOnly(value)) {
    const [year, month, day] = value.split('-').map(Number)
    prop.resetType('date')
    // `Time.fromData` is the same as `new Time(data, undefined)` (floating).
    prop.setValue(ical.Time.fromData({ year, month, day, isDate: true }))
  } else {
    const [datePart, timePart] = value.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    prop.setValue(ical.Time.fromData({ year, month, day, hour, minute, second: 0, isDate: false }))
    prop.setParameter('tzid', getLocalTimeZone())
  }
  comp.addProperty(prop)
}

/** RFC 5545 PRIORITY: 0 removes the property, 1–9 is stored verbatim. */
function applyPriority(vtodo: IcalComponent, priority: number): void {
  const value = Number(priority) || 0
  if (value >= 1 && value <= 9) {
    vtodo.updatePropertyWithValue('priority', value)
  } else {
    vtodo.removeProperty('priority')
  }
}

function applyCategories(ical: IcalApi, vtodo: IcalComponent, categories?: string[]): void {
  const values = (categories ?? []).map((c) => c.trim()).filter(Boolean)
  vtodo.removeProperty('categories')
  if (values.length === 0) return
  // The property is multi-valued: build it from its jCal form so commas are
  // separators, not escaped text.
  vtodo.addProperty(new ical.Property(['categories', {}, 'text', ...values]))
}

/**
 * Apply a completion state: completing stamps STATUS/COMPLETED/PERCENT-COMPLETE,
 * reopening clears the stamp again (RFC 5545 §3.8.1.11 / §3.8.4.2).
 */
function applyCompletion(ical: IcalApi, vtodo: IcalComponent, completed: boolean, now: Date): void {
  if (completed) {
    vtodo.updatePropertyWithValue('status', 'COMPLETED')
    vtodo.updatePropertyWithValue('completed', ical.Time.fromJSDate(now, true))
    vtodo.updatePropertyWithValue('percent-complete', 100)
  } else {
    vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION')
    vtodo.removeProperty('completed')
    vtodo.updatePropertyWithValue('percent-complete', 0)
  }
}

/**
 * Build a fresh VCALENDAR around one VTODO (create path).
 *
 * `task.start`/`task.due` timed values carry the viewer's wall clock, so they are
 * re-tagged with the local zone plus a generated VTIMEZONE (same as events).
 */
export async function buildTodoIcs(task: Task): Promise<string> {
  const ical = await getICAL()

  // RFC 5545 §3.1: physical lines MUST NOT exceed 75 octets.
  const prevFoldLength: number = ical.foldLength
  ical.foldLength = 74

  try {
    const comp = new ical.Component('vcalendar')
    comp.updatePropertyWithValue('version', '2.0')
    comp.updatePropertyWithValue('prodid', '-//OpenCloud//Planner//EN')

    // The VTODO is attached last so generated VTIMEZONEs precede it.
    const vtodo = new ical.Component('vtodo')
    vtodo.updatePropertyWithValue('uid', task.id)
    vtodo.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))
    vtodo.updatePropertyWithValue('summary', task.title)

    if (task.description) {
      vtodo.updatePropertyWithValue('description', task.description)
    }

    for (const [name, value] of [
      ['due', task.due],
      ['dtstart', task.start]
    ] as const) {
      if (!value) continue
      setTimeProperty(ical, vtodo, name, value)
      if (!isDateOnly(value))
        ensureVtimezone(ical, comp, getLocalTimeZone(), Number(value.slice(0, 4)))
    }

    applyPriority(vtodo, task.priority)
    applyCategories(ical, vtodo, task.categories)

    vtodo.updatePropertyWithValue('status', task.status || 'NEEDS-ACTION')
    vtodo.updatePropertyWithValue('percent-complete', Number(task.percentComplete) || 0)
    if (task.completed) {
      // COMPLETED is an absolute (UTC) timestamp; the model holds local wall time.
      const [datePart, timePart = '00:00'] = task.completed.split(' ')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      vtodo.updatePropertyWithValue(
        'completed',
        ical.Time.fromJSDate(new Date(year, month - 1, day, hour, minute), true)
      )
    }

    comp.addSubcomponent(vtodo)
    return comp.toString()
  } finally {
    ical.foldLength = prevFoldLength
  }
}

/**
 * Patch an existing VTODO resource in place, preserving everything the UI does
 * not model (X-MOZ-*, X-APPLE-*, VALARMs, RRULE, CREATED, LAST-MODIFIED, …).
 *
 * Touched properties: SUMMARY, DESCRIPTION, DUE, DTSTART, PRIORITY, CATEGORIES,
 * STATUS, COMPLETED, PERCENT-COMPLETE, DTSTAMP.
 */
export async function patchTodoIcs(rawIcs: string, task: Task): Promise<string> {
  const ical = await getICAL()
  const comp = new ical.Component(ical.parse(rawIcs))
  const vtodo = getMasterVtodo(comp)
  if (!vtodo) throw new Error('patchTodoIcs: no VTODO found in rawIcs')

  vtodo.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))
  vtodo.updatePropertyWithValue('summary', task.title)

  if (task.description) {
    vtodo.updatePropertyWithValue('description', task.description)
  } else {
    vtodo.removeProperty('description')
  }

  if (task.due) {
    setTimeProperty(ical, vtodo, 'due', task.due)
    // RFC 5545 §3.6.2: DUE and DURATION must not both be present.
    vtodo.removeProperty('duration')
    if (!isDateOnly(task.due)) {
      ensureVtimezone(ical, comp, getLocalTimeZone(), Number(task.due.slice(0, 4)))
    }
  } else {
    vtodo.removeProperty('due')
  }

  // DTSTART is optional in the model: only touch it when the caller supplies one,
  // so a task edited in the UI never loses a start date another client set.
  if (task.start) {
    setTimeProperty(ical, vtodo, 'dtstart', task.start)
    if (!isDateOnly(task.start)) {
      ensureVtimezone(ical, comp, getLocalTimeZone(), Number(task.start.slice(0, 4)))
    }
  }

  applyPriority(vtodo, task.priority)
  applyCategories(ical, vtodo, task.categories)

  const status: TaskStatus = task.status || 'NEEDS-ACTION'
  vtodo.updatePropertyWithValue('status', status)
  if (status === 'COMPLETED') {
    if (!vtodo.hasProperty('completed')) {
      vtodo.updatePropertyWithValue('completed', ical.Time.fromJSDate(new Date(), true))
    }
    vtodo.updatePropertyWithValue('percent-complete', Number(task.percentComplete) || 100)
  } else {
    vtodo.removeProperty('completed')
    vtodo.updatePropertyWithValue('percent-complete', Number(task.percentComplete) || 0)
  }

  return comp.toString()
}

/**
 * Flip the completion state of a stored VTODO without touching anything else.
 * Kept separate from `patchTodoIcs` so the checkbox never rewrites fields the
 * user did not edit (and so the behaviour is directly testable).
 */
export async function setTodoCompletedIcs(
  rawIcs: string,
  completed: boolean,
  now: Date = new Date()
): Promise<string> {
  const ical = await getICAL()
  const comp = new ical.Component(ical.parse(rawIcs))
  const vtodo = getMasterVtodo(comp)
  if (!vtodo) throw new Error('setTodoCompletedIcs: no VTODO found in rawIcs')

  applyCompletion(ical, vtodo, completed, now)
  vtodo.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(now, true))
  return comp.toString()
}
