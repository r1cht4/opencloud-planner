/**
 * Reminder alarm index — turns stored events/tasks into concrete "fire at"
 * moments the browser scheduler can arm timers for.
 *
 * The alarms come from the **raw ICS** (VALARM components), not from a UI
 * model: other clients write `RELATED=END` triggers, absolute triggers and
 * several VALARMs per item, and those must keep working. Recurring series are
 * expanded with the shared `expandRecurringEvents` so every occurrence gets its
 * own alarm (and its own notification key).
 *
 * Nothing here writes to the server: "shown" state is local (see `scheduler.ts`).
 */

import type { CalendarEvent, Task } from '../types'
import { expandRecurringEvents, zonedWallClockToDate } from '../composables/useCalendarService'
import { davResourceName } from '../composables/useDAVClient'
import {
  asIcalDuration,
  asIcalTime,
  getICAL,
  paramText,
  type IcalComponent,
  type IcalTime
} from '../ics/ical'

/** One reminder that is due inside the requested window. */
export interface DueAlarm {
  /**
   * `uid|occurrence|trigger|fireAt` — stable across refreshes and shared between
   * tabs. The fire time is part of the key: an item moved to a
   * later time gets a *new* key, so the "shown" log never suppresses the
   * reminder for the new time (dedupe across tabs still works).
   */
  key: string
  fireAt: Date
  title: string
  start?: Date
  kind: 'event' | 'task'
  /** Server URL of the .ics resource (used to open the item from a notification). */
  href: string
}

/**
 * Widest lead time we look for when expanding/collecting.
 *
 * An alarm fires `lead` *before* its item, so an item starting shortly after the
 * window end can still produce an alarm inside it (e.g. a one-day reminder).
 * One week covers every lead real clients write (-P1W) while keeping the
 * expansion window cheap.
 */
export const MAX_ALARM_LEAD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Read one of the model's wall-clock strings ('YYYY-MM-DD' or
 * 'YYYY-MM-DD HH:mm', viewer's local zone) as a local `Date`.
 */
function wallClockToDate(value: string): Date {
  const [datePart, timePart = '00:00'] = value.trim().split(/[ T]/)
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = (timePart || '00:00').split(':').map(Number)
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0)
}

/**
 * Absolute VALARM triggers carry `VALUE=DATE-TIME`. ical.js has no tz database,
 * so a trigger tagged with a bare IANA `TZID` parses as floating — resolve that
 * case via Intl offset probing, exactly like the item parsers do.
 */
function icalTimeToDate(time: IcalTime, tzidParam?: string | null): Date | null {
  if (time.isDate) return time.toJSDate()
  const zoneId: string | undefined = time.zone?.tzid
  const unresolved = (!zoneId || zoneId === 'floating') && !!tzidParam && tzidParam !== 'UTC'
  if (unresolved) {
    const resolved = zonedWallClockToDate(
      time.year,
      time.month,
      time.day,
      time.hour,
      time.minute,
      tzidParam!
    )
    if (resolved) return resolved
  }
  try {
    return time.toJSDate()
  } catch {
    return null
  }
}

/** A VALARM as read from the ICS, still independent of the item it belongs to. */
interface AlarmTrigger {
  /** Stable fragment for the notification key (`-900:START`, `ABS:<iso>`, `DUE`). */
  label: string
  /** `RELATED` parameter; `null` means "not given" (START for events, DUE for tasks). */
  related: 'START' | 'END' | null
  /** Relative trigger offset in ms (negative = before), `null` for absolute triggers. */
  offsetMs: number | null
  /** Absolute trigger instant, `null` for relative triggers. */
  at: Date | null
}

/** Digit-normalised RECURRENCE-ID so '2026-12-02T15:00:00' matches its variants. */
function sameRecurrenceId(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/[^0-9]/g, '')
  return normalize(a) === normalize(b)
}

