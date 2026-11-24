// @vitest-environment happy-dom
/**
 * Order of the three apps inside a slot (`general.filesSidebarOrder`,
 * `general.appDrawerOrder`).
 *
 * Two apps in the same slot used to be ordered Calendar < Contacts < Tasks no
 * matter what; these lists decide that order for the Files sidebar and the app
 * menu, and three places have to agree on it: the schema (normalises a stored
 * list to a full permutation), `navigation.ts` (the slot base plus the app's rank
 * in the list) and Settings → General → Apps (rows in that order, one pair of
 * move buttons per row).
 */
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'

const state = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  admin: {} as Record<string, unknown>,
  calls: [] as Array<[string, unknown]>,
  loaded: true,
  error: null as string | null
}))

/** `$gettext` with the `%{…}` interpolation the labels use. */
vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, unknown>) =>
      params
        ? text.replace(/%\{(\w+)\}/g, (match, name: string) =>
            name in params ? String(params[name]) : match
          )
        : text
  })
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
  return createSettingsStoreMock(state)
})

import {
  DEFAULT_SETTINGS,
  FILES_SIDEBAR_SLOTS,
  normalizeAppOrder,
  resolveSettings,
  type AppDrawerSlot,
  type AppKey,
  type Settings
} from '../../src/settings/schema'
import {
  appDrawerPriority,
  appDrawerSlot,
  buildAppMenuItems,
  buildFilesSidebarItems,
  filesSidebarPriority,
  orderedApps
} from '../../src/navigation'
import GeneralSettings from '../../src/components/settings/GeneralSettings.vue'

const $gettext = (text: string) => text
const ALL: AppKey[] = ['calendar', 'contacts', 'tasks']

/** Every permutation of the three apps — the value space of both settings. */
const PERMUTATIONS: AppKey[][] = [
  ['calendar', 'contacts', 'tasks'],
  ['calendar', 'tasks', 'contacts'],
  ['contacts', 'calendar', 'tasks'],
  ['contacts', 'tasks', 'calendar'],
  ['tasks', 'calendar', 'contacts'],
  ['tasks', 'contacts', 'calendar']
]

describe('normalizeAppOrder', () => {
  it('drops unknown keys', () => {
    expect(normalizeAppOrder(['tasks', 'mail'])).toEqual(['tasks', 'calendar', 'contacts'])
  })

  it('appends the missing apps in the default order', () => {
    expect(normalizeAppOrder(['tasks'])).toEqual(['tasks', 'calendar', 'contacts'])
    expect(normalizeAppOrder(['contacts'])).toEqual(['contacts', 'calendar', 'tasks'])
  })

  it('removes duplicates, first occurrence wins', () => {
    expect(normalizeAppOrder(['tasks', 'tasks', 'calendar'])).toEqual([
      'tasks',
      'calendar',
      'contacts'
    ])
  })

  it('keeps a complete permutation as it is', () => {
    for (const order of PERMUTATIONS) expect(normalizeAppOrder(order)).toEqual(order)
  })

  it('fills an empty list with the default order', () => {
    expect(normalizeAppOrder([])).toEqual(ALL)
  })

  it('rejects a value that names no app at all', () => {
    // Not a list, or a list of typos: the next resolution level decides.
    expect(normalizeAppOrder('tasks')).toBeUndefined()
    expect(normalizeAppOrder({ order: ['tasks'] })).toBeUndefined()
    expect(normalizeAppOrder(['mail', 'chat'])).toBeUndefined()
  })
})

