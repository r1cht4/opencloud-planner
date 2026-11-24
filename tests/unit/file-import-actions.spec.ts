/**
 * Files app actions: "Import into calendar" / "Import into contacts".
 *
 * Covers the visibility rules (extension, MIME type, folder, multi-selection)
 * and the click path: read the resource, parse it losslessly, then open the
 * shared import dialog through the platform modal instead of navigating away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  getFileContents: vi.fn(),
  dispatchModal: vi.fn(),
  showErrorMessage: vi.fn(),
  prepareImport: vi.fn()
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useClientService: () => ({ webdav: { getFileContents: state.getFileContents } }),
  useModals: () => ({ dispatchModal: state.dispatchModal, removeModal: vi.fn() }),
  useMessages: () => ({ showErrorMessage: state.showErrorMessage, showMessage: vi.fn() }),
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

// The visibility check reads the (mocked) settings store; keep it offline.
const settingsDoc = vi.hoisted(() => ({ doc: {} as Record<string, unknown> }))
vi.mock('../../src/settings/settingsStore', async () => {
  const { computed, ref } = await import('vue')
  const { resolveSettings } = await import('../../src/settings/schema')
  return {
    useSettings: () => ({
      settings: computed(() => resolveSettings(settingsDoc.doc, {})),
      loaded: ref(true),
      error: ref<string | null>(null),
      update: vi.fn(),
      isLocked: () => false,
      reload: async (): Promise<void> => undefined
    })
  }
})

vi.mock('../../src/composables/useImport', () => ({
  useImport: () => ({ prepareImport: state.prepareImport })
}))

import {
  FILE_ACTION_EXTENSION_POINT,
  importKindForResource,
  isImportableSelection,
  useFileImportActions
} from '../../src/composables/useFileImportActions'

const SPACE = { id: 'space-1', driveAlias: 'personal/admin', driveType: 'personal' }

function resource(overrides: Record<string, unknown>) {
  return { id: 'r1', path: '/Holidays.ics', name: 'Holidays.ics', ...overrides }
}

function fileOptions(resources: unknown[]) {
  return { space: SPACE, resources } as never
}

beforeEach(() => {
  state.getFileContents.mockReset()
  state.dispatchModal.mockReset()
  state.showErrorMessage.mockReset()
  state.prepareImport.mockReset()
})

describe('importKindForResource', () => {
  it('recognises .ics files, case-insensitively', () => {
    expect(importKindForResource(resource({ name: 'holidays.ics' }))).toBe('calendar')
    expect(importKindForResource(resource({ name: 'HOLIDAYS.ICS' }))).toBe('calendar')
    expect(importKindForResource(resource({ name: 'Team.Ics' }))).toBe('calendar')
  })

  it('recognises .vcf files, case-insensitively', () => {
    expect(importKindForResource(resource({ name: 'team.vcf' }))).toBe('contacts')
    expect(importKindForResource(resource({ name: 'TEAM.VCF' }))).toBe('contacts')
  })

  it('falls back to the MIME type when the extension is missing', () => {
    expect(importKindForResource(resource({ name: 'event', mimeType: 'text/calendar' }))).toBe(
      'calendar'
    )
    expect(importKindForResource(resource({ name: 'card', mimeType: 'text/vcard' }))).toBe(
      'contacts'
    )
    expect(importKindForResource(resource({ name: 'card', mimeType: 'text/x-vcard' }))).toBe(
      'contacts'
    )
    // Parameters are ignored.
    expect(
      importKindForResource(resource({ name: 'event', mimeType: 'text/calendar; charset=utf-8' }))
    ).toBe('calendar')
  })

  it('ignores folders and unrelated files', () => {
    expect(importKindForResource(resource({ name: 'Archive.ics', isFolder: true }))).toBeNull()
    expect(importKindForResource(resource({ name: 'Archive.ics', type: 'folder' }))).toBeNull()
    expect(importKindForResource(resource({ name: 'notes.txt' }))).toBeNull()
    expect(importKindForResource(resource({ name: 'holidays.ics', mimeType: 'image/png' }))).toBe(
      'calendar'
    )
    expect(importKindForResource(undefined)).toBeNull()
  })
})

describe('isImportableSelection', () => {
  it('requires exactly one selection of the matching kind', () => {
    expect(isImportableSelection('calendar', [resource({ name: 'a.ics' })])).toBe(true)
    expect(isImportableSelection('contacts', [resource({ name: 'a.ics' })])).toBe(false)
    expect(isImportableSelection('contacts', [resource({ name: 'a.vcf' })])).toBe(true)
    expect(isImportableSelection('calendar', [])).toBe(false)
    expect(isImportableSelection('calendar', undefined)).toBe(false)
    expect(
      isImportableSelection('calendar', [resource({ name: 'a.ics' }), resource({ name: 'b.ics' })])
    ).toBe(false)
  })
})

describe('the registered actions', () => {
  it('exposes one action per kind on the files context-menu extension point', () => {
    const { actions } = useFileImportActions()
    expect(FILE_ACTION_EXTENSION_POINT).toBe('global.files.context-actions')
    expect(actions.value.map((a) => a.name)).toEqual([
      'import-into-calendar',
      'import-into-contacts'
    ])
    expect(actions.value.map((a) => a.icon)).toEqual(['calendar-2', 'contacts-book'])
    expect(actions.value.map((a) => a.label())).toEqual([
      'Import into calendar',
      'Import into contacts'
    ])
  })

  it('only shows the calendar action for a single .ics file', () => {
    const [importCalendar, importContacts] = useFileImportActions().actions.value
    expect(importCalendar.isVisible(fileOptions([resource({ name: 'Holidays.ics' })]))).toBe(true)
    expect(importContacts.isVisible(fileOptions([resource({ name: 'Holidays.ics' })]))).toBe(false)

    expect(
      importCalendar.isVisible(fileOptions([resource({ name: 'folder.ics', isFolder: true })]))
    ).toBe(false)
    expect(
      importCalendar.isVisible(
        fileOptions([resource({ name: 'a.ics' }), resource({ name: 'b.ics' })])
      )
    ).toBe(false)
    expect(importCalendar.isVisible(fileOptions([resource({ name: 'notes.txt' })]))).toBe(false)
  })

  it('only shows the contacts action for a single .vcf file', () => {
    const [, importContacts] = useFileImportActions().actions.value
    expect(importContacts.isVisible(fileOptions([resource({ name: 'Team.vcf' })]))).toBe(true)
    expect(importContacts.isVisible(fileOptions([resource({ name: 'Team.ics' })]))).toBe(false)
  })
})

describe('clicking the action', () => {
  const prepared = {
    kind: 'calendar',
    items: [{ uid: 'u1', ics: 'ICS-1', summary: 'One' }],
    suggestedName: 'Holidays'
  }

  it('reads the selected file and opens the import dialog in the platform modal', async () => {
    state.getFileContents.mockResolvedValue({ body: 'BEGIN:VCALENDAR...' })
    state.prepareImport.mockResolvedValue(prepared)

    const [importCalendar] = useFileImportActions().actions.value
    const options = fileOptions([resource({ name: 'holidays.ics', path: '/Holidays.ics' })])
    await importCalendar.handler(options)

    expect(state.getFileContents).toHaveBeenCalledWith(SPACE, { path: '/Holidays.ics' })
    expect(state.prepareImport).toHaveBeenCalledWith(
      'calendar',
      'BEGIN:VCALENDAR...',
      'holidays.ics'
    )
    expect(state.dispatchModal).toHaveBeenCalledTimes(1)

    const modal = state.dispatchModal.mock.calls[0][0]
    expect(modal.title).toBe('Import events')
    expect(modal.hideActions).toBe(true)
    expect(modal.customComponent).toBeTruthy()
    expect(modal.customComponentAttrs()).toEqual({
      kind: 'calendar',
      items: prepared.items,
      suggestedName: 'Holidays',
      showOpenHint: true,
      standalone: false
    })
    // The user stays in the Files app: no navigation, no message spam.
    expect(state.showErrorMessage).not.toHaveBeenCalled()
  })

  it('opens the contacts dialog for a .vcf file', async () => {
    state.getFileContents.mockResolvedValue({ body: 'BEGIN:VCARD...' })
    state.prepareImport.mockResolvedValue({
      kind: 'contacts',
      items: [{ uid: 'c1', vcard: 'CARD-1', displayName: 'Ada' }],
      suggestedName: 'Team'
    })

    const [, importContacts] = useFileImportActions().actions.value
    await importContacts.handler(fileOptions([resource({ name: 'team.vcf', path: '/team.vcf' })]))

    expect(state.prepareImport).toHaveBeenCalledWith('contacts', 'BEGIN:VCARD...', 'team.vcf')
    expect(state.dispatchModal.mock.calls[0][0].title).toBe('Import contacts')
  })

  it('reports unreadable files instead of opening an empty dialog', async () => {
    state.getFileContents.mockRejectedValue(new Error('403 Forbidden'))

    const [importCalendar] = useFileImportActions().actions.value
    await importCalendar.handler(fileOptions([resource({ name: 'holidays.ics' })]))

    expect(state.showErrorMessage).toHaveBeenCalledWith({
      title: 'Could not read the selected file'
    })
    expect(state.dispatchModal).not.toHaveBeenCalled()
  })

  it('stays silent when the file carries nothing importable', async () => {
    state.getFileContents.mockResolvedValue({ body: 'nothing' })
    state.prepareImport.mockResolvedValue(null)

    const [importCalendar] = useFileImportActions().actions.value
    await importCalendar.handler(fileOptions([resource({ name: 'holidays.ics' })]))

    // useImport already reported "No events found in file".
    expect(state.showErrorMessage).not.toHaveBeenCalled()
    expect(state.dispatchModal).not.toHaveBeenCalled()
  })

  it('ignores a handler call for a mismatching resource', async () => {
    const [importCalendar] = useFileImportActions().actions.value
    await importCalendar.handler(fileOptions([resource({ name: 'team.vcf' })]))

    expect(state.getFileContents).not.toHaveBeenCalled()
    expect(state.dispatchModal).not.toHaveBeenCalled()
  })
})

describe('visibility and size cap', () => {
  beforeEach(() => {
    settingsDoc.doc = {}
  })

  it('shows the actions while the apps are enabled and the user is signed in', () => {
    const [importCalendar, importContacts] = useFileImportActions().actions.value
    expect(importCalendar.isVisible(fileOptions([resource({ name: 'a.ics' })]))).toBe(true)
    expect(importContacts.isVisible(fileOptions([resource({ name: 'a.vcf' })]))).toBe(true)
  })

  it('hides the calendar action when the Calendar app is disabled', () => {
    settingsDoc.doc = { general: { enabledApps: ['contacts', 'tasks'] } }
    const [importCalendar, importContacts] = useFileImportActions().actions.value
    expect(importCalendar.isVisible(fileOptions([resource({ name: 'a.ics' })]))).toBe(false)
    expect(importContacts.isVisible(fileOptions([resource({ name: 'a.vcf' })]))).toBe(true)
  })

  it('hides the contacts action when the Contacts app is disabled', () => {
    settingsDoc.doc = { general: { enabledApps: ['calendar', 'tasks'] } }
    const [importCalendar, importContacts] = useFileImportActions().actions.value
    expect(importCalendar.isVisible(fileOptions([resource({ name: 'a.ics' })]))).toBe(true)
    expect(importContacts.isVisible(fileOptions([resource({ name: 'a.vcf' })]))).toBe(false)
  })

  it('refuses files above the import size cap without reading them', async () => {
    const [importCalendar] = useFileImportActions().actions.value
    const big = resource({ name: 'huge.ics', path: '/huge.ics', size: 21 * 1024 * 1024 })

    await importCalendar.handler(fileOptions([big]))

    expect(state.getFileContents).not.toHaveBeenCalled()
    expect(state.showErrorMessage).toHaveBeenCalledWith({
      title: 'This file is too large to import. The maximum size is 20 MB.'
    })
    expect(state.dispatchModal).not.toHaveBeenCalled()
  })

  it('refuses content above the cap even when no size was reported', async () => {
    state.getFileContents.mockResolvedValue({ body: 'x'.repeat(21 * 1024 * 1024) })
    const [importCalendar] = useFileImportActions().actions.value

    await importCalendar.handler(fileOptions([resource({ name: 'big.ics', path: '/big.ics' })]))

    expect(state.prepareImport).not.toHaveBeenCalled()
    expect(state.showErrorMessage).toHaveBeenCalledWith({
      title: 'This file is too large to import. The maximum size is 20 MB.'
    })
    expect(state.dispatchModal).not.toHaveBeenCalled()
  })
})
