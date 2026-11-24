/**
 * useCollections – collection-level CalDAV/CardDAV management (rename, color,
 * delete, create) as used by Settings → Data.
 *
 * Event/contact CRUD lives in the calendar/contacts services; this file owns the
 * DAV property plumbing (PROPPATCH props, DELETE, MKCOL via createCollection) so
 * the views stay free of XML.
 */

import { davFetch, useDAVClient, type DAVService } from './useDAVClient'
import { createCollection, escapeXml } from './useCalendarService'
import { davPropText, parseMultistatus } from './davXml'
import { normalizeColor } from './colorUtils'
import { APPLE_CALENDAR_NS, CALDAV_NS } from './davCollections'

/**
 * Normalise a user/server color (`#abc`, `#AABBCC`, `#AABBCCDD`) to `#RRGGBB`
 * (upper case), or null when the value is not a hex color.
 *
 * Thin wrapper: the parsing lives in `normalizeColor` (`colorUtils`), this keeps
 * the historical upper-case / null contract of the collection manager.
 */
export function normalizeHexColor(value: string): string | null {
  return normalizeColor(value)?.toUpperCase() ?? null
}

/** PROPPATCH body that sets `<d:displayname>` (XML-escaped). */
export function buildRenameBody(displayName: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(displayName)}</d:displayname>
    </d:prop>
  </d:set>
</d:propertyupdate>`
}

/**
 * PROPPATCH body that sets `calendar-color` in both namespaces in one request:
 * Apple ns carries `#RRGGBBFF` (opaque, what Apple/Thunderbird/DAVx5 write),
 * the CalDAV ns carries plain `#RRGGBB`.
 */
export function buildColorBody(color: string): string {
  const hex = normalizeHexColor(color)
  if (!hex) throw new Error(`Invalid calendar color: ${color}`)
  return `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:a="${APPLE_CALENDAR_NS}" xmlns:c="${CALDAV_NS}">
  <d:set>
    <d:prop>
      <a:calendar-color>${hex}FF</a:calendar-color>
      <c:calendar-color>${hex}</c:calendar-color>
    </d:prop>
  </d:set>
</d:propertyupdate>`
}

export interface ProppatchResult {
  ok: boolean
  /** Local names of the properties the server refused. */
  failed: string[]
}

function isSuccessStatus(status: string): boolean {
  if (!status) return false
  return /\s2\d\d(?:\s|$)/.test(status)
}

/**
 * Check a PROPPATCH multistatus: 207 with every propstat at 2xx is success; a
 * single non-2xx propstat fails the whole request (partially applied props are
 * not worth reporting as success). Responses without any propstat (e.g. SabreDAV
 * answering with a bare status) are judged by their response-level status.
 */
export function parseProppatchResponse(xml: string): ProppatchResult {
  const failed: string[] = []
  let sawPropstat = false

  for (const resp of parseMultistatus(xml)) {
    for (const el of Array.from(resp.el.getElementsByTagName('*'))) {
      if (el.localName !== 'propstat') continue
      sawPropstat = true
      if (isSuccessStatus(davPropText(el, 'status'))) continue
      for (const prop of Array.from(el.getElementsByTagName('*'))) {
        if (prop.parentElement?.localName === 'prop') failed.push(prop.localName)
      }
      if (failed.length === 0) failed.push('unknown-property')
    }
    if (!sawPropstat && resp.status && !isSuccessStatus(resp.status)) {
      failed.push(resp.href || 'unknown-collection')
    }
  }

  if (!sawPropstat && failed.length === 0) {
    // Empty or unparsable body: cannot confirm the properties were stored.
    return { ok: false, failed: ['unconfirmed'] }
  }
  return { ok: failed.length === 0, failed }
}

async function proppatch(url: string, body: string, action: string): Promise<void> {
  const resp = await davFetch(url, {
    method: 'PROPPATCH',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body
  })

  if (resp.status !== 207 && resp.status !== 200) {
    throw new Error(`PROPPATCH ${action} failed: ${resp.status} (${url})`)
  }

  const { ok, failed } = parseProppatchResponse(await resp.text())
  if (!ok) {
    throw new Error(`PROPPATCH ${action} rejected by server: ${failed.join(', ')} (${url})`)
  }
}

/** Set the collection display name (works for calendars and address books). */
export async function renameCollection(url: string, displayName: string): Promise<void> {
  const name = displayName.trim()
  if (!name) throw new Error('Display name must not be empty')
  await proppatch(url, buildRenameBody(name), 'displayname')
}

/** Set the calendar color in both the Apple and the CalDAV namespace. */
export async function setCollectionColor(url: string, color: string): Promise<void> {
  await proppatch(url, buildColorBody(color), 'calendar-color')
}

/**
 * Delete a whole collection. No If-Match: collections carry no usable ETag in
 * Radicale. A 404 counts as success — the collection is gone either way.
 */
export async function deleteCollection(url: string): Promise<void> {
  const resp = await davFetch(url, { method: 'DELETE' })
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`DELETE ${url} failed: ${resp.status}`)
  }
}

/** Fresh collection URL: a random path segment under the discovered principal. */
async function newCollectionUrl(service: DAVService): Promise<string> {
  const { ensureReady, getState } = useDAVClient()
  if (!(await ensureReady(service))) throw new Error(`${service} DAV service not available`)
  const principal = getState(service)?.principalUrl
  if (!principal) throw new Error('DAV principal not discovered')
  const base = principal.endsWith('/') ? principal : `${principal}/`
  return `${base}${crypto.randomUUID()}/`
}

/** Create a calendar (MKCOL) and set its color. Returns the new collection URL. */
export async function createCalendar(name: string, color?: string): Promise<string> {
  const displayName = name.trim()
  if (!displayName) throw new Error('Display name must not be empty')
  const url = await newCollectionUrl('calendar')
  await createCollection(url, 'calendar', displayName)
  if (color) await setCollectionColor(url, color)
  return url
}

/** Create an address book (MKCOL). Returns the new collection URL. */
export async function createAddressBook(name: string): Promise<string> {
  const displayName = name.trim()
  if (!displayName) throw new Error('Display name must not be empty')
  const url = await newCollectionUrl('contacts')
  await createCollection(url, 'addressbook', displayName)
  return url
}
