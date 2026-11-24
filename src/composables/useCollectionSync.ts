/**
 * useCollectionSync – detect changes made by *other* clients (phone, Thunderbird)
 * and let the open views reload only what actually changed.
 *
 * Every CalDAV/CardDAV collection exposes a change marker:
 *   - `CS:getctag` (CalendarServer extension, `http://calendarserver.org/ns/`)
 *   - `DAV:sync-token` (RFC 6578)
 * Radicale answers both; SabreDAV/Nextcloud and Baïkal answer at least the ctag.
 * We request both in one `PROPFIND` and remember whichever comes back, so a
 * server that only speaks one of the two still works.
 *
 * `Depth: 0` per collection (not `Depth: 1` on the principal) on purpose: the
 * views already know exactly which collections they show, the response needs no
 * href → URL normalisation (servers disagree on absolute vs. path hrefs and on
 * trailing slashes), and an unhashable/unknown collection cannot silently change
 * the request shape. The cost is one tiny metadata request per collection, made
 * at most once per poll interval and only while the tab is visible.
 *
 * No UI: this is a silent refresh. Views reload, they never toast.
 */

import { getCurrentScope, onScopeDispose } from 'vue'
import { propfind } from './useDAVClient'
import { davPropText, parseMultistatus } from './davXml'

/**
 * Props for one PROPFIND: the Apple/CalendarServer ctag plus the RFC 6578
 * sync-token. The nested `xmlns:cs` declaration rebinds that prefix for this
 * element only (the `propfind()` body binds `cs` to the caldav namespace) —
 * namespace-aware parsers resolve it to the calendar-server namespace.
 */
export const CHANGE_MARKER_PROPS =
  '<cs:getctag xmlns:cs="http://calendarserver.org/ns/"/><d:sync-token/>'

/** Poll period while the document is visible. */
export const DEFAULT_SYNC_INTERVAL_MS = 60000

/** Focus/visibility bursts are folded into at most one check per second. */
export const FOCUS_CHECK_DELAY_MS = 1000

/** Absolute URL → comparable path (trailing slashes and encoding removed). */
function normalizeHref(href: string): string {
  let path = href
  if (/^https?:\/\//i.test(href)) {
    try {
      path = new URL(href).pathname
    } catch {
      /* fall back to the raw href */
    }
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    /* keep the raw path */
  }
  return path.replace(/\/+$/, '')
}

/**
 * Extract the change marker from a `PROPFIND` multistatus body: the ctag when
 * the server has one, else the sync-token. `''` means "no marker available".
 */
export function parseChangeMarker(xml: string, collectionUrl?: string): string {
  const responses = parseMultistatus(xml)
  if (responses.length === 0) return ''

  let target = responses[0]
  if (collectionUrl) {
    const wanted = normalizeHref(collectionUrl)
    const match = responses.find((resp) => normalizeHref(resp.href) === wanted)
    if (match) target = match
  }

  const ctag = davPropText(target.el, 'getctag')
  if (ctag) return `ctag:${ctag}`

  const syncToken = davPropText(target.el, 'sync-token')
  return syncToken ? `token:${syncToken}` : ''
}

/**
 * Read the change marker of each collection (one `PROPFIND` Depth 0 each).
 *
 * Failures are per collection and swallowed on purpose: a poll must not throw
 * (an unreachable collection would otherwise abort the whole cycle) and it must
 * not log on every interval. A collection without a marker is simply absent from
 * the result, which leaves its remembered marker untouched.
 */
export async function fetchCtags(collectionUrls: string[]): Promise<Map<string, string>> {
  const markers = new Map<string, string>()
  await Promise.all(
    collectionUrls.map(async (url) => {
      try {
        const xml = await propfind(url, CHANGE_MARKER_PROPS, '0')
        const marker = parseChangeMarker(xml, url)
        if (marker) markers.set(url, marker)
      } catch {
        /* keep the previous marker; the next poll retries */
      }
    })
  )
  return markers
}

