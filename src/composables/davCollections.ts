/**
 * davCollections – the one collection-discovery implementation of the extension.
 *
 * Every caller that wants to know which calendars / address books live under a
 * DAV home set (`useCalendarService.fetchCalendars`,
 * `useTasksService.fetchCalendars`, `useContactsService.fetchAddressBooks`) used
 * to PROPFIND the principal and parse the multistatus itself. They now share the
 * body builder and the parser below, which decode every property any of them
 * needs: href/URL, display name, colour (both the CalDAV and the Apple
 * namespace, normalised through `normalizeColor`), ctag, description,
 * `supported-calendar-component-set` and the resourcetype flags.
 *
 * The callers keep their public signature and return type; they only decide
 * which collections they care about (calendar vs. addressbook, VEVENT vs.
 * VTODO) and what their fallback display name / colour is.
 */

import { propfind } from './useDAVClient'
import { davPropText, davPropTexts, hasResourceType, parseMultistatus } from './davXml'
import { normalizeColor } from './colorUtils'

/** Apple's iCal namespace — read/written by Apple Calendar, Thunderbird, DAVx5, Radicale. */
export const APPLE_CALENDAR_NS = 'http://apple.com/ns/ical/'
/** CalDAV namespace — the one the CalDAV RFC-adjacent tooling reads. */
export const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav'

/** Which kind of DAV collection a discovery call looks for. */
export type CollectionKind = 'calendar' | 'addressbook'

/** One collection found under a home set, with every property the app reads. */
export interface DiscoveredCollection {
  /** `<d:href>` of the multistatus response, exactly as the server reported it. */
  href: string
  /** Absolute URL (origin-resolved) for REPORT/PUT/DELETE requests. */
  url: string
  /** `<d:displayname>`, else the last path segment; `''` when neither exists. */
  displayName: string
  /**
   * First non-empty `calendar-color` (either namespace) exactly as served —
   * `''` when the server has none. Callers apply their own fallback/case
   * (e.g. `normalizeDavColor` for the upper-case calendar colour).
   */
  colorRaw: string
  /** `colorRaw` normalised through `normalizeColor` (lower-case `#rrggbb`, else null). */
  color: string | null
  /** `getctag` when the server reported one (discovery does not request it), else `''`. */
  ctag: string
  /** `calendar-description` / `addressbook-description` (`''` when absent). */
  description: string
  /**
   * `comp@name` values of `supported-calendar-component-set`, upper-cased and
   * de-duplicated. `[]` means "the server reported no set", i.e. its default
   * applies (RFC 4791 §5.2.3) — callers must treat that as "everything allowed".
   */
  supportedComponents: string[]
  /** `<d:collection/>` was part of the resourcetype. */
  isCollection: boolean
  /** `<caldav:calendar/>` was part of the resourcetype. */
  isCalendar: boolean
  /** `<carddav:addressbook/>` was part of the resourcetype. */
  isAddressbook: boolean
}

/** Options shared by the discovery request and its parser. */
export interface DiscoverOptions {
  /**
   * Origin used to resolve relative hrefs. Defaults to the origin of the URL
   * that was requested.
   */
  origin?: string
}

/** Root path segment fallback when a collection has no displayname. */
function lastHrefSegment(href: string): string {
  return href.split('/').filter(Boolean).pop() || ''
}

/**
 * The property set of a collection-discovery PROPFIND.
 *
 * Colours are requested in *both* namespaces: Radicale/Nextcloud answer in the
 * CalDAV namespace, Apple/Thunderbird/DAVx5 write (and report) them in the Apple
 * iCal namespace, and the parser matches by local name so a server that only
 * knows one of them answers the other with an empty 404 propstat.
 *
 * Description and ctag are *not* requested (they were never fetched before, and
 * an unused property request only costs a 404 propstat); the parser still reads
 * them when a server volunteers one.
 */
