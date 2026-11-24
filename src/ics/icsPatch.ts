/**
 * icsPatch.ts – ICS document building and patching, moved out of
 * `useCalendarService` (same output, byte for byte).
 */

import { asIcalTime, getICAL, paramText } from './ical'
import { applyReminders, formatReminderTrigger, normalizeReminders } from './reminders'
import {
  applyEventTimes,
  getMasterVevent,
  parseRecurrenceId,
  sameIcalTime,
  setRecurrenceIdProperty,
  updateVeventFields
} from './vevent'

export async function buildIcs(event: {
  id: string
  title: string
  start: string
  end: string
  description?: string
  location?: string
  rrule?: string
  reminder?: number
  reminders?: number[]
}): Promise<string> {
  const ical = await getICAL()

  // RFC 5545 §3.1: lines MUST NOT exceed 75 octets (excluding CRLF).
  // ical.js folds at foldLength chars; continuation lines prepend a space (1 octet),
  // so setting foldLength=74 ensures physical lines are at most 75 octets.
  const prevFoldLength: number = ical.foldLength
  ical.foldLength = 74

  try {
    const comp = new ical.Component('vcalendar')
    comp.updatePropertyWithValue('version', '2.0')
    comp.updatePropertyWithValue('prodid', '-//OpenCloud//Planner//EN')

    // The VEVENT is attached at the end so a generated VTIMEZONE precedes it.
    const vevent = new ical.Component('vevent')

    vevent.updatePropertyWithValue('uid', event.id)
    vevent.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))
    // ical.js handles escaping and folding — do NOT double-escape the title
    vevent.updatePropertyWithValue('summary', event.title)

    // DTSTART/DTEND (all-day VALUE=DATE or timed with TZID + generated
    // VTIMEZONE) come from the shared helper — never hand-rolled per call site.
    applyEventTimes(ical, vevent, event.start, event.end, comp)

    if (event.rrule) {
      vevent.updatePropertyWithValue('rrule', ical.Recur.fromString(event.rrule))
    }
    if (event.description) {
      vevent.updatePropertyWithValue('description', event.description)
    }
    if (event.location) {
      vevent.updatePropertyWithValue('location', event.location)
    }
    const reminders = normalizeReminders(event)
    if (reminders) {
      for (const minutes of reminders) {
        const alarm = new ical.Component('valarm')
        vevent.addSubcomponent(alarm)
        alarm.updatePropertyWithValue('action', 'DISPLAY')
        alarm.updatePropertyWithValue(
          'trigger',
          ical.Duration.fromString(formatReminderTrigger(minutes))
        )
        alarm.updatePropertyWithValue('description', event.title)
      }
    }

    comp.addSubcomponent(vevent)

    return comp.toString()
  } finally {
    ical.foldLength = prevFoldLength
  }
}

/**
 * Patch an existing ICS string with updated UI-managed fields while preserving
 * every other property (ATTENDEE, ORGANIZER, X-* props, non-DISPLAY alarms, etc.).
 *
 * Only the following properties are touched on the VEVENT:
 *   SUMMARY, DTSTART, DTEND, DTSTAMP, DESCRIPTION, LOCATION, RRULE,
 *   and the ACTION:DISPLAY VALARM subcomponents (the UI manages reminders).
 *
 * All other properties and subcomponents are left intact, guaranteeing
 * round-trip fidelity for data the UI does not model.
 */