export interface CollectionSyncOptions {
  /** Collection URLs the view currently shows (re-read on every check). */
  getCollections: () => string[]
  /** Called with the URLs whose marker changed since the previous check. */
  onChanged: (changedUrls: string[]) => void | Promise<void>
  /** Poll period in ms while the document is visible. */
  intervalMs?: number
}

export interface CollectionSync {
  /** Compare markers once (single-flight: overlapping calls share one run). */
  check: () => Promise<void>
  /**
   * Re-read the marker(s) after the view reloaded a collection (its own write,
   * an explicit refresh), so the app's own change does not trigger a refetch.
   */
  markSynced: (urls?: string[]) => Promise<void>
  /** Start polling + focus/visibility listeners (idempotent). */
  start: () => void
  /** Stop polling and remove listeners (idempotent). */
  stop: () => void
}

export function useCollectionSync({
  getCollections,
  onChanged,
  intervalMs = DEFAULT_SYNC_INTERVAL_MS
}: CollectionSyncOptions): CollectionSync {
  /** url → last marker the view is known to have loaded. */
  const markers = new Map<string, string>()
  let inFlight: Promise<void> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let focusTimer: ReturnType<typeof setTimeout> | null = null
  let lastFocusCheckAt = 0
  let running = false

  function documentVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState === 'visible'
  }

  async function runCheck(): Promise<void> {
    const collections = getCollections()
    if (collections.length === 0) return

    const fresh = await fetchCtags(collections)

    // Forget collections the user no longer sees (deleted, or deselected).
    for (const url of Array.from(markers.keys())) {
      if (!collections.includes(url)) markers.delete(url)
    }

    const changed: string[] = []
    for (const [url, marker] of fresh) {
      const previous = markers.get(url)
      // Remember before notifying: a reload triggered by this notification must
      // not look like a new external change on the next poll.
      markers.set(url, marker)
      if (previous !== undefined && previous !== marker) changed.push(url)
    }
    if (changed.length === 0) return

    try {
      await onChanged(changed)
    } catch (err) {
      // A failing reload must not stop the poll loop.
      console.error('[planner] collection sync onChange failed:', err)
    }
  }

  function check(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = runCheck().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function markSynced(urls?: string[]): Promise<void> {
    // Let a running check finish first: otherwise its (older) markers could
    // overwrite the ones we are about to read and produce one redundant reload.
    if (inFlight) await inFlight
    const targets = urls?.length ? urls : getCollections()
    if (targets.length === 0) return
    const fresh = await fetchCtags(targets)
    for (const [url, marker] of fresh) markers.set(url, marker)
  }

  function clearFocusTimer(): void {
    if (focusTimer !== null) {
      clearTimeout(focusTimer)
      focusTimer = null
    }
  }

  /**
   * Focus and visibility events arrive in bursts (alt-tab, unlock, click back).
   * The first one checks right away; repeats inside the debounce window are
   * folded into a single trailing check.
   */
  function scheduleCheck(): void {
    if (!running || !documentVisible()) return
    if (focusTimer !== null) return

    const run = () => {
      focusTimer = null
      lastFocusCheckAt = Date.now()
      void check()
    }
    const elapsed = Date.now() - lastFocusCheckAt
    if (elapsed >= FOCUS_CHECK_DELAY_MS) {
      run()
      return
    }
    focusTimer = setTimeout(run, FOCUS_CHECK_DELAY_MS - elapsed)
  }

  function onFocus(): void {
    scheduleCheck()
  }

  function onVisibilityChange(): void {
    // Returning to the tab is the moment a change is most likely and most
    // visible; going hidden only stops the timer from doing anything.
    scheduleCheck()
  }

  function start(): void {
    if (running) return
    running = true
    pollTimer = setInterval(() => {
      if (documentVisible()) void check()
    }, intervalMs)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  }

  function stop(): void {
    running = false
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    clearFocusTimer()
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  start()
  if (getCurrentScope()) onScopeDispose(stop)

  return { check, markSynced, start, stop }
}
