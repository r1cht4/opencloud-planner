// @vitest-environment jsdom
/**
 * davCollections – the single collection-discovery parser. One PROPFIND body,
 * one parser for every home set. These fixtures are shaped the way the real
 * servers answer: Radicale (CalDAV namespace colour, no ctag, relative hrefs),
 * Apple/CalendarServer (Apple iCal namespace colour, ctag, absolute hrefs) and a
 * mixed one where the unknown namespace comes back as an empty 404 propstat.
 */
import { describe, expect, it } from 'vitest'

import {
  discoveryProps,
  parseDiscoveredCollections,
  parseSupportedComponents,
  supportsComponent,
  type DiscoveredCollection
} from '../../src/composables/davCollections'

const ORIGIN = 'http://localhost:3000'

/** Radicale: colours in the CalDAV namespace, relative hrefs, no displayname on one. */
const RADICALE_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/caldav/user-1/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/caldav/user-1/personal/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><cs:calendar/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
        <cs:calendar-color>#0082c9FF</cs:calendar-color>
        <cs:supported-calendar-component-set>
          <cs:comp name="VEVENT"/>
          <cs:comp name="VTODO"/>
        </cs:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/caldav/user-1/unnamed/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><cs:calendar/></d:resourcetype>
        <cs:supported-calendar-component-set>
          <cs:comp name="VEVENT"/>
        </cs:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/caldav/user-1/personal/event.ics</d:href>
    <d:propstat>
      <d:prop><d:resourcetype/><d:displayname>event.ics</d:displayname></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

