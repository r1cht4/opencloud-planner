/**
 * recurrence.ts – RRULE expansion into single occurrences, moved out of
 * `useCalendarService`.
 */

import { getICAL, paramText } from './ical'
import { formatDate, formatDateTime, icalTimeToDate } from './datetime'
import { getAttendeesFromVevent, getMasterVevent, getOrganizerFromVevent } from './vevent'
import { getRemindersFromVevent } from './reminders'
import type { CalendarEvent } from '../types'

/**
 * Occurrence budgets for `expandRecurringEvents`.
 *  - MAX_EMITTED_OCCURRENCES: occurrences handed to the UI per series (per call).
 *  - MAX_ITERATION_STEPS: hard guard against runaway RRULEs (always terminates).
 */
const MAX_EMITTED_OCCURRENCES = 2000
const MAX_ITERATION_STEPS = 100000

export async function expandRecurringEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<CalendarEvent[]> {
  const ical = await getICAL()
  const result: CalendarEvent[] = []

  for (const evt of events) {
    if (!evt.rrule || !evt.rawIcs) {
      result.push(evt)
      continue
    }

    try {
      const jcalData = ical.parse(evt.rawIcs)
      const comp = new ical.Component(jcalData)
      const vevent = getMasterVevent(comp)
      if (!vevent) {
        result.push(evt)
        continue
      }

      const icalEvent = new ical.Event(vevent)
      const masterStartTzid = paramText(vevent.getFirstProperty('dtstart')?.getParameter('tzid'))
      const masterEndTzid = paramText(vevent.getFirstProperty('dtend')?.getParameter('tzid'))
      const iter = icalEvent.iterator()
      let next = iter.next()
      // Two independent budgets:
      //  - emitted occurrences: what the UI can show for the loaded window. Counted
      //    over the occurrences we actually emit, NOT from the series start — an old
      //    daily series would otherwise burn the whole budget before reaching the
      //    viewed range and yield zero occurrences.
      //  - iterator steps: a separate, much larger guard against runaway rules
      //    (e.g. FREQ=SECONDLY starting decades ago) so we always terminate.
      let emitted = 0
      let steps = 0

      while (next && emitted < MAX_EMITTED_OCCURRENCES && steps < MAX_ITERATION_STEPS) {
        steps++
        const details = icalEvent.getOccurrenceDetails(next)
        const item = details.item
        const recurrenceStart = next.toJSDate()
        const occStart = icalTimeToDate(details.startDate, masterStartTzid)
        if (recurrenceStart > rangeEnd) break
        const occEndDate = icalTimeToDate(details.endDate, masterEndTzid ?? masterStartTzid)

        if (occEndDate >= rangeStart && occStart <= rangeEnd) {
          const isAllDay = details.startDate.isDate
          const recurrenceId = details.recurrenceId.toString()
          const occId = `${evt.id}_${recurrenceId}`
          const occReminders = getRemindersFromVevent(item.component)
          // A RECURRENCE-ID override may carry its own organizer/attendee list
          // (e.g. one occurrence moved to a smaller group). `item.component` is
          // the occurrence's own VEVENT, so prefer it over the master's data.
          const occOrganizer = getOrganizerFromVevent(item.component)
          const occAttendees = getAttendeesFromVevent(item.component)
          result.push({
            ...evt,
            id: occId,
            title: item.summary || evt.title,
            start: isAllDay ? formatDate(occStart) : formatDateTime(occStart),
            end: isAllDay ? formatDate(occEndDate) : formatDateTime(occEndDate),
            description: item.description || undefined,
            location: item.location || undefined,
            isAllDay,
            reminder: occReminders[0],
            reminders: occReminders,
            organizer: occOrganizer ?? evt.organizer,
            attendees: occAttendees.length > 0 ? occAttendees : evt.attendees,
            recurringEventId: evt.id,
            recurrenceId
          })
          emitted++
        }

        next = iter.next()
      }
    } catch (err) {
      console.warn('[planner] Failed to expand recurring event:', evt.id, err)
      result.push(evt)
    }
  }

  return result
}
