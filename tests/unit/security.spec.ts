import { afterEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ accessToken: 'test-token' }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: authState.accessToken })
}))

afterEach(() => {
  vi.unstubAllGlobals()
  authState.accessToken = 'test-token'
})

import {
  escapeXml,
  formatIfMatch,
  useCalendarService
} from '../../src/composables/useCalendarService'
import { safePhotoSrc, useContactsService } from '../../src/composables/useContactsService'
import type { CalendarEvent } from '../../src/types'
import type { Contact } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 207,
    headers: { 'Content-Type': 'application/xml' }
  })
}

/** Returns a fetch mock that handles DAV init for a given service and delegates
 *  any further requests to `handleRequest`. */
function makeCalDAVFetchMock(
  handleRequest: (url: string, init: RequestInit) => Response | Promise<Response>
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const requestUrl = String(url)
    const method = init?.method ?? 'GET'

    // CalDAV principal discovery
    if (method === 'PROPFIND' && requestUrl.endsWith('/caldav/')) {
      return xmlResponse(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/caldav/</d:href>
            <d:propstat>
              <d:prop>
                <d:current-user-principal>
                  <d:href>/caldav/user-1/</d:href>
                </d:current-user-principal>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`)
    }

    if (method === 'PROPFIND' && requestUrl.endsWith('/caldav/user-1/')) {
      return xmlResponse(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/caldav/user-1/</d:href>
            <d:propstat><d:prop><d:displayname>User</d:displayname></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`)
    }

    return handleRequest(requestUrl, init)
  })
}

function makeCardDAVFetchMock(
  handleRequest: (url: string, init: RequestInit) => Response | Promise<Response>
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const requestUrl = String(url)
    const method = init?.method ?? 'GET'

    // CardDAV principal discovery
    if (method === 'PROPFIND' && requestUrl.endsWith('/carddav/')) {
      return xmlResponse(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/carddav/</d:href>
            <d:propstat>
              <d:prop>
                <d:current-user-principal>
                  <d:href>/carddav/user-1/</d:href>
                </d:current-user-principal>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`)
    }

    if (method === 'PROPFIND' && requestUrl.endsWith('/carddav/user-1/')) {
      return xmlResponse(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/carddav/user-1/</d:href>
            <d:propstat><d:prop><d:displayname>User</d:displayname></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`)
    }

    return handleRequest(requestUrl, init)
  })
}

// ---------------------------------------------------------------------------
// escapeXml
// ---------------------------------------------------------------------------

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml('<script>')).toBe('&lt;script&gt;')
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escapeXml("it's")).toBe('it&#39;s')
    expect(escapeXml('a & b')).toBe('a &amp; b')
  })

  it('escapes & first so it is not double-escaped (input &<>"\')', () => {
    expect(escapeXml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeXml('My Calendar')).toBe('My Calendar')
  })
})

// ---------------------------------------------------------------------------
// safePhotoSrc — render gate for untrusted (imported) contact photos
// ---------------------------------------------------------------------------