/** Apple/CalendarServer: colour in the Apple namespace, ctag, absolute hrefs. */
const APPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:ICAL="http://apple.com/ns/ical/" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>${ORIGIN}/caldav/user-1/work/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>Work</D:displayname>
        <C:calendar-color/>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
        <CS:getctag>"ctag-42"</CS:getctag>
      </D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop>
        <ICAL:calendar-color>#E5484D</ICAL:calendar-color>
        <C:calendar-description>Team calendar</C:calendar-description>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`

function byName(found: DiscoveredCollection[], displayName: string): DiscoveredCollection {
  const match = found.find((collection) => collection.displayName === displayName)
  if (!match) throw new Error(`no collection named ${displayName}`)
  return match
}

describe('parseDiscoveredCollections (calendars)', () => {
  it('reads Radicale-style calendars with relative hrefs', () => {
    const found = parseDiscoveredCollections('calendar', RADICALE_XML, { origin: ORIGIN })

    // The home set itself and the .ics resource are not collections.
    expect(found.map((c) => c.displayName)).toEqual(['Personal', 'unnamed'])

    const personal = byName(found, 'Personal')
    expect(personal.href).toBe('/caldav/user-1/personal/')
    expect(personal.url).toBe(`${ORIGIN}/caldav/user-1/personal/`)
    expect(personal.colorRaw).toBe('#0082c9FF')
    expect(personal.color).toBe('#0082c9')
    expect(personal.supportedComponents).toEqual(['VEVENT', 'VTODO'])
    expect(personal.isCollection).toBe(true)
    expect(personal.isCalendar).toBe(true)
    expect(personal.isAddressbook).toBe(false)
    expect(personal.ctag).toBe('')
    expect(personal.description).toBe('')
  })

  it('falls back to the last path segment when the displayname is missing', () => {
    const found = parseDiscoveredCollections('calendar', RADICALE_XML, { origin: ORIGIN })
    expect(byName(found, 'unnamed').displayName).toBe('unnamed')
  })

  it('reads the Apple iCal namespace, the ctag and absolute hrefs', () => {
    const [work] = parseDiscoveredCollections('calendar', APPLE_XML)

    expect(work.url).toBe(`${ORIGIN}/caldav/user-1/work/`)
    expect(work.displayName).toBe('Work')
    // The empty CalDAV `calendar-color` of the 404 propstat must not win.
    expect(work.colorRaw).toBe('#E5484D')
    expect(work.color).toBe('#e5484d')
    expect(work.ctag).toBe('"ctag-42"')
    expect(work.description).toBe('Team calendar')
    expect(work.supportedComponents).toEqual(['VEVENT'])
  })

  it('prefers the first non-empty colour when both namespaces answer', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
        <d:response>
          <d:href>/caldav/user-1/both/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <c:calendar-color>#112233</c:calendar-color>
              <a:calendar-color>#445566</a:calendar-color>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const [both] = parseDiscoveredCollections('calendar', xml, { origin: ORIGIN })
    expect(both.colorRaw).toBe('#112233')
    expect(both.color).toBe('#112233')
  })

  it('leaves the colour null when the server has none or an unusable one', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/caldav/user-1/no-color/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <c:calendar-color>cornflowerblue</c:calendar-color>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const [calendar] = parseDiscoveredCollections('calendar', xml)
    expect(calendar.colorRaw).toBe('cornflowerblue')
    expect(calendar.color).toBeNull()
  })

  it('tolerates a calendar resourcetype without <d:collection/>', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/caldav/user-1/quirky/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><c:calendar/></d:resourcetype>
              <d:displayname>Quirky</d:displayname>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const [quirky] = parseDiscoveredCollections('calendar', xml, { origin: ORIGIN })
    expect(quirky.displayName).toBe('Quirky')
    expect(quirky.isCalendar).toBe(true)
    // The flag reports what the server actually said.
    expect(quirky.isCollection).toBe(false)
  })

  it('ignores address books and unparsable bodies', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
        <d:response>
          <d:href>/carddav/user-1/contacts/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
              <d:displayname>Contacts</d:displayname>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    expect(parseDiscoveredCollections('calendar', xml)).toEqual([])
    expect(parseDiscoveredCollections('addressbook', xml)).toHaveLength(1)
    expect(parseDiscoveredCollections('calendar', 'not xml <<<')).toEqual([])
    expect(parseDiscoveredCollections('calendar', '')).toEqual([])
  })
})

describe('parseDiscoveredCollections (address books)', () => {
  it('reads a CardDAV home set', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
        <d:response>
          <d:href>/carddav/user-1/</d:href>
          <d:propstat>
            <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/carddav/user-1/contacts/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
              <d:displayname>Contacts</d:displayname>
              <card:addressbook-description>Family and friends</card:addressbook-description>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    const found = parseDiscoveredCollections('addressbook', xml, { origin: ORIGIN })
    expect(found).toHaveLength(1)
    expect(found[0].url).toBe(`${ORIGIN}/carddav/user-1/contacts/`)
    expect(found[0].isAddressbook).toBe(true)
    expect(found[0].isCalendar).toBe(false)
    expect(found[0].description).toBe('Family and friends')
    expect(found[0].supportedComponents).toEqual([])
  })
})

describe('supported-calendar-component-set', () => {
  function responseElement(inner: string): Element {
    const doc = new DOMParser().parseFromString(
      `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response><d:href>/caldav/user-1/cal/</d:href>
          <d:propstat><d:prop>${inner}</d:prop></d:propstat>
        </d:response>
      </d:multistatus>`,
      'application/xml'
    )
    return doc.getElementsByTagName('*')[0]
  }

  it('lists the component names upper-cased without duplicates', () => {
    const el = responseElement(
      '<c:supported-calendar-component-set><c:comp name="vevent"/><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>'
    )
    expect(parseSupportedComponents(el)).toEqual(['VEVENT', 'VTODO'])
  })

  it('treats an absent or empty set as "server default"', () => {
    const [absent] = parseDiscoveredCollections(
      'calendar',
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response><d:href>/caldav/user-1/cal/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`
    )
    const [empty] = parseDiscoveredCollections(
      'calendar',
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response><d:href>/caldav/user-1/cal/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <c:supported-calendar-component-set/></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`
    )

    expect(absent.supportedComponents).toEqual([])
    expect(supportsComponent(absent, 'VTODO')).toBe(true)
    expect(supportsComponent(empty, 'VTODO')).toBe(true)
  })

  it('accepts only the listed components when the set is explicit', () => {
    const [eventsOnly] = parseDiscoveredCollections(
      'calendar',
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response><d:href>/caldav/user-1/cal/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
          </d:prop></d:propstat>
        </d:response>
      </d:multistatus>`
    )

    expect(supportsComponent(eventsOnly, 'VTODO')).toBe(false)
    expect(supportsComponent(eventsOnly, 'vevent')).toBe(true)
  })
})

describe('discoveryProps', () => {
  it('requests both calendar-colour namespaces for calendars', () => {
    const props = discoveryProps('calendar')

    expect(props).toContain('<d:resourcetype/>')
    expect(props).toContain('<d:displayname/>')
    expect(props).toContain('<cs:supported-calendar-component-set/>')
    expect(props).toContain('http://apple.com/ns/ical/')
    expect(props).toContain('calendar-color')
  })

  it('requests only resourcetype and displayname for address books', () => {
    const props = discoveryProps('addressbook')

    expect(props).toContain('<d:resourcetype/>')
    expect(props).toContain('<d:displayname/>')
    expect(props).not.toContain('calendar-color')
  })
})