describe('the order settings in the schema', () => {
  it('defaults both lists to Calendar, Contacts, Tasks', () => {
    expect(DEFAULT_SETTINGS.general.filesSidebarOrder).toEqual(ALL)
    expect(DEFAULT_SETTINGS.general.appDrawerOrder).toEqual(ALL)
  })

  it('normalises a stored list (unknown keys, gaps, duplicates)', () => {
    const settings = resolveSettings(
      {
        general: {
          filesSidebarOrder: ['tasks', 'mail', 'tasks'],
          appDrawerOrder: ['contacts']
        }
      },
      {}
    )

    expect(settings.general.filesSidebarOrder).toEqual(['tasks', 'calendar', 'contacts'])
    expect(settings.general.appDrawerOrder).toEqual(['contacts', 'calendar', 'tasks'])
  })

  it('hands out its own copy, so a resolved order cannot leak into the defaults', () => {
    const settings = resolveSettings({}, {})
    settings.general.filesSidebarOrder.push('calendar')

    expect(DEFAULT_SETTINGS.general.filesSidebarOrder).toEqual(ALL)
    expect(settings.general.filesSidebarOrder).not.toBe(DEFAULT_SETTINGS.general.filesSidebarOrder)
  })

  it('falls through to the admin default when the user list names no app', () => {
    const settings = resolveSettings(
      { general: { filesSidebarOrder: ['mail'] } },
      { defaults: { general: { filesSidebarOrder: ['tasks', 'contacts', 'calendar'] } } }
    )

    expect(settings.general.filesSidebarOrder).toEqual(['tasks', 'contacts', 'calendar'])
  })

  it('a locked order keeps the admin list, normalised', () => {
    const settings = resolveSettings(
      { general: { appDrawerOrder: ['tasks', 'calendar', 'contacts'] } },
      {
        // An admin typo is repaired by the same normaliser, not passed through.
        defaults: {
          general: { appDrawerOrder: ['contacts', 'mail'] as unknown as AppKey[] }
        },
        locked: ['general.appDrawerOrder']
      }
    )

    // No fall-through to the user value, and the admin typo is repaired.
    expect(settings.general.appDrawerOrder).toEqual(['contacts', 'calendar', 'tasks'])
  })

  it('a lock without an admin default keeps the built-in order', () => {
    const settings = resolveSettings(
      { general: { filesSidebarOrder: ['tasks', 'calendar', 'contacts'] } },
      { locked: ['general.filesSidebarOrder'] }
    )

    expect(settings.general.filesSidebarOrder).toEqual(ALL)
  })
})

describe('orderedApps', () => {
  it('sorts the three apps the way a stored list puts them', () => {
    expect(orderedApps(['tasks', 'contacts', 'calendar'])).toEqual([
      'tasks',
      'contacts',
      'calendar'
    ])
  })

  it('appends apps the list does not name instead of dropping them', () => {
    expect(orderedApps(['tasks'])).toEqual(['tasks', 'calendar', 'contacts'])
    expect(orderedApps(null)).toEqual(ALL)
  })
})

describe('Files-sidebar priorities follow general.filesSidebarOrder', () => {
  const settingsWith = (general: Record<string, unknown>): Settings =>
    resolveSettings({ general: { navigation: 'filesSidebar', ...general } }, {})

  it('ranks the apps of one slot in the stored order', () => {
    const settings = settingsWith({ filesSidebarOrder: ['tasks', 'contacts', 'calendar'] })

    // Same slot (default: after Spaces, host priority 40) → 41…43, reordered.
    expect(filesSidebarPriority(settings, 'tasks')).toBe(41)
    expect(filesSidebarPriority(settings, 'contacts')).toBe(42)
    expect(filesSidebarPriority(settings, 'calendar')).toBe(43)

    const items = buildFilesSidebarItems(ALL, settings, $gettext)
    expect(items.map((item) => item.navItem.priority)).toEqual([43, 42, 41])
    expect(
      items
        .slice()
        .sort((a, b) => a.navItem.priority - b.navItem.priority)
        .map((item) => item.id.split('.').pop())
    ).toEqual(['tasks', 'contacts', 'calendar'])
  })

  it('keeps every rank inside its own slot (different slots stay separated)', () => {
    const settings = settingsWith({
      filesSidebarOrder: ['tasks', 'calendar', 'contacts'],
      filesSidebarPosition: { calendar: 'personal', contacts: 'spaces', tasks: 'shares' }
    })

    // Rank in the order: tasks 0, calendar 1, contacts 2.
    expect(filesSidebarPriority(settings, 'tasks')).toBe(31) // after Shares (30)
    expect(filesSidebarPriority(settings, 'calendar')).toBe(12) // after Personal (10)
    expect(filesSidebarPriority(settings, 'contacts')).toBe(43) // after Spaces (40)
  })

  it('never reaches the next host entry, whatever the order is', () => {
    for (const order of PERMUTATIONS) {
      for (const slot of FILES_SIDEBAR_SLOTS) {
        const settings = settingsWith({
          filesSidebarOrder: order,
          filesSidebarPosition: { calendar: slot, contacts: slot, tasks: slot }
        })
        const priorities = ALL.map((key) => filesSidebarPriority(settings, key))
        const lowest = Math.min(...priorities)

        expect(
          priorities.slice().sort((a, b) => a - b),
          `${slot} ${order.join()}`
        ).toEqual([lowest, lowest + 1, lowest + 2])
        // The gap is 1…9 after the host entry, so the next entry (+10) is safe.
        expect(priorities.every((priority) => priority % 10 >= 1 && priority % 10 <= 3)).toBe(true)
      }
    }
  })

  it('a locked order keeps the admin order', () => {
    const settings = resolveSettings(
      { general: { filesSidebarOrder: ['tasks', 'calendar', 'contacts'] } },
      {
        defaults: { general: { filesSidebarOrder: ['contacts', 'calendar', 'tasks'] } },
        locked: ['general.filesSidebarOrder']
      }
    )

    // Admin order: contacts, calendar, tasks → 41, 42, 43.
    expect(ALL.map((key) => filesSidebarPriority(settings, key))).toEqual([42, 41, 43])
  })
})

