// @vitest-environment jsdom
/**
 * The OpenCloud access token must never be attached to a URL
 * outside the DAV endpoints it belongs to.
 *
 * `davFetch`/`propfind` accept absolute hrefs (multistatus responses, `?open=`
 * links, backup data). A hostile or corrupted href must be rejected *before*
 * `fetch` is called, so the Bearer token cannot leak cross-origin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAdminConfig } from '../../src/config/appConfig'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import { allowedDavOrigins, davFetch, propfind } from '../../src/composables/useDAVClient'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  setAdminConfig(undefined)
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => ''
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAdminConfig(undefined)
})

describe('allowedDavOrigins', () => {
  it('defaults to the page origin', () => {
    expect(allowedDavOrigins()).toEqual([window.location.origin])
  })

  it('includes the origins of the configured caldav/carddav base URLs', () => {
    setAdminConfig({
      caldavUrl: 'https://dav.private/caldav/',
      carddavUrl: 'https://dav.private/carddav/'
    })
    expect(allowedDavOrigins()).toContain('https://dav.private')
    expect(allowedDavOrigins()).toContain(window.location.origin)
  })
})

describe('davFetch token boundary', () => {
  it('rejects a foreign origin before fetch is called', async () => {
    await expect(davFetch('https://evil.example/x')).rejects.toThrow(/origin/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an admin-configured origin only when it is not a DAV base URL', async () => {
    setAdminConfig({ caldavUrl: 'https://dav.private/caldav/' })
    // Same host as the DAV endpoint, different scheme → not the same origin.
    await expect(davFetch('http://dav.private/caldav/x')).rejects.toThrow(/origin/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the page origin and the configured DAV origins', async () => {
    setAdminConfig({
      caldavUrl: 'https://dav.private/caldav/',
      carddavUrl: 'https://cards.private/carddav/'
    })

    await davFetch('/caldav/user-1/')
    await davFetch('https://dav.private/caldav/user-1/cal/x.ics')
    await davFetch('https://cards.private/carddav/user-1/')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('propfind refuses foreign origins as well (it shares the wrapper)', async () => {
    await expect(propfind('https://evil.example/caldav/', '<d:prop/>')).rejects.toThrow(/origin/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
