/**
 * useDAVClient - fetch-based CalDAV/CardDAV access via OpenCloud.
 *
 * OpenCloud authenticates the browser request and forwards the user identity to
 * Radicale. The frontend must not keep DAV credentials.
 */

import { useAuthStore } from '@opencloud-eu/web-pkg'
import { ref, watch, type Ref } from 'vue'
import { getDAVConfig } from '../config/davConfig'
import { davPropText, parseMultistatus } from './davXml'

export type DAVService = 'calendar' | 'contacts'

export interface DAVClientState {
  service: DAVService
  baseUrl: string
  principalUrl: string
}

/**
 * Discovery state shared by all views (one DAV discovery per service per app
 * lifetime). Owned by this single store object rather than scattered globals;
 * resetDAVClient() clears it in place so refs already handed to mounted views
 * stay reactive.
 */
interface DAVClientStore {
  states: Record<DAVService, Ref<DAVClientState | null>>
  ready: Record<DAVService, Ref<boolean>>
  isReady: Ref<boolean>
  error: Ref<string | null>
  initPromises: Partial<Record<DAVService, Promise<void>>>
}

const store: DAVClientStore = {
  states: {
    calendar: ref<DAVClientState | null>(null),
    contacts: ref<DAVClientState | null>(null)
  },
  ready: {
    calendar: ref<boolean>(false),
    contacts: ref<boolean>(false)
  },
  isReady: ref<boolean>(false),
  error: ref<string | null>(null),
  initPromises: {}
}
const { states, ready, isReady, error, initPromises } = store

/**
 * The page origin, without crashing when there is no `window` (node unit tests).
 */
function pageOrigin(): string {
  const origin = globalThis.location?.origin
  return origin ?? 'http://localhost'
}

/**
 * The only origins the OpenCloud access token may be sent to:
 * the page origin plus the origins of the configured caldav/carddav base URLs
 * (an admin may point the DAV endpoints at another host). Everything else is
 * refused before `fetch` is called, so a hostile href (multistatus response,
 * `?open=` link, backup data) can never leak the token cross-origin.
 */
export function allowedDavOrigins(): string[] {
  const origins = new Set<string>([pageOrigin()])
  const config = getDAVConfig()
  for (const base of [config.caldavUrl, config.carddavUrl]) {
    if (!base) continue
    try {
      origins.add(new URL(base, pageOrigin()).origin)
    } catch {
      // An unparsable admin URL must not break every DAV request.
    }
  }
  return [...origins]
}

/**
 * Throw when `url` points outside `allowedDavOrigins()`. Called
 * before `fetch` in `davRequest`/`davFetch`, so nothing is ever sent.
 */
function assertDavOrigin(url: string): void {
  const target = new URL(url, pageOrigin())
  if (!allowedDavOrigins().includes(target.origin)) {
    throw new Error(
      `Refusing DAV request to a non-DAV origin: ${target.origin} (allowed: ${allowedDavOrigins().join(', ')})`
    )
  }
}

/** Forget all DAV discovery (tests; auth/user change). The next init re-discovers. */
export function resetDAVClient(): void {
  for (const service of ['calendar', 'contacts'] as const) {
    states[service].value = null
    ready[service].value = false
    initPromises[service] = undefined
  }
  isReady.value = false
  error.value = null
}

/**
 * The raw access token the OpenCloud host handed us ('' while signed out).
 *
 * `defineWebApplication.setup()` runs *before* the host puts the token in the
 * auth store, so every setup-time service must gate on this instead of firing a
 * DAV request that the proxy answers with 401.
 */
function accessTokenValue(): string {
  try {
    return useAuthStore()?.accessToken ?? ''
  } catch {
    return ''
  }
}

/**
 * Is there an OpenCloud auth store at all, i.e. are we running inside the host?
 * Setup-time code uses this to tell "no host" (tests, a plain page) from "host,
 * but not signed in yet".
 */