describe('app-menu priorities follow general.appDrawerOrder', () => {
  const settingsWith = (general: Record<string, unknown>): Settings =>
    resolveSettings({ general: { appDrawer: 'individual', ...general } }, {})

  it('ranks the apps of one slot in the stored order', () => {
    const settings = settingsWith({ appDrawerOrder: ['tasks', 'contacts', 'calendar'] })

    // Same slot (default: after Files, host priority 10) → 11…13.
    expect(appDrawerPriority(settings, 'tasks')).toBe(11)
    expect(appDrawerPriority(settings, 'contacts')).toBe(12)
  })

  it('applies the order per slot, so mixed slots interleave', () => {
    const settings = settingsWith({
      appDrawerOrder: ['tasks', 'contacts', 'calendar'],
      appDrawerPosition: { calendar: 'afterSettings', contacts: 'first', tasks: 'afterFiles' }
    })

    const priorities: Record<AppKey, number | undefined> = {
      calendar: appDrawerPriority(settings, 'calendar'),
      contacts: appDrawerPriority(settings, 'contacts'),
      tasks: appDrawerPriority(settings, 'tasks')
    }

    // ranks: tasks 0, contacts 1, calendar 2
    expect(priorities).toEqual({ calendar: 43, contacts: 2, tasks: 11 })
  })

  it('never leaves the slot, whatever the order is', () => {
    const bases: Record<Exclude<AppDrawerSlot, 'last'>, number> = {
      first: 1,
      afterFiles: 11,
      afterApps: 31,
      afterSettings: 41
    }

    for (const order of PERMUTATIONS) {
      for (const [slot, base] of Object.entries(bases) as Array<
        [Exclude<AppDrawerSlot, 'last'>, number]
      >) {
        const settings = settingsWith({
          appDrawerOrder: order,
          appDrawerPosition: { calendar: slot, contacts: slot, tasks: slot }
        })
        const ranks = ALL.map((key) => (appDrawerPriority(settings, key) as number) - base)

        expect(
          ranks.slice().sort((a, b) => a - b),
          `${slot} ${order.join()}`
        ).toEqual([0, 1, 2])
      }
    }

    // The `last` slot has no priority at all, whatever the order says.
    const last = settingsWith({
      appDrawerOrder: ['tasks', 'contacts', 'calendar'],
      appDrawerPosition: { calendar: 'last', contacts: 'last', tasks: 'last' }
    })
    expect(ALL.map((key) => appDrawerPriority(last, key))).toEqual([
      undefined,
      undefined,
      undefined
    ])
  })

  it('the individual drawer entries are built and ranked in that order', () => {
    const settings = settingsWith({ appDrawerOrder: ['tasks', 'contacts', 'calendar'] })
    const items = buildAppMenuItems(settings, ALL, $gettext)

    expect(items.map((item) => item.id.split('.').pop())).toEqual(['tasks', 'contacts', 'calendar'])
    expect(items.map((item) => item.priority)).toEqual([11, 12, 13])
  })

  it('respects the ticked apps and the enabled apps in the new order', () => {
    const settings = settingsWith({
      appDrawerOrder: ['tasks', 'contacts', 'calendar'],
      appDrawerApps: ALL
    })

    const items = buildAppMenuItems(settings, ALL, $gettext)
    expect(items.map((item) => item.id.split('.').pop())).toEqual(['tasks', 'contacts', 'calendar'])

    // A disabled app has no entry, but the surviving apps keep their ranks
    // (tasks 0, contacts 1, calendar 2).
    const withoutTasks = buildAppMenuItems(settings, ['contacts', 'calendar'], $gettext)
    expect(withoutTasks.map((item) => item.priority)).toEqual([12, 13])
  })
})

// ── Settings → General → Apps: rows, buttons, writes ────────────────────────

let wrapper: VueWrapper | null = null

const OcIconStub = defineComponent({
  name: 'OcIconStub',
  props: { name: { type: String as PropType<string>, default: '' } },
  setup(props) {
    return () => h('i', { 'data-icon': props.name })
  }
})

