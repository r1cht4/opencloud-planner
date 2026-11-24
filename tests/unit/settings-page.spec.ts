// @vitest-environment happy-dom
/**
 * Settings page shell + the ⚙ header button.
 *
 * The URL of the page is always the plain `/planner/settings` — no
 * `#<tab>`, no query: the tab is handed over in memory (`settings/pendingTab.ts`).
 * These tests pin that handover, the tabs themselves and the read-only rendering of
 * admin-locked settings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  calls: [] as Array<[string, unknown]>,
  error: null as string | null,
  admin: {} as Record<string, unknown>,
  push: null as unknown as ReturnType<typeof vi.fn>,
  route: {
    name: 'calendar',
    path: '/planner/calendar',
    query: {} as Record<string, string>,
    hash: ''
  } as {
    name?: string
    path?: string
    query: Record<string, string>
    hash: string
  },
  showErrorMessage: null as unknown as ReturnType<typeof vi.fn>
}))

state.push = vi.fn()
state.showErrorMessage = vi.fn()

/**
 * The route the mocked web-pkg `useRoute()` returns — a real Ref (not a plain
 * getter), like the host's `useRoute()`. The Settings page no longer reads it
 * (the tab comes from `settings/pendingTab.ts`), the ⚙ button still does.
 */
const routeBox = vi.hoisted(() => ({ ref: null as unknown as { value: typeof state.route } }))

type RouteState = {
  name?: string
  path?: string
  query: Record<string, string>
  hash: string
}

/** Set the host route the components see (mirrors `router.push`). */
function setRoute(route: Partial<RouteState> = {}): void {
  state.route = {
    name: 'calendar',
    path: '/planner/calendar',
    query: {},
    hash: '',
    ...route
  }
  routeBox.ref.value = state.route
}

vi.mock('vue3-gettext', () => ({
  // Like the real $gettext: interpolate `%{name}` when named params are passed.
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string>) =>
      params ? text.replace(/%\{(\w+)\}/g, (match, name: string) => params[name] ?? match) : text
  })
}))

vi.mock('@opencloud-eu/web-pkg', async () => {
  const { ref } = await import('vue')
  // web-pkg's useRoute returns a Ref of the host route.
  const route = ref(state.route)
  routeBox.ref = route as unknown as { value: typeof state.route }
  return {
    useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: state.showErrorMessage }),
    useRoute: () => route,
    useRouter: () => ({ push: state.push })
  }
})

// Guard: the extension must never use vue-router's own composables (undefined in the host).
vi.mock('vue-router', () => ({
  useRoute: (): undefined => undefined,
  useRouter: (): undefined => undefined
}))

// The Tools section is DAV-dependent and wrapped in ConnectionGate; the gate has
// its own spec, this one only needs to control its outcome.
const probe = vi.hoisted(() => ({ outcome: null as unknown as { value: string } }))

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref } = await import('vue')
  const outcome = ref<string>('ok')
  probe.outcome = outcome as unknown as { value: string }
  return {
    useConnectionProbe: () => ({
      outcome,
      probing: ref(false),
      lastResult: ref(null),
      retest: async (): Promise<void> => undefined
    }),
    probeOutcomeForStatus: () => 'ok'
  }
})

vi.mock('../../src/config/appConfig', () => ({
  getAdminConfig: () => state.admin,
  setAdminConfig: (): void => undefined
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { computed, ref } = await import('vue')
  const { resolveSettings, writeSettingPath } = await import('../../src/settings/schema')
  const doc = ref<Record<string, unknown>>({})
  const error = ref<string | null>(null)
  return {
    useSettings: () => {
      doc.value = state.doc
      error.value = state.error
      return {
        settings: computed(() => resolveSettings(doc.value, state.admin as never)),
        loaded: ref(true),
        error,
        update: (path: string, value: unknown) => {
          state.calls.push([path, value])
          const next: Record<string, unknown> = JSON.parse(JSON.stringify(doc.value))
          writeSettingPath(next, path, value)
          doc.value = next
          state.doc = next
        },
        isLocked: (path: string) => state.locked.includes(path),
        reload: async (): Promise<void> => undefined
      }
    }
  }
})

import Settings from '../../src/views/Settings.vue'
import PageHeaderActions from '../../src/components/PageHeaderActions.vue'
import { SETTINGS_TARGET } from '../../src/navigation'
import { requestSettingsTab, resetPendingTab, takeSettingsTab } from '../../src/settings/pendingTab'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { ariaLabel: { type: String, default: '' } },
  setup(props, { slots, attrs }) {
    return () =>
      h('button', { ...attrs, 'aria-label': props.ariaLabel || undefined }, slots.default?.())
  }
})