/** The VEVENT a recurring occurrence belongs to (its override, else the master). */
function pickEventComponent(
  components: IcalComponent[],
  recurrenceId?: string
): IcalComponent | null {
  const master = components.find((comp) => !comp.hasProperty('recurrence-id'))
  if (!recurrenceId) return master ?? components[0] ?? null
  const override = components.find((comp) => {
    const value = comp.getFirstPropertyValue('recurrence-id')
    return value ? sameRecurrenceId(String(value), recurrenceId) : false
  })
  return override ?? master ?? components[0] ?? null
}

/**
 * All DISPLAY alarms of the given ICS resource.
 *
 * Only `ACTION:DISPLAY` becomes a browser notification; `ACTION:EMAIL` /
 * `ACTION:AUDIO` alarms are somebody else's job and stay untouched (we never
 * write, so they are simply not shown).
 */
async function readTriggers(
  rawIcs: string | undefined,
  kind: 'event' | 'task',
  recurrenceId?: string
): Promise<AlarmTrigger[]> {
  if (!rawIcs) return []
  const ical = await getICAL()

  let comp: IcalComponent
  try {
    comp = new ical.Component(ical.parse(rawIcs))
  } catch {
    return []
  }

  const components = comp.getAllSubcomponents(kind === 'event' ? 'vevent' : 'vtodo') ?? []
  const source =
    kind === 'event'
      ? pickEventComponent(components, recurrenceId)
      : (components.find((item) => !item.hasProperty('recurrence-id')) ?? components[0] ?? null)
  if (!source) return []

  const triggers: AlarmTrigger[] = []
  for (const valarm of source.getAllSubcomponents('valarm') ?? []) {
    const action = valarm.getFirstPropertyValue('action')
    if (action && String(action).toUpperCase() !== 'DISPLAY') continue

    const prop = valarm.getFirstProperty('trigger')
    const value = prop?.getFirstValue()
    if (!value) continue

    const relatedParam = prop.getParameter('related')
      ? String(prop.getParameter('related')).toUpperCase() === 'END'
        ? 'END'
        : 'START'
      : null

    const duration = asIcalDuration(value)
    if (duration) {
      // Relative trigger (DURATION): negative means "before".
      const seconds = duration.toSeconds()
      triggers.push({
        label: `${seconds}:${relatedParam ?? 'DEFAULT'}`,
        related: relatedParam,
        offsetMs: seconds * 1000,
        at: null
      })
      continue
    }

    const absolute = asIcalTime(value)
    if (absolute) {
      const at = icalTimeToDate(absolute, paramText(prop?.getParameter('tzid')))
      if (!at) continue
      triggers.push({ label: `ABS:${at.toISOString()}`, related: relatedParam, offsetMs: null, at })
    }
  }
  return triggers
}

/**
 * Fallback for events without parseable VALARMs: the UI model carries reminder
 * lead times in minutes (always relative to the start), so honour them instead
 * of silently dropping the reminder.
 */
function modelTriggers(event: CalendarEvent): AlarmTrigger[] {
  const minutes =
    event.reminders ?? (event.reminder !== undefined && event.reminder >= 0 ? [event.reminder] : [])
  return minutes.map((value) => {
    const trigger: AlarmTrigger = {
      label: `${-value * 60}:DEFAULT`,
      related: null,
      offsetMs: -value * 60_000,
      at: null
    }
    return trigger
  })
}

/**
 * Collect every alarm that fires inside `[from, to]`.
 *
 * Handles relative triggers (RELATED=START, the default, and RELATED=END),
 * absolute triggers, all-day items (anchor = local midnight), recurring
 * occurrences (each occurrence is expanded and keeps its own key) and task
 * alarms anchored on DUE.
 *
 * `taskDefaultReminderMinutes` opts in to a reminder for tasks that carry **no**
 * VALARM at all (e.g. tasks created in this app, or in a client that does not
 * write alarms): `N` minutes before DUE, `0` = at the due time. `undefined`
 * (the default) keeps those tasks silent — with many dated tasks an implicit
 * reminder per task would be noise, so it has to be enabled deliberately.
 */
