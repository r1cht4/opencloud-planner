// @vitest-environment jsdom
/**
 * Service state under parallel DAV calls.
 *
 * The Calendar view fetches several calendars at once. With a single boolean
 * `loading` flag the first call to finish reported "not loading" while other
 * calls were still running, and every call cleared `error` at its start — so a
 * successful sibling call could hide a concurrent failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ accessToken: 'test-token' }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: authState.accessToken })
}))

import { useCalendarService } from '../../src/composables/useCalendarService'
import { useContactsService } from '../../src/composables/useContactsService'
import { resetDAVClient } from '../../src/composables/useDAVClient'

const CAL_DAV = 'http://localhost:3000/caldav/'
const CARD_DAV = 'http://localhost:3000/carddav/'
const CAL_A = 'http://localhost:3000/caldav/user-1/cal-a/'
const CAL_B = 'http://localhost:3000/caldav/user-1/cal-b/'

function xmlResponse(body: string): Response {
  return new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml' } })
}

function principalXml(service: 'caldav' | 'carddav'): string {
  return `<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/${service}/</d:href>
        <d:propstat>
          <d:prop>
            <d:current-user-principal><d:href>/${service}/user-1/</d:href></d:current-user-principal>
          </d:prop>
        </d:propstat>
      </d:response>
    </d:multistatus>`
}

function emptyReport(): Response {
  return xmlResponse('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>')
}

interface Deferred {
  promise: Promise<Response>
  resolve: (response: Response) => void
}

function deferred(): Deferred {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Fetch stub that answers discovery immediately and lets tests gate REPORTs. */
function stubbedFetch(reportResponses: Record<string, Deferred | Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url)
    const method = init?.method ?? 'GET'

    if (method === 'PROPFIND' && requestUrl === CAL_DAV) return xmlResponse(principalXml('caldav'))
    if (method === 'PROPFIND' && requestUrl === CARD_DAV)
      return xmlResponse(principalXml('carddav'))
    if (method === 'REPORT') {
      const entry = reportResponses[requestUrl]
      if (!entry) return new Response('', { status: 500 })
      return entry instanceof Response ? entry : entry.promise
    }
    return new Response('', { status: 500 })
  })
}

/** Wait until the fetch mock has seen `count` REPORT requests. */
async function waitForReports(fetchMock: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  await vi.waitFor(() => {
    const reports = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'REPORT'
    )
    expect(reports).toHaveLength(count)
  })
}

beforeEach(() => {
  resetDAVClient()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDAVClient()
})

describe('useCalendarService – loading/error under parallel fetches', () => {
  it('keeps loading true while any call is in flight and keeps a concurrent failure', async () => {
    const reportA = deferred()
    const reportB = deferred()
    const fetchMock = stubbedFetch({ [CAL_A]: reportA, [CAL_B]: reportB })
    vi.stubGlobal('fetch', fetchMock)

    const { loading, error, fetchEvents } = useCalendarService()

    const pendingA = fetchEvents(CAL_A)
    const pendingB = fetchEvents(CAL_B)
    await waitForReports(fetchMock, 2)

    expect(loading.value).toBe(true)

    // First call succeeds while the second is still running.
    reportA.resolve(emptyReport())
    await pendingA

    expect(error.value).toBeNull()
    expect(loading.value).toBe(true)

    // Second call fails — its error must not be hidden by the successful sibling.
    reportB.resolve(new Response('', { status: 500 }))
    await pendingB

    expect(loading.value).toBe(false)
    expect(error.value).toContain('calendar-query failed')
  })

  it('clears a previous error when a fresh top-level fetch starts and succeeds', async () => {
    vi.stubGlobal('fetch', stubbedFetch({ [CAL_A]: new Response('', { status: 500 }) }))

    const { loading, error, fetchEvents } = useCalendarService()

    await fetchEvents(CAL_A)
    expect(error.value).toContain('calendar-query failed')

    vi.stubGlobal('fetch', stubbedFetch({ [CAL_A]: emptyReport() }))
    const pending = fetchEvents(CAL_A)
    expect(loading.value).toBe(true)
    await pending

    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
  })
})

describe('useContactsService – loading/error under parallel fetches', () => {
  it('keeps loading true while any address book query is in flight', async () => {
    const reportA = deferred()
    const reportB = deferred()
    const bookA = 'http://localhost:3000/carddav/user-1/a/'
    const bookB = 'http://localhost:3000/carddav/user-1/b/'
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'PROPFIND' && requestUrl === CARD_DAV)
        return xmlResponse(principalXml('carddav'))
      if (method === 'REPORT') {
        const entry = requestUrl.startsWith(bookA) ? reportA : reportB
        return entry.promise
      }
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { loading, error, fetchContacts } = useContactsService()

    const pendingA = fetchContacts(bookA)
    const pendingB = fetchContacts(bookB)
    await waitForReports(fetchMock, 2)

    expect(loading.value).toBe(true)

    reportA.resolve(emptyReport())
    await pendingA
    expect(loading.value).toBe(true)

    reportB.resolve(new Response('', { status: 500 }))
    await pendingB
    expect(loading.value).toBe(false)
    expect(error.value).toContain('addressbook-query failed')
  })
})

describe('fetchCalendars – colours from the Apple iCal namespace', () => {
  it('requests calendar-color in both namespaces and normalises the value', async () => {
    const propfind = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      if (init?.method === 'PROPFIND' && requestUrl === CAL_DAV)
        return xmlResponse(principalXml('caldav'))
      if (init?.method === 'PROPFIND' && requestUrl === 'http://localhost:3000/caldav/user-1/') {
        return xmlResponse(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav" xmlns:ICAL="http://apple.com/ns/ical/">
            <d:response>
              <d:href>/caldav/user-1/apple-cal/</d:href>
              <d:propstat>
                <d:prop>
                  <d:resourcetype><d:collection/><cs:calendar/></d:resourcetype>
                  <d:displayname>Apple Calendar</d:displayname>
                </d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
              <d:propstat>
                <d:prop><cs:calendar-color/></d:prop>
                <d:status>HTTP/1.1 404 Not Found</d:status>
              </d:propstat>
              <d:propstat>
                <d:prop><ICAL:calendar-color>#E5484DFF</ICAL:calendar-color></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
            <d:response>
              <d:href>/caldav/user-1/plain/</d:href>
              <d:propstat>
                <d:prop>
                  <d:resourcetype><d:collection/><cs:calendar/></d:resourcetype>
                  <d:displayname>Plain</d:displayname>
                </d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          </d:multistatus>`)
      }
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', propfind)

    const { fetchCalendars } = useCalendarService()
    const calendars = await fetchCalendars()

    expect(calendars.map((cal) => cal.color)).toEqual(['#E5484D', '#00677F'])

    // The Apple namespace must actually be requested (otherwise other clients'
    // colours never reach the browser).
    const calendarsPropfind = propfind.mock.calls.find(
      (call) => String(call[0]) === 'http://localhost:3000/caldav/user-1/'
    )
    const body = String((calendarsPropfind?.[1] as RequestInit | undefined)?.body ?? '')
    expect(body).toContain('http://apple.com/ns/ical/')
    expect(body).toContain('calendar-color')
  })
})
