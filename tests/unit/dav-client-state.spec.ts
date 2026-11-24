import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import { davUserId, resetDAVClient, useDAVClient } from '../../src/composables/useDAVClient'
import { setAdminConfig } from '../../src/config/appConfig'

// The fake Radicale of this suite lives on dav.test — announce it as the DAV
// origin so the token boundary lets the requests through.
beforeEach(() => {
  setAdminConfig({ caldavUrl: 'http://dav.test/caldav', carddavUrl: 'http://dav.test/carddav' })
})

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

function stubDavFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 207,
    text: async () => principalXml,
    headers: new Headers()
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetDAVClient()
  setAdminConfig(undefined)
})

describe('DAV client state lifecycle', () => {
  it('discovers once and caches across init calls', async () => {
    const fetchMock = stubDavFetch()
    const { init, getState } = useDAVClient()
    await init('calendar', 'http://dav.test/caldav')
    expect(getState('calendar')?.principalUrl).toBe('http://dav.test/caldav/user-1/')
    const callsAfterFirst = fetchMock.mock.calls.length
    await init('calendar', 'http://dav.test/caldav')
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('re-runs discovery after resetDAVClient()', async () => {
    const fetchMock = stubDavFetch()
    const { init } = useDAVClient()
    await init('calendar', 'http://dav.test/caldav')
    const callsAfterFirst = fetchMock.mock.calls.length
    resetDAVClient()
    const client = useDAVClient()
    expect(client.getState('calendar')).toBeNull()
    await client.init('calendar', 'http://dav.test/caldav')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('reset keeps previously handed-out refs reactive', async () => {
    stubDavFetch()
    const { init, isReady, error } = useDAVClient()
    await init('calendar', 'http://dav.test/caldav')
    expect(isReady.value).toBe(true)
    resetDAVClient()
    // same ref objects must reflect the cleared state (views stay wired)
    expect(isReady.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('clears a failed-init error on reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'boom',
        headers: new Headers()
      }))
    )
    const { init, error } = useDAVClient()
    await init('calendar', 'http://dav.test/caldav')
    expect(error.value).toContain('calendar DAV connection failed')
    resetDAVClient()
    expect(error.value).toBeNull()
  })
})

describe('davUserId (per-user browser storage keys)', () => {
  it("returns the principal path segment behind the DAV base — the user's Radicale UUID", async () => {
    stubDavFetch()
    const { init } = useDAVClient()
    await init('calendar', 'http://dav.test/caldav')
    expect(davUserId()).toBe('user-1')
  })

  it("falls back to 'shared' before discovery ran", () => {
    expect(davUserId()).toBe('shared')
  })
})