describe('safePhotoSrc', () => {
  it('allows base64 raster data URIs', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(safePhotoSrc(png)).toBe(png)
    expect(safePhotoSrc('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ')
    expect(safePhotoSrc('data:image/webp;base64,UklGRg==')).toBe('data:image/webp;base64,UklGRg==')
    expect(safePhotoSrc('data:image/gif;base64,R0lGOD==')).toBe('data:image/gif;base64,R0lGOD==')
  })

  it('rejects remote http(s) photo URLs (beacon/privacy leak)', () => {
    expect(safePhotoSrc('http://evil.example/beacon.gif')).toBe('')
    expect(safePhotoSrc('https://tracker.example/p.png')).toBe('')
  })

  it('rejects SVG and non-image data URIs', () => {
    expect(safePhotoSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe('')
    expect(safePhotoSrc('data:text/html;base64,PGgxPg==')).toBe('')
  })

  it('rejects empty/null/undefined', () => {
    expect(safePhotoSrc('')).toBe('')
    expect(safePhotoSrc(null)).toBe('')
    expect(safePhotoSrc(undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// DELETE If-Match — Calendar
// ---------------------------------------------------------------------------

describe('deleteEvent sends If-Match header when etag is present', () => {
  it('passes If-Match: formatIfMatch(etag) on DELETE', async () => {
    const etag = 'abc-etag-123'
    const eventHref = 'http://localhost:3000/caldav/user-1/default/event-1.ics'

    let capturedHeaders: Record<string, string> | Headers | undefined

    const fetchMock = makeCalDAVFetchMock((_url, init) => {
      if (init?.method === 'DELETE') {
        capturedHeaders = init.headers as Record<string, string>
        return new Response('', { status: 204 })
      }
      // Fallback for calendar PROPFIND (collection listing — return empty list)
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { events, deleteEvent } = useCalendarService()

    const event: CalendarEvent = {
      id: 'event-1',
      title: 'Test Event',
      start: '2026-06-01 10:00',
      end: '2026-06-01 11:00',
      calendarId: 'http://localhost:3000/caldav/user-1/default/',
      href: eventHref,
      etag,
      isAllDay: false
    }
    events.value = [event]

    const result = await deleteEvent(event)

    expect(result).toBe(true)
    const hdrs = new Headers(capturedHeaders as HeadersInit)
    expect(hdrs.get('If-Match')).toBe(formatIfMatch(etag))
  })

  it('returns false and sets error on 412 Precondition Failed', async () => {
    const etag = 'stale-etag'
    const eventHref = 'http://localhost:3000/caldav/user-1/default/event-2.ics'

    const fetchMock = makeCalDAVFetchMock((_url, init) => {
      if (init?.method === 'DELETE') {
        return new Response('', { status: 412 })
      }
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { events, error, deleteEvent } = useCalendarService()

    const event: CalendarEvent = {
      id: 'event-2',
      title: 'Stale Event',
      start: '2026-06-02 10:00',
      end: '2026-06-02 11:00',
      calendarId: 'http://localhost:3000/caldav/user-1/default/',
      href: eventHref,
      etag,
      isAllDay: false
    }
    events.value = [event]

    const result = await deleteEvent(event)

    expect(result).toBe(false)
    expect(error.value).toContain('modified elsewhere')
  })
})

describe('updateEvent handles If-Match conflicts', () => {
  it('returns false and sets error on 412 Precondition Failed', async () => {
    const eventHref = 'http://localhost:3000/caldav/user-1/default/event-update.ics'

    const fetchMock = makeCalDAVFetchMock((_url, init) => {
      if (init?.method === 'PUT') {
        return new Response('', { status: 412 })
      }
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { error, updateEvent } = useCalendarService()
    const result = await updateEvent({
      id: 'event-update',
      title: 'Updated Event',
      start: '2026-06-03 10:00',
      end: '2026-06-03 11:00',
      calendarId: 'http://localhost:3000/caldav/user-1/default/',
      href: eventHref,
      etag: 'stale-update-etag',
      isAllDay: false
    })

    expect(result).toBe(false)
    expect(error.value).toContain('modified elsewhere')
  })
})

// ---------------------------------------------------------------------------
// DELETE If-Match — Contacts
// ---------------------------------------------------------------------------

describe('deleteContact sends If-Match header when etag is present', () => {
  it('passes If-Match: formatIfMatch(etag) on DELETE', async () => {
    const etag = 'contact-etag-xyz'
    const contactHref = 'http://localhost:3000/carddav/user-1/default/contact-1.vcf'

    let capturedHeaders: Record<string, string> | Headers | undefined

    const fetchMock = makeCardDAVFetchMock((_url, init) => {
      if (init?.method === 'DELETE') {
        capturedHeaders = init.headers as Record<string, string>
        return new Response('', { status: 204 })
      }
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { contacts, deleteContact } = useContactsService()

    const contact: Contact = {
      id: 'contact-1',
      displayName: 'Alice',
      firstName: 'Alice',
      lastName: '',
      emails: [],
      phones: [],
      addresses: [],
      organization: '',
      title: '',
      notes: '',
      href: contactHref,
      etag
    }
    contacts.value = [contact]

    const result = await deleteContact(contact)

    expect(result).toBe(true)
    const hdrs = new Headers(capturedHeaders as HeadersInit)
    expect(hdrs.get('If-Match')).toBe(formatIfMatch(etag))
  })

  it('returns false and sets error on 412 Precondition Failed', async () => {
    const etag = 'stale-contact-etag'
    const contactHref = 'http://localhost:3000/carddav/user-1/default/contact-2.vcf'

    const fetchMock = makeCardDAVFetchMock((_url, init) => {
      if (init?.method === 'DELETE') {
        return new Response('', { status: 412 })
      }
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { contacts, error, deleteContact } = useContactsService()

    const contact: Contact = {
      id: 'contact-2',
      displayName: 'Bob',
      firstName: 'Bob',
      lastName: '',
      emails: [],
      phones: [],
      addresses: [],
      organization: '',
      title: '',
      notes: '',
      href: contactHref,
      etag
    }
    contacts.value = [contact]

    const result = await deleteContact(contact)

    expect(result).toBe(false)
    expect(error.value).toContain('modified elsewhere')
  })
})

describe('updateContact handles If-Match conflicts', () => {
  it('returns false and sets error on 412 Precondition Failed', async () => {
    const contactHref = 'http://localhost:3000/carddav/user-1/default/contact-update.vcf'

    const fetchMock = makeCardDAVFetchMock((_url, init) => {
      if (init?.method === 'PUT') {
        return new Response('', { status: 412 })
      }
      return xmlResponse(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { error, updateContact } = useContactsService()
    const result = await updateContact({
      id: 'contact-update',
      displayName: 'Updated Contact',
      firstName: 'Updated',
      lastName: 'Contact',
      emails: [],
      phones: [],
      addresses: [],
      organization: '',
      title: '',
      notes: '',
      href: contactHref,
      etag: 'stale-contact-update-etag',
      rawVcard: [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'UID:contact-update',
        'FN:Old Contact',
        'N:Contact;Old;;;',
        'END:VCARD'
      ].join('\r\n')
    })

    expect(result).toBe(false)
    expect(error.value).toContain('modified elsewhere')
  })
})