/** Stub of RemindersSettings: records the props and can emit a toggle. */
const RemindersSettingsStub = defineComponent({
  name: 'RemindersSettings',
  props: { enabled: { type: Boolean, default: false }, locked: { type: Boolean, default: false } },
  emits: ['update:enabled'],
  setup(props, { emit }) {
    return () =>
      h(
        'button',
        {
          class: 'reminders-settings-stub',
          'data-enabled': String(props.enabled),
          'data-locked': String(props.locked),
          onClick: () => emit('update:enabled', !props.enabled)
        },
        'Show reminders'
      )
  }
})

function mountSettings() {
  return mount(Settings, {
    global: {
      stubs: {
        'oc-button': OcButtonStub,
        'oc-icon': true,
        'oc-spinner': true,
        CalendarToolsCard: true,
        ContactsToolsCard: true,
        CollectionsCard: true,
        ConnectDevices: true,
        BackupCard: true,
        DuplicateEventsCard: true,
        ContactsCsvCard: true,
        RemindersSettings: RemindersSettingsStub,
        CalendarSettings: true,
        ContactsSettings: true,
        TasksSettings: true,
        BirthdaysSettings: true,
        // AboutStatus has its own spec and talks to the DAV server.
        AboutStatus: true
      }
    }
  })
}

/**
 * Press the small "arrange" gear next to a mode select: the per-app placement
 * rows are a disclosure and start collapsed on every mount.
 */
async function expandArrangement(wrapper: VueWrapper, path: string): Promise<void> {
  const gear = wrapper.find(`[data-toggle="${path}"]`)
  expect(gear.exists()).toBe(true)
  await gear.trigger('click')
}

beforeEach(() => {
  state.doc = {}
  state.locked = []
  state.calls = []
  state.error = null
  state.admin = {}
  setRoute()
  state.push.mockClear()
  state.showErrorMessage.mockClear()
  probe.outcome.value = 'ok'
  // The tab handover is module state: a leftover request would leak into the next test.
  resetPendingTab()
})

describe('⚙ header button', () => {
  function mountGear() {
    return mount(PageHeaderActions, {
      global: { stubs: { 'oc-icon': true, RouterLink: RouterLinkStub } }
    })
  }

  it('is an icon-only link with an accessible label', () => {
    const wrapper = mountGear()

    const link = wrapper.find('a')
    expect(link.attributes('aria-label')).toBe('Settings')
  })

  it('links to the plain Settings path — no hash, no query', () => {
    setRoute({ name: '', path: '/planner/contacts' })

    const wrapper = mountGear()

    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual(SETTINGS_TARGET)
    // The tab is never part of the address any more (`?from=` and `#<tab>` are gone).
    expect(SETTINGS_TARGET).toEqual({ path: '/planner/settings' })
  })

  it('hands the tab of the current page over in memory', async () => {
    // `path` is what the host always has; route *names* are not reliable inside
    // OpenCloud (the host registers the routes).
    for (const [path, tab] of [
      ['/planner/calendar', 'calendar'],
      ['/planner/contacts', 'contacts'],
      ['/planner/tasks', 'tasks']
    ]) {
      setRoute({ name: '', path })
      resetPendingTab()

      const wrapper = mountGear()
      await wrapper.find('a').trigger('click')

      expect(takeSettingsTab(), path).toBe(tab)
    }
  })

  it('falls back to the General tab for a page without settings tab of its own', async () => {
    for (const path of ['', '/files/spaces']) {
      setRoute({ name: '', path })
      resetPendingTab()

      const wrapper = mountGear()
      await wrapper.find('a').trigger('click')

      expect(takeSettingsTab(), path).toBe('general')
    }
  })

  it('opens the Contacts tab (with Birthdays) from a birthdays page', async () => {
    setRoute({ name: '', path: '/planner/birthdays' })
    resetPendingTab()

    const wrapper = mountGear()
    await wrapper.find('a').trigger('click')

    expect(takeSettingsTab()).toBe('contacts')
  })

  it('never touches the browser history when it is opened', async () => {
    setRoute({ name: '', path: '/planner/contacts' })
    const replaceState = vi.spyOn(window.history, 'replaceState')

    await mountGear().find('a').trigger('click')

    expect(replaceState).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })

  it('is rendered by Calendar, Contacts and Tasks', () => {
    for (const view of ['Calendar', 'Contacts', 'Tasks']) {
      const source = readFileSync(join(process.cwd(), 'src', 'views', `${view}.vue`), 'utf8')
      expect(source, view).toContain(
        "import PageHeaderActions from '../components/PageHeaderActions.vue'"
      )
      expect(source, view).toContain('<PageHeaderActions />')
    }
  })
})

