/**
 * backup.ts – full backup (one `.zip`) and restore planning for Settings → Data.
 *
 * Backup: every calendar becomes one `.ics` (merged through the existing
 * lossless export path, `mergeIcsForExport`), every address book one `.vcf`
 * (the stored vCards concatenated verbatim), plus a `manifest.json` carrying the
 * collection names, kinds and colours so a restore can recreate them.
 *
 * Restore: `planRestore` is pure — it reads the archive entries, parses the
 * manifest and decides per file whether an existing collection with the same
 * display name can take it or a new one has to be created. The actual import
 * runs through the shared `useImport` path (verbatim PUTs, `If-None-Match`), so
 * nothing the app does not model is dropped.
 */

import { collectionSlug, mergeIcsForExport } from '../composables/importExport'
import { useCalendarService } from '../composables/useCalendarService'
import { useContactsService } from '../composables/useContactsService'
import { useTasksService } from '../composables/useTasksService'
import { createZip, type ZipEntry } from './zip'

/** Marker in `manifest.json` – a restore refuses archives from other apps. */
const BACKUP_APP = 'planner'

/**
 * Backup *format* version (bumped when the manifest shape changes, so a future
 * restore can migrate). The release script injects the app version as
 * `__APP_VERSION__` and can add it as `manifest.appVersion` — until then the
 * format version is the only version a restore needs.
 */
export const BACKUP_FORMAT_VERSION = 1

export const BACKUP_MANIFEST_NAME = 'manifest.json'

export type BackupKind = 'calendar' | 'addressbook'

/** One collection inside the manifest: which file, what it is, how it looked. */
interface BackupCollection {
  file: string
  kind: BackupKind
  displayName: string
  color?: string
}

export interface BackupManifest {
  app: string
  version: number
  /** ISO-8601 timestamp of the backup. */
  created: string
  collections: BackupCollection[]
}

/**
 * A collection that could NOT be backed up. The backup card tells
 * the user exactly which parts are missing instead of a silent "created".
 */
interface BackupFailure {
  kind: BackupKind
  displayName: string
}

export interface BuildBackupResult {
  blob: Blob
  /** Collections whose data could not be fetched — not part of the zip. */
  failed: BackupFailure[]
}

/** Existing collection a restore can import into. */
export interface RestoreTarget {
  url: string
  displayName: string
}

export interface ExistingTargets {
  calendars?: RestoreTarget[]
  addressBooks?: RestoreTarget[]
}

/** Per-file decision the preview dialog shows (and the user may change). */
export interface RestorePlanItem {
  /** Entry name inside the zip (`personal.ics`). */
  fileName: string
  kind: BackupKind
  /** Name from the manifest, or derived from the file name. */
  displayName: string
  color?: string
  /** URL of an existing collection with the same name, or null → create new. */
  existingUrl: string | null
  /** Prefilled name for "create a new collection". */
  suggestedName: string
}

export interface RestorePlan {
  manifest: BackupManifest | null
  items: RestorePlanItem[]
  /** Archive entries this plan does not use (`manifest.json`, unknown files). */
  skipped: string[]
}

const EXTENSION_KIND: Record<string, BackupKind> = {
  '.ics': 'calendar',
  '.vcf': 'addressbook'
}

/** `calendar.ics → calendar`, `my-calendar.ics → my-calendar`. */
function baseName(fileName: string): string {
  const name = fileName.split('/').pop() || fileName
  return name.replace(/\.[^.]+$/, '')
}

/** Keep generated file names unique (`calendar.ics`, `calendar-2.ics`, …). */
function uniqueFileName(displayName: string, extension: string, used: Set<string>): string {
  const slug = collectionSlug(displayName)
  let candidate = `${slug}${extension}`
  let index = 2
  while (used.has(candidate)) {
    candidate = `${slug}-${index}${extension}`
    index++
  }
  used.add(candidate)
  return candidate
}

/**
 * Read every calendar (events AND tasks) and address book and pack
 * them into one zip.
 *
 * Failures on a single collection are REPORTED: the services
 * swallow fetch errors and return `[]`, so their `error` refs are checked
 * after every call; a collection that could not be read is left out of the zip
 * and listed in `failed`, so the card can say "incomplete backup: Work" instead
 * of storing an empty file that looks like "Work has no events" on restore.
 * Empty collections are included: the manifest documents the structure, not
 * only the data.
 */
