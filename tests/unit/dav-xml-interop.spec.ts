// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  davPropData,
  davPropText,
  davPropTexts,
  hasResourceType,
  parseMultistatus
} from '../../src/composables/davXml'

// ---------------------------------------------------------------------------
// Fixtures modeled on real server responses. Radicale uses bare/`D:` prefixes
// and self-closed tags; SabreDAV (Nextcloud/Baïkal) uses `d:`/`cal:`/`card:`,
// paired empty tags, a second 404 propstat for missing props, the Apple
// namespace for calendar-color, and &#13; entities inside calendar-data.
// ---------------------------------------------------------------------------

const sabrePropfind = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:x1="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/remote.php/dav/calendars/jane/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop>
        <d:displayname></d:displayname>
        <x1:calendar-color/>
      </d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:response xmlns:extra="urn:x-vendor">
    <d:href>/remote.php/dav/calendars/jane/tom-und-jerry/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <cal:calendar></cal:calendar>
        </d:resourcetype>
        <d:displayname>Tom &amp; Jerry &lt;privat&gt;</d:displayname>
        <x1:calendar-color>#0082c9FF</x1:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const sabreReport = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/jane/personal/a&amp;b.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"sabre-etag-1"</d:getetag>
        <cal:calendar-data>BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
SUMMARY:Café &amp; Croissant &lt;3&#13;
END:VEVENT&#13;
END:VCALENDAR&#13;
</cal:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const cdataReport = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/cal/user/personal/x.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"cdata-etag"</D:getetag>
        <C:calendar-data><![CDATA[BEGIN:VCALENDAR
SUMMARY:a<b&c
END:VCALENDAR]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`

const sabreCarddav = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/remote.php/dav/addressbooks/users/jane/kontakte/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <card:addressbook></card:addressbook>
        </d:resourcetype>
        <d:displayname>Kontakte</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

describe('parseMultistatus (namespace interop)', () => {
  it('parses SabreDAV-style responses with attributes and paired empty tags', () => {
    const responses = parseMultistatus(sabrePropfind)
    expect(responses).toHaveLength(2)
    expect(responses[0].href).toBe('/remote.php/dav/calendars/jane/')
    expect(responses[1].href).toBe('/remote.php/dav/calendars/jane/tom-und-jerry/')
    expect(responses[0].status).toBe('HTTP/1.1 200 OK')
  })

  it('decodes XML entities in href', () => {
    const responses = parseMultistatus(sabreReport)
    expect(responses[0].href).toBe('/remote.php/dav/calendars/jane/personal/a&b.ics')
  })

  it('returns [] for malformed XML instead of throwing', () => {
    expect(parseMultistatus('this is not xml <<<')).toEqual([])
    expect(parseMultistatus('')).toEqual([])
  })
})

describe('hasResourceType', () => {
  it('detects paired-form <cal:calendar></cal:calendar> inside resourcetype', () => {
    const [principal, calendar] = parseMultistatus(sabrePropfind)
    expect(hasResourceType(principal.el, 'calendar')).toBe(false)
    expect(hasResourceType(calendar.el, 'calendar')).toBe(true)
  })

  it('detects carddav addressbook resourcetype', () => {
    const [book] = parseMultistatus(sabreCarddav)
    expect(hasResourceType(book.el, 'addressbook')).toBe(true)
    expect(hasResourceType(book.el, 'calendar')).toBe(false)
  })
})

describe('davPropText', () => {
  it('decodes entities in displayname', () => {
    const [, calendar] = parseMultistatus(sabrePropfind)
    expect(davPropText(calendar.el, 'displayname')).toBe('Tom & Jerry <privat>')
  })

  it('reads calendar-color from the Apple namespace', () => {
    const [, calendar] = parseMultistatus(sabrePropfind)
    expect(davPropText(calendar.el, 'calendar-color')).toBe('#0082c9FF')
  })

  it('returns "" for props only present as empty elements in a 404 propstat', () => {
    const [principal] = parseMultistatus(sabrePropfind)
    expect(davPropText(principal.el, 'displayname')).toBe('')
    expect(davPropText(principal.el, 'calendar-color')).toBe('')
  })

  it('reads getetag', () => {
    const [obj] = parseMultistatus(sabreReport)
    expect(davPropText(obj.el, 'getetag')).toBe('"sabre-etag-1"')
  })
})

describe('davPropTexts', () => {
  it('skips empty elements from a 404 propstat and returns the real value', () => {
    // `calendar-color` requested in two namespaces: the unknown one comes back
    // empty, the Apple one carries the value. `davPropText` would return ''.
    const [principal] = parseMultistatus(sabrePropfind)
    expect(davPropText(principal.el, 'calendar-color')).toBe('')
    expect(davPropTexts(principal.el, 'calendar-color')).toEqual([])

    const [, calendar] = parseMultistatus(sabrePropfind)
    expect(davPropTexts(calendar.el, 'calendar-color')).toEqual(['#0082c9FF'])
  })

  it('returns every non-empty value in document order', () => {
    const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cs="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
      <d:response>
        <d:href>/cal/user/cal/</d:href>
        <d:propstat>
          <d:prop><cs:calendar-color>#112233</cs:calendar-color><ical:calendar-color>#445566</ical:calendar-color></d:prop>
        </d:propstat>
      </d:response>
    </d:multistatus>`
    const [resp] = parseMultistatus(xml)
    expect(davPropTexts(resp.el, 'calendar-color')).toEqual(['#112233', '#445566'])
  })
})

describe('davPropData', () => {
  it('decodes &#13; carriage-return entities in calendar-data (Nextcloud style)', () => {
    const [obj] = parseMultistatus(sabreReport)
    const ics = davPropData(obj.el, 'calendar-data')
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('SUMMARY:Café & Croissant <3\r')
    expect(ics!.endsWith('END:VCALENDAR')).toBe(true)
  })

  it('reads CDATA-wrapped calendar-data', () => {
    const [obj] = parseMultistatus(cdataReport)
    expect(davPropData(obj.el, 'calendar-data')).toBe(
      'BEGIN:VCALENDAR\nSUMMARY:a<b&c\nEND:VCALENDAR'
    )
  })

  it('returns null when the payload prop is absent', () => {
    const [principal] = parseMultistatus(sabrePropfind)
    expect(davPropData(principal.el, 'calendar-data')).toBeNull()
  })
})
