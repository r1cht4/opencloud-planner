/**
 * Shared types for Planner (calendar, contacts and tasks in one app).
 */

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Internal calendar model (one Radicale collection). */
export interface CalendarCollection {
  url: string
  displayName: string
  color: string
  description: string
  ctag: string
}

/** ORGANIZER of an event (read-only; managed by the inviting client). */
export interface EventOrganizer {
  /** `CN` parameter, when the ICS carries one. */
  name?: string
  /** Calendar address without the `mailto:` scheme. */
  email: string
}

/** ATTENDEE of an event (read-only; managed by the inviting client). */
export interface EventAttendee {
  /** `CN` parameter, when the ICS carries one. */
  name?: string
  /** Calendar address without the `mailto:` scheme. */
  email: string
  /** `PARTSTAT` parameter, upper-cased (`ACCEPTED`, `NEEDS-ACTION`, …). */
  partstat?: string
  /** `ROLE` parameter, upper-cased (`REQ-PARTICIPANT`, `CHAIR`, …). */
  role?: string
}

/** Internal event model. */
export interface CalendarEvent {
  id: string
  title: string
  start: string // 'YYYY-MM-DD HH:mm' or 'YYYY-MM-DD'
  end: string
  description?: string
  location?: string
  calendarId: string
  /** Raw iCalendar string for round-trip fidelity. */
  rawIcs?: string
  /** The URL of the .ics resource on the server. */
  href?: string
  /** ETag for conflict detection. */
  etag?: string
  /** Whether this is an all-day event. */
  isAllDay?: boolean
  /** RRULE string if recurring. */
  rrule?: string
  /** ID of the master event this occurrence belongs to. */
  recurringEventId?: string
  /** Original occurrence date (for editing single occurrences). */
  recurrenceId?: string
  /** Reminder minutes before event (0 = at time, 15, 30, 60, etc.). First of `reminders`. */
  reminder?: number
  /** All reminder lead times in minutes (UI-managed DISPLAY alarms). */
  reminders?: number[]
  /** ORGANIZER — read-only in the UI, preserved verbatim on save. */
  organizer?: EventOrganizer
  /** ATTENDEE list (an occurrence override may carry its own). */
  attendees?: EventAttendee[]
}

/**
 * Which events a recurring-event save/delete should touch: the clicked
 * occurrence only, or the whole series.
 */
export type RecurrenceScope = 'single' | 'series'

/**
 * Old/new comparison shown by the drag/resize confirmation dialog
 * (`MoveConfirmDialog.vue`).
 */
export interface EventMoveInfo {
  title: string
  oldDate: string
  oldTime: string
  newDate: string
  newTime: string
  event: CalendarEvent
  updatedEvent: CalendarEvent
}

// ---------------------------------------------------------------------------
// Tasks (VTODO)
// ---------------------------------------------------------------------------

/** RFC 5545 §3.8.1.11 STATUS values a VTODO can carry. */
export type TaskStatus = 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'

/**
 * Internal task model (one VTODO).
 *
 * `due` / `start` use the same wall-clock convention as `CalendarEvent.start`:
 * 'YYYY-MM-DD HH:mm' for timed values (viewer's local zone) and 'YYYY-MM-DD'
 * for date-only values. `completed` is the COMPLETED timestamp, local wall
 * clock ('YYYY-MM-DD HH:mm').
 */
export interface Task {
  id: string
  title: string
  description?: string
  due?: string
  start?: string
  /** RFC 5545 PRIORITY: 0 = none, 1–9 (1 = highest). */
  priority: number
  status: TaskStatus
  completed?: string
  percentComplete: number
  categories?: string[]
  calendarId: string
  /** Server resource URL. */
  href?: string
  /** ETag for conflict detection. */
  etag?: string
  /** Raw iCalendar string for round-trip fidelity (edits patch this). */
  rawIcs?: string
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactAddress {
  type: string // 'home' | 'work' | 'other'
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

interface ContactPhone {
  type: string // 'cell' | 'home' | 'work' | 'fax'
  value: string
}

interface ContactEmail {
  type: string
  value: string
}

export interface Contact {
  id: string // UID from vCard
  displayName: string
  firstName: string
  lastName: string
  emails: ContactEmail[]
  phones: ContactPhone[]
  addresses: ContactAddress[]
  organization: string
  title: string
  notes: string
  photo?: string // data-URI or URL
  categories?: string[]
  birthday?: string // YYYY-MM-DD
  /** Raw vCard string for round-trip fidelity. */
  rawVcard?: string
  /** Server resource URL. */
  href?: string
  /** ETag for conflict detection. */
  etag?: string
}

export interface AddressBook {
  url: string
  displayName: string
  description: string
  ctag: string
}

// ---------------------------------------------------------------------------
// DAV config
// ---------------------------------------------------------------------------

export interface DAVConfig {
  caldavUrl?: string
  carddavUrl?: string
}
