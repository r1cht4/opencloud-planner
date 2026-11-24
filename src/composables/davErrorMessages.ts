/**
 * davErrorMessages.ts – turn the DAV services' English error strings into
 * translated, user-presentable messages.
 *
 * The services keep setting plain English strings on their `error` ref (they
 * are *identifiers*, e.g. `'Item was modified elsewhere; refresh and try
 * again.'`, `'DAV server not reachable'`, `'PUT failed: 500'`); the views must
 * not show those raw. `mapDavError` recognises the known identifiers and
 * returns a translated message; anything else gets a generic translated
 * fallback (the raw string stays in the console).
 *
 * Pure apart from the injected `$gettext`, so it is unit-testable without a
 * component.
 */

/** Minimal gettext signature this module needs. */
export type GettextFn = (text: string, params?: Record<string, string | number>) => string

/** Service error identifiers (the strings the services set on `error`). */
export const DAV_ERROR = {
  /** Set on a 412 (If-Match) — the item changed on the server meanwhile. */
  conflict: 'modified elsewhere',
  /** Set when the DAV discovery/ready check failed. */
  unreachable: 'DAV server not reachable'
} as const

/** True when a service `error` string is the 412 conflict identifier. */
export function isConflictErrorMessage(error: string | null | undefined): boolean {
  return !!error && error.includes(DAV_ERROR.conflict)
}

/**
 * Map a service `error` string to a translated message, or `null` when there is
 * nothing to show. Known identifiers get a specific message; unknown technical
 * strings (`PUT failed: 500`, …) get the generic one.
 */
export function mapDavError(error: string | null | undefined, $gettext: GettextFn): string | null {
  if (!error) return null
  if (isConflictErrorMessage(error)) {
    return $gettext('Item was modified elsewhere. Latest version loaded.')
  }
  if (error.includes(DAV_ERROR.unreachable)) {
    return $gettext('The calendar server is not reachable. Try again.')
  }
  return $gettext('The request to the calendar server failed. Please try again.')
}
