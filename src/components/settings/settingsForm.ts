/**
 * settingsForm – the tiny form-value helpers every settings section uses in its
 * `@change` handlers.
 *
 * One copy instead of one per section: each section reads either a select value,
 * a checkbox state or an "empty means unset" optional collection URL from the
 * same DOM event.
 */

/** `value` of the select/input behind a change event. */
export function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

/** `checked` state of the checkbox behind a change event. */
export function checkedOf(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

/** An optional collection URL: the empty option means "not set" (key removed). */
export function optionalUrl(event: Event): string | undefined {
  return valueOf(event) || undefined
}

/** A reminder lead time from its select value (`'none'` = no reminder). */
export function parseReminder(value: string): number | undefined {
  if (value === 'none') return undefined
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined
}
