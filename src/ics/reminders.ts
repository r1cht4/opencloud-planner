/**
 * reminders.ts – VALARM (reminder) helpers moved out of `useCalendarService`.
 *
 * The UI models reminders as ACTION:DISPLAY alarms with a negative TRIGGER;
 * these helpers read those lead times back, normalise the two shapes the service
 * accepts and rewrite the display alarms of a VEVENT.
 */

import { asIcalDuration, type IcalApi, type IcalComponent } from './ical'

/** Lead times (minutes) of all UI-managed DISPLAY alarms on a VEVENT. */
export function getRemindersFromVevent(vevent: IcalComponent): number[] {
  const reminders: number[] = []
  for (const valarm of vevent.getAllSubcomponents('valarm')) {
    const action = valarm.getFirstPropertyValue('action')
    if (action && String(action).toUpperCase() !== 'DISPLAY') continue
    const minutes = reminderMinutesOfValarm(valarm)
    if (minutes !== null) {
      // Sign kept: -PT15M → 15 (before), +PT9H → -540 (after the start; all-day birthday alarms).
      reminders.push(minutes)
    }
  }
  return reminders
}

/**
 * Normalise the two reminder shapes the UI/service accept:
 *  - `reminders: number[]` (current, possibly empty)
 *  - `reminder: number`     (legacy single value)
 * Returns undefined when neither is present, meaning "leave alarms untouched".
 */
export function normalizeReminders(event: {
  reminder?: number
  reminders?: number[]
}): number[] | undefined {
  if (event.reminders !== undefined) return event.reminders
  if (event.reminder !== undefined && event.reminder >= 0) return [event.reminder]
  return undefined
}

/**
 * Lead time (minutes, signed) of a DISPLAY VALARM's TRIGGER: -PT15M → 15
 * (before the start), +PT9H → -540 (after it). Null when the trigger is not a
 * duration (e.g. an absolute DATE-TIME trigger).
 */
function reminderMinutesOfValarm(valarm: IcalComponent): number | null {
  const trigger = asIcalDuration(valarm.getFirstPropertyValue('trigger'))
  return trigger ? -trigger.toSeconds() / 60 : null
}

/**
 * Replace the UI-managed (ACTION:DISPLAY) VALARMs with one per reminder,
 * preserving alarms the UI does not model (ACTION:EMAIL, etc.).
 *
 * An existing DISPLAY VALARM whose trigger is *unchanged* (its lead time is
 * one of the requested reminders) is kept verbatim — ACKNOWLEDGED,
 * X-MOZ-LASTACK, alarm UID and any other foreign property survive, so
 * Thunderbird does not re-fire a dismissed reminder. Only the alarms whose
 * trigger is no longer wanted are removed, and only the missing reminders are
 * created fresh. A `reminders` of `[]` clears all display alarms; `undefined`
 * leaves the VEVENT untouched.
 */
export function applyReminders(
  ical: IcalApi,
  vevent: IcalComponent,
  reminders: number[] | undefined,
  title: string
): void {
  if (reminders === undefined) return
  const wanted = [...reminders]
  for (const valarm of vevent.getAllSubcomponents('valarm')) {
    const action = valarm.getFirstPropertyValue('action')
    if (!action || String(action).toUpperCase() !== 'DISPLAY') continue
    const minutes = reminderMinutesOfValarm(valarm)
    const match = minutes !== null ? wanted.indexOf(minutes) : -1
    if (match !== -1) {
      // Unchanged trigger: keep this VALARM exactly as it is.
      wanted.splice(match, 1)
    } else {
      vevent.removeSubcomponent(valarm)
    }
  }
  for (const minutes of wanted) {
    const alarm = new ical.Component('valarm')
    alarm.updatePropertyWithValue('action', 'DISPLAY')
    alarm.updatePropertyWithValue(
      'trigger',
      ical.Duration.fromString(formatReminderTrigger(minutes))
    )
    alarm.updatePropertyWithValue('description', title)
    vevent.addSubcomponent(alarm)
  }
}

/** Format a reminder duration in minutes to RFC 5545 format (e.g. PT1H30M). */
function formatReminderDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? (m > 0 ? `PT${h}H${m}M` : `PT${h}H`) : `PT${m}M`
}

/**
 * RFC 5545 trigger for a lead time in minutes: positive = before the start
 * (`-PT15M`), negative = after it (`+PT9H`, used for "09:00 on the day" of
 * all-day events such as birthdays).
 */
export function formatReminderTrigger(minutes: number): string {
  const sign = minutes < 0 ? '+' : '-'
  return `${sign}${formatReminderDuration(Math.abs(minutes))}`
}
