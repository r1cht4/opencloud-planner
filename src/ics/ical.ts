/**
 * ical.ts – the single lazy ical.js loader of the extension.
 *
 * ical.js ships its own type declarations, so the module object and the
 * instances we pass around (components, times, properties) are typed here once
 * and reused by every `src/ics/**` module instead of sprinkling `any`.
 */

/** The ical.js module object (`ICAL.Component`, `ICAL.Time`, `ICAL.parse`, …). */
export type IcalApi = (typeof import('ical.js'))['default']
/** A parsed/constructed `VCALENDAR`/`VEVENT`/`VTODO`/`VALARM` component. */
export type IcalComponent = InstanceType<IcalApi['Component']>
/** An iCalendar date or date-time value. */
export type IcalTime = InstanceType<IcalApi['Time']>
/** A single content line (property) of a component. */
export type IcalProperty = InstanceType<IcalApi['Property']>
/** A hydrated event (`ICAL.Event`), used for the recurrence iterator. */
/** A DURATION value (`TRIGGER:-PT15M`). */
export type IcalDuration = InstanceType<IcalApi['Duration']>
let ICAL: IcalApi | null = null

/**
 * Lazily import ical.js (it is the biggest dependency in the bundle, so every
 * entry point loads it on first use instead of at module evaluation).
 */
export async function getICAL(): Promise<IcalApi> {
  if (!ICAL) {
    const module = (await import('ical.js')) as { default?: IcalApi }
    // Bundlers disagree on `default` vs. the module namespace for ical.js.
    ICAL = module.default ?? (module as unknown as IcalApi)
  }
  return ICAL
}

/**
 * Narrow the `getFirstPropertyValue()` / `getFirstValue()` union (Binary,
 * Duration, Period, Recur, Time, UtcOffset, Geo, string, null) to an
 * `ICAL.Time`. Date-ish properties (DTSTART, DUE, COMPLETED, …) always hold one;
 * anything else is reported as `null` so callers can skip it without casting.
 */
export function asIcalTime(value: unknown): IcalTime | null {
  if (value && typeof value === 'object' && 'toJSDate' in value) {
    return value as IcalTime
  }
  return null
}

/**
 * Read a parameter as text: `getParameter()` returns `string` for a single
 * value and an array when the parameter repeats (`TZID` never does, but the
 * declaration allows it).
 */
export function paramText(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' ? value : null
}

/** Narrow a value to an `ICAL.Duration` (a `TRIGGER:-PT15M` style value). */
export function asIcalDuration(value: unknown): IcalDuration | null {
  if (value && typeof value === 'object' && 'toSeconds' in value) {
    return value as IcalDuration
  }
  return null
}
