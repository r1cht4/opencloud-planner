/**
 * useImport – the import pipeline shared by Settings → Data and the Files app
 * actions.
 *
 * Parsing stays lossless (`importExport.ts`): the file is split into per-UID
 * documents / verbatim vCard blocks, so nothing the UI model does not know about
 * is dropped. This composable only decides *where* the data goes (an existing
 * collection or one created on the fly), performs the verbatim PUTs and turns
 * the outcome into an honest imported / skipped / failed summary.
 */

import { ref, type Ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useDAVClient } from './useDAVClient'
import { createCollection, useCalendarService } from './useCalendarService'
import { useContactsService } from './useContactsService'
import {
  collectionSlug,
  parseIcsImport,
  splitVcardsForImport,
  type IcsImportItem,
  type VcardImportItem
} from './importExport'

export type ImportKind = 'calendar' | 'contacts'

/** Selective subset of a calendar / address book offered as import target. */
export interface ImportTarget {
  url: string
  displayName: string
}

/** One uploadable item: a complete VCALENDAR document or a verbatim vCard. */
export type ImportItem = IcsImportItem | VcardImportItem

/** A parsed file plus what the target dialog needs to prefill itself. */
export interface PreparedImport {
  kind: ImportKind
  items: ImportItem[]
  suggestedName: string
}

/** What the user picked in the import dialog. */
export interface ImportSelection {
  mode: 'existing' | 'new'
  targetUrl?: string
  newName?: string
}

export interface ImportCounts {
  kind: ImportKind
  created: number
  exists: number
  failed: number
  targetUrl: string | null
}

export interface ImportSummary {
  title: string
  status: 'success' | 'error'
}

/**
 * The gettext surface `summariseImport` needs: plain messages plus plural
 * forms for the counts (no numbers glued onto strings).
 */
export interface GettextApi {
  $gettext: (text: string) => string
  $ngettext: (
    singular: string,
    plural: string,
    n: number,
    params?: Record<string, string | number>
  ) => string
}

/** `holidays-2026.ics` → `holidays-2026` (used to prefill a collection name). */
export function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim()
}

/**
 * Build the toast text for an import result. Pure (no side effects) so the
 * counting rules can be unit-tested without pinia or services.
 *
 * The rules mirror the Data tab: an import where everything failed is an
 * error, an import where nothing was new is reported as "already exists", and
 * everything else reports the individual counts.
 */
export function summariseImport(
  kind: ImportKind,
  counts: Pick<ImportCounts, 'created' | 'exists' | 'failed'>,
  t: GettextApi
): ImportSummary {
  const { created, exists, failed } = counts
  const parts: string[] = []
  if (created > 0) {
    parts.push(
      kind === 'calendar'
        ? t.$ngettext('%{count} event imported', '%{count} events imported', created, {
            count: created
          })
        : t.$ngettext('%{count} contact imported', '%{count} contacts imported', created, {
            count: created
          })
    )
  }
  if (exists > 0) {
    parts.push(
      t.$ngettext(
        '%{count} item skipped (already exists)',
        '%{count} items skipped (already exist)',
        exists,
        { count: exists }
      )
    )
  }
  if (failed > 0) {
    parts.push(
      t.$ngettext('%{count} item failed', '%{count} items failed', failed, {
        count: failed
      })
    )
  }

  if (failed > 0 && created === 0) {
    return { title: parts.join(', ') || t.$gettext('Import failed'), status: 'error' }
  }
  if (created === 0 && exists > 0) {
    return { title: t.$gettext('Everything in this file already exists'), status: 'success' }
  }
  return { title: parts.join(', ') || t.$gettext('Nothing to import'), status: 'success' }
}

