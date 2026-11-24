/**
 * Calendar view options derived from the synced `calendar.*` settings.
 *
 * The grid (@event-calendar/core) is configured once at mount and can be changed
 * afterwards through `setOption` — no re-mount, so the current date and an open
 * dialog survive a settings change (the Settings page is a separate route, but
 * the change must also apply when the calendar is already mounted, e.g. after a
 * `reload()`).
 *
 * Everything here is pure, which is what makes the option mapping testable
 * without a DOM: `tests/unit/calendar-settings-options.spec.ts`.
 */

import type { CalendarDefaultView, CalendarSettings } from './schema'

/** @event-calendar view names for the four `calendar.defaultView` values. */
export type EcViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'

/** The subset of the grid options the settings drive. */
export interface CalendarSettingsOptions {
  view: EcViewName
  /** `HH:MM:SS` — where the day/week grid scrolls to on open. */
  scrollTime: string
  /** 0 (Sunday) … 6 (Saturday). */
  firstDay: number
  weekNumbers: boolean
  /** `[0, 6]` when weekends are hidden, otherwise empty. */
  hiddenDays: number[]
}

/** Minimal surface of the created calendar instance (keeps this module DOM-free). */
export interface OptionSink {
  setOption(name: string, value: unknown): void
}

/** CLDR regions whose week starts on Sunday (fallback when `Intl.Locale` has no week info). */
const SUNDAY_REGIONS = new Set(
  (
    'AG AS BD BR BS BT BW BZ CA CN CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO ' +
    'MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'
  ).split(' ')
)

/** First day of the week (0 = Sunday) from the locale's region, if it has one. */
function regionWeekStart(locale: string): number | undefined {
  let parsed: Intl.Locale
  try {
    parsed = new Intl.Locale(locale)
  } catch {
    return undefined
  }
  if (!parsed.region) return undefined
  const withInfo = parsed as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number }
    weekInfo?: { firstDay: number }
  }
  try {
    const info = withInfo.getWeekInfo?.() ?? withInfo.weekInfo
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7
  } catch {
    // fall back to the table
  }
  return SUNDAY_REGIONS.has(parsed.region) ? 0 : 1
}

/**
 * `weekStart: 'locale'` follows the format locale's region (`en-DE` → Monday,
 * `en-US` → Sunday). A locale without a region keeps the old rule: English
 * starts on Sunday, every other language on Monday. An explicit number is
 * used as-is.
 */
export function effectiveWeekStart(weekStart: number | 'locale', locale: string): number {
  if (
    typeof weekStart === 'number' &&
    Number.isInteger(weekStart) &&
    weekStart >= 0 &&
    weekStart <= 6
  ) {
    return weekStart
  }
  return regionWeekStart(locale) ?? (locale.toLowerCase().startsWith('en') ? 0 : 1)
}

/** @event-calendar hides the listed weekdays (`hiddenDays`). */
export function hiddenDaysFor(showWeekends: boolean): number[] {
  return showWeekends ? [] : [0, 6]
}

export function defaultViewName(view: CalendarDefaultView): EcViewName {
  switch (view) {
    case 'month':
      return 'dayGridMonth'
    case 'day':
      return 'timeGridDay'
    case 'list':
      return 'listWeek'
    default:
      return 'timeGridWeek'
  }
}

/** `'HH:MM'` → `'HH:MM:00'` (the grid's `scrollTime` format). */
export function scrollTimeFrom(dayStart: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dayStart.trim())
  return match ? `${match[1]}:${match[2]}:00` : '06:00:00'
}

/** The grid options the `calendar.*` settings produce for `locale`. */
export function buildCalendarSettingsOptions(
  calendar: CalendarSettings,
  locale: string
): CalendarSettingsOptions {
  return {
    view: defaultViewName(calendar.defaultView),
    scrollTime: scrollTimeFrom(calendar.dayStart),
    firstDay: effectiveWeekStart(calendar.weekStart, locale),
    weekNumbers: calendar.weekNumbers,
    hiddenDays: hiddenDaysFor(calendar.showWeekends)
  }
}

/**
 * Push changed settings into a running calendar instance. Only the options that
 * actually differ are written, so an unrelated settings change (e.g. contacts
 * sorting) costs nothing and never resets the visible range.
 */
export function applyCalendarSettingsOptions(
  calendar: OptionSink,
  next: CalendarSettingsOptions,
  current: CalendarSettingsOptions
): void {
  for (const key of Object.keys(next) as Array<keyof CalendarSettingsOptions>) {
    if (JSON.stringify(next[key]) === JSON.stringify(current[key])) continue
    calendar.setOption(key, next[key])
  }
}
