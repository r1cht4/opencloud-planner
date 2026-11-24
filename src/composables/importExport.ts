/**
 * importExport – lossless .ics / .vcf import splitting and export merging.
 *
 * Import must NOT round-trip through the UI event/contact model: the model only
 * carries the fields the forms edit, so a parse-and-rebuild import would silently
 * drop ATTENDEE, ORGANIZER, extra VALARMs, X-props, recurrence overrides, EXDATE,
 * IMPP, item-grouped vCard props, etc. Instead the original components are copied
 * wholesale into per-UID documents (calendar) or raw blocks (contacts) and PUT
 * verbatim; only the UID is rewritten when missing or unsafe for a URL path.
 */

import { getICAL, type IcalComponent } from '../ics/ical'

/**
 * CalDAV component types an import groups by UID: a backup of a
 * calendar contains VEVENTs *and* VTODOs (and maybe VJOURNALs), and components
 * sharing a UID live in one server resource.
 */
const IMPORTED_COMPONENTS = ['vevent', 'vtodo', 'vjournal'] as const

export interface IcsImportItem {
  /**
   * The UID exactly as it appears in the data: a UID is never
   * rewritten — unsafe ones move into the *resource name* at PUT time, see
   * `davResourceName` in `useDAVClient`).
   */
  uid: string
  /** Complete VCALENDAR document: referenced VTIMEZONEs + master + overrides. */
  ics: string
  /** Master event summary, for display in the import dialog. */
  summary: string
}

export interface IcsImportResult {
  items: IcsImportItem[]
  /** X-WR-CALNAME of the source, to prefill a new-calendar name. */
  calendarName: string | null
}

/**
 * Split an .ics file (possibly several concatenated VCALENDARs) into one
 * uploadable VCALENDAR document per UID. VEVENTs sharing a UID (recurring
 * master + RECURRENCE-ID overrides) stay together in one document — CalDAV
 * stores them as a single resource. METHOD is dropped (RFC 4791 §4.1 forbids
 * it in calendar object resources); only VTIMEZONEs referenced by the group's
 * TZID parameters are carried over.
 */
export async function parseIcsImport(text: string): Promise<IcsImportResult> {
  const ical = await getICAL()
  const items: IcsImportItem[] = []
  let calendarName: string | null = null

  const docs = text.split(/(?=BEGIN:VCALENDAR)/i).filter((chunk) => /BEGIN:VCALENDAR/i.test(chunk))

  const prevFoldLength: number = ical.foldLength
  ical.foldLength = 74
  try {
    for (const doc of docs) {
      let comp: IcalComponent
      try {
        comp = new ical.Component(ical.parse(doc))
      } catch (err) {
        console.warn('[planner] Skipping unparsable VCALENDAR block:', err)
        continue
      }

      if (!calendarName) {
        const name = comp.getFirstPropertyValue('x-wr-calname')
        if (name) calendarName = String(name)
      }

      const prodid = comp.getFirstPropertyValue('prodid') || '-//OpenCloud//Planner//EN'
      const vtimezones: IcalComponent[] = comp.getAllSubcomponents('vtimezone')

      // Group every managed component by UID; assign a fresh UID only
      // to components that lack one. Unsafe-but-present UIDs are KEPT — the
      // identity with the source survives, only the resource name is derived
      // at PUT time.
      const groups = new Map<string, IcalComponent[]>()
      for (const name of IMPORTED_COMPONENTS) {
        for (const component of comp.getAllSubcomponents(name) ?? []) {
          let uid = component.getFirstPropertyValue('uid')
          if (!uid) {
            uid = crypto.randomUUID()
            component.updatePropertyWithValue('uid', uid)
          }
          const key = String(uid)
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(component)
        }
      }

      for (const [uid, components] of groups) {
        // Master first so parsers meeting overrides have context.
        components.sort(
          (a, b) => Number(a.hasProperty('recurrence-id')) - Number(b.hasProperty('recurrence-id'))
        )

        const referencedTzids = new Set<string>()
        for (const component of components) {
          for (const prop of component.getAllProperties()) {
            const tzid = prop.getParameter('tzid')
            if (tzid) referencedTzids.add(String(tzid))
          }
        }

        const out = new ical.Component('vcalendar')
        out.updatePropertyWithValue('version', '2.0')
        out.updatePropertyWithValue('prodid', String(prodid))
        for (const vtz of vtimezones) {
          if (referencedTzids.has(String(vtz.getFirstPropertyValue('tzid')))) {
            out.addSubcomponent(new ical.Component(vtz.toJSON()))
          }
        }
        for (const component of components) {
          out.addSubcomponent(new ical.Component(component.toJSON()))
        }

        const master = components.find((c) => !c.hasProperty('recurrence-id')) || components[0]
        items.push({
          uid,
          ics: out.toString(),
          summary: String(master?.getFirstPropertyValue('summary') || '(untitled)')
        })
      }
    }
  } finally {
    ical.foldLength = prevFoldLength
  }

  return { items, calendarName }
}

