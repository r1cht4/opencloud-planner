// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import {
  buildColorBody,
  buildRenameBody,
  createAddressBook,
  createCalendar,
  deleteCollection,
  normalizeHexColor,
  parseProppatchResponse,
  renameCollection,
  setCollectionColor
} from '../../src/composables/useCollections'
import { resetDAVClient } from '../../src/composables/useDAVClient'
import { setAdminConfig } from '../../src/config/appConfig'

const CAL_URL = 'https://cloud.example/caldav/user-1/personal/'
const BOOK_URL = 'https://cloud.example/carddav/user-1/contacts/'

afterEach(() => {
  vi.unstubAllGlobals()
  resetDAVClient()
  setAdminConfig(undefined)
})

function multistatus(body: string): Response {
  return new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml' } })
}

function propstatBody(entries: Array<{ prop: string; status: number }>): string {
  const propstats = entries
    .map(
      (e) =>
        `<d:propstat><d:prop><d:${e.prop}/></d:prop>` +
        `<d:status>HTTP/1.1 ${e.status} ${e.status === 200 ? 'OK' : 'Forbidden'}</d:status></d:propstat>`
    )
    .join('')
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/caldav/user-1/personal/</d:href>${propstats}</d:response>
</d:multistatus>`
}

function fetchFor(
  responses: Array<{ match: (url: string, method: string) => boolean; response: () => Response }>
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    for (const r of responses) {
      if (r.match(requestUrl, method)) return r.response()
    }
    return new Response('', { status: 500 })
  })
}

describe('calendar color handling', () => {
  it('normalises hex colors to #RRGGBB', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')
    expect(normalizeHexColor('#00677f')).toBe('#00677F')
    expect(normalizeHexColor('#00677FFF')).toBe('#00677F')
    expect(normalizeHexColor('  #00677F  ')).toBe('#00677F')
    expect(normalizeHexColor('blue')).toBeNull()
    expect(normalizeHexColor('')).toBeNull()
  })

  it('writes calendar-color in both the Apple and the CalDAV namespace', () => {
    const body = buildColorBody('#00677f')

    expect(body).toContain('xmlns:a="http://apple.com/ns/ical/"')
    expect(body).toContain('xmlns:c="urn:ietf:params:xml:ns:caldav"')
    // Apple/Thunderbird/DAVx5 read the opaque 8-digit form …
    expect(body).toContain('<a:calendar-color>#00677FFF</a:calendar-color>')
    // … the CalDAV namespace carries the plain 6-digit form.
    expect(body).toContain('<c:calendar-color>#00677F</c:calendar-color>')
  })

  it('rejects values that are not hex colors', () => {
    expect(() => buildColorBody('red')).toThrow(/Invalid calendar color/)
  })
})

describe('rename body', () => {
  it('XML-escapes the display name', () => {
    const body = buildRenameBody('Tom & Jerry <"team">')

    expect(body).toContain(
      '<d:displayname>Tom &amp; Jerry &lt;&quot;team&quot;&gt;</d:displayname>'
    )
    expect(body).not.toContain('<"team">')
  })

  it('refuses an empty display name', async () => {
    await expect(renameCollection(CAL_URL, '   ')).rejects.toThrow(/must not be empty/)
  })
})

describe('PROPPATCH multistatus parsing', () => {
  it('treats a 200 propstat as success', () => {
    const result = parseProppatchResponse(propstatBody([{ prop: 'displayname', status: 200 }]))

    expect(result).toEqual({ ok: true, failed: [] })
  })

  it('reports the property names of failed propstats', () => {
    const result = parseProppatchResponse(propstatBody([{ prop: 'calendar-color', status: 403 }]))

    expect(result.ok).toBe(false)
    expect(result.failed).toContain('calendar-color')
  })

  it('fails the whole request when one of several props is refused', () => {
    const result = parseProppatchResponse(
      propstatBody([
        { prop: 'displayname', status: 200 },
        { prop: 'calendar-color', status: 409 }
      ])
    )

    expect(result.ok).toBe(false)
    expect(result.failed).toEqual(['calendar-color'])
  })

  it('fails on a response without any propstat instead of assuming success', () => {
    const result = parseProppatchResponse('<d:multistatus xmlns:d="DAV:"/>')

    expect(result.ok).toBe(false)
    expect(result.failed).toEqual(['unconfirmed'])
  })
})

describe('collection DAV writes', () => {
  // These tests talk to a fake Radicale on cloud.example, but the token only
  // travels to the page origin plus the configured DAV origins, so announce
  // cloud.example as the DAV host for this section.
  beforeEach(() => {
    setAdminConfig({
      caldavUrl: 'https://cloud.example/caldav/',
      carddavUrl: 'https://cloud.example/carddav/'
    })
  })

  it('sends one PROPPATCH setting the color in both namespaces', async () => {
    const fetchMock = fetchFor([
      {
        match: (url, method) => method === 'PROPPATCH' && url === CAL_URL,
        response: () => multistatus(propstatBody([{ prop: 'calendar-color', status: 200 }]))
      }
    ])
    vi.stubGlobal('fetch', fetchMock)

    await setCollectionColor(CAL_URL, '#C41E3A')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CAL_URL)
    expect(init.method).toBe('PROPPATCH')
    expect(String(init.body)).toContain('<a:calendar-color>#C41E3AFF</a:calendar-color>')
    expect(String(init.body)).toContain('<c:calendar-color>#C41E3A</c:calendar-color>')
  })

  it('throws when the server rejects the color prop', async () => {
    vi.stubGlobal(
      'fetch',
      fetchFor([
        {
          match: () => true,
          response: () => multistatus(propstatBody([{ prop: 'calendar-color', status: 403 }]))
        }
      ])
    )

    await expect(setCollectionColor(CAL_URL, '#C41E3A')).rejects.toThrow(/rejected by server/)
  })

  it('throws on a non-multistatus PROPPATCH response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 }))
    )

    await expect(renameCollection(CAL_URL, 'Renamed')).rejects.toThrow(
      /PROPPATCH displayname failed: 403/
    )
  })

  it('renames a collection with the escaped name in the body', async () => {
    const fetchMock = fetchFor([
      {
        match: (url, method) => method === 'PROPPATCH' && url === CAL_URL,
        response: () => multistatus(propstatBody([{ prop: 'displayname', status: 200 }]))
      }
    ])
    vi.stubGlobal('fetch', fetchMock)

    await renameCollection(CAL_URL, 'Work & Private')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).toContain('<d:displayname>Work &amp; Private</d:displayname>')
  })

  it('deletes a collection with a plain DELETE (no If-Match)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteCollection(BOOK_URL)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(BOOK_URL)
    expect(init.method).toBe('DELETE')
    const headers = new Headers(init.headers)
    expect(headers.has('If-Match')).toBe(false)
  })

  it('treats a 404 delete as already gone and other errors as failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    )
    await expect(deleteCollection(BOOK_URL)).resolves.toBeUndefined()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 }))
    )
    await expect(deleteCollection(BOOK_URL)).rejects.toThrow(/DELETE .* failed: 500/)
  })
})

describe('collection creation', () => {
  it('creates a calendar under the principal with a random path segment and sets the color', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url: requestUrl, method, body: init?.body ? String(init.body) : undefined })

      if (method === 'PROPFIND' && requestUrl === 'http://localhost:3000/caldav/') {
        return multistatus(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:">
            <d:response>
              <d:href>/caldav/</d:href>
              <d:propstat><d:prop><d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal></d:prop></d:propstat>
            </d:response>
          </d:multistatus>`)
      }
      if (method === 'MKCOL') return new Response('', { status: 201 })
      if (method === 'PROPPATCH') {
        return multistatus(propstatBody([{ prop: 'calendar-color', status: 200 }]))
      }
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const url = await createCalendar('Team & Co', '#00AA55')

    expect(url).toMatch(
      /^http:\/\/localhost:3000\/caldav\/user-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/
    )

    const mkcol = calls.find((c) => c.method === 'MKCOL')!
    expect(mkcol.url).toBe(url)
    expect(mkcol.body).toContain('<d:displayname>Team &amp; Co</d:displayname>')

    const proppatch = calls.find((c) => c.method === 'PROPPATCH')!
    expect(proppatch.url).toBe(url)
    expect(proppatch.body).toContain('<a:calendar-color>#00AA55FF</a:calendar-color>')
  })

  it('creates an address book under the CardDAV principal', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url: requestUrl, method, body: init?.body ? String(init.body) : undefined })

      if (method === 'PROPFIND' && requestUrl === 'http://localhost:3000/carddav/') {
        return multistatus(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:">
            <d:response>
              <d:href>/carddav/</d:href>
              <d:propstat><d:prop><d:current-user-principal><d:href>/carddav/user-1/</d:href></d:current-user-principal></d:prop></d:propstat>
            </d:response>
          </d:multistatus>`)
      }
      if (method === 'MKCOL') return new Response('', { status: 201 })
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const url = await createAddressBook('Family')

    expect(url).toMatch(/^http:\/\/localhost:3000\/carddav\/user-1\/[0-9a-f-]{36}\/$/)
    const mkcol = calls.find((c) => c.method === 'MKCOL')!
    expect(mkcol.body).toContain('addressbook')
    expect(mkcol.body).toContain('<d:displayname>Family</d:displayname>')
    expect(calls.some((c) => c.method === 'PROPPATCH')).toBe(false)
  })

  it('surfaces a failed MKCOL as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const requestUrl = String(url)
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method === 'PROPFIND') {
          return multistatus(`<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:"><d:response><d:href>/caldav/</d:href>
            <d:propstat><d:prop><d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal></d:prop></d:propstat>
            </d:response></d:multistatus>`)
        }
        if (method === 'MKCOL' && requestUrl.startsWith('http://localhost:3000/caldav/user-1/')) {
          return new Response('', { status: 507 })
        }
        return new Response('', { status: 500 })
      })
    )

    await expect(createCalendar('Too big')).rejects.toThrow(/MKCOL calendar failed: 507/)
  })
})
