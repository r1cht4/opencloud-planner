/**
 * vevent.ts – VEVENT read/write helpers moved out of `useCalendarService`.
 *
 * Everything that turns a `VEVENT` into the UI model and back lives here, plus
 * the single place where all-day vs. timed date properties are decided.
 */

import { ensureVtimezone } from '../composables/vtimezone'
import {
  asIcalTime,
  getICAL,
  paramText,
  type IcalApi,
  type IcalComponent,
  type IcalProperty,
  type IcalTime
} from './ical'
import { formatDate, formatDateTime, getLocalTimeZone, icalTimeToDate } from './datetime'
import { applyReminders, getRemindersFromVevent, normalizeReminders } from './reminders'
import type { CalendarEvent, EventAttendee, EventOrganizer } from '../types'

export function getMasterVevent(comp: IcalComponent): IcalComponent | null {
  const vevents = comp.getAllSubcomponents('vevent')
  return vevents.find((vevent) => !vevent.hasProperty('recurrence-id')) || vevents[0] || null
}

function getRruleFromVevent(vevent: IcalComponent): string | undefined {
  const rruleProp = vevent.getFirstPropertyValue('rrule')
  return rruleProp ? rruleProp.toString() : undefined
}

/**
 * Decode one CAL-ADDRESS property (`ORGANIZER`, `ATTENDEE`) into the UI shape:
 * the `mailto:` scheme is stripped and the `CN` parameter becomes the name.
 * Returns null for a missing/empty address so callers can skip the property.
 */
function parseCalAddress(prop: IcalProperty): { name?: string; email: string } | null {
  const value = prop.getFirstValue()
  if (!value) return null
  const email = String(value)
    .replace(/^mailto:/i, '')
    .trim()
  if (!email) return null
  const cn = prop.getParameter('cn')
  const name = Array.isArray(cn) ? cn[0] : cn
  return typeof name === 'string' && name.trim() ? { name: name.trim(), email } : { email }
}

/** ORGANIZER of a VEVENT as `{ name, email }` (undefined when absent). */
export function getOrganizerFromVevent(vevent: IcalComponent): EventOrganizer | undefined {
  const prop = vevent.getFirstProperty('organizer')
  if (!prop) return undefined
  return parseCalAddress(prop) ?? undefined
}

/** All ATTENDEEs of a VEVENT, with PARTSTAT/ROLE upper-cased (RFC 5545 values). */
export function getAttendeesFromVevent(vevent: IcalComponent): EventAttendee[] {
  const attendees: EventAttendee[] = []
  for (const prop of vevent.getAllProperties('attendee')) {
    const address = parseCalAddress(prop)
    if (!address) continue
    const partstat = prop.getParameter('partstat')
    const role = prop.getParameter('role')
    attendees.push({
      ...address,
      ...(partstat ? { partstat: String(partstat).toUpperCase() } : {}),
      ...(role ? { role: String(role).toUpperCase() } : {})
    })
  }
  return attendees
}

/**
 * Write DTSTART/DTEND (or any date/date-time property) on a VEVENT — the single
 * place where the all-day vs. timed shapes are decided.
 *
 * - all-day:  `VALUE=DATE` with the wall-clock date, no TZID.
 * - timed:    `TZID=<zone>` on a *floating* ICAL.Time, so the wall-clock digits
 *             in `value` ('YYYY-MM-DD HH:mm') are serialised verbatim. Callers
 *             must pass the viewer's local zone (event.start/end hold the local
 *             wall clock — re-using a foreign TZID would shift the event).
 *
 * Works on both fresh components (property appended) and existing events
 * (property replaced in place), so `buildIcs`, `patchIcs` and
 * `updateVeventFields` all share it.
 */
function applyTimeProperty(
  ical: IcalApi,
  vevent: IcalComponent,
  name: string,
  value: string,
  isAllDay: boolean,
  zone?: string | null
): IcalProperty {
  if (isAllDay) {
    const [y, m, d] = value.split('-').map(Number)
    vevent.removeProperty(name)
    const prop = new ical.Property(name, vevent)
    prop.resetType('date')
    // `Time.fromData` is `new Time(data, undefined)`, i.e. a floating time.
    prop.setValue(ical.Time.fromData({ year: y, month: m, day: d, isDate: true }))
    vevent.addProperty(prop)
    return prop
  }

  const [datePart, timePart] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const prop = vevent.updatePropertyWithValue(
    name,
    ical.Time.fromData({ year, month, day, hour, minute, second: 0, isDate: false })
  )
  prop.setParameter('tzid', zone || getLocalTimeZone())
  return prop
}

/** True when the UI's start/end strings describe an all-day event ('YYYY-MM-DD'). */
function isAllDayValue(start: string): boolean {
  return !start.includes(' ')
}

/**
 * Write the UI's start/end onto a VEVENT and, when the owning VCALENDAR is
 * given, make sure it carries a VTIMEZONE for the zone we tagged (timed events
 * only; all-day has no zone). `updateVeventFields` passes no component because
 * an override VEVENT is derived from a master in the same VCALENDAR, which
 * already carries its VTIMEZONE.
 */