export async function collectDueAlarms(
  events: CalendarEvent[],
  tasks: Task[],
  from: Date,
  to: Date,
  taskDefaultReminderMinutes?: number
): Promise<DueAlarm[]> {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const inWindow = (date: Date) => date.getTime() >= fromMs && date.getTime() <= toMs

  // Occurrences are expanded with the lead time on both sides: an item may start
  // before the window (END-relative alarm inside it) or after it (lead pushes the
  // alarm back into the window).
  const occurrences = await expandRecurringEvents(
    events,
    new Date(fromMs - MAX_ALARM_LEAD_MS),
    new Date(toMs + MAX_ALARM_LEAD_MS)
  )

  const alarms = new Map<string, DueAlarm>()

  const remember = (alarm: DueAlarm) => {
    const existing = alarms.get(alarm.key)
    // Same key twice (e.g. an override repeating the master's VALARM): keep one.
    if (existing && existing.fireAt.getTime() <= alarm.fireAt.getTime()) return
    alarms.set(alarm.key, alarm)
  }

  for (const occurrence of occurrences) {
    const start = wallClockToDate(occurrence.start)
    const end = occurrence.end ? wallClockToDate(occurrence.end) : start
    const uid = occurrence.recurringEventId || occurrence.id
    const occurrenceId = occurrence.recurrenceId ?? 'single'
    // Safe resource name for the fallback href (real occurrences carry one).
    const href = occurrence.href || `${occurrence.calendarId}${await davResourceName(uid)}.ics`

    let triggers = await readTriggers(occurrence.rawIcs, 'event', occurrence.recurrenceId)
    if (triggers.length === 0) triggers = modelTriggers(occurrence)

    for (const trigger of triggers) {
      const anchor = trigger.related === 'END' ? end : start
      const fireAt = trigger.at ?? new Date(anchor.getTime() + (trigger.offsetMs ?? 0))
      if (!inWindow(fireAt)) continue
      remember({
        key: `${uid}|${occurrenceId}|${trigger.label}|${fireAt.toISOString()}`,
        fireAt,
        title: occurrence.title,
        start,
        kind: 'event',
        href
      })
    }
  }

  for (const task of tasks) {
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') continue

    const taskStart = task.start ? wallClockToDate(task.start) : undefined
    const taskDue = task.due ? wallClockToDate(task.due) : undefined
    if (!taskDue && !taskStart) continue

    const href = task.href || `${task.calendarId}${await davResourceName(task.id)}.ics`
    let triggers = await readTriggers(task.rawIcs, 'task')
    if (triggers.length === 0) {
      // No VALARM from any client. An implicit reminder is opt-in (setting
      // `tasks.defaultReminder`); without it the task stays silent. It needs a
      // DUE date — "N minutes before DUE" is meaningless for a start-only task.
      const minutes = taskDefaultReminderMinutes
      if (minutes === undefined || !taskDue) continue
      triggers = [
        { label: `${-minutes * 60}:DEFAULT`, related: null, offsetMs: -minutes * 60_000, at: null }
      ]
    }

    for (const trigger of triggers) {
      // VTODO anchors: DUE by default, DTSTART when the alarm says RELATED=START.
      const anchor = trigger.related === 'START' ? (taskStart ?? taskDue!) : (taskDue ?? taskStart!)
      const fireAt = trigger.at ?? new Date(anchor.getTime() + (trigger.offsetMs ?? 0))
      if (!inWindow(fireAt)) continue
      remember({
        key: `${task.id}|single|${trigger.label}|${fireAt.toISOString()}`,
        fireAt,
        title: task.title,
        start: taskDue ?? taskStart,
        kind: 'task',
        href
      })
    }
  }

  return [...alarms.values()].sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
