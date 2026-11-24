/**
 * Diagnostics for Settings → About/Status.
 *
 * The report is meant to be pasted into a support request, so it must never
 * contain personal data: no names, no e-mail addresses and no URLs carrying the
 * user id. Radicale addresses collections by a UUID under the principal, so the
 * single redaction rule "replace every UUID with `<user>`" covers principal and
 * collection URLs alike (`src/setup/diagnostics.spec.ts` pins it).
 */

import type { ProbeState } from '../composables/useConnectionProbe'
import { APP_NAME } from '../navigation'

/**
 * App version injected by Vite (`define: { __APP_VERSION__ }` in `vite.config.ts`).
 * `typeof` guards the case where the define is missing (e.g. a bare vitest run
 * without the define) instead of throwing a ReferenceError.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Replace every UUID (the Radicale user id) with `<user>`. */
export function redactUserIds(value: string): string {
  return value.replace(UUID_RE, '<user>')
}

export interface DiagnosticsInput {
  outcome: ProbeState
  status?: number
  detail?: string
  principal?: string | null
  opencloudVersion?: string | null
  calendars?: number | null
  addressBooks?: number | null
  events?: number | null
  contacts?: number | null
  tasks?: number | null
  /** Epoch ms of the last successful status refresh. */
  lastCheck?: number | null
  /** Injected for tests; defaults to the real clock. */
  now?: Date
  /** Injected for tests; defaults to `navigator.userAgent`. */
  userAgent?: string
}

function count(value?: number | null): string {
  return typeof value === 'number' ? String(value) : 'unknown'
}

/**
 * Plain-text diagnostics block. Every value goes through `redactUserIds`.
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const now = input.now ?? new Date()
  const userAgent =
    input.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || 'unknown'

  const lines: string[] = [
    `${APP_NAME} ${APP_VERSION}`,
    `OpenCloud ${input.opencloudVersion || 'unknown'}`,
    `DAV outcome: ${input.outcome}${input.status ? ` (HTTP ${input.status})` : ''}`,
    `Principal: ${input.principal || 'unknown'}`,
    `Calendars: ${count(input.calendars)}`,
    `Address books: ${count(input.addressBooks)}`,
    `Events (loaded range): ${count(input.events)}`,
    `Contacts: ${count(input.contacts)}`,
    `Tasks: ${count(input.tasks)}`,
    `Last check: ${input.lastCheck ? new Date(input.lastCheck).toISOString() : 'never'}`,
    `Generated: ${now.toISOString()}`,
    `Browser: ${userAgent}`
  ]

  if (input.detail) lines.push(`Detail: ${input.detail}`)

  return redactUserIds(lines.join('\n'))
}
