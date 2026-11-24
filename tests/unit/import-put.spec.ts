// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import { resetDAVClient } from '../../src/composables/useDAVClient'
import { setAdminConfig } from '../../src/config/appConfig'
import { useCalendarService } from '../../src/composables/useCalendarService'
import { useContactsService } from '../../src/composables/useContactsService'

// The fake Radicale of this suite lives on dav.test — announce it as the DAV
// origin so the token boundary lets the requests through.
beforeEach(() => {
  setAdminConfig({ caldavUrl: 'http://dav.test/cal/', carddavUrl: 'http://dav.test/card/' })
})

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/dav/user-1/</d:href></d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

/** fetch stub: 207 for PROPFIND discovery, configurable status for PUT. */
function stubFetch(putStatus: number) {
  const fetchMock = vi.fn(async (_url: any, init?: any) => {
    const method = init?.method || 'GET'
    if (method === 'PROPFIND') {
      return { ok: true, status: 207, text: async () => principalXml, headers: new Headers() }
    }
    return {
      ok: putStatus >= 200 && putStatus < 300,
      status: putStatus,
      text: async () => '',
      headers: new Headers()
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetDAVClient()
})

const ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u1\r\nEND:VEVENT\r\nEND:VCALENDAR'
const VCF = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c1\r\nFN:Ada\r\nEND:VCARD'

describe('importEventIcs', () => {
  it('PUTs the document verbatim with If-None-Match and reports created', async () => {
    const fetchMock = stubFetch(201)
    const { importEventIcs } = useCalendarService()
    const result = await importEventIcs('http://dav.test/cal/', 'u1', ICS)
    expect(result).toBe('created')

    const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!
    expect(put[0]).toBe('http://dav.test/cal/u1.ics')
    expect(put[1].body).toBe(ICS)
    expect(new Headers(put[1].headers).get('If-None-Match')).toBe('*')
  })

  it('reports exists on 412 without treating it as an error', async () => {
    stubFetch(412)
    const { importEventIcs, error } = useCalendarService()
    expect(await importEventIcs('http://dav.test/cal/', 'u1', ICS)).toBe('exists')
    expect(error.value).toBeNull()
  })

  it('reports failed on server errors', async () => {
    stubFetch(500)
    const { importEventIcs } = useCalendarService()
    expect(await importEventIcs('http://dav.test/cal/', 'u1', ICS)).toBe('failed')
  })
})

describe('importContactVcard', () => {
  it('PUTs the vCard verbatim and reports created', async () => {
    const fetchMock = stubFetch(201)
    const { importContactVcard } = useContactsService()
    expect(await importContactVcard('http://dav.test/ab/', 'c1', VCF)).toBe('created')

    const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!
    expect(put[0]).toBe('http://dav.test/ab/c1.vcf')
    expect(put[1].body).toBe(VCF)
    expect(new Headers(put[1].headers).get('If-None-Match')).toBe('*')
  })

  it('maps 412 to exists and 500 to failed', async () => {
    stubFetch(412)
    expect(await useContactsService().importContactVcard('http://dav.test/ab/', 'c1', VCF)).toBe(
      'exists'
    )
    resetDAVClient()
    stubFetch(500)
    expect(await useContactsService().importContactVcard('http://dav.test/ab/', 'c1', VCF)).toBe(
      'failed'
    )
  })
})

describe('import PUTs use deterministic resource names', () => {
  const UNSAFE_UID = 'urn:uuid:9f8e7d6c-1234-5678-abcd-000000000003'

  const ICS_UNSAFE = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${UNSAFE_UID}`,
    'DTSTAMP:20260101T000000Z',
    'SUMMARY:Foreign',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const VCF_UNSAFE = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${UNSAFE_UID}`,
    'FN:Foreign',
    'END:VCARD'
  ].join('\r\n')

  /** Same digest as the app computes (`crypto.subtle` SHA-256, lowercase hex). */
  async function expectedName(uid: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /** PUT: 201 for the first call per URL, 412 (exists) from the second on. */
  function stubFetchPutOnce() {
    const seen = new Set<string>()
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const method = init?.method || 'GET'
      if (method === 'PROPFIND') {
        return { ok: true, status: 207, text: async () => principalXml, headers: new Headers() }
      }
      if (method === 'PUT') {
        if (seen.has(String(url))) {
          return { ok: false, status: 412, text: async () => '', headers: new Headers() }
        }
        seen.add(String(url))
        return { ok: true, status: 201, text: async () => '', headers: new Headers() }
      }
      return { ok: false, status: 404, text: async () => '', headers: new Headers() }
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('PUTs an event with an unsafe UID to its SHA-256 name, UID untouched in the body', async () => {
    const fetchMock = stubFetchPutOnce()
    const { importEventIcs } = useCalendarService()

    const result = await importEventIcs('http://dav.test/cal/', UNSAFE_UID, ICS_UNSAFE)

    expect(result).toBe('created')
    const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!
    // The URL carries the deterministic safe name …
    expect(put[0]).toBe(`http://dav.test/cal/${await expectedName(UNSAFE_UID)}.ics`)
    // … the body keeps the original identity verbatim.
    expect(put[1].body).toBe(ICS_UNSAFE)
  })

  it('re-importing the same file lands on the same URL and reports exists', async () => {
    stubFetchPutOnce()
    const { importEventIcs } = useCalendarService()

    expect(await importEventIcs('http://dav.test/cal/', UNSAFE_UID, ICS_UNSAFE)).toBe('created')
    expect(await importEventIcs('http://dav.test/cal/', UNSAFE_UID, ICS_UNSAFE)).toBe('exists')
  })

  it('works the same for vCards (SHA-256 resource name, UID kept)', async () => {
    const fetchMock = stubFetchPutOnce()
    const { importContactVcard } = useContactsService()

    expect(await importContactVcard('http://dav.test/card/', UNSAFE_UID, VCF_UNSAFE)).toBe(
      'created'
    )
    const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!
    expect(put[0]).toBe(`http://dav.test/card/${await expectedName(UNSAFE_UID)}.vcf`)
    expect(put[1].body).toBe(VCF_UNSAFE)
  })
})
