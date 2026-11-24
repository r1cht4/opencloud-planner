/**
 * Namespace-aware WebDAV multistatus parsing via DOMParser.
 *
 * Matching is by XML local name (prefix- and namespace-agnostic) because DAV
 * servers disagree on prefixes (Radicale, SabreDAV/Nextcloud, Baïkal) and on
 * namespaces for vendor props (calendar-color lives in the Apple ns on some
 * servers and the caldav ns on others).
 */

export interface DavResponse {
  href: string
  status: string
  el: Element
}

function parseXmlDocument(xml: string): Document | null {
  if (!xml.trim()) return null
  const parser = new DOMParser()
  let doc: Document
  try {
    doc = parser.parseFromString(xml, 'application/xml')
  } catch {
    return null
  }
  if (!doc.documentElement) return null
  if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) return null
  return doc
}

function firstDescendant(scope: Element | Document, localName: string): Element | null {
  for (const el of Array.from(scope.getElementsByTagName('*'))) {
    if (el.localName === localName) return el
  }
  return null
}

export function parseMultistatus(xml: string): DavResponse[] {
  const doc = parseXmlDocument(xml)
  if (!doc) return []
  const results: DavResponse[] = []
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName !== 'response') continue
    const href = davPropText(el, 'href')
    if (!href) continue
    results.push({ href, status: davPropText(el, 'status'), el })
  }
  return results
}

/** Trimmed text content of the first descendant with the given local name ('' if absent). */
export function davPropText(scope: Element, localName: string): string {
  return firstDescendant(scope, localName)?.textContent?.trim() ?? ''
}

/**
 * Trimmed, non-empty text contents of *all* descendants with the given local
 * name, in document order. Needed when the same property can be reported more
 * than once — e.g. `calendar-color` requested in both the CalDAV and the Apple
 * namespace: servers answer the unknown one with an empty element in a 404
 * propstat, which would otherwise shadow the real value.
 */
export function davPropTexts(scope: Element, localName: string): string[] {
  const values: string[] = []
  for (const el of Array.from(scope.getElementsByTagName('*'))) {
    if (el.localName !== localName) continue
    const text = el.textContent?.trim()
    if (text) values.push(text)
  }
  return values
}

/** Payload props (calendar-data/address-data): trimmed content, or null if absent/empty. */
export function davPropData(scope: Element, localName: string): string | null {
  const text = firstDescendant(scope, localName)?.textContent?.trim()
  return text || null
}

/**
 * True if the response's <resourcetype> contains a child with the given local
 * name (`collection`, `calendar`, `addressbook`, …).
 */
export function hasResourceType(scope: Element, localName: string): boolean {
  for (const el of Array.from(scope.getElementsByTagName('*'))) {
    if (el.localName === localName && el.parentElement?.localName === 'resourcetype') return true
  }
  return false
}