export async function buildBackup(): Promise<BuildBackupResult> {
  const calService = useCalendarService()
  const { fetchAddressBooks, fetchContacts, error: contactsError } = useContactsService()
  const { fetchTasks, error: tasksError } = useTasksService()
  const { fetchCalendars, fetchEvents, error: calendarError } = calService

  const entries: ZipEntry[] = []
  const collections: BackupCollection[] = []
  const failed: BackupFailure[] = []
  const used = new Set<string>([BACKUP_MANIFEST_NAME])
  // One encoder per call: TextEncoder has no state, but keeping it local avoids
  // sharing mutable encoder instances across concurrent backups.
  const encoder = new TextEncoder()

  const calendars = await fetchCalendars()

  // Tasks: every task-capable calendar is read once; the VTODOs are
  // merged into the same .ics as their calendar's events, so a restore puts
  // both back. A partial task failure flags the affected calendars.
  const tasks = await fetchTasks()
  /** calendarUrl -> raw VTODO documents for the export merge. */
  const todoIcsByUrl = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.rawIcs) continue
    const list = todoIcsByUrl.get(task.calendarId) ?? []
    list.push(task.rawIcs)
    todoIcsByUrl.set(task.calendarId, list)
  }
  const taskUrlsMissing = (): string[] => (tasksError.value ? [...todoIcsByUrl.keys()] : [])

  for (const calendar of calendars) {
    try {
      const events = await fetchEvents(calendar.url)
      const raws = [
        ...events.map((event) => event.rawIcs).filter((ics): ics is string => !!ics),
        ...(todoIcsByUrl.get(calendar.url) ?? [])
      ]
      if (calendarError.value) throw new Error(calendarError.value)
      const ics = await mergeIcsForExport(raws, calendar.displayName)
      const file = uniqueFileName(calendar.displayName, '.ics', used)
      entries.push({ name: file, data: encoder.encode(ics) })
      collections.push({
        file,
        kind: 'calendar',
        displayName: calendar.displayName,
        color: calendar.color
      })
    } catch (err) {
      console.warn('[planner] backup: skipping calendar', calendar.url, err)
      failed.push({ kind: 'calendar', displayName: calendar.displayName })
    }
  }
  // Tasks that could not be fetched mark their calendars incomplete:
  // the events alone would look like a full backup while the tasks are missing.
  for (const url of taskUrlsMissing()) {
    const calendar = calendars.find((c) => c.url === url)
    if (!calendar) continue
    if (!failed.some((f) => f.kind === 'calendar' && f.displayName === calendar.displayName)) {
      failed.push({ kind: 'calendar', displayName: calendar.displayName })
    }
  }

  for (const book of await fetchAddressBooks()) {
    try {
      const contacts = await fetchContacts(book.url)
      if (contactsError.value) throw new Error(contactsError.value)
      const vcards = contacts
        .map((contact) => contact.rawVcard)
        .filter((vcard): vcard is string => !!vcard)
        .join('\r\n')
      const file = uniqueFileName(book.displayName, '.vcf', used)
      entries.push({ name: file, data: encoder.encode(vcards) })
      collections.push({ file, kind: 'addressbook', displayName: book.displayName })
    } catch (err) {
      console.warn('[planner] backup: skipping address book', book.url, err)
      failed.push({ kind: 'addressbook', displayName: book.displayName })
    }
  }

  const manifest: BackupManifest = {
    app: BACKUP_APP,
    version: BACKUP_FORMAT_VERSION,
    created: new Date().toISOString(),
    collections
  }
  entries.unshift({
    name: BACKUP_MANIFEST_NAME,
    data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`)
  })

  return { blob: await createZip(entries), failed }
}

/** Parse `manifest.json`; anything malformed yields null (restore falls back to file names). */
function parseManifest(text: string): BackupManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Partial<BackupManifest>
  if (doc.app !== BACKUP_APP) return null
  const collections = Array.isArray(doc.collections) ? doc.collections : []
  return {
    app: BACKUP_APP,
    version: typeof doc.version === 'number' ? doc.version : 0,
    created: typeof doc.created === 'string' ? doc.created : '',
    collections: collections
      .filter((entry): entry is BackupCollection => {
        return (
          !!entry &&
          typeof entry.file === 'string' &&
          (entry.kind === 'calendar' || entry.kind === 'addressbook') &&
          typeof entry.displayName === 'string'
        )
      })
      .map((entry) => ({
        file: entry.file,
        kind: entry.kind,
        displayName: entry.displayName,
        color: typeof entry.color === 'string' ? entry.color : undefined
      }))
  }
}

function findExisting(
  kind: BackupKind,
  displayName: string,
  existing: ExistingTargets
): RestoreTarget | null {
  const pool = kind === 'calendar' ? (existing.calendars ?? []) : (existing.addressBooks ?? [])
  const wanted = displayName.trim().toLowerCase()
  return pool.find((target) => target.displayName.trim().toLowerCase() === wanted) ?? null
}

/**
 * Turn archive entries into a restore plan.
 *
 * Every `.ics`/`.vcf` entry becomes one item; the manifest supplies the display
 * name and colour, and an existing collection with the *same display name* is
 * preselected as the target (the user may still opt for a new collection). Files
 * the plan does not use are reported in `skipped` so the preview can say so.
 */
export function planRestore(entries: ZipEntry[], existing: ExistingTargets = {}): RestorePlan {
  const decoder = new TextDecoder('utf-8')
  const manifestEntry = entries.find(
    (entry) => entry.name.split('/').pop()?.toLowerCase() === BACKUP_MANIFEST_NAME
  )
  const manifest = manifestEntry ? parseManifest(decoder.decode(manifestEntry.data)) : null

  const items: RestorePlanItem[] = []
  const skipped: string[] = []

  for (const entry of entries) {
    const name = entry.name.split('/').pop() || entry.name
    // The manifest is *used* (names/colors) — not something to report as skipped.
    if (name.toLowerCase() === BACKUP_MANIFEST_NAME) continue
    // macOS "Compress" adds AppleDouble metadata (`__MACOSX/._name.ics`); those
    // entries carry binary junk under an .ics name and must never be restored.
    if (entry.name.startsWith('__MACOSX/') || name.startsWith('._')) {
      skipped.push(entry.name)
      continue
    }
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
    const kind = EXTENSION_KIND[extension]
    if (!kind) {
      skipped.push(entry.name)
      continue
    }

    const fromManifest = manifest?.collections.find((collection) => collection.file === name)
    const displayName = fromManifest?.displayName?.trim() || baseName(name)
    const target = findExisting(kind, displayName, existing)

    items.push({
      fileName: entry.name,
      kind,
      displayName,
      color: fromManifest?.color,
      existingUrl: target?.url ?? null,
      suggestedName: displayName
    })
  }

  return { manifest, items, skipped }
}

/** One implementation (revokes the object URL after the download started). */
export { downloadBlob } from '../composables/download'