export function useImport(): {
  importBusy: Ref<boolean>
  prepareImport: (
    kind: ImportKind,
    text: string,
    fileName: string
  ) => Promise<PreparedImport | null>
  loadTargets: (kind: ImportKind) => Promise<ImportTarget[]>
  createImportTarget: (kind: ImportKind, name: string) => Promise<string | null>
  runImport: (prepared: PreparedImport, selection: ImportSelection) => Promise<ImportCounts | null>
  reportImport: (counts: ImportCounts, hint?: string) => void
  importInto: (
    prepared: PreparedImport,
    selection: ImportSelection,
    opts?: { hint?: string }
  ) => Promise<ImportCounts | null>
} {
  const { $gettext, $ngettext } = useGettext()
  const { showMessage, showErrorMessage } = useMessages()
  const { ensureReady, getState } = useDAVClient()
  const { fetchCalendars, importEventIcs } = useCalendarService()
  const { fetchAddressBooks, importContactVcard } = useContactsService()

  const importBusy = ref(false)

  /**
   * Split a file's text into uploadable items. Returns null (and reports it)
   * when the file carries nothing importable — an empty result must not look
   * like a successful import.
   */
  async function prepareImport(
    kind: ImportKind,
    text: string,
    fileName: string
  ): Promise<PreparedImport | null> {
    if (kind === 'calendar') {
      const { items, calendarName } = await parseIcsImport(text)
      if (items.length === 0) {
        showErrorMessage({ title: $gettext('No events found in file') })
        return null
      }
      return {
        kind,
        items,
        suggestedName: calendarName || fileBaseName(fileName) || $gettext('Calendar')
      }
    }

    const items = splitVcardsForImport(text)
    if (items.length === 0) {
      showErrorMessage({ title: $gettext('No contacts found in file') })
      return null
    }
    return { kind, items, suggestedName: fileBaseName(fileName) || $gettext('Contacts') }
  }

  /** Existing calendars / address books to import into. */
  async function loadTargets(kind: ImportKind): Promise<ImportTarget[]> {
    if (kind === 'calendar') {
      const cals = await fetchCalendars()
      return cals.map((c) => ({ url: c.url, displayName: c.displayName }))
    }
    const books = await fetchAddressBooks()
    return books.map((b) => ({ url: b.url, displayName: b.displayName }))
  }

  /** Create the new target collection; retries once with a unique suffix on name collision. */
  async function createImportTarget(kind: ImportKind, name: string): Promise<string | null> {
    const service = kind === 'calendar' ? 'calendar' : 'contacts'
    const type = kind === 'calendar' ? 'calendar' : 'addressbook'
    if (!(await ensureReady(service))) return null
    const principal = getState(service)?.principalUrl
    if (!principal) return null

    const trimmed = name.trim()
    const slug = collectionSlug(trimmed)
    for (const candidate of [slug, `${slug}-${Date.now().toString(36)}`]) {
      const url = `${principal}${candidate}/`
      try {
        await createCollection(url, type, trimmed)
        return url
      } catch (err) {
        console.warn('[planner] MKCOL failed:', candidate, err)
      }
    }
    return null
  }

  /**
   * Resolve the target (creating it when asked for) and PUT every item
   * verbatim. Returns the counts, or null when no target could be resolved
   * (an error toast has been shown in that case).
   */
  async function runImport(
    prepared: PreparedImport,
    selection: ImportSelection
  ): Promise<ImportCounts | null> {
    importBusy.value = true
    try {
      let targetUrl = selection.mode === 'existing' ? (selection.targetUrl ?? '') : ''
      if (selection.mode === 'new') {
        const created = await createImportTarget(prepared.kind, selection.newName ?? '')
        if (!created) {
          showErrorMessage({
            title:
              prepared.kind === 'calendar'
                ? $gettext('Could not create calendar')
                : $gettext('Could not create address book')
          })
          return null
        }
        targetUrl = created
      }
      if (!targetUrl) return null

      const counts: ImportCounts = {
        kind: prepared.kind,
        created: 0,
        exists: 0,
        failed: 0,
        targetUrl
      }

      for (const item of prepared.items) {
        const result =
          prepared.kind === 'calendar'
            ? await importEventIcs(targetUrl, item.uid, (item as IcsImportItem).ics)
            : await importContactVcard(targetUrl, item.uid, (item as VcardImportItem).vcard)
        if (result === 'created') counts.created++
        else if (result === 'exists') counts.exists++
        else counts.failed++
      }

      return counts
    } finally {
      importBusy.value = false
    }
  }

  /** Report the outcome as a toast; `hint` (e.g. "Open calendar") becomes the description. */
  function reportImport(counts: ImportCounts, hint?: string): void {
    const { title, status } = summariseImport(counts.kind, counts, { $gettext, $ngettext })
    if (status === 'error') showErrorMessage({ title, desc: hint })
    else showMessage({ title, desc: hint })
  }

  /** runImport + reportImport: what every caller wants. */
  async function importInto(
    prepared: PreparedImport,
    selection: ImportSelection,
    opts?: { hint?: string }
  ): Promise<ImportCounts | null> {
    const counts = await runImport(prepared, selection)
    if (counts) reportImport(counts, opts?.hint)
    return counts
  }

  return {
    importBusy,
    prepareImport,
    loadTargets,
    createImportTarget,
    runImport,
    reportImport,
    importInto
  }
}
