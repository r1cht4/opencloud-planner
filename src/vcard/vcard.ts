/**
 * vcard.ts – pure vCard 3.0/4.0 parsing and serialisation (moved out of
 * `useContactsService`, same behaviour).
 *
 * Everything here is free of DAV/state: it turns a raw vCard into a `Contact`
 * and back. `patchVcard` is the round-trip-safe writer used for updates — it
 * rebuilds only the properties the UI manages and preserves every other line
 * (IMPP, X-SOCIALPROFILE, Apple item groups and their X-ABLabel companions)
 * verbatim so foreign clients keep their data.
 */

import type { Contact } from '../types'

function unfoldVcard(raw: string): string {
  return raw.replace(/\r?\n[ \t]/g, '')
}

/** A single unfolded vCard content line, split into its structural parts. */
interface VcardLine {
  /** The line exactly as it appeared (already unfolded). */
  raw: string
  /** iCalendar/vCard group prefix (`item1.` in `item1.EMAIL:…`), '' when none. */
  group: string
  /** Upper-cased property name with the group prefix removed. */
  name: string
  /** Parameter tokens (`TYPE=work`, `VALUE=uri`, …) between name and ':'. */
  params: string[]
  /** Everything after the first ':' (still escaped). */
  value: string
}

/**
 * Split a content line into group/property/params/value.
 *
 * Apple Contacts (and therefore everything synced from it) writes related
 * properties as *item groups*: `item1.EMAIL;type=INTERNET:…`,
 * `item1.X-ABLabel:Work`. The group is presentation metadata; the property name
 * is what follows the dot. Ignoring that prefix made grouped emails, phones and
 * addresses invisible in the UI.
 */
function splitVcardLine(line: string): VcardLine | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return null
  const key = line.substring(0, colonIdx)
  const value = line.substring(colonIdx + 1)
  const parts = key.split(';')
  const namePart = parts[0]
  const dotIdx = namePart.indexOf('.')
  const group = dotIdx === -1 ? '' : namePart.substring(0, dotIdx)
  const name = (dotIdx === -1 ? namePart : namePart.substring(dotIdx + 1)).toUpperCase()
  if (!name) return null
  return { raw: line, group, name, params: parts.slice(1), value }
}