export async function patchIcs(
  rawIcs: string,
  event: {
    title: string
    start: string
    end: string
    description?: string
    location?: string
    rrule?: string
    reminder?: number
    reminders?: number[]
  }
): Promise<string> {
  const ical = await getICAL()
  const jcal = ical.parse(rawIcs)
  const comp = new ical.Component(jcal)
  // The *master* VEVENT, not simply the first one: files written by other
  // clients may list a RECURRENCE-ID override before the master, and patching
  // the override would rename the one-off instance and give it the series RRULE
  // while leaving the master untouched.
  const vevent = getMasterVevent(comp)
  if (!vevent) throw new Error('patchIcs: no VEVENT found in rawIcs')

  // --- DTSTAMP (always refresh to now, UTC) ---
  // ICAL.Time.fromJSDate(date, useUTC) produces a proper UTC time value.
  vevent.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))

  // --- SUMMARY ---
  vevent.updatePropertyWithValue('summary', event.title)

  // --- DTSTART / DTEND ---
  // Same shared helper as buildIcs/updateVeventFields: the viewer's LOCAL wall
  // clock is re-tagged with the local zone (never the original TZID, which would
  // reinterpret the digits in a foreign zone and shift the event on every save),
  // and a VTIMEZONE is generated when the file has none for that zone.
  applyEventTimes(ical, vevent, event.start, event.end, comp)

  // --- DESCRIPTION ---
  if (event.description) {
    vevent.updatePropertyWithValue('description', event.description)
  } else {
    vevent.removeProperty('description')
  }

  // --- LOCATION ---
  if (event.location) {
    vevent.updatePropertyWithValue('location', event.location)
  } else {
    vevent.removeProperty('location')
  }

  // --- RRULE ---
  if (event.rrule) {
    vevent.updatePropertyWithValue('rrule', ical.Recur.fromString(event.rrule))
  } else {
    vevent.removeProperty('rrule')
  }

  // --- VALARMs: the UI models reminders as ACTION:DISPLAY alarms. Replace all
  // of them with one per reminder; leave non-DISPLAY alarms (EMAIL, AUDIO, …)
  // from other clients untouched. `reminders` undefined means "leave as-is".
  applyReminders(ical, vevent, normalizeReminders(event), event.title)

  return comp.toString()
}

export async function addExdateToIcs(rawIcs: string, recurrenceId: string): Promise<string> {
  const ical = await getICAL()
  const jcal = ical.parse(rawIcs)
  const comp = new ical.Component(jcal)
  const vevent = getMasterVevent(comp)
  if (!vevent) throw new Error('addExdateToIcs: no VEVENT found in rawIcs')

  const dtstartProp = vevent.getFirstProperty('dtstart')
  const recurrenceTime = parseRecurrenceId(ical, recurrenceId, dtstartProp)
  const existing = vevent
    .getAllProperties('exdate')
    .flatMap((prop) => prop.getValues())
    .some((value) => {
      const exdate = asIcalTime(value)
      return exdate ? sameIcalTime(ical, exdate, recurrenceTime) : false
    })

  if (!existing) {
    const exdateProp = new ical.Property('exdate', vevent)
    if (recurrenceTime.isDate) {
      exdateProp.resetType('date')
    } else {
      exdateProp.resetType('date-time')
      const tzid = paramText(dtstartProp?.getParameter('tzid'))
      if (tzid) exdateProp.setParameter('tzid', tzid)
    }
    exdateProp.setValue(recurrenceTime)
    vevent.addProperty(exdateProp)
  }

  vevent.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))
  return comp.toString()
}

export async function upsertRecurrenceOverrideIcs(
  rawIcs: string,
  recurrenceId: string,
  event: {
    title: string
    start: string
    end: string
    description?: string
    location?: string
    reminder?: number
    reminders?: number[]
  }
): Promise<string> {
  const ical = await getICAL()
  const jcal = ical.parse(rawIcs)
  const comp = new ical.Component(jcal)
  const master = getMasterVevent(comp)
  if (!master) throw new Error('upsertRecurrenceOverrideIcs: no VEVENT found in rawIcs')

  const uid = master.getFirstPropertyValue('uid')
  const dtstartProp = master.getFirstProperty('dtstart')
  const recurrenceTime = parseRecurrenceId(ical, recurrenceId, dtstartProp)

  for (const vevent of comp.getAllSubcomponents('vevent')) {
    if (!vevent.hasProperty('recurrence-id')) continue
    if (uid && vevent.getFirstPropertyValue('uid') !== uid) continue
    const existingRecurrenceId = asIcalTime(vevent.getFirstPropertyValue('recurrence-id'))
    if (existingRecurrenceId && sameIcalTime(ical, existingRecurrenceId, recurrenceTime)) {
      comp.removeSubcomponent(vevent)
    }
  }

  const override = new ical.Component(JSON.parse(JSON.stringify(master.jCal)))
  override.removeAllProperties('rrule')
  override.removeAllProperties('rdate')
  override.removeAllProperties('exdate')
  setRecurrenceIdProperty(ical, override, recurrenceTime, dtstartProp)
  updateVeventFields(ical, override, event, { includeRrule: false })
  comp.addSubcomponent(override)
  master.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))

  return comp.toString()
}