export function hasAuthStore(): boolean {
  try {
    return Boolean(useAuthStore())
  } catch {
    return false
  }
}

/** True once the user is signed in (DAV requests need the token). */
export function isAuthenticated(): boolean {
  return accessTokenValue() !== ''
}

/**
 * Run `onToken` once an access token is available, i.e. as soon as the sign-in
 * finished. Returns a stop function (also called after the first token).
 */
export function watchAccessToken(onToken: (token: string) => void): () => void {
  try {
    const auth = useAuthStore()
    if (!auth) return () => undefined
    return watch(
      () => auth.accessToken as string,
      (token) => {
        if (token) onToken(token)
      },
      { immediate: true }
    )
  } catch {
    return () => undefined
  }
}

function currentBearerToken(): string {
  const token = accessTokenValue()
  if (!token) return ''
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

export function buildDAVHeaders(headers?: HeadersInit, defaults?: HeadersInit): Headers {
  const result = new Headers(defaults)
  if (headers) {
    new Headers(headers).forEach((value, key) => result.set(key, value))
  }

  const token = currentBearerToken()
  if (token && !result.has('Authorization')) {
    result.set('Authorization', token)
  }
  if (!result.has('X-Requested-With')) {
    result.set('X-Requested-With', 'XMLHttpRequest')
  }
  if (!result.has('Cache-Control')) {
    result.set('Cache-Control', 'no-cache')
  }

  return result
}

async function davRequest(
  url: string,
  method: string,
  body?: string,
  headers?: Record<string, string>,
  opts: { keepalive?: boolean } = {}
): Promise<{ status: number; text: string; headers: Headers }> {
  // The token only ever travels to DAV origins.
  assertDavOrigin(url)
  const resp = await fetch(url, {
    method,
    headers: buildDAVHeaders(headers, {
      'Content-Type': 'application/xml; charset=utf-8'
    }),
    body,
    credentials: 'include',
    cache: 'no-store',
    // Survives the page unload when read as part of a pagehide flush.
    ...(opts.keepalive ? { keepalive: true } : {})
  })

  const text = await resp.text()
  return { status: resp.status, text, headers: resp.headers }
}

export async function propfind(
  url: string,
  props: string,
  depth: string = '0',
  opts: { keepalive?: boolean } = {}
): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    ${props}
  </d:prop>
</d:propfind>`

  const { status, text } = await davRequest(url, 'PROPFIND', body, { Depth: depth }, opts)
  if (status !== 207 && status !== 200) {
    throw new Error(`PROPFIND ${url} failed: ${status}`)
  }
  return text
}

export function davFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // Same guard as `davRequest` — never attach the token to a foreign origin.
  // The check rejects (never throws synchronously) so callers can `.catch()` it.
  try {
    assertDavOrigin(url)
  } catch (err) {
    return Promise.reject(err)
  }
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: buildDAVHeaders(init.headers),
    cache: init.cache ?? 'no-store'
  })
}

function serviceBaseUrl(service: DAVService, serverUrl?: string): string {
  if (serverUrl) return serverUrl.replace(/\/$/, '')
  const config = getDAVConfig()
  if (service === 'calendar')
    return (config.caldavUrl ?? `${window.location.origin}/caldav`).replace(/\/$/, '')
  return (config.carddavUrl ?? `${window.location.origin}/carddav`).replace(/\/$/, '')
}

export function parseCurrentUserPrincipal(xml: string): string | null {
  for (const resp of parseMultistatus(xml)) {
    for (const el of Array.from(resp.el.getElementsByTagName('*'))) {
      if (el.localName === 'current-user-principal') {
        const href = davPropText(el, 'href')
        if (href) return href
      }
    }
  }
  // Fallback: some servers answer with just the principal collection itself
  return parseMultistatus(xml)[0]?.href ?? null
}

export function resolveDavUrl(baseUrl: string, href: string): string {
  if (href.startsWith('http')) return href
  return new URL(href, `${new URL(baseUrl).origin}/`).toString()
}

/** The pattern a UID can be used as a resource name as-is (no encoding needed). */
const SAFE_RESOURCE_NAME = /^[A-Za-z0-9._@-]+$/

/** Lowercase hex SHA-256 of `text` (fallback: a deterministic 32-hex FNV hash when
 *  `crypto.subtle` is unavailable, e.g. non-secure contexts). */
async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Deterministic fallback so the same UID still maps to the same name.
  let h1 = 0x811c9dc5
  let h2 = 0x9747b28c
  for (const byte of new TextEncoder().encode(text)) {
    h1 = ((h1 ^ byte) * 0x01000193) >>> 0
    h2 = ((h2 ^ byte) * 0x85ebca6b) >>> 0
  }
  return (
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0')
  ).slice(0, 64)
}

/**
 * Deterministic, URL-safe resource name for a UID.
 *
 * The UID itself stays untouched inside the ICS/vCard data (identity with the
 * source: iTIP/sync/re-import "already exists"). Only the resource URL uses
 * the safe name: the UID when it matches `[A-Za-z0-9._@-]+`, else the lowercase
 * hex SHA-256 of the UID. Same UID ⇒ same name, everywhere in the app.
 */
export function davResourceName(uid: string | undefined | null): Promise<string> {
  if (uid && SAFE_RESOURCE_NAME.test(uid)) return Promise.resolve(uid)
  return sha256Hex(uid ?? '')
}

/**
 * Stable per-user fragment for browser-local storage keys: the
 * OpenCloud user UUID Radicale addresses, i.e. the first path segment of the
 * principal URL beyond the DAV base path. Falls back to `'shared'` before
 * discovery has run (two accounts then share only the very first batch).
 */
export function davUserId(): string {
  for (const service of ['calendar', 'contacts'] as const) {
    const state = states[service].value
    if (!state?.principalUrl) continue
    try {
      const origin = pageOrigin()
      const baseSegments = new URL(state.baseUrl, origin).pathname.split('/').filter(Boolean)
      const segments = new URL(state.principalUrl, origin).pathname.split('/').filter(Boolean)
      const user = segments[baseSegments.length]
      if (user) return user
    } catch {
      // ignore and try the next service
    }
  }
  return 'shared'
}

export function useDAVClient() {
  async function init(service: DAVService = 'calendar', serverUrl?: string): Promise<void> {
    if (ready[service].value && states[service].value) return
    if (initPromises[service]) {
      await initPromises[service]
      return
    }
    initPromises[service] = doInit(service, serverUrl)
    await initPromises[service]
  }

  async function doInit(service: DAVService, serverUrl?: string): Promise<void> {
    const baseUrl = serviceBaseUrl(service, serverUrl)

    try {
      const xml = await propfind(baseUrl + '/', '<d:current-user-principal/>', '0')

      const principalPath = parseCurrentUserPrincipal(xml)
      if (!principalPath) throw new Error('Could not discover current DAV principal')

      states[service].value = {
        service,
        baseUrl,
        principalUrl: resolveDavUrl(baseUrl, principalPath)
      }
      ready[service].value = true
      isReady.value = ready.calendar.value || ready.contacts.value
      error.value = null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[planner] ${service} DAV init failed:`, message, err)
      error.value = `${service} DAV connection failed: ${message}`
      ready[service].value = false
      isReady.value = ready.calendar.value || ready.contacts.value
      initPromises[service] = undefined
    }
  }

  async function ensureReady(
    service: DAVService = 'calendar',
    serverUrl?: string
  ): Promise<boolean> {
    if (!ready[service].value || !states[service].value) {
      await init(service, serverUrl)
    }
    return ready[service].value
  }

  function getState(service: DAVService = 'calendar'): DAVClientState | null {
    return states[service].value
  }

  return { davState: states.calendar, states, isReady, ready, error, init, ensureReady, getState }
}