/** `oc-button` is registered by the host shell, which is not mounted here. */
const OcButtonStub = defineComponent({
  name: 'OcButtonStub',
  setup(_, { slots, attrs }) {
    return () => h('button', attrs, slots.default?.())
  }
})

function mountGeneral(): VueWrapper {
  wrapper = mount(GeneralSettings, {
    global: {
      stubs: {
        'oc-icon': OcIconStub,
        'oc-button': OcButtonStub,
        // Not what this spec is about (their own specs cover them), and both pull
        // host services in.
        FormatSettings: true,
        RemindersSettings: true
      }
    }
  })
  return wrapper
}

const FILES_GEAR = '[data-toggle="general.filesSidebarPosition"]'
const DRAWER_GEAR = '[data-toggle="general.appDrawerPosition"]'

/** The Files-sidebar rows, top to bottom, as their select's app key. */
function filesSidebarRowKeys(section: VueWrapper): string[] {
  return section
    .findAll('select[data-setting^="general.filesSidebarPosition."]')
    .map((select) => select.attributes('data-setting')!.split('.').pop()!)
}

function drawerRowKeys(section: VueWrapper): string[] {
  return section
    .findAll('select[data-setting^="general.appDrawerPosition."]')
    .map((select) => select.attributes('data-setting')!.split('.').pop()!)
}

