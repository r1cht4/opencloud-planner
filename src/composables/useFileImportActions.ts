/**
 * useFileImportActions – "Import into calendar" / "Import into contacts" for the
 * Files app.
 *
 * The actions are registered as `action` extensions on the
 * `global.files.context-actions` extension point, so they show up in the file
 * context menu next to the built-in file actions. A click reads the selected
 * resource's content through the platform WebDAV client, parses it losslessly
 * (`useImport`) and hands it to the shared import dialog, which the platform
 * modal shell hosts — the user stays in the Files app.
 */

import { computed, defineAsyncComponent, type ComputedRef } from 'vue'
import { useGettext } from 'vue3-gettext'
import {
  useClientService,
  useMessages,
  useModals,
  type FileAction,
  type FileActionOptions
} from '@opencloud-eu/web-pkg'
import { useImport, type ImportKind } from './useImport'
import { getAdminConfig } from '../config/appConfig'
import { effectiveEnabledApps } from '../navigation'
import type { AppKey } from '../settings/schema'
import { useSettings } from '../settings/settingsStore'
import { isAuthenticated } from './useDAVClient'
import {
  isOversizedImportFile,
  isOversizedImportText,
  oversizedImportMessage
} from './importFileLimits'

/** Extension point the Files app reads its context-menu actions from. */
export const FILE_ACTION_EXTENSION_POINT = 'global.files.context-actions'

const ImportDialog = defineAsyncComponent(() => import('../components/ImportDialog.vue'))

/** Minimal shape we need from a Files-app resource (web-client `Resource`). */
export interface ImportableResource {
  name?: string
  path?: string
  type?: string
  mimeType?: string
  isFolder?: boolean
  /** Byte size, when the Files app reports it (used for the size cap). */
  size?: number
}

const CALENDAR_MIMES = ['text/calendar']
const CONTACTS_MIMES = ['text/vcard', 'text/x-vcard']

/** The app an import kind belongs to (`effectiveEnabledApps` decides visibility). */
function appKeyForImportKind(kind: ImportKind): AppKey {
  return kind === 'calendar' ? 'calendar' : 'contacts'
}

function extensionOf(name?: string): string {
  const match = /\.([^.]+)$/.exec((name ?? '').trim())
  return match ? match[1].toLowerCase() : ''
}

/**
 * Which import an .ics/.vcf file belongs to, or null when it is neither.
 * Extension and MIME type are both honoured (a `.ics` served with a generic
 * MIME type still counts via its extension, and vice versa).
 */
export function importKindForResource(resource?: ImportableResource): ImportKind | null {
  if (!resource) return null
  if (resource.isFolder || (resource.type ?? '').toLowerCase() === 'folder') return null

  const mime = (resource.mimeType ?? '').toLowerCase().split(';')[0].trim()
  if (CALENDAR_MIMES.includes(mime)) return 'calendar'
  if (CONTACTS_MIMES.includes(mime)) return 'contacts'

  const ext = extensionOf(resource.name)
  if (ext === 'ics') return 'calendar'
  if (ext === 'vcf') return 'contacts'
  return null
}

/** True when exactly one resource is selected and it is importable as `kind`. */
export function isImportableSelection(kind: ImportKind, resources?: ImportableResource[]): boolean {
  if (!resources || resources.length !== 1) return false
  return importKindForResource(resources[0]) === kind
}

export function useFileImportActions(): { actions: ComputedRef<FileAction[]> } {
  // Everything a click needs is resolved HERE, once: this function runs inside
  // `defineWebApplication`'s setup, but the handlers run much later from the
  // Files app's context menu. Composables such as vue3-gettext's `useGettext`
  // rely on `inject()` and throw ("Failed to inject gettext. …") when called
  // outside a setup context, so they must never be reached from a handler.
  const { $gettext } = useGettext()
  const { showErrorMessage } = useMessages()
  const { dispatchModal } = useModals()
  const clientService = useClientService()
  // `useImport` captures its own dependencies (gettext, messages, DAV services)
  // at call time as well; calling it per click would re-enter those composables.
  const { prepareImport } = useImport()
  // The actions only make sense while the app is enabled and a DAV session
  // exists. Read once at setup (the settings store is a module singleton, so
  // reading its ref later is safe and needs no inject()).
  const { settings } = useSettings()

  /**
   * Visible only when the owning app is enabled (admin ∩ user) AND the user
   * is signed in — on public-link pages there is no DAV session and the import
   * would fail. Runs without any composable call, so it is safe from the Files
   * app's context menu.
   */
  function isAppUsable(kind: ImportKind): boolean {
    if (!isAuthenticated()) return false
    return effectiveEnabledApps(getAdminConfig(), settings.value).includes(
      appKeyForImportKind(kind)
    )
  }

  async function importSelectedResource(
    kind: ImportKind,
    options?: FileActionOptions<ImportableResource>
  ): Promise<void> {
    const resource = options?.resources?.[0]
    if (!resource || importKindForResource(resource) !== kind) return

    // Refuse huge files up front (the resource size when the Files app
    // reports it) instead of parsing them on the main thread.
    if (isOversizedImportFile(resource)) {
      showErrorMessage({ title: oversizedImportMessage($gettext) })
      return
    }

    let content = ''
    try {
      const { body } = await clientService.webdav.getFileContents(options?.space, {
        path: resource.path
      })
      content = typeof body === 'string' ? body : String(body ?? '')
    } catch (err) {
      console.warn('[planner] Could not read the selected file:', err)
      showErrorMessage({ title: $gettext('Could not read the selected file') })
      return
    }

    // Same cap after reading (the size is not always reported up front).
    if (isOversizedImportText(content)) {
      showErrorMessage({ title: oversizedImportMessage($gettext) })
      return
    }

    const fileName = resource.name || resource.path || ''
    const prepared = await prepareImport(kind, content, fileName)
    if (!prepared) return

    // The dialog lives in this app while the user is in the Files app: mount it
    // through the platform modal instead of navigating away. `ImportDialog` is a
    // real component, so composables in its own setup are fine.
    dispatchModal({
      title: kind === 'calendar' ? $gettext('Import events') : $gettext('Import contacts'),
      hideActions: true,
      customComponent: ImportDialog,
      customComponentAttrs: () => ({
        kind: prepared.kind,
        items: prepared.items,
        suggestedName: prepared.suggestedName,
        showOpenHint: true,
        standalone: false
      })
    })
  }

  const actions = computed<FileAction[]>(() => [
    {
      name: 'import-into-calendar',
      icon: 'calendar-2',
      hasPriority: true,
      label: () => $gettext('Import into calendar'),
      isVisible: (options) =>
        isAppUsable('calendar') && isImportableSelection('calendar', options?.resources),
      handler: (options) => importSelectedResource('calendar', options)
    },
    {
      name: 'import-into-contacts',
      icon: 'contacts-book',
      hasPriority: true,
      label: () => $gettext('Import into contacts'),
      isVisible: (options) =>
        isAppUsable('contacts') && isImportableSelection('contacts', options?.resources),
      handler: (options) => importSelectedResource('contacts', options)
    }
  ])

  return { actions }
}