/**
 * Merge per-event VCALENDAR documents into ONE VCALENDAR for export.
 * An .ics file is a single VCALENDAR per RFC 5545 — naively concatenating the
 * stored documents yields a file many importers reject or truncate to the
 * first block. VTIMEZONEs are deduplicated by TZID.
 */
export async function mergeIcsForExport(
  rawIcsList: string[],
  calendarName?: string
): Promise<string> {
  const ical = await getICAL()

  const prevFoldLength: number = ical.foldLength
  ical.foldLength = 74
  try {
    const out = new ical.Component('vcalendar')
    out.updatePropertyWithValue('version', '2.0')
    out.updatePropertyWithValue('prodid', '-//OpenCloud//Planner//EN')
    if (calendarName) out.updatePropertyWithValue('x-wr-calname', calendarName)

    const seenTzids = new Set<string>()
    for (const raw of rawIcsList) {
      let comp: IcalComponent
      try {
        comp = new ical.Component(ical.parse(raw))
      } catch (err) {
        console.warn('[planner] Skipping unparsable event on export:', err)
        continue
      }
      for (const vtz of comp.getAllSubcomponents('vtimezone')) {
        const tzid = String(vtz.getFirstPropertyValue('tzid') || '')
        if (!tzid || seenTzids.has(tzid)) continue
        seenTzids.add(tzid)
        out.addSubcomponent(new ical.Component(vtz.toJSON()))
      }
      for (const name of IMPORTED_COMPONENTS) {
        // Tasks (and journals) ship with the events of the same calendar —
        // merging only VEVENTs silently dropped every task on export.
        for (const component of comp.getAllSubcomponents(name) ?? []) {
          out.addSubcomponent(new ical.Component(component.toJSON()))
        }
      }
    }

    return out.toString()
  } finally {
    ical.foldLength = prevFoldLength
  }
}

export interface VcardImportItem {
  /**
   * The UID as stored in the card: kept verbatim, never replaced — the
   * resource name is derived at PUT time (`davResourceName`).
   */
  uid: string
  /** The vCard block, verbatim except for UID injection/replacement. */
  vcard: string
  /** FN (or assembled N) for display in the import dialog. */
  displayName: string
}

/**
 * Split a .vcf file into individual vCard blocks kept verbatim (multiple cards
 * per file are valid vCard, unlike ICS). Cards without any name are skipped.
 * Only a *missing* UID is generated and injected (the only rewrite performed);
 * an unsafe-but-present UID is kept verbatim — `importContactVcard`
 * derives the URL-safe resource name at PUT time.
 */
export function splitVcardsForImport(text: string): VcardImportItem[] {
  const items: VcardImportItem[] = []
  const blocks = text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || []

  for (const block of blocks) {
    // Unfold a copy for inspection; the stored block stays folded.
    const unfolded = block.replace(/\r?\n[ \t]/g, '')

    const fnMatch = unfolded.match(/^(?:item\d+\.)?FN(?:;[^:]*)?:(.+)$/im)
    const nMatch = unfolded.match(/^(?:item\d+\.)?N(?:;[^:]*)?:(.+)$/im)
    const fn = fnMatch?.[1]?.trim() || ''
    const nParts = (nMatch?.[1] || '').split(';').map((p) => p.trim())
    const displayName = fn || [nParts[1], nParts[0]].filter(Boolean).join(' ')
    if (!displayName) continue

    const uidMatch = unfolded.match(/^UID(?:;[^:]*)?:(.*)$/im)
    const rawUid = uidMatch?.[1]?.trim() || ''

    // A present UID is kept — however it looks (identity beats URL safety;
    // the resource name is derived at PUT time).
    if (rawUid) {
      items.push({ uid: rawUid, vcard: block, displayName })
      continue
    }

    // Only a missing UID is generated and injected.
    const uid = crypto.randomUUID()
    const eol = block.includes('\r\n') ? '\r\n' : '\n'
    const vcard = unfolded.replace(/^BEGIN:VCARD/i, `BEGIN:VCARD${eol}UID:${uid}`)
    items.push({ uid, vcard, displayName })
  }

  return items
}

/** Derive a URL-safe collection path segment from a display name. */
export function collectionSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'collection'
}