export function discoveryProps(kind: CollectionKind): string {
  const common = '<d:resourcetype/><d:displayname/>'
  if (kind === 'addressbook') return common
  return (
    common +
    '<cs:supported-calendar-component-set/>' +
    '<cs:calendar-color/>' +
    `<x:calendar-color xmlns:x="${APPLE_CALENDAR_NS}"/>`
  )
}

/**
 * Decode a `supported-calendar-component-set` into upper-cased component names.
 * `[]` means the property was absent (or empty) — the server default applies.
 */
export function parseSupportedComponents(scope: Element): string[] {
  let set: Element | null = null
  for (const candidate of Array.from(scope.getElementsByTagName('*'))) {
    if (candidate.localName === 'supported-calendar-component-set') {
      set = candidate
      break
    }
  }
  if (!set) return []

  const components: string[] = []
  for (const comp of Array.from(set.getElementsByTagName('*'))) {
    if (comp.localName !== 'comp') continue
    const name = comp.getAttribute('name')
    if (name && !components.includes(name.toUpperCase())) components.push(name.toUpperCase())
  }
  return components
}

/**
 * Does a collection accept `component` (e.g. `VTODO`)?
 *
 * An absent or empty `supported-calendar-component-set` means "server default",
 * which is accepted; an explicit set must list the component.
 */
export function supportsComponent(collection: DiscoveredCollection, component: string): boolean {
  if (collection.supportedComponents.length === 0) return true
  return collection.supportedComponents.includes(component.toUpperCase())
}

/**
 * Parse a collection-discovery multistatus into typed collections.
 *
 * Entries are returned in document order; the home set itself (or anything that
 * is not a collection of the requested kind) is skipped. `origin` resolves
 * relative hrefs — pass the DAV base origin so the URLs match what the views
 * already use.
 */
export function parseDiscoveredCollections(
  kind: CollectionKind,
  xml: string,
  options: DiscoverOptions = {}
): DiscoveredCollection[] {
  const origin = options.origin ?? ''
  const found: DiscoveredCollection[] = []

  for (const resp of parseMultistatus(xml)) {
    // Only entries whose resourcetype marks them as `kind` are collections we
    // care about; the home set itself and the resources inside it (an `.ics`
    // or `.vcf` with an empty resourcetype) are skipped. A missing
    // `<d:collection/>` is tolerated — the kind flag alone identifies the
    // collection, which is what the per-service finders always required.
    if (!hasResourceType(resp.el, kind)) continue

    const colorRaw = davPropTexts(resp.el, 'calendar-color')[0] ?? ''
    found.push({
      href: resp.href,
      url: resp.href.startsWith('http') ? resp.href : `${origin}${resp.href}`,
      displayName: davPropText(resp.el, 'displayname') || lastHrefSegment(resp.href),
      colorRaw,
      color: normalizeColor(colorRaw),
      ctag: davPropText(resp.el, 'getctag'),
      description:
        davPropText(
          resp.el,
          kind === 'calendar' ? 'calendar-description' : 'addressbook-description'
        ) || '',
      supportedComponents: parseSupportedComponents(resp.el),
      isCollection: hasResourceType(resp.el, 'collection'),
      isCalendar: hasResourceType(resp.el, 'calendar'),
      isAddressbook: hasResourceType(resp.el, 'addressbook')
    })
  }

  return found
}

/** Origin of an absolute URL, or `''` when it cannot be parsed. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * PROPFIND the home set (`Depth: 1`) and return its collections of `kind`.
 *
 * Throws when the server rejects the request — the service callers wrap this in
 * their own try/catch and map the error into their `error` ref.
 */
export async function discoverCollections(
  kind: CollectionKind,
  principalUrl: string,
  options: DiscoverOptions = {}
): Promise<DiscoveredCollection[]> {
  const xml = await propfind(principalUrl, discoveryProps(kind), '1')
  return parseDiscoveredCollections(kind, xml, {
    origin: options.origin ?? originOf(principalUrl)
  })
}
