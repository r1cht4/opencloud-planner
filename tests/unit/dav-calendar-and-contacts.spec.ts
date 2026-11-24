// @vitest-environment jsdom
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
  buildDAVHeaders,
  parseCurrentUserPrincipal,
  resolveDavUrl
} from '../../src/composables/useDAVClient'
import {
  buildIcs,
  formatIfMatch,
  parseIcsToEvent,
  useCalendarService
} from '../../src/composables/useCalendarService'
import {
  buildVcard,
  escapeVcardText,
  parseVcard,
  unescapeVcardText,
  useContactsService
} from '../../src/composables/useContactsService'
import { davPropText, parseMultistatus } from '../../src/composables/davXml'
import type { Contact } from '../../src/types'

describe('DAV client helpers', () => {
  it('adds the OpenCloud bearer token and XMLHttpRequest header', () => {
    authState.accessToken = 'test-token'

    const headers = buildDAVHeaders({ Depth: '1' }, { 'Content-Type': 'application/xml' })

    expect(headers.get('Authorization')).toBe('Bearer test-token')
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(headers.get('Cache-Control')).toBe('no-cache')
    expect(headers.get('Depth')).toBe('1')
    expect(headers.get('Content-Type')).toBe('application/xml')
  })

  it('does not overwrite an explicit authorization header', () => {
    authState.accessToken = 'store-token'

    const headers = buildDAVHeaders({ Authorization: 'Bearer explicit-token' })

    expect(headers.get('Authorization')).toBe('Bearer explicit-token')
  })

  it('parses current-user-principal and resolves relative DAV URLs', () => {
    const xml = `<?xml version="1.0"?>
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
      </d:multistatus>`

    expect(parseCurrentUserPrincipal(xml)).toBe('/caldav/user-1/')
    expect(resolveDavUrl('https://cloud.example/caldav', '/caldav/user-1/')).toBe(
      'https://cloud.example/caldav/user-1/'
    )
  })
})

