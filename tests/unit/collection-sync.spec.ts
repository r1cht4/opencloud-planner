// @vitest-environment happy-dom
/**
 * useCollectionSync – live refresh from other clients (ctag / sync-token).
 *
 * Driven with fake timers and a stubbed `fetch` that answers PROPFIND with a
 * multistatus carrying a ctag (Radicale answers ctag *and* sync-token; the
 * marker prefers the ctag and falls back to the sync-token).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import {
  CHANGE_MARKER_PROPS,
  DEFAULT_SYNC_INTERVAL_MS,
  FOCUS_CHECK_DELAY_MS,
  fetchCtags,
  parseChangeMarker,
  useCollectionSync,
  type CollectionSync
} from '../../src/composables/useCollectionSync'
import { setAdminConfig } from '../../src/config/appConfig'

const CAL_A = 'http://dav.test/caldav/user/alice/'
const CAL_B = 'http://dav.test/caldav/user/work/'

interface DavRequest {
  url: string
  method: string
  depth: string | null
  body: string
}

const server = {
  ctags: new Map<string, string>(),
  syncTokens: new Map<string, string>(),
  failing: new Set<string>(),
  requests: [] as DavRequest[],
  /** When set, PROPFINDs hang until the promise resolves (single-flight test). */
  gate: null as Promise<void> | null
}

let visibility: DocumentVisibilityState = 'visible'

function multistatus(href: string, props: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>${props}</d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
}

function bodyFor(url: string): string {
  const parts: string[] = []
  const ctag = server.ctags.get(url)
  if (ctag) parts.push(`<cs:getctag>${ctag}</cs:getctag>`)
  const token = server.syncTokens.get(url)
  if (token) parts.push(`<d:sync-token>${token}</d:sync-token>`)
  return multistatus(url, parts.join(''))
}

async function fakeFetch(input: unknown, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const headers =
    init.headers instanceof Headers ? init.headers : new Headers(init.headers as HeadersInit)
  server.requests.push({
    url,
    method: init.method ?? 'GET',
    depth: headers.get('Depth'),
    body: String(init.body ?? '')
  })

  if (server.gate) await server.gate
  if (server.failing.has(url)) {
    return { ok: false, status: 500, text: async () => '', headers: new Headers() } as Response
  }
  return {
    ok: true,
    status: 207,
    text: async () => bodyFor(url),
    headers: new Headers()
  } as Response
}