/** First TYPE parameter, unquoted and lower-cased ('other' when absent). */
function typeFromParams(params: string[]): string {
  for (const p of params) {
    const [k, v] = p.split('=')
    // vCard 4.0 allows TYPE="CELL,VOICE" / TYPE=home,voice — take the first,
    // unquoted. 'pref' alone is a ranking, not a type.
    if (k.toUpperCase() === 'TYPE' && v) {
      const first = v.replace(/"/g, '').split(',')[0].toLowerCase()
      if (first) return first
    }
  }
  return 'other'
}

/** ADR components (PO box; extended; street; city; region; postcode; country) → contact fields. */
function parseAddressValue(value: string): {
  street: string
  city: string
  region: string
  postalCode: string
  country: string
} {
  const p = splitEscaped(value, ';').map(unescapeVcardText)
  return {
    street: p[2] || '',
    city: p[3] || '',
    region: p[4] || '',
    postalCode: p[5] || '',
    country: p[6] || ''
  }
}

/**
 * Gate a contact photo for safe rendering as an `<img src>`. Only base64 raster
 * data URIs (jpeg/png/gif/webp) are allowed through; remote `http(s)` URLs and
 * `data:image/svg+xml` are rejected (returns '').
 *
 * Why: the upload path validates type + size, but a photo parsed from an
 * *imported/synced* vCard is untrusted — a remote `PHOTO;VALUE=URI:http://…`
 * would otherwise load on view as a tracking beacon (IP/timing leak), and an
 * SVG could carry markup. The raw value stays in the contact model so edits
 * still round-trip; only what we actually load into the DOM is restricted.
 */
export function safePhotoSrc(photo?: string | null): string {
  if (photo && /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,/i.test(photo)) {
    return photo
  }
  return ''
}

export function escapeVcardText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

export function unescapeVcardText(value: string): string {
  return value.replace(/\\([nN\\;,])/g, (_, char: string) => {
    if (char === 'n' || char === 'N') return '\n'
    return char
  })
}

function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let escaped = false

  for (const char of value) {
    if (escaped) {
      current += `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === separator) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }

  if (escaped) current += '\\'
  parts.push(current)
  return parts
}

/**
 * Parse a BDAY value (plus its params) into the model's `YYYY-MM-DD` /
 * year-less `--MM-DD` form.
 *
 * Tolerates what real clients write: the vCard 4.0 reduced date `--MMDD`
 * (native year-less form), the padded `19850415`, date-times with a zone and
 * Apple's placeholder-year trick `BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-15`,
 * which means "April 15, year unknown".
 */
function parseBdayValue(value: string, params: string[]): string {
  const dateOnly = value.replace(/T.*$/, '').trim()
  let parsed = dateOnly
    .replace(/^--(\d{2})(\d{2})$/, '--$1-$2')
    .replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  // Apple stores the omitted year as a placeholder (1604); the parameter —
  // not the digits — says the year is unknown.
  if (params.some((p) => /^X-APPLE-OMIT-YEAR=/i.test(p)) && !parsed.startsWith('--')) {
    const withoutYear = parsed.match(/^\d{4}-(\d{2}-\d{2})$/)
    if (withoutYear) parsed = `--${withoutYear[1]}`
  }
  return parsed
}

/** Serialise a model birthday in the syntax of the target vCard version. */
function formatBdayValue(birthday: string, version: '3.0' | '4.0'): string {
  const yearLess = birthday.match(/^--(\d{2})-(\d{2})$/)
  if (yearLess) return `--${yearLess[1]}${yearLess[2]}`
  if (version === '4.0') return birthday // ISO date is 4.0's native form
  return birthday.replace(/-/g, '') // v3.0 basic date
}

/** The file's vCard version; unknown/missing stays 3.0. */
function detectVcardVersion(unfoldedRaw: string): '3.0' | '4.0' {
  const match = unfoldedRaw.match(/^VERSION\s*:\s*(\S+)\s*$/im)
  return match?.[1]?.startsWith('4') ? '4.0' : '3.0'
}

export function parseVcard(raw: string): Contact {
  const lines = unfoldVcard(raw).split(/\r?\n/)
  const contact: Contact = {
    id: '',
    displayName: '',
    firstName: '',
    lastName: '',
    emails: [],
    phones: [],
    addresses: [],
    organization: '',
    title: '',
    notes: '',
    rawVcard: raw
  }

  for (const line of lines) {
    const parsed = splitVcardLine(line)
    if (!parsed) continue
    // `splitVcardLine` strips Apple's `item1.` group prefix, so grouped
    // managed properties (and their `X-ABLabel` companions below) are visible.
    const { name: key, params, value } = parsed
    const getType = (): string => typeFromParams(params)

    switch (key) {
      case 'UID':
        contact.id = value
        break
      case 'FN':
        contact.displayName = unescapeVcardText(value)
        break
      case 'N': {
        const [last, first] = splitEscaped(value, ';').map(unescapeVcardText)
        contact.lastName = last || ''
        contact.firstName = first || ''
        break
      }
      case 'EMAIL':
        contact.emails.push({ type: getType(), value: unescapeVcardText(value) })
        break
      // vCard 4.0 TEL is often a URI: TEL;VALUE=uri:tel:+49… — strip the scheme
      case 'TEL':
        contact.phones.push({
          type: getType(),
          value: unescapeVcardText(value).replace(/^tel:/i, '')
        })
        break
      case 'ADR':
        contact.addresses.push({ type: getType(), ...parseAddressValue(value) })
        break
      case 'ORG':
        contact.organization = unescapeVcardText(splitEscaped(value, ';')[0] || '')
        break
      case 'TITLE':
        contact.title = unescapeVcardText(value)
        break
      case 'NOTE':
        contact.notes = unescapeVcardText(value)
        break
      case 'PHOTO': {
        const encodingParam = params.find((p) => p.toUpperCase().startsWith('ENCODING='))
        const typeParam = params.find(
          (p) => p.toUpperCase().startsWith('TYPE=') || p.toUpperCase().match(/^(JPEG|PNG|GIF)$/)
        )
        if (
          encodingParam?.toUpperCase().includes('B') ||
          encodingParam?.toUpperCase().includes('BASE64')
        ) {
          const imgType = typeParam?.split('=').pop()?.toLowerCase() || 'jpeg'
          contact.photo = `data:image/${imgType};base64,${value}`
        } else if (value.startsWith('data:') || value.startsWith('http')) {
          contact.photo = value
        } else {
          contact.photo = `data:image/jpeg;base64,${value}`
        }
        break
      }
      case 'CATEGORIES':
        contact.categories = value.split(',').map((c) => unescapeVcardText(c.trim()))
        break
      case 'BDAY': {
        contact.birthday = parseBdayValue(value, params)
        break
      }
    }
  }

  if (!contact.displayName) {
    contact.displayName =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed'
  }
  return contact
}

/** Returns a UTC timestamp string in vCard REV format: YYYYMMDDTHHMMSSZ */
function revTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Identity of one EMAIL/TEL/ADR entry, used to recognise an unchanged entry in
 * the original vCard. Two entries match only when property, type AND value are
 * identical — so editing any of them rewrites the line instead.
 */
function managedEntryKey(name: 'EMAIL' | 'TEL' | 'ADR', type: string, value: string): string {
  return `${name}|${type.toLowerCase()}|${value}`
}

/** Key of an original content line, computed the same way as `managedEntryKey`. */
function rawLineEntryKey(line: VcardLine): string | null {
  const name = line.name
  if (name !== 'EMAIL' && name !== 'TEL' && name !== 'ADR') return null
  const type = typeFromParams(line.params)
  if (name === 'EMAIL') return managedEntryKey(name, type, unescapeVcardText(line.value))
  if (name === 'TEL')
    return managedEntryKey(name, type, unescapeVcardText(line.value).replace(/^tel:/i, ''))
  const addr = parseAddressValue(line.value)
  return managedEntryKey(
    name,
    type,
    [addr.street, addr.city, addr.region, addr.postalCode, addr.country].join('\u0000')
  )
}

/**
 * Generates the managed-property lines (everything between VERSION and END)
 * from the contact model. Shared by buildVcard and patchVcard so they stay
 * in sync without duplication.
 *
 * `reusable` maps an entry key to original lines with an Apple item group
 * (`item1.EMAIL:…`). When the model entry is unchanged, the original line is
 * emitted verbatim: the group prefix keeps linking it to its `item1.X-ABLabel`,
 * so "Work"/"Mobile" labels survive an edit that did not touch that value.
 */
interface ManagedLineOptions {
  /** Original lines that can be emitted verbatim (unchanged managed entries). */
  reusable: Map<string, string[]>
  /** The file's version — managed lines are written in its syntax. */
  version: '3.0' | '4.0'
  /**
   * The original BDAY line, emitted byte-for-byte while the model's birthday is
   * unchanged: it carries params like Apple's X-APPLE-OMIT-YEAR that no
   * rewrite could reproduce.
   */
  originalBdayLine?: string | null
}

function buildManagedLines(contact: Contact, options: ManagedLineOptions): string[] {
  const { reusable, version, originalBdayLine } = options
  const lines: string[] = []
  const takeReusable = (key: string): string | null => {
    const queue = reusable.get(key)
    if (!queue?.length) return null
    const raw = queue.shift()!
    if (!queue.length) reusable.delete(key)
    return raw
  }

  lines.push(`UID:${contact.id}`)
  lines.push(`FN:${escapeVcardText(contact.displayName)}`)
  lines.push(`N:${escapeVcardText(contact.lastName)};${escapeVcardText(contact.firstName)};;;`)
  for (const email of contact.emails) {
    lines.push(
      takeReusable(managedEntryKey('EMAIL', email.type, email.value)) ??
        `EMAIL;TYPE=${email.type}:${escapeVcardText(email.value)}`
    )
  }
  for (const phone of contact.phones) {
    lines.push(
      takeReusable(managedEntryKey('TEL', phone.type, phone.value)) ??
        `TEL;TYPE=${phone.type}:${escapeVcardText(phone.value)}`
    )
  }
  for (const addr of contact.addresses) {
    const key = managedEntryKey(
      'ADR',
      addr.type,
      [addr.street, addr.city, addr.region, addr.postalCode, addr.country].join('\u0000')
    )
    lines.push(
      takeReusable(key) ??
        `ADR;TYPE=${addr.type}:;;${escapeVcardText(addr.street)};${escapeVcardText(addr.city)};${escapeVcardText(addr.region)};${escapeVcardText(addr.postalCode)};${escapeVcardText(addr.country)}`
    )
  }
  if (contact.organization) lines.push(`ORG:${escapeVcardText(contact.organization)}`)
  if (contact.title) lines.push(`TITLE:${escapeVcardText(contact.title)}`)
  if (contact.categories?.length)
    lines.push(`CATEGORIES:${contact.categories.map(escapeVcardText).join(',')}`)
  if (contact.birthday) {
    lines.push(originalBdayLine ?? `BDAY:${formatBdayValue(contact.birthday, version)}`)
  }
  if (contact.photo) {
    if (contact.photo.startsWith('data:image/')) {
      const match = contact.photo.match(/^data:image\/(\w+);base64,(.+)$/)
      if (match) {
        // v3.0 carries the base64 inline with ENCODING=b; vCard 4.0 uses the
        // data URI as the value itself (its default value type is URI).
        lines.push(
          version === '4.0'
            ? `PHOTO:data:image/${match[1].toLowerCase()};base64,${match[2]}`
            : `PHOTO;ENCODING=b;TYPE=${match[1].toUpperCase()}:${match[2]}`
        )
      }
    } else if (contact.photo.startsWith('http')) {
      lines.push(version === '4.0' ? `PHOTO:${contact.photo}` : `PHOTO;VALUE=URI:${contact.photo}`)
    }
  }
  if (contact.notes) lines.push(`NOTE:${escapeVcardText(contact.notes)}`)
  return lines
}

export function buildVcard(contact: Contact): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(...buildManagedLines(contact, { reusable: new Map(), version: '3.0' }))
  lines.push(`REV:${revTimestamp()}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/**
 * The set of property names that buildVcard/patchVcard fully control.
 * Any property NOT in this set is considered "unmanaged" and will be
 * preserved verbatim from the original rawVcard.
 */
const MANAGED_PROPS = new Set([
  'BEGIN',
  'END',
  'VERSION',
  'UID',
  'FN',
  'N',
  'EMAIL',
  'TEL',
  'ADR',
  'ORG',
  'TITLE',
  'CATEGORIES',
  'BDAY',
  'PHOTO',
  'NOTE',
  'REV'
])

/**
 * Patches an existing raw vCard string with updated contact data, preserving
 * any properties not managed by the UI (e.g. IMPP, X-SOCIALPROFILE, X-* custom
 * properties written by other clients). Use this for updates; use buildVcard
 * for new contacts.
 *
 * Assembly order: BEGIN, VERSION, managed properties, REV, preserved unmanaged
 * lines, END.
 */
export function patchVcard(rawVcard: string, contact: Contact): string {
  // Walk the original vCard lines and sort them into buckets:
  //  - unmanaged properties → preserved verbatim (IMPP, X-SOCIALPROFILE, X-*,
  //    and Apple's group companions such as item1.X-ABLabel / item1.X-ABADR);
  //  - UNCHANGED managed EMAIL/TEL/ADR properties (grouped or not) → reused
  //    verbatim so PREF, multi-TYPE, VALUE=uri and the group label linkage
  //    survive an edit that did not touch them;
  //  - everything else managed → rebuilt from the model, in the file's own
  //    vCard version.
  //
  // The managed check strips the Apple group prefix (`item1.EMAIL` → EMAIL), so
  // a grouped managed property is never emitted twice — once rebuilt from the
  // model and once preserved from the original.
  const preservedLines: string[] = []
  const reusable = new Map<string, string[]>()
  const unfolded = unfoldVcard(rawVcard)
  const version = detectVcardVersion(unfolded)
  let originalBdayLine: string | null = null
  for (const rawLine of unfolded.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const line = splitVcardLine(rawLine)
    if (!line) continue
    if (line.name === 'BEGIN' || line.name === 'END') continue
    if (!MANAGED_PROPS.has(line.name)) {
      preservedLines.push(rawLine)
      continue
    }
    if (line.name === 'BDAY') {
      // While the model's birthday is unchanged, the original line
      // (params like X-APPLE-OMIT-YEAR included) is emitted byte-for-byte.
      if (!originalBdayLine && parseBdayValue(line.value, line.params) === contact.birthday) {
        originalBdayLine = rawLine
      } else if (!originalBdayLine && line.value.replace(/T.*$/, '') === contact.birthday) {
        originalBdayLine = rawLine
      }
      continue
    }
    const key = rawLineEntryKey(line)
    if (!key) continue
    const queue = reusable.get(key) ?? []
    queue.push(rawLine)
    reusable.set(key, queue)
  }

  const lines: string[] = ['BEGIN:VCARD', `VERSION:${version}`]
  lines.push(...buildManagedLines(contact, { reusable, version, originalBdayLine }))
  lines.push(`REV:${revTimestamp()}`)
  lines.push(...preservedLines)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}