describe('Calendar DAV service helpers', () => {
  it('parses multistatus calendar responses', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/caldav/user/default/</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>Default Calendar</d:displayname>
              <cs:calendar />
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const responses = parseMultistatus(xml)

    expect(responses).toHaveLength(1)
    expect(responses[0].href).toBe('/caldav/user/default/')
    expect(davPropText(responses[0].el, 'displayname')).toBe('Default Calendar')
  })

  it('preserves DAV ETags for If-Match headers', () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response>
      <d:href>/caldav/user/default/e.ics</d:href>
      <d:propstat><d:prop><d:getetag>"radicale-etag"</d:getetag></d:prop></d:propstat>
    </d:response></d:multistatus>`

    expect(davPropText(parseMultistatus(xml)[0].el, 'getetag')).toBe('"radicale-etag"')
    expect(formatIfMatch('"radicale-etag"')).toBe('"radicale-etag"')
    expect(formatIfMatch('radicale-etag')).toBe('"radicale-etag"')
  })

  it('builds and parses a timed VEVENT', async () => {
    const ics = await buildIcs({
      id: 'event-1',
      title: 'Planning',
      start: '2026-06-07 10:00',
      end: '2026-06-07 11:00',
      description: 'Discuss rollout',
      location: 'OpenCloud'
    })

    expect(ics).toMatch(/DTSTART;TZID=[^:]+:20260607T100000/)
    expect(ics).toMatch(/DTEND;TZID=[^:]+:20260607T110000/)

    const event = await parseIcsToEvent(ics, 'https://cloud.example/caldav/user/default/')

    expect(event).toMatchObject({
      id: 'event-1',
      title: 'Planning',
      start: '2026-06-07 10:00',
      end: '2026-06-07 11:00',
      location: 'OpenCloud'
    })
  })
})

describe('Contacts DAV service helpers', () => {
  it('parses multistatus address book responses', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
        <d:response>
          <d:href>/carddav/user/default/</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>Contacts</d:displayname>
              <card:addressbook />
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const responses = parseMultistatus(xml)

    expect(responses).toHaveLength(1)
    expect(responses[0].href).toBe('/carddav/user/default/')
    expect(davPropText(responses[0].el, 'displayname')).toBe('Contacts')
  })

  it('parses and builds vCards with email, phone, organization, and address', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:contact-1',
      'FN:Ada Lovelace',
      'N:Lovelace;Ada;;;',
      'EMAIL;TYPE=work:ada@example.test',
      'TEL;TYPE=cell:+49123456789',
      'ADR;TYPE=home:;;Main Street 1;Berlin;;10115;Germany',
      'ORG:Analytical Engines',
      'TITLE:Researcher',
      'NOTE:First programmer',
      'END:VCARD'
    ].join('\r\n')

    const contact = parseVcard(raw)

    expect(contact.displayName).toBe('Ada Lovelace')
    expect(contact.emails).toEqual([{ type: 'work', value: 'ada@example.test' }])
    expect(contact.phones).toEqual([{ type: 'cell', value: '+49123456789' }])
    expect(contact.addresses[0]).toMatchObject({
      street: 'Main Street 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'Germany'
    })

    const rebuilt = buildVcard(contact)

    expect(rebuilt).toContain('FN:Ada Lovelace')
    expect(rebuilt).toContain('EMAIL;TYPE=work:ada@example.test')
    expect(rebuilt).toContain('ORG:Analytical Engines')
  })

  it('escapes and unescapes vCard text values', () => {
    expect(escapeVcardText('Ada, Countess; notes\\math\nnext')).toBe(
      'Ada\\, Countess\\; notes\\\\math\\nnext'
    )
    expect(unescapeVcardText('Ada\\, Countess\\; notes\\\\math\\nnext')).toBe(
      'Ada, Countess; notes\\math\nnext'
    )

    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:escaped-contact',
      'FN:Ada\\, Countess\\; Notes',
      'N:Lovelace\\;Byron;Ada;;;',
      'ADR;TYPE=home:;;Street\\; 1;Berlin;;10115;Germany',
      'NOTE:Line one\\nLine two',
      'END:VCARD'
    ].join('\r\n')
    const contact = parseVcard(raw)

    expect(contact.displayName).toBe('Ada, Countess; Notes')
    expect(contact.lastName).toBe('Lovelace;Byron')
    expect(contact.addresses[0].street).toBe('Street; 1')
    expect(contact.notes).toBe('Line one\nLine two')
    expect(buildVcard(contact)).toContain('FN:Ada\\, Countess\\; Notes')
  })

  it('filters and sorts contacts by the user search query', () => {
    const { contacts, filteredContacts, searchQuery } = useContactsService()
    contacts.value = [
      contactFixture('zed', 'Zed Example', 'zed@example.test'),
      contactFixture('ada', 'Ada Lovelace', 'ada@example.test')
    ]

    expect(filteredContacts.value.map((contact) => contact.displayName)).toEqual([
      'Ada Lovelace',
      'Zed Example'
    ])

    searchQuery.value = 'ada'

    expect(filteredContacts.value.map((contact) => contact.displayName)).toEqual(['Ada Lovelace'])
  })
})

describe('first-run collection creation', () => {
  it('creates a default calendar when discovery finds no calendars', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'

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

      if (method === 'MKCOL' && requestUrl.endsWith('/caldav/user-1/default-calendar/')) {
        return new Response('', { status: 201 })
      }

      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchCalendars } = useCalendarService()
    const calendars = await fetchCalendars()

    expect(calendars).toEqual([
      {
        url: 'http://localhost:3000/caldav/user-1/default-calendar/',
        displayName: 'Calendar',
        color: '#00677F',
        description: '',
        ctag: ''
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/caldav/user-1/default-calendar/',
      expect.objectContaining({ method: 'MKCOL' })
    )
  })

  it('creates a default address book when discovery finds no address books', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'

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

      if (method === 'MKCOL' && requestUrl.endsWith('/carddav/user-1/default-contacts/')) {
        return new Response('', { status: 201 })
      }

      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchAddressBooks } = useContactsService()
    const addressBooks = await fetchAddressBooks()

    expect(addressBooks).toEqual([
      {
        url: 'http://localhost:3000/carddav/user-1/default-contacts/',
        displayName: 'Contacts',
        description: '',
        ctag: ''
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/carddav/user-1/default-contacts/',
      expect.objectContaining({ method: 'MKCOL' })
    )
  })
})

function contactFixture(id: string, displayName: string, email: string): Contact {
  const [firstName, lastName] = displayName.split(' ')
  return {
    id,
    displayName,
    firstName,
    lastName,
    emails: [{ type: 'work', value: email }],
    phones: [],
    addresses: [],
    organization: '',
    title: '',
    notes: ''
  }
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 207,
    headers: { 'Content-Type': 'application/xml' }
  })
}
