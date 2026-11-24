/**
 * useConnectionProbe – "is the DAV backend there?" at app load.
 *
 * A store install of an OpenCloud instance without Radicale behind the proxy must
 * not end in a raw "DAV connection failed" error: the app asks once, cheaply,
 * whether `/caldav/` answers, and the views render a setup state instead of their
 * content while it does not (see `ConnectionGate.vue`).
 *
 * The probe is one `PROPFIND` with `Depth: 0` on the CalDAV base URL — the
 * cheapest request that proves the proxy route *and* Radicale are alive. It never
 * throws: every failure is classified into a `ProbeOutcome`, because the caller
 * shows guidance, not an exception.
 *
 * State is a module-level singleton on purpose: the probe runs once per app
 * lifetime (started from `src/setup/connection.ts` at `setup()`), and every view
 * gate plus About/Status reads the same outcome.
 */

import { ref, type Ref } from 'vue'
import { getDAVConfig } from '../config/davConfig'
import { davFetch } from './useDAVClient'

/** What the probe found. `'pending'` (below) is the "not answered yet" state. */
export type ProbeOutcome = 'ok' | 'not-configured' | 'unavailable' | 'unauthorized' | 'error'

/** Outcome including the state before the first probe finished. */
export type ProbeState = ProbeOutcome | 'pending'

export interface ProbeResult {
  outcome: ProbeOutcome
  /** HTTP status of the probe response, when one arrived at all. */
  status?: number
  /** Short technical hint (HTTP status or network error message). */
  detail?: string
}

/**
 * Classify a PROPFIND answer. `status === undefined` means the request never got
 * a response (DNS, connection refused, TLS) — Radicale/proxy not there.
 *
 *   207            → ok            (multistatus = a real WebDAV endpoint)
 *   404, 405       → not-configured (route missing / method not allowed)
 *   502, 503, 504  → unavailable   (proxy is up, Radicale behind it is not)
 *   401, 403       → unauthorized  (auth mapping / X-Remote-User broken)
 *   anything else  → error         (unexpected answer, needs a human)
 */
export function probeOutcomeForStatus(status?: number | null): ProbeOutcome {
  if (status == null) return 'unavailable'
  if (status === 207) return 'ok'
  if (status === 404 || status === 405) return 'not-configured'
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  if (status === 401 || status === 403) return 'unauthorized'
  return 'error'
}

/** CalDAV base URL the probe (and the app) talks to, with one trailing slash. */
export function caldavProbeUrl(): string {
  const base = (getDAVConfig().caldavUrl ?? `${window.location.origin}/caldav`).replace(/\/+$/, '')
  return `${base}/`
}

const PROBE_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`

/**
 * A hanging proxy must not leave the app on a spinner forever: give up after this
 * long and report `unavailable` (the load state is a gate, not a request).
 */
export const PROBE_TIMEOUT_MS = 10000

function probeSignal(): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
      : undefined
  } catch {
    return undefined
  }
}

/** One `PROPFIND Depth: 0` on the CalDAV base. Never throws. */
export async function probeDav(): Promise<ProbeResult> {
  const url = caldavProbeUrl()
  try {
    const resp = await davFetch(url, {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8'
      },
      body: PROBE_BODY,
      signal: probeSignal()
    })
    const outcome = probeOutcomeForStatus(resp.status)
    if (outcome === 'ok') return { outcome }
    return { outcome, status: resp.status, detail: `HTTP ${resp.status}` }
  } catch (err) {
    // Network-level failure: no response at all.
    return { outcome: 'unavailable', detail: err instanceof Error ? err.message : String(err) }
  }
}

const outcome = ref<ProbeState>('pending')
const lastResult = ref<ProbeResult | null>(null)
const probing = ref(false)
let inFlight: Promise<void> | null = null

/** Back to "never probed" (tests; auth/user change). */
export function resetConnectionProbe(): void {
  outcome.value = 'pending'
  lastResult.value = null
  probing.value = false
  inFlight = null
}

/**
 * Run the probe now. Concurrent callers share one request (the first probe at
 * load and a user pressing "Test connection" must not race). `outcome` keeps its
 * previous value while the request is in flight so the UI does not flash back to
 * the spinner; `probing` reports the in-flight request.
 */
function retest(): Promise<void> {
  if (inFlight) return inFlight
  probing.value = true
  inFlight = probeDav()
    .then((result) => {
      lastResult.value = result
      outcome.value = result.outcome
    })
    .finally(() => {
      probing.value = false
      inFlight = null
    })
  return inFlight
}

export interface ConnectionProbe {
  outcome: Ref<ProbeState>
  probing: Ref<boolean>
  lastResult: Ref<ProbeResult | null>
  retest: () => Promise<void>
}

/**
 * Handle on the singleton probe state. Safe to call at any component's `setup()`
 * — nothing is created per call, so the captured parts may also be used from
 * click handlers.
 */
export function useConnectionProbe(): ConnectionProbe {
  return { outcome, probing, lastResult, retest }
}