export function applyEventTimes(
  ical: IcalApi,
  vevent: IcalComponent,
  start: string,
  end: string,
  comp?: IcalComponent
): void {
  const allDay = isAllDayValue(start)
  const zone: string | null = allDay ? null : getLocalTimeZone()

  applyTimeProperty(ical, vevent, 'dtstart', start, allDay, zone)
  applyTimeProperty(ical, vevent, 'dtend', end, allDay, zone)

  if (zone && comp) ensureVtimezone(ical, comp, zone, Number(start.slice(0, 4)))
}

export function setRecurrenceIdProperty(
  ical: IcalApi,
  vevent: IcalComponent,
  recurrenceTime: IcalTime,
  masterDtstartProp: IcalProperty | null
): void {
  vevent.removeProperty('recurrence-id')
  const prop = new ical.Property('recurrence-id', vevent)
  if (recurrenceTime.isDate) {
    prop.resetType('date')
  } else {
    prop.resetType('date-time')
    const tzid = masterDtstartProp?.getParameter('tzid')
    if (tzid) prop.setParameter('tzid', tzid)
  }
  prop.setValue(recurrenceTime)
  vevent.addProperty(prop)
}

export function sameIcalTime(ical: IcalApi, a: IcalTime, b: IcalTime): boolean {
  if (a.toString() === b.toString()) return true
  return (
    a.convertToZone(ical.Timezone.utcTimezone).toString() ===
    b.convertToZone(ical.Timezone.utcTimezone).toString()
  )
}

export function parseRecurrenceId(
  ical: IcalApi,
  recurrenceId: string,
  masterDtstartProp: IcalProperty | null
): IcalTime {
  const masterStart = asIcalTime(masterDtstartProp?.getFirstValue())
  const masterTzid = paramText(masterDtstartProp?.getParameter('tzid'))
  const isDate = masterStart?.isDate ?? !recurrenceId.includes('T')

  if (isDate) {
    const [year, month, day] = recurrenceId.slice(0, 10).split('-').map(Number)
    return ical.Time.fromData({ year, month, day, isDate: true })
  }

  if (/Z$/.test(recurrenceId)) {
    return ical.Time.fromJSDate(new Date(recurrenceId), true)
  }

  const [datePart, rawTimePart = '00:00:00'] = recurrenceId.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = '0'] = rawTimePart.split(':')
  return ical.Time.fromData({
    year,
    month,
    day,
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    isDate: false,
    timezone: masterTzid || undefined
  })
}

export function updateVeventFields(
  ical: IcalApi,
  vevent: IcalComponent,
  event: {
    title: string
    start: string
    end: string
    description?: string
    location?: string
    rrule?: string
    reminder?: number
    reminders?: number[]
  },
  options: { includeRrule?: boolean } = { includeRrule: true }
): void {
  vevent.updatePropertyWithValue('dtstamp', ical.Time.fromJSDate(new Date(), true))
  vevent.updatePropertyWithValue('summary', event.title)

  // event.start/end carry the VIEWER'S LOCAL wall clock (parseIcsToEvent converts
  // any stored zone to local via toJSDate + formatDateTime). applyEventTimes
  // therefore re-tags with the local zone — NOT the original TZID — otherwise the
  // local digits get reinterpreted in a foreign zone and the event shifts by the
  // offset on every save. The absolute instant is preserved.
  applyEventTimes(ical, vevent, event.start, event.end)

  if (event.description) {
    vevent.updatePropertyWithValue('description', event.description)
  } else {
    vevent.removeProperty('description')
  }

  if (event.location) {
    vevent.updatePropertyWithValue('location', event.location)
  } else {
    vevent.removeProperty('location')
  }

  if (options.includeRrule !== false) {
    if (event.rrule) {
      vevent.updatePropertyWithValue('rrule', ical.Recur.fromString(event.rrule))
    } else {
      vevent.removeProperty('rrule')
    }
  }

  applyReminders(ical, vevent, normalizeReminders(event), event.title)
}

export async function parseIcsToEvent(
  icsString: string,
  calendarId: string,
  href?: string,
  etag?: string
): Promise<CalendarEvent | null> {
  try {
    const ical = await getICAL()
    const jcalData = ical.parse(icsString)
    const comp = new ical.Component(jcalData)
    const vevent = getMasterVevent(comp)
    if (!vevent) return null
    const event = new ical.Event(vevent)
    const startTzid = paramText(vevent.getFirstProperty('dtstart')?.getParameter('tzid'))
    const endTzid = paramText(vevent.getFirstProperty('dtend')?.getParameter('tzid'))
    const dtStart = icalTimeToDate(event.startDate, startTzid)
    const dtEnd = icalTimeToDate(event.endDate, endTzid ?? startTzid)
    const isAllDay = event.startDate.isDate

    const rrule = getRruleFromVevent(vevent)
    const reminders = getRemindersFromVevent(vevent)
    const organizer = getOrganizerFromVevent(vevent)
    const attendees = getAttendeesFromVevent(vevent)

    return {
      id: event.uid,
      title: event.summary || '(untitled)',
      start: isAllDay ? formatDate(dtStart) : formatDateTime(dtStart),
      end: isAllDay ? formatDate(dtEnd) : formatDateTime(dtEnd),
      description: event.description || undefined,
      location: event.location || undefined,
      calendarId,
      rawIcs: icsString,
      href,
      etag,
      isAllDay,
      rrule,
      reminder: reminders[0],
      reminders,
      organizer,
      attendees: attendees.length > 0 ? attendees : undefined
    }
  } catch (err) {
    console.warn('[planner] Failed to parse ICS:', err)
    return null
  }
}
