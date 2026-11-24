/**
 * Birthday reminder (VALARM) derivation.
 *
 * Birthday events are all-day events (`DTSTART;VALUE=DATE`), so a plain
 * "-P1D" trigger would fire at *midnight* — 00:00 is technically correct and
 * practically useless. The app therefore defines `birthdays.reminder` as
 * "**N minutes before 09:00 on the birthday**", which keeps one predictable
 * morning slot for every reminder choice:
 *
 * | setting          | fires                     | ICS trigger (`DTSTART` = midnight) |
 * |------------------|---------------------------|------------------------------------|
 * | 0 (at 09:00)     | 09:00 on the birthday     | `TRIGGER:+PT9H`                    |
 * | 60 (1 h before)  | 08:00 on the birthday     | `TRIGGER:+PT8H`                    |
 * | 1440 (1 day)     | 09:00 the day before      | `TRIGGER:-PT15H`                   |
 *
 * The ICS stays a standard relative DISPLAY trigger anchored to DTSTART, so other
 * clients show the same alarm — no custom semantics on the wire. Triggers *after*
 * the start are expressed with a positive duration (RFC 5545 §3.8.6.3), which
 * `useCalendarService` supports for exactly this case.
 */

/** Local wall-clock hour the birthday reminder refers to. */
const BIRTHDAY_REMINDER_HOUR = 9

/** Minutes between local midnight (DTSTART of an all-day event) and 09:00. */
const MINUTES_TO_REMINDER_HOUR = BIRTHDAY_REMINDER_HOUR * 60

/**
 * Reminder lead in minutes relative to the event's **midnight** start — the value
 * `buildIcs({ reminders })` expects: positive = before the start, negative =
 * after it. `null` means "no reminder" (unset or not a number).
 *
 * `540` (09:00 on the birthday) yields `-540` → `TRIGGER:+PT9H`,
 * `1440` (one day before, 09:00) yields `900` → `TRIGGER:-PT15H`.
 */
export function birthdayReminderLeadMinutes(reminder: number | undefined | null): number | null {
  if (typeof reminder !== 'number' || !Number.isFinite(reminder) || reminder < 0) return null
  return reminder - MINUTES_TO_REMINDER_HOUR
}