/** Let pending promise chains (PROPFIND → parse → onChanged) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

interface Harness {
  sync: CollectionSync
  changes: string[][]
  scope: EffectScope
}

function startSync(collections: () => string[] = () => [CAL_A, CAL_B]): Harness {
  const changes: string[][] = []
  const scope = effectScope()
  const sync = scope.run(() =>
    useCollectionSync({
      getCollections: collections,
      onChanged: (urls) => {
        changes.push(urls)
      }
    })
  ) as CollectionSync
  return { sync, changes, scope }
}

beforeEach(() => {
  // The fake Radicale of this suite lives on dav.test — announce it as the
  // DAV origin so the token boundary lets the requests through.
  setAdminConfig({ caldavUrl: 'http://dav.test/caldav', carddavUrl: 'http://dav.test/carddav' })
  server.ctags.clear()
  server.syncTokens.clear()
  server.failing.clear()
  server.requests.length = 0
  server.gate = null
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility
  })
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setAdminConfig(undefined)
})

describe('parseChangeMarker', () => {
  it('prefers the ctag and falls back to the sync-token', () => {
    expect(
      parseChangeMarker(
        multistatus(CAL_A, '<cs:getctag>abc</cs:getctag><d:sync-token>t1</d:sync-token>')
      )
    ).toBe('ctag:abc')
    expect(parseChangeMarker(multistatus(CAL_A, '<d:sync-token>t1</d:sync-token>'))).toBe(
      'token:t1'
    )
  })

  it('returns an empty marker when the server exposes neither', () => {
    expect(parseChangeMarker(multistatus(CAL_A, '<d:getetag>"1"</d:getetag>'))).toBe('')
    expect(parseChangeMarker('')).toBe('')
  })

  it('picks the response of the requested collection among several', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:response><d:href>/caldav/user/other/</d:href><d:propstat><d:prop>
    <cs:getctag>other</cs:getctag></d:prop></d:propstat></d:response>
  <d:response><d:href>/caldav/user/alice/</d:href><d:propstat><d:prop>
    <cs:getctag>wanted</cs:getctag></d:prop></d:propstat></d:response>
</d:multistatus>`
    expect(parseChangeMarker(xml, CAL_A)).toBe('ctag:wanted')
  })
})

describe('fetchCtags', () => {
  it('sends one Depth-0 PROPFIND per collection asking for ctag and sync-token', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')

    const markers = await fetchCtags([CAL_A, CAL_B])

    expect(markers.get(CAL_A)).toBe('ctag:a1')
    expect(markers.get(CAL_B)).toBe('ctag:b1')
    expect(server.requests).toHaveLength(2)
    for (const request of server.requests) {
      expect(request.method).toBe('PROPFIND')
      expect(request.depth).toBe('0')
      expect(request.body).toContain('getctag')
      expect(request.body).toContain('sync-token')
    }
    expect(CHANGE_MARKER_PROPS).toContain('http://calendarserver.org/ns/')
  })

  it('tolerates a single failing collection instead of aborting the poll', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.failing.add(CAL_B)

    const markers = await fetchCtags([CAL_A, CAL_B])

    expect([...markers.keys()]).toEqual([CAL_A])
  })

  it('omits collections that expose no marker at all', async () => {
    const markers = await fetchCtags([CAL_A])
    expect(markers.size).toBe(0)
  })
})

describe('useCollectionSync', () => {
  it('records the baseline without notifying, and stays silent while nothing changes', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()

    await harness.sync.markSynced()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(harness.changes).toEqual([])
    // baseline (2) + two polls (2 each)
    expect(server.requests).toHaveLength(6)
    harness.scope.stop()
  })

  it('without a baseline the first marker is adopted silently (no initial storm)', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()

    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(harness.changes).toEqual([])
    harness.scope.stop()
  })

  it('notifies exactly once with the changed collection URL', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()

    server.ctags.set(CAL_A, 'a2')
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()
    expect(harness.changes).toEqual([[CAL_A]])

    // The new marker was remembered, so the next poll is quiet again.
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()
    expect(harness.changes).toEqual([[CAL_A]])
    harness.scope.stop()
  })

  it('detects a change carried only by the sync-token (no ctag)', async () => {
    server.syncTokens.set(CAL_A, 'token-1')
    const harness = startSync(() => [CAL_A])
    await harness.sync.markSynced()

    server.syncTokens.set(CAL_A, 'token-2')
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(harness.changes).toEqual([[CAL_A]])
    harness.scope.stop()
  })

  it('reports several changed collections in one notification', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()

    server.ctags.set(CAL_A, 'a2')
    server.ctags.set(CAL_B, 'b2')
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(harness.changes).toEqual([[CAL_A, CAL_B]])
    harness.scope.stop()
  })

  it('does not poll while the document is hidden, and checks when it becomes visible', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    visibility = 'hidden'
    const harness = startSync()
    await harness.sync.markSynced()
    const afterBaseline = server.requests.length

    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS * 3)
    await settle()
    expect(server.requests).toHaveLength(afterBaseline)
    expect(harness.changes).toEqual([])

    server.ctags.set(CAL_A, 'a2')
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(harness.changes).toEqual([[CAL_A]])
    harness.scope.stop()
  })

  it('checks on window focus', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()

    server.ctags.set(CAL_B, 'b2')
    window.dispatchEvent(new Event('focus'))
    await settle()

    expect(harness.changes).toEqual([[CAL_B]])
    harness.scope.stop()
  })

  it('does not check on events while the document stays hidden', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()
    const afterBaseline = server.requests.length

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await settle()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS * 2)
    await settle()

    expect(server.requests).toHaveLength(afterBaseline)
    expect(harness.changes).toEqual([])
    harness.scope.stop()
  })

  it('coalesces focus/visibility bursts to at most one check per second', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()
    const base = server.requests.length

    // First event checks right away.
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(server.requests).toHaveLength(base + 2)

    // Repeats inside the debounce window are folded into one trailing check.
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(server.requests).toHaveLength(base + 2)

    await vi.advanceTimersByTimeAsync(FOCUS_CHECK_DELAY_MS)
    await settle()
    expect(server.requests).toHaveLength(base + 4)
    harness.scope.stop()
  })

  it('is single-flight: overlapping checks share one run and one notification', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()
    const base = server.requests.length

    let release!: () => void
    server.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.ctags.set(CAL_A, 'a2')

    const first = harness.sync.check()
    const second = harness.sync.check()
    expect(second).toBe(first)

    await settle()
    expect(server.requests).toHaveLength(base + 2)

    server.gate = null
    release()
    await first
    await second
    await settle()

    expect(harness.changes).toHaveLength(1)
    expect(harness.changes[0]).toContain(CAL_A)
    harness.scope.stop()
  })

  it('re-reading the marker after a local write suppresses the self-triggered refresh', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()

    // Our own save bumps the ctag of that calendar.
    server.ctags.set(CAL_A, 'a2')
    await harness.sync.markSynced([CAL_A])

    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(harness.changes).toEqual([])
    harness.scope.stop()
  })

  it('stops polling, clears a pending debounce and drops listeners on scope dispose', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const harness = startSync()
    await harness.sync.markSynced()

    // Prime a pending trailing check (event inside the debounce window).
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    window.dispatchEvent(new Event('focus'))
    await settle()
    const base = server.requests.length

    harness.scope.stop()

    server.ctags.set(CAL_A, 'a2')
    server.ctags.set(CAL_B, 'b2')
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS * 2)
    await settle()

    expect(server.requests).toHaveLength(base)
    expect(harness.changes).toEqual([])
  })

  it('start() is idempotent and check() ignores an empty collection list', async () => {
    const harness = startSync(() => [])
    harness.sync.start()

    await harness.sync.check()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(server.requests).toHaveLength(0)
    expect(harness.changes).toEqual([])
    harness.scope.stop()
  })

  it('keeps polling when onChanged throws', async () => {
    server.ctags.set(CAL_A, 'a1')
    server.ctags.set(CAL_B, 'b1')
    const calls: string[][] = []
    const scope = effectScope()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sync = scope.run(() =>
      useCollectionSync({
        getCollections: () => [CAL_A, CAL_B],
        onChanged: (urls) => {
          calls.push(urls)
          throw new Error('reload failed')
        }
      })
    ) as CollectionSync

    await sync.markSynced()
    server.ctags.set(CAL_A, 'a2')
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()

    expect(calls).toHaveLength(1)

    // Still polling: the next change is reported again.
    server.ctags.set(CAL_A, 'a3')
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_INTERVAL_MS)
    await settle()
    expect(calls).toHaveLength(2)

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
    scope.stop()
  })
})