describe('Settings page', () => {
  const ids = ['general', 'calendar', 'contacts', 'tasks', 'data', 'devices', 'about']

  it('renders one tab per section, each pointing at its panel', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.attributes('aria-label')).toBe('Settings sections')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.attributes('data-section'))).toEqual(ids)
    expect(tabs.map((tab) => tab.text())).toEqual([
      'General',
      'Calendar',
      'Contacts',
      'Tasks',
      'Data',
      'Devices',
      'About'
    ])
    for (const [index, id] of ids.entries()) {
      expect(tabs[index].attributes('aria-controls'), id).toBe(`settings-panel-${id}`)
      expect(tabs[index].attributes('aria-selected'), id).toBe(id === 'general' ? 'true' : 'false')
    }
  })

  it('shows only the active tab content in a tabpanel', async () => {
    // One tab instead of a long page: the other panels are not rendered at all
    // (and so cannot be reached by a stray anchor link).
    const wrapper = mountSettings()
    await flushPromises()

    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe('settings-panel-general')
    expect(panel.attributes('data-tab')).toBe('general')
    expect(panel.attributes('aria-labelledby')).toBe('settings-tab-general')

    // General = the Apps group (real), Format (real) and the reminder stub.
    const groups = panel.findAll('.settings-section')
    expect(groups.map((group) => group.find('h2').text())).toEqual(['Apps', 'Reminders', 'Format'])
    expect(wrapper.find('calendar-settings-stub').exists()).toBe(false)
  })

  it('switching tabs shows that section and leaves the URL alone', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const wrapper = mountSettings()
    await flushPromises()

    await wrapper.find('[role="tab"][data-section="calendar"]').trigger('click')

    expect(wrapper.find('calendar-settings-stub').exists()).toBe(true)
    expect(wrapper.find('.reminders-settings-stub').exists()).toBe(false)
    expect(wrapper.find('[role="tab"][data-section="calendar"]').attributes('aria-selected')).toBe(
      'true'
    )
    // The tab is never written into the address (user decision: no `#<tab>`).
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    replaceState.mockRestore()
  })

  it('opens the tab the previous page requested (⚙ handover)', async () => {
    // The ⚙ button of the Contacts page drops the tab here right before navigating.
    requestSettingsTab('contacts')

    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('[role="tabpanel"]').attributes('data-tab')).toBe('contacts')
    expect(wrapper.find('[role="tab"][data-section="contacts"]').attributes('aria-selected')).toBe(
      'true'
    )
    // Contacts and Birthdays share the tab.
    expect(wrapper.find('contacts-settings-stub').exists()).toBe(true)
    expect(wrapper.find('birthdays-settings-stub').exists()).toBe(true)
  })

  it('opens the Data tab when the legacy /manage route redirected here', async () => {
    // `/manage` → `legacyToolsRedirect()` requests the Data tab, then pushes the
    // plain settings path: `/settings` carries no tab of its own any more.
    requestSettingsTab('data')

    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('[role="tabpanel"]').attributes('data-tab')).toBe('data')
  })

  it('takes the requested tab only once', async () => {
    requestSettingsTab('tasks')

    const first = mountSettings()
    await flushPromises()
    expect(first.find('[role="tabpanel"]').attributes('data-tab')).toBe('tasks')
    first.unmount()

    // A second mount (reload, back/forward) is a plain visit again.
    const second = mountSettings()
    await flushPromises()
    expect(second.find('[role="tabpanel"]').attributes('data-tab')).toBe('general')
    expect(takeSettingsTab()).toBeNull()
  })

  it('ignores a fragment left in the URL', async () => {
    setRoute({ name: 'settings', path: '/planner/settings', hash: '#contacts' })
    window.location.hash = '#contacts'

    const wrapper = mountSettings()
    await flushPromises()

    // Bookmarks with a hash are not supported any more: General is the default.
    expect(wrapper.find('[role="tabpanel"]').attributes('data-tab')).toBe('general')
    window.location.hash = ''
  })

  it('has no Back button of its own (the sidebar links out to OpenCloud)', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('.settings-back').exists()).toBe(false)
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
  })

  it('unchecking Contacts in the Files sidebar calls update on the settings store', async () => {
    // The per-app Files-sidebar list only exists in that navigation mode.
    state.doc = { general: { navigation: 'filesSidebar' } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    // One checkbox per enabled app — all three are on by default.
    const calendar = wrapper.find('input[data-setting="general.filesSidebar.calendar"]')
    const contacts = wrapper.find('input[data-setting="general.filesSidebar.contacts"]')
    const tasks = wrapper.find('input[data-setting="general.filesSidebar.tasks"]')
    expect((calendar.element as HTMLInputElement).checked).toBe(true)
    expect((contacts.element as HTMLInputElement).checked).toBe(true)
    expect((tasks.element as HTMLInputElement).checked).toBe(true)

    await contacts.setValue(false)

    expect(state.calls).toContainEqual(['general.filesSidebar', ['calendar', 'tasks']])
  })

  it('keeps the Files-sidebar rows collapsed until the gear is pressed', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }

    const wrapper = mountSettings()
    await flushPromises()

    // Collapsed by default, and the gear says so.
    const gear = wrapper.find('[data-toggle="general.filesSidebarPosition"]')
    expect(gear.exists()).toBe(true)
    expect(gear.attributes('aria-expanded')).toBe('false')
    expect(gear.attributes('aria-label')).toBe('Arrange apps in the Files sidebar')
    expect(wrapper.find('input[data-setting="general.filesSidebar.calendar"]').exists()).toBe(false)
    expect(
      wrapper.find('select[data-setting="general.filesSidebarPosition.calendar"]').exists()
    ).toBe(false)

    await gear.trigger('click')

    expect(
      wrapper.find('[data-toggle="general.filesSidebarPosition"]').attributes('aria-expanded')
    ).toBe('true')
    for (const key of ['calendar', 'contacts', 'tasks']) {
      expect(wrapper.find(`input[data-setting="general.filesSidebar.${key}"]`).exists()).toBe(true)
      expect(
        wrapper.find(`select[data-setting="general.filesSidebarPosition.${key}"]`).exists()
      ).toBe(true)
    }
    // Default slot: after the host's Spaces entry.
    const calendar = wrapper.find('select[data-setting="general.filesSidebarPosition.calendar"]')
    expect((calendar.element as HTMLSelectElement).value).toBe('spaces')
    expect(calendar.findAll('option').map((option) => option.text())).toEqual([
      'After Personal',
      'After Favorites',
      'After Shares',
      'After Spaces',
      'After Deleted files'
    ])
    // The select is named for screen readers (the row label is the app).
    expect(calendar.attributes('aria-label')).toBe('Position of Calendar in the Files sidebar')
  })

  it('writes the slot of one app and leaves the others alone', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    await wrapper
      .find('select[data-setting="general.filesSidebarPosition.contacts"]')
      .setValue('personal')

    expect(state.calls).toContainEqual([
      'general.filesSidebarPosition',
      { calendar: 'spaces', contacts: 'personal', tasks: 'spaces' }
    ])
  })

  it('keeps the Files-sidebar controls read-only when the admin locks them', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }
    state.locked = ['general.filesSidebar', 'general.filesSidebarPosition']

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    expect(
      wrapper
        .find('select[data-setting="general.filesSidebarPosition.tasks"]')
        .attributes('disabled')
    ).toBeDefined()
    expect(
      wrapper.find('input[data-setting="general.filesSidebar.tasks"]').attributes('disabled')
    ).toBeDefined()
    // One lock icon per locked row, no repeated paragraph.
    expect(wrapper.text()).not.toContain('Settings marked as read-only')
  })

  it('offers the app-menu modes; "One entry" has a single Planner row', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    const select = wrapper.find('select[data-setting="general.appDrawer"]')
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'single',
      'individual'
    ])
    expect((select.element as HTMLSelectElement).value).toBe('single')
    expect(wrapper.text()).toContain('One Planner entry in the app menu')
    // Collapsed by default: no placement row until the gear is pressed.
    expect(wrapper.find('select[data-setting="general.appDrawerPosition"]').exists()).toBe(false)

    await expandArrangement(wrapper, 'general.appDrawerPosition')

    // One row for the whole package — the app is not listed per app, and the row
    // has no checkbox (hiding the only app-menu entry would leave no way in).
    const row = wrapper.find('select[data-setting="general.appDrawerPosition"]')
    expect(row.exists()).toBe(true)
    expect(row.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'first',
      'afterFiles',
      'afterApps',
      'afterSettings',
      'last'
    ])
    expect(wrapper.find('input[data-setting="general.appDrawerApps.calendar"]').exists()).toBe(
      false
    )
    expect(wrapper.text()).toContain('Planner')
  })

  it('lists one row per enabled app in individual app-menu mode', async () => {
    state.doc = { general: { appDrawer: 'individual', appDrawerApps: ['calendar', 'tasks'] } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.appDrawerPosition')

    // Each app has its placement select and its own "show" checkbox.
    for (const key of ['calendar', 'contacts', 'tasks']) {
      expect(wrapper.find(`select[data-setting="general.appDrawerPosition.${key}"]`).exists()).toBe(
        true
      )
      expect(wrapper.find(`input[data-setting="general.appDrawerApps.${key}"]`).exists()).toBe(true)
    }
    expect(
      wrapper
        .find('select[data-setting="general.appDrawerPosition.calendar"]')
        .attributes('aria-label')
    ).toBe('Position of Calendar in the app menu')

    expect(
      (
        wrapper.find('input[data-setting="general.appDrawerApps.calendar"]')
          .element as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(
      (
        wrapper.find('input[data-setting="general.appDrawerApps.tasks"]')
          .element as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(
      (
        wrapper.find('input[data-setting="general.appDrawerApps.contacts"]')
          .element as HTMLInputElement
      ).checked
    ).toBe(false)

    await wrapper.find('input[data-setting="general.appDrawerApps.contacts"]').setValue(true)
    expect(state.calls).toContainEqual(['general.appDrawerApps', ['calendar', 'tasks', 'contacts']])
  })

  it('writes the app-menu mode', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    await wrapper.find('select[data-setting="general.appDrawer"]').setValue('individual')

    expect(state.calls).toContainEqual(['general.appDrawer', 'individual'])
  })

  it('grows the Navigation select to the full control width when the gear is hidden', async () => {
    // Default mode is "App menu only": no gear, so the inline row is solo and the
    // select spans the whole control column like the "Default app" select above.
    const wrapper = mountSettings()
    await flushPromises()

    const select = wrapper.find('select[data-setting="general.navigation"]')
    const inline = select.element.closest('.settings-inline') as HTMLElement
    expect(inline.classList.contains('settings-inline--solo')).toBe(true)
    expect(wrapper.find('[data-toggle="general.filesSidebarPosition"]').exists()).toBe(false)

    // Files-sidebar mode: the gear comes back and the row keeps its two-column
    // inline grid (select + gear), so the select ends where the other rows' do.
    await select.setValue('filesSidebar')
    await flushPromises()

    const inlineAgain = wrapper
      .find('select[data-setting="general.navigation"]')
      .element.closest('.settings-inline') as HTMLElement
    expect(inlineAgain.classList.contains('settings-inline--solo')).toBe(false)
    expect(wrapper.find('[data-toggle="general.filesSidebarPosition"]').exists()).toBe(true)
  })

  it('gives the Navigation row its own hint in app-menu-only mode', async () => {
    // Default navigation is "App menu only"; the App-menu row shows the "one
    // entry" hint in the same situation, so the Navigation row must not repeat it.
    const wrapper = mountSettings()
    await flushPromises()

    const navRow = wrapper
      .find('select[data-setting="general.navigation"]')
      .element.closest('.settings-row') as HTMLElement
    expect(navRow.querySelector('.settings-row-hint')?.textContent).toBe(
      'Nothing in the Files sidebar; open the apps from the app menu.'
    )

    const drawerRow = wrapper
      .find('select[data-setting="general.appDrawer"]')
      .element.closest('.settings-row') as HTMLElement
    expect(drawerRow.querySelector('.settings-row-hint')?.textContent).toBe(
      'One Planner entry in the app menu; switch apps in the sidebar.'
    )
  })

  it('puts the position select and the checkbox in one row, side by side', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    const select = wrapper.find('select[data-setting="general.filesSidebarPosition.calendar"]')
    const control = select.element.closest('.settings-inline') as HTMLElement
    expect(control).not.toBeNull()

    // One line per app: exactly one select and one checkbox in the same control
    // slot (the checkbox keeps the right edge of the row).
    expect(control.querySelectorAll('select')).toHaveLength(1)
    expect(control.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(control.querySelector('input[type="checkbox"]')?.getAttribute('data-setting')).toBe(
      'general.filesSidebar.calendar'
    )

    const row = select.element.closest('.settings-row') as HTMLElement
    expect(row.querySelectorAll('select, input[type="checkbox"]')).toHaveLength(2)
    // No hint paragraph between the rows of the group.
    expect(wrapper.find('.settings-section').exists()).toBe(true)
    expect(wrapper.findAll('p.settings-hint')).toHaveLength(0)
  })

  it('writes the app-menu slot of one app', async () => {
    state.doc = { general: { appDrawer: 'individual' } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.appDrawerPosition')

    await wrapper
      .find('select[data-setting="general.appDrawerPosition.contacts"]')
      .setValue('afterSettings')

    expect(state.calls).toContainEqual([
      'general.appDrawerPosition',
      { calendar: 'afterFiles', contacts: 'afterSettings', tasks: 'afterFiles' }
    ])
  })

  it('gives the single app-menu entry the slot of the default app', async () => {
    state.doc = { general: { appDrawer: 'single', defaultApp: 'contacts' } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.appDrawerPosition')

    const select = wrapper.find('select[data-setting="general.appDrawerPosition"]')
    expect((select.element as HTMLSelectElement).value).toBe('afterFiles')

    await select.setValue('last')

    // The one entry opens the default app, so its slot is that app's slot.
    expect(state.calls).toContainEqual([
      'general.appDrawerPosition',
      { calendar: 'afterFiles', contacts: 'last', tasks: 'afterFiles' }
    ])
  })

  it('collapses the arrangement again on the second press', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }

    const wrapper = mountSettings()
    await flushPromises()

    await expandArrangement(wrapper, 'general.filesSidebarPosition')
    expect(
      wrapper.find('select[data-setting="general.filesSidebarPosition.calendar"]').exists()
    ).toBe(true)

    await wrapper.find('[data-toggle="general.filesSidebarPosition"]').trigger('click')

    expect(
      wrapper.find('[data-toggle="general.filesSidebarPosition"]').attributes('aria-expanded')
    ).toBe('false')
    expect(
      wrapper.find('select[data-setting="general.filesSidebarPosition.calendar"]').exists()
    ).toBe(false)
  })

  it('offers no Files-sidebar gear in app-menu-only mode (nothing to arrange)', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('[data-toggle="general.filesSidebarPosition"]').exists()).toBe(false)
    // The app-menu gear is always there: both modes have an entry to place.
    expect(wrapper.find('[data-toggle="general.appDrawerPosition"]').exists()).toBe(true)
  })

  it('checking an app adds it to the Files-sidebar list', async () => {
    state.doc = { general: { navigation: 'filesSidebar', filesSidebar: ['calendar'] } }

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    const contacts = wrapper.find('input[data-setting="general.filesSidebar.contacts"]')
    expect((contacts.element as HTMLInputElement).checked).toBe(false)

    await contacts.setValue(true)

    expect(state.calls).toContainEqual(['general.filesSidebar', ['calendar', 'contacts']])
  })

  it('locked setting renders disabled with the lock marker', async () => {
    state.doc = { general: { navigation: 'filesSidebar' } }
    state.locked = ['general.filesSidebar']

    const wrapper = mountSettings()
    await flushPromises()
    await expandArrangement(wrapper, 'general.filesSidebarPosition')

    const input = wrapper.find('input[data-setting="general.filesSidebar.calendar"]')
    expect(input.attributes('disabled')).toBeDefined()
    // A locked list cannot be changed at all — every app's box is read-only and
    // carries the lock icon (no repeated "read-only" paragraph).
    expect(
      wrapper.find('input[data-setting="general.filesSidebar.tasks"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.findAll('[aria-label="Set by your administrator."]').length).toBeGreaterThan(0)
    expect(wrapper.text()).not.toContain('Settings marked as read-only')
  })

  it('admin-disabled app renders disabled with hint', async () => {
    state.admin = { enabledApps: ['calendar', 'contacts'] }

    const wrapper = mountSettings()
    await flushPromises()

    const tasks = wrapper.find('input[data-setting="general.enabledApps.tasks"]')
    expect(tasks.attributes('disabled')).toBeDefined()
    expect((tasks.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('Disabled by your administrator.')
  })

  it('hiding an app writes the remaining list', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    await wrapper.find('input[data-setting="general.enabledApps.contacts"]').setValue(false)

    expect(state.calls).toContainEqual(['general.enabledApps', ['calendar', 'tasks']])
  })

  it('keeps the last enabled app checked and explained', async () => {
    state.doc = { general: { enabledApps: ['calendar'] } }

    const wrapper = mountSettings()
    await flushPromises()

    const calendar = wrapper.find('input[data-setting="general.enabledApps.calendar"]')
    expect(calendar.attributes('disabled')).toBeDefined()
    expect((calendar.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('At least one app must remain enabled.')
  })

  it('shows a save failure instead of swallowing it', async () => {
    state.error = 'PROPPATCH of user settings failed: 500'

    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('Your settings could not be saved.')
  })

  it('puts the moved tools cards into the Data tab', async () => {
    requestSettingsTab('data')

    const wrapper = mountSettings()
    await flushPromises()

    const panel = wrapper.find('[role="tabpanel"]')
    const groups = panel.findAll('.settings-section')
    expect(groups.map((group) => group.find('h2').text())).toEqual([
      'Calendars & address books',
      'Import & export',
      'Backup & restore',
      'Clean up'
    ])

    const importGroup = groups[1]
    expect(importGroup.find('calendar-tools-card-stub').exists()).toBe(true)
    expect(importGroup.find('contacts-tools-card-stub').exists()).toBe(true)
    expect(importGroup.find('contacts-csv-card-stub').exists()).toBe(true)
    expect(groups[0].find('collections-card-stub').exists()).toBe(true)
  })

  it('collapses the whole Clean up group', async () => {
    requestSettingsTab('data')

    const wrapper = mountSettings()
    await flushPromises()

    const cleanUp = wrapper.findAll('details.settings-section')
    expect(cleanUp).toHaveLength(1)
    expect(cleanUp[0].find('summary').text()).toContain('Clean up')
    expect(cleanUp[0].attributes('open')).toBeUndefined()
    expect(cleanUp[0].find('duplicate-events-card-stub').exists()).toBe(true)
  })

  it('hosts the reminder settings in General and writes their toggle', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    const reminders = wrapper.find('.reminders-settings-stub')
    expect(reminders.exists()).toBe(true)
    // Defaults: reminders are on (see DEFAULT_SETTINGS.reminders.enabled).
    expect(reminders.attributes('data-enabled')).toBe('true')

    await reminders.trigger('click')
    expect(state.calls).toContainEqual(['reminders.enabled', false])
  })

  it('passes the admin lock of reminders.enabled to the card', async () => {
    state.locked = ['reminders.enabled']

    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('.reminders-settings-stub').attributes('data-locked')).toBe('true')
  })

  it('keeps Settings usable without a connection but gates the Data tab', async () => {
    probe.outcome.value = 'not-configured'
    requestSettingsTab('data')

    const wrapper = mountSettings()
    await flushPromises()

    // The DAV-dependent Data tab explains the missing backend…
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('is not set up yet')
    expect(wrapper.find('collections-card-stub').exists()).toBe(false)

    // …while the other tabs stay reachable.
    for (const tab of ['general', 'calendar', 'about']) {
      await wrapper.find(`[role="tab"][data-section="${tab}"]`).trigger('click')
      expect(wrapper.find('[role="tabpanel"]').attributes('data-tab'), tab).toBe(tab)
    }
  })

  it('renders the per-app settings under their tabs (no placeholders left)', async () => {
    const wrapper = mountSettings()
    await flushPromises()

    for (const [tab, stub] of [
      ['calendar', 'calendar-settings-stub'],
      ['contacts', 'contacts-settings-stub'],
      ['tasks', 'tasks-settings-stub'],
      ['devices', 'connect-devices-stub'],
      ['about', 'about-status-stub']
    ]) {
      // Each section lives behind its own tab now.
      await wrapper.find(`[role="tab"][data-section="${tab}"]`).trigger('click')
      expect(wrapper.find(stub).exists(), tab).toBe(true)
    }

    const source = readFileSync(join(process.cwd(), 'src', 'views', 'Settings.vue'), 'utf8')
    expect(source).not.toContain('<!-- slot:')
    expect(source).not.toContain('coming soon')
  })
})
