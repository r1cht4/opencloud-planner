/**
 * Regression: the Files app actions must not call composables at click time.
 *
 * `useGettext` (vue3-gettext) resolves the translation object with `inject()`, so
 * it only works inside a setup / effect scope. The action handler runs much later
 * from the Files app's context menu — i.e. after this app's `setup()` finished —
 * and previously called `useGettext()` (via `useImport`) there, which blew up with
 * "Failed to inject gettext. Make sure vue3-gettext is set up properly." and no
 * modal was dispatched.
 *
 * The mocks below therefore throw whenever they are used outside a setup / effect
 * scope, mirroring the real error. The actions are registered inside an
 * `effectScope` exactly like `defineWebApplication`'s setup does, then the handler
 * is invoked *outside* that scope.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const calls = vi.hoisted(() => ({
  /** Composables used without a setup/effect scope (must stay empty). */
  outsideScope: [] as string[],
  getFileContents: vi.fn(),
  dispatchModal: vi.fn(),
  showErrorMessage: vi.fn(),
  showMessage: vi.fn()
}))

vi.mock('vue3-gettext', async () => {
  const { getCurrentInstance, getCurrentScope } = await import('vue')
  return {
    useGettext: () => {
      if (!getCurrentInstance() && !getCurrentScope()) {
        calls.outsideScope.push('useGettext')
        throw new Error('Failed to inject gettext. Make sure vue3-gettext is set up properly.')
      }
      return { $gettext: (text: string) => text, current: 'en' }
    }
  }
})

vi.mock('@opencloud-eu/web-pkg', async () => {
  const { getCurrentInstance, getCurrentScope } = await import('vue')
  function assertScope(name: string): void {
    if (getCurrentInstance() || getCurrentScope()) return
    calls.outsideScope.push(name)
    throw new Error(`Failed to inject ${name}. Make sure it is set up properly.`)
  }
  return {
    useMessages: () => {
      assertScope('useMessages')
      return { showMessage: calls.showMessage, showErrorMessage: calls.showErrorMessage }
    },
    useModals: () => {
      assertScope('useModals')
      return { dispatchModal: calls.dispatchModal, removeModal: vi.fn() }
    },
    useClientService: () => {
      assertScope('useClientService')
      return { webdav: { getFileContents: calls.getFileContents } }
    }
  }
})

// DAV services are mocked so no network is touched; the real `useImport` (and
// therefore its own composable capture) stays in place on purpose.
vi.mock('../../src/composables/useDAVClient', () => ({
  useDAVClient: () => ({
    ensureReady: vi.fn().mockResolvedValue(true),
    getState: (): null => null
  }),
  // The Files actions are visible while signed in.
  isAuthenticated: () => true
}))

// The visibility check also reads the (mocked) settings store — all apps on.
vi.mock('../../src/settings/settingsStore', async () => {
  const { computed, ref } = await import('vue')
  const { resolveSettings } = await import('../../src/settings/schema')
  return {
    useSettings: () => ({
      settings: computed(() => resolveSettings({}, {})),
      loaded: ref(true),
      error: ref<string | null>(null),
      update: vi.fn(),
      isLocked: () => false,
      reload: async (): Promise<void> => undefined
    })
  }
})
vi.mock('../../src/composables/useCalendarService', () => ({
  useCalendarService: () => ({ fetchCalendars: vi.fn(), importEventIcs: vi.fn() }),
  createCollection: vi.fn()
}))
vi.mock('../../src/composables/useContactsService', () => ({
  useContactsService: () => ({ fetchAddressBooks: vi.fn(), importContactVcard: vi.fn() })
}))

import { useGettext } from 'vue3-gettext'
import { useFileImportActions } from '../../src/composables/useFileImportActions'

const SPACE = { id: 'space-1' }

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//E2E//Import//EN',
  'X-WR-CALNAME:Conference',
  'BEGIN:VEVENT',
  'UID:conference-1',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260718T090000Z',
  'DTEND:20260718T100000Z',
  'SUMMARY:Conference',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const VCF = ['BEGIN:VCARD', 'VERSION:3.0', 'UID:card-1', 'FN:Ada', 'END:VCARD'].join('\r\n')

function icsOptions(name = 'conference.ics') {
  return { space: SPACE, resources: [{ id: 'r1', path: `/${name}`, name }] } as never
}

/** Register the actions the way `defineWebApplication`'s setup does. */
function registerInSetupScope() {
  const scope = effectScope()
  const actions = scope.run(() => useFileImportActions().actions)!
  scope.stop()
  return actions
}

beforeEach(() => {
  calls.outsideScope.length = 0
  calls.getFileContents.mockReset()
  calls.dispatchModal.mockReset()
  calls.showErrorMessage.mockReset()
  calls.showMessage.mockReset()
})

describe('scope guard (sanity check of this harness)', () => {
  it('throws when useGettext is called outside a setup/effect scope', () => {
    expect(() => useGettext()).toThrow(/Failed to inject gettext/)
    expect(calls.outsideScope).toEqual(['useGettext'])
  })

  it('requires the actions to be registered inside a setup/effect scope', () => {
    expect(() => useFileImportActions()).toThrow(/Failed to inject/)
    calls.outsideScope.length = 0
  })
})

describe('import action handler runs outside the setup scope', () => {
  it('does not call any composable while handling a .ics click', async () => {
    calls.getFileContents.mockResolvedValue({ body: ICS })
    const actions = registerInSetupScope()
    expect(calls.outsideScope).toEqual([])

    // Click happens from the Files app: no setup scope, no component instance.
    await actions.value[0].handler(icsOptions())

    expect(calls.outsideScope).toEqual([])
    expect(calls.getFileContents).toHaveBeenCalledWith(SPACE, { path: '/conference.ics' })
    expect(calls.dispatchModal).toHaveBeenCalledTimes(1)
    const modal = calls.dispatchModal.mock.calls[0][0]
    expect(modal.title).toBe('Import events')
    expect(modal.customComponentAttrs()).toMatchObject({
      kind: 'calendar',
      suggestedName: 'Conference',
      standalone: false,
      showOpenHint: true
    })
  })

  it('does not call any composable while handling a .vcf click', async () => {
    calls.getFileContents.mockResolvedValue({ body: VCF })
    const actions = registerInSetupScope()

    await actions.value[1].handler(icsOptions('team.vcf'))

    expect(calls.outsideScope).toEqual([])
    expect(calls.dispatchModal.mock.calls[0][0].title).toBe('Import contacts')
  })

  it('reports unreadable files without calling a composable', async () => {
    calls.getFileContents.mockRejectedValue(new Error('403 Forbidden'))
    const actions = registerInSetupScope()

    await actions.value[0].handler(icsOptions())

    expect(calls.outsideScope).toEqual([])
    expect(calls.showErrorMessage).toHaveBeenCalledWith({
      title: 'Could not read the selected file'
    })
    expect(calls.dispatchModal).not.toHaveBeenCalled()
  })

  it('keeps isVisible free of composable calls as well', () => {
    const actions = registerInSetupScope()
    const [importCalendar, importContacts] = actions.value

    expect(importCalendar.isVisible(icsOptions())).toBe(true)
    expect(importContacts.isVisible(icsOptions())).toBe(false)
    expect(importCalendar.label()).toBe('Import into calendar')
    expect(calls.outsideScope).toEqual([])
  })
})