beforeEach(() => {
  setMockSettingsDocument(state, {})
  state.locked = []
  state.admin = {}
  state.calls = []
  state.loaded = true
  state.error = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('GeneralSettings — order buttons', () => {
  it('lists the Files-sidebar rows in the stored order', async () => {
    setMockSettingsDocument(state, {
      general: {
        navigation: 'filesSidebar',
        filesSidebarOrder: ['tasks', 'calendar', 'contacts']
      }
    })
    const section = mountGeneral()
    await flushPromises()

    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    expect(filesSidebarRowKeys(section)).toEqual(['tasks', 'calendar', 'contacts'])
  })

  it('moves an app down and up, writing the whole order', async () => {
    setMockSettingsDocument(state, { general: { navigation: 'filesSidebar' } })
    const section = mountGeneral()
    await flushPromises()
    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    await section.find('[data-setting="general.filesSidebarOrder.calendar.down"]').trigger('click')
    expect(state.calls).toContainEqual([
      'general.filesSidebarOrder',
      ['contacts', 'calendar', 'tasks']
    ])
    await flushPromises()
    expect(filesSidebarRowKeys(section)).toEqual(['contacts', 'calendar', 'tasks'])

    await section.find('[data-setting="general.filesSidebarOrder.tasks.up"]').trigger('click')
    expect(state.calls).toContainEqual([
      'general.filesSidebarOrder',
      ['contacts', 'tasks', 'calendar']
    ])
    await flushPromises()
    expect(filesSidebarRowKeys(section)).toEqual(['contacts', 'tasks', 'calendar'])
  })

  it('skips the rows of disabled apps instead of reordering them into view', async () => {
    // Tasks is off: the two visible rows swap around it, tasks keeps its place.
    setMockSettingsDocument(state, {
      general: { navigation: 'filesSidebar', enabledApps: ['calendar', 'contacts'] }
    })
    const section = mountGeneral()
    await flushPromises()
    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    expect(filesSidebarRowKeys(section)).toEqual(['calendar', 'contacts'])

    await section.find('[data-setting="general.filesSidebarOrder.calendar.down"]').trigger('click')
    expect(state.calls).toContainEqual([
      'general.filesSidebarOrder',
      ['contacts', 'calendar', 'tasks']
    ])
  })

  it('disables the buttons at the ends of the order', async () => {
    setMockSettingsDocument(state, { general: { navigation: 'filesSidebar' } })
    const section = mountGeneral()
    await flushPromises()
    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    const up = (key: string) => section.find(`[data-setting="general.filesSidebarOrder.${key}.up"]`)
    const down = (key: string) =>
      section.find(`[data-setting="general.filesSidebarOrder.${key}.down"]`)

    // First row: no way up. Last row: no way down. The middle row can move both.
    expect(up('calendar').attributes('disabled')).toBeDefined()
    expect(down('calendar').attributes('disabled')).toBeUndefined()
    expect(up('contacts').attributes('disabled')).toBeUndefined()
    expect(down('contacts').attributes('disabled')).toBeUndefined()
    expect(up('tasks').attributes('disabled')).toBeUndefined()
    expect(down('tasks').attributes('disabled')).toBeDefined()
  })

  it('disables every button when the admin locked the order', async () => {
    state.locked = ['general.filesSidebarOrder']
    setMockSettingsDocument(state, { general: { navigation: 'filesSidebar' } })
    const section = mountGeneral()
    await flushPromises()
    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    const buttons = section.findAll('[data-setting^="general.filesSidebarOrder."]')
    expect(buttons).toHaveLength(6)
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)

    // The lock is marked on every row, like the other locked settings.
    expect(section.findAll('[aria-label="Set by your administrator."]')).toHaveLength(3)
  })

  it('labels the buttons with the app they move and keeps them next to the label', async () => {
    setMockSettingsDocument(state, { general: { navigation: 'filesSidebar' } })
    const section = mountGeneral()
    await flushPromises()
    await section.find(FILES_GEAR).trigger('click')
    await flushPromises()

    const up = section.find('[data-setting="general.filesSidebarOrder.contacts.up"]')
    const down = section.find('[data-setting="general.filesSidebarOrder.contacts.down"]')

    expect(up.attributes('aria-label')).toBe('Move Contacts up')
    expect(up.attributes('title')).toBe('Move Contacts up')
    expect(down.attributes('aria-label')).toBe('Move Contacts down')
    expect(up.find('[data-icon="arrow-up-s"]').exists()).toBe(true)
    expect(down.find('[data-icon="arrow-down-s"]').exists()).toBe(true)

    // Outside the control column: the select/checkbox columns stay aligned with
    // the rows above, and the buttons sit on the label's line.
    expect(
      section
        .find('.settings-row-heading [data-setting="general.filesSidebarOrder.contacts.up"]')
        .exists()
    ).toBe(true)
    expect(
      section.find('.settings-row-control [data-setting^="general.filesSidebarOrder."]').exists()
    ).toBe(false)
  })

  it('shows the app-menu rows in appDrawerOrder and moves them', async () => {
    setMockSettingsDocument(state, {
      general: { appDrawer: 'individual', appDrawerOrder: ['contacts', 'tasks', 'calendar'] }
    })
    const section = mountGeneral()
    await flushPromises()

    await section.find(DRAWER_GEAR).trigger('click')
    await flushPromises()

    expect(drawerRowKeys(section)).toEqual(['contacts', 'tasks', 'calendar'])

    await section.find('[data-setting="general.appDrawerOrder.calendar.up"]').trigger('click')
    expect(state.calls).toContainEqual([
      'general.appDrawerOrder',
      ['contacts', 'calendar', 'tasks']
    ])
    await flushPromises()
    expect(drawerRowKeys(section)).toEqual(['contacts', 'calendar', 'tasks'])
  })

  it('has no order buttons for the single app-menu entry', async () => {
    // One row for the package: there is nothing to order.
    setMockSettingsDocument(state, { general: { appDrawer: 'single' } })
    const section = mountGeneral()
    await flushPromises()

    await section.find(DRAWER_GEAR).trigger('click')
    await flushPromises()

    expect(section.find('select[data-setting="general.appDrawerPosition"]').exists()).toBe(true)
    expect(section.find('[data-setting^="general.appDrawerOrder."]').exists()).toBe(false)
  })

  it('positions the single entry for the app it opens when the default app is disabled', async () => {
    // Contacts is the stored default app but no longer enabled, so the one entry
    // opens Calendar. The row must arrange Calendar's slot — not the disabled
    // Contacts' — or it would edit a setting the entry never uses.
    const document = {
      general: {
        defaultApp: 'contacts',
        enabledApps: ['calendar', 'tasks'],
        appDrawerPosition: { calendar: 'first', contacts: 'afterApps', tasks: 'afterSettings' }
      }
    }
    setMockSettingsDocument(state, document)

    const section = mountGeneral()
    await flushPromises()
    await section.find(DRAWER_GEAR).trigger('click')
    await flushPromises()

    const settings = resolveSettings(document, {})
    const enabled: AppKey[] = ['calendar', 'tasks']
    const [entry] = buildAppMenuItems(settings, enabled, $gettext)

    // The entry sits in Calendar's slot (priority 1, not Contacts' 32)…
    expect(entry.priority).toBe(appDrawerPriority(settings, 'calendar'))
    expect(entry.priority).toBe(1)

    // …and the row shows and edits that same app's position.
    const row = section.find('select[data-setting="general.appDrawerPosition"]')
    expect((row.element as HTMLSelectElement).value).toBe(appDrawerSlot(settings, 'calendar'))

    await row.setValue('last')
    expect(state.calls).toContainEqual([
      'general.appDrawerPosition',
      { calendar: 'last', contacts: 'afterApps', tasks: 'afterSettings' }
    ])
  })
})
