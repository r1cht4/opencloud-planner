/**
 * Navigation — three apps from one package.
 *
 * A disabled app must leave no trace: no app-drawer entry, no Files-sidebar
 * entry, no in-app nav item, and its route redirects to the first enabled app.
 * An admin-disabled app cannot be re-enabled by the user; a user may hide more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `src/index.ts` is the module under test below (route table); it pulls in the
// platform packages, which are mocked here exactly like the other specs do.
vi.mock('@opencloud-eu/web-pkg', () => ({
  defineWebApplication: (args: unknown) => args,
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() }),
  useRouter: () => ({ push: vi.fn() }),
  useModals: () => ({ dispatchModal: vi.fn(), removeModal: vi.fn() }),
  useClientService: () => ({ webdav: {} }),
  useAuthStore: () => ({ accessToken: '' }),
  useUserStore: () => ({ user: null as unknown }),
  useAbility: () => ({ can: () => false }),
  urlJoin: (...parts: string[]) => parts.join('/'),
  getLocaleFromLanguage: () => 'en'
}))
vi.mock('vue3-gettext', () => ({ useGettext: () => ({ $gettext: (text: string) => text }) }))
// The app-wide services `setup()` starts are not what this spec is about: their
// wiring is covered by `reminder-wiring.spec.ts` / `connection-probe.spec.ts`.
vi.mock('../../src/setup/connection', () => ({ startConnectionProbe: vi.fn() }))
vi.mock('../../src/setup/reminders', () => ({
  startReminderWiring: vi.fn(),
  refreshReminders: vi.fn()
}))

vi.mock('../../src/composables/useFileImportActions', () => ({
  FILE_ACTION_EXTENSION_POINT: 'global.files.context-actions',
  useFileImportActions: () => ({ actions: { value: [] as unknown[] } })
}))

/**
 * Settings the mocked store resolves. `touch()` bumps a reactive revision, so a
 * change made *after* `setup()` also reaches the route guards — that is what the
 * real store does when the DAV PROPFIND finally answers.
 */
const settingsState = vi.hoisted(() => ({
  enabledApps: ['calendar', 'contacts', 'tasks'] as string[],
  filesSidebar: ['calendar', 'contacts', 'tasks'] as string[],
  navigation: 'filesSidebar' as 'filesSidebar' | 'drawerOnly',
  defaultApp: 'calendar' as 'calendar' | 'contacts' | 'tasks',
  /**
   * Result of the store's bounded wait for the document
   * (`whenSettingsLoaded`). `null` = already loaded, so the wait resolves at
   * once; a test sets a promise it can settle to hold a navigation open.
   */
  pendingLoad: null as null | Promise<boolean>,
  /** How often the app asked the store to wait (guards only). */
  waits: 0,
  /** Set by the mock below: re-evaluate the resolved settings. */
  touch: null as null | (() => void)
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { computed, ref } = await import('vue')
  const { resolveSettings } = await import('../../src/settings/schema')
  const revision = ref(0)
  settingsState.touch = () => {
    revision.value += 1
  }
  const settings = () =>
    computed(() => {
      // The dependency: `touch()` re-resolves with the current `settingsState`.
      void revision.value
      return resolveSettings(
        {
          general: {
            enabledApps: settingsState.enabledApps,
            filesSidebar: settingsState.filesSidebar,
            navigation: settingsState.navigation,
            defaultApp: settingsState.defaultApp
          }
        },
        {}
      )
    })
  return {
    useSettings: () => ({
      settings: settings(),
      loaded: computed(() => true),
      error: computed((): null => null),
      update: vi.fn(),
      isLocked: () => false,
      reload: async (): Promise<void> => undefined
    }),
    whenSettingsLoaded: (): Promise<boolean> => {
      settingsState.waits += 1
      return settingsState.pendingLoad ?? Promise.resolve(true)
    }
  }
})

import app from '../../src/index'
import { startConnectionProbe } from '../../src/setup/connection'
import { startReminderWiring } from '../../src/setup/reminders'
import {
  APP_ID,
  APP_NAME,
  APP_ROOT_ROUTE,
  OPENCLOUD_HOME_ROUTE,
  PLANNER_ICON,
  PLANNER_TILE_COLOR,
  SETTINGS_ROUTE,
  SETTINGS_TARGET,
  APP_KEYS,
  appDrawerPriority,
  appDrawerSlot,
  appRoute,
  buildAppMenuItems,
  buildFilesSidebarItems,
  buildInAppNavItems,
  defaultAppRoute,
  effectiveDefaultApp,
  effectiveEnabledApps,
  filesSidebarApps,
  filesSidebarPriority,
  filesSidebarSlot,
  legacyToolsRedirect,
  redirectForDisabledApp,
  settingsSectionForPath
} from '../../src/navigation'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { defineComponent } from 'vue'
import { takeSettingsTab, resetPendingTab } from '../../src/settings/pendingTab'
import {
  APP_DRAWER_SLOTS,
  DEFAULT_SETTINGS,
  resolveSettings,
  type AppDrawerSlot,
  type AppKey,
  type FilesSidebarSlot,
  type Settings
} from '../../src/settings/schema'

const $gettext = (text: string) => text

/** Stands in for the lazy view components and the `/` placeholder. */
const RouterStub = defineComponent({ name: 'RouterStub', render: (): null => null })

function settingsWith(enabledApps: Settings['general']['enabledApps']): Settings {
  return resolveSettings({ general: { enabledApps } }, {})
}

/**
 * Change what the mocked store resolves — also after `setup()`, the way the real
 * store switches from the built-in defaults to the user's document.
 */
function setSettingsState(patch: {
  enabledApps?: string[]
  defaultApp?: 'calendar' | 'contacts' | 'tasks'
}): void {
  Object.assign(settingsState, patch)
  settingsState.touch?.()
}

describe('effectiveEnabledApps', () => {
  it('defaults to all three apps', () => {
    expect(effectiveEnabledApps({}, DEFAULT_SETTINGS)).toEqual(['calendar', 'contacts', 'tasks'])
  })

  it('admin-disabled apps cannot be re-enabled by the user', () => {
    const enabled = effectiveEnabledApps(
      { enabledApps: ['calendar', 'contacts'] },
      settingsWith(['calendar', 'contacts', 'tasks'])
    )

    expect(enabled).toEqual(['calendar', 'contacts'])
  })

  it('the user may hide further apps', () => {
    const enabled = effectiveEnabledApps({}, settingsWith(['calendar', 'tasks']))

    expect(enabled).toEqual(['calendar', 'tasks'])
  })

  it('never ends up empty (the app always needs one entry)', () => {
    expect(effectiveEnabledApps({ enabledApps: ['tasks'] }, settingsWith(['calendar']))).toEqual([
      'calendar'
    ])
  })
})

describe('buildAppMenuItems', () => {
  const enabled = ['calendar', 'contacts', 'tasks'] as const
  const menuItems = (settings: Settings) => buildAppMenuItems(settings, [...enabled], $gettext)

  it('single mode: exactly one entry for the whole app, opening the app root', () => {
    const items = menuItems(DEFAULT_SETTINGS)

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(`app.${APP_ID}.menuItem`)
    expect(items[0].type).toBe('appMenuItem')
    // The root redirect picks the default app — one entry, no app switcher.
    expect(items[0].path).toBe(APP_ROOT_ROUTE)
    expect(DEFAULT_SETTINGS.general.appDrawer).toBe('single')
  })

  it('single mode: carries the colour and image icon the host paints a tile with', () => {
    const [item] = menuItems(DEFAULT_SETTINGS)

    // OcApplicationIcon paints `colorPrimary` as the rounded tile and renders the
    // icon on top of it — the combination the built-in apps use.
    expect(item.color).toBe(PLANNER_TILE_COLOR)
    expect(item.icon).toEqual(PLANNER_ICON)
    expect(item.icon).toMatchObject({ src: expect.stringContaining('planner') })
    expect(item.icon).not.toHaveProperty('name')
  })

  it('labels the single entry with the brand name, untranslated', () => {
    const german = (text: string) => (text === 'Contacts' ? 'Kontakte' : text)
    const [item] = menuItems(DEFAULT_SETTINGS)

    expect(APP_NAME).toBe('Planner')
    expect(item.label()).toBe('Planner')
    // Not routed through $gettext at all: the label ignores a translator.
    expect(german(item.label())).toBe('Planner')
  })

  it('single mode stays one entry when apps are disabled', () => {
    const items = buildAppMenuItems(DEFAULT_SETTINGS, ['calendar'], $gettext)

    expect(items).toHaveLength(1)
  })

  it('individual mode: one entry per ticked app, each with its own icon and route', () => {
    const settings = resolveSettings(
      { general: { appDrawer: 'individual', appDrawerApps: ['calendar', 'tasks'] } },
      {}
    )
    const items = menuItems(settings)

    expect(items.map((item) => item.id)).toEqual([
      'app.planner.menuItem.calendar',
      'app.planner.menuItem.tasks'
    ])
    expect(items.map((item) => item.label())).toEqual(['Calendar', 'Tasks'])
    expect(items.map((item) => item.path)).toEqual(['/planner/calendar', '/planner/tasks'])
    // Named icons plus the shared tile colour: exactly how the host's own apps
    // look in the drawer (Contacts is not ticked, so it has no entry).
    expect(items.map((item) => item.icon)).toEqual(['calendar-2', 'task'])
    expect(items.every((item) => item.color === PLANNER_TILE_COLOR)).toBe(true)
    // Ordered: the host sorts by priority, first ticked app first; the default
    // slot sits right after the host's Files entry (priority 10).
    expect(items.map((item) => item.priority)).toEqual([11, 13])
  })

  it('individual mode never lists a disabled app', () => {
    const settings = resolveSettings(
      { general: { appDrawer: 'individual', appDrawerApps: ['calendar', 'contacts', 'tasks'] } },
      {}
    )
    const items = buildAppMenuItems(settings, ['calendar', 'tasks'], $gettext)

    expect(items.map((item) => item.path)).toEqual(['/planner/calendar', '/planner/tasks'])
  })

  it('falls back to one entry for an unknown mode value', () => {
    const settings = resolveSettings({ general: { appDrawer: 'bogus' } }, {})

    expect(menuItems(settings)).toHaveLength(1)
    expect(settings.general.appDrawer).toBe('single')
  })

  it('individual mode keeps the one package entry when every picked app is disabled', () => {
    // Contacts is hidden (by the user or by the admin's `enabledApps`), so the
    // intersection is empty — an empty app menu would leave the app unreachable.
    const settings = resolveSettings(
      { general: { appDrawer: 'individual', appDrawerApps: ['contacts'] } },
      {}
    )
    const items = buildAppMenuItems(settings, ['calendar', 'tasks'], $gettext)

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(`app.${APP_ID}.menuItem`)
    expect(items[0].path).toBe(APP_ROOT_ROUTE)
    expect(items[0].label()).toBe(APP_NAME)
  })
})

describe('app-menu position (general.appDrawerPosition)', () => {
  const settingsWithDrawer = (general: Record<string, unknown>): Settings =>
    resolveSettings({ general }, {})

  it('maps every slot into the gap after the host entry it belongs to', () => {
    // Host priorities: Files 10, Contacts/Mail/App Store 30, Admin Settings 40.
    const expected: Array<[AppDrawerSlot, number]> = [
      ['first', 1],
      ['afterFiles', 11],
      ['afterApps', 31],
      ['afterSettings', 41]
    ]

    for (const [slot, base] of expected) {
      const settings = settingsWithDrawer({
        appDrawerPosition: { calendar: slot, contacts: slot, tasks: slot }
      })
      // Calendar, Contacts, Tasks keep that order inside the slot.
      expect(APP_KEYS.map((key) => appDrawerPriority(settings, key))).toEqual([
        base,
        base + 1,
        base + 2
      ])
    }
  })

  it('gives the last slot no priority at all', () => {
    const settings = settingsWithDrawer({
      appDrawer: 'individual',
      appDrawerPosition: { calendar: 'last', contacts: 'last', tasks: 'last' }
    })

    // The host sorts a missing priority with Number.MAX_SAFE_INTEGER, where
    // OpenCloud's own priority-less entries are.
    expect(appDrawerPriority(settings, 'calendar')).toBeUndefined()
    const items = buildAppMenuItems(settings, [...APP_KEYS], $gettext)
    expect(items.map((item) => item.priority)).toEqual([undefined, undefined, undefined])
  })

  it('applies the position per app, so mixed slots interleave with the host entries', () => {
    const settings = settingsWithDrawer({
      appDrawer: 'individual',
      appDrawerPosition: { calendar: 'first', contacts: 'afterSettings', tasks: 'afterApps' }
    })

    const items = buildAppMenuItems(settings, [...APP_KEYS], $gettext)
    // Sorted the way the host renders the drawer (ascending priority).
    const sorted = [...items].sort(
      (a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
    )
    expect(sorted.map((item) => item.id.split('.').pop())).toEqual([
      'calendar',
      'tasks',
      'contacts'
    ])
    expect(sorted.map((item) => item.priority)).toEqual([1, 33, 42])
  })

  it('falls back to the slot after Files for an unknown value', () => {
    const settings = settingsWithDrawer({ appDrawerPosition: { calendar: 'bogus' } })

    expect(appDrawerSlot(settings, 'calendar')).toBe('afterFiles')
    expect(appDrawerPriority(settings, 'calendar')).toBe(11)
  })

  it('offers every slot of the switcher, first to last', () => {
    expect(APP_DRAWER_SLOTS).toEqual(['first', 'afterFiles', 'afterApps', 'afterSettings', 'last'])
  })

  it('single mode takes the slot of the default app (the one that entry opens)', () => {
    const afterSettings = settingsWithDrawer({
      defaultApp: 'contacts',
      appDrawerPosition: { calendar: 'first', contacts: 'afterSettings', tasks: 'first' }
    })
    expect(buildAppMenuItems(afterSettings, [...APP_KEYS], $gettext)[0].priority).toBe(42)

    const last = settingsWithDrawer({
      defaultApp: 'contacts',
      appDrawerPosition: { contacts: 'last' }
    })
    expect(buildAppMenuItems(last, [...APP_KEYS], $gettext)[0].priority).toBeUndefined()
  })

  it('a locked position keeps the admin slot (user value is ignored)', () => {
    const settings = resolveSettings(
      { general: { appDrawerPosition: { calendar: 'first' } } },
      {
        defaults: { general: { appDrawerPosition: { calendar: 'afterSettings' } } },
        locked: ['general.appDrawerPosition']
      }
    )

    expect(appDrawerSlot(settings, 'calendar')).toBe('afterSettings')
    expect(appDrawerPriority(settings, 'calendar')).toBe(41)
  })

  it('single mode uses the slot of the app it opens, not of a disabled default app', () => {
    const settings = resolveSettings(
      {
        general: {
          defaultApp: 'contacts',
          appDrawerPosition: { calendar: 'first', contacts: 'afterApps', tasks: 'afterSettings' }
        }
      },
      {}
    )
    const enabled: AppKey[] = ['calendar', 'tasks']

    const [entry] = buildAppMenuItems(settings, enabled, $gettext)

    // Contacts is disabled, so the entry opens Calendar — and takes Calendar's
    // slot: the same app the Settings row positions (`effectiveDefaultApp`).
    expect(effectiveDefaultApp(enabled, 'contacts')).toBe('calendar')
    expect(entry.priority).toBe(appDrawerPriority(settings, 'calendar'))
    expect(entry.priority).toBe(1)
  })
})

describe('buildFilesSidebarItems', () => {
  const all = ['calendar', 'contacts', 'tasks'] as const
  const filesItems = (settings: Settings) => buildFilesSidebarItems([...all], settings, $gettext)

  it('registers on the Files nav extension point, positioned after Spaces by default', () => {
    const items = filesItems(DEFAULT_SETTINGS)

    expect(items).toHaveLength(3)
    expect(items.every((item) => item.type === 'sidebarNav')).toBe(true)
    expect(items.every((item) => item.extensionPointIds?.join() === 'app.files.navItems')).toBe(
      true
    )
    // Host priorities: Personal 10, Favorites 20, Shares 30, Spaces 40, Deleted 50.
    expect(items.map((item) => item.navItem.priority)).toEqual([41, 42, 43])
    expect(items.map((item) => item.navItem.route?.path)).toEqual([
      '/planner/calendar',
      '/planner/contacts',
      '/planner/tasks'
    ])
  })

  it('maps every slot to the gap after the host entry it belongs to', () => {
    // The same slot keeps Calendar < Contacts < Tasks, and the next host entry
    // (priority + 10) is never crossed.
    const cases: [FilesSidebarSlot, number[]][] = [
      ['personal', [11, 12, 13]],
      ['favorites', [21, 22, 23]],
      ['shares', [31, 32, 33]],
      ['spaces', [41, 42, 43]],
      ['deleted', [51, 52, 53]]
    ]

    for (const [slot, priorities] of cases) {
      const settings = resolveSettings(
        {
          general: {
            navigation: 'filesSidebar',
            filesSidebarPosition: { calendar: slot, contacts: slot, tasks: slot }
          }
        },
        {}
      )

      expect(
        filesItems(settings).map((item) => item.navItem.priority),
        slot
      ).toEqual(priorities)
    }
  })

  it('applies the position per app (mixed slots interleave with the host entries)', () => {
    const settings = resolveSettings(
      {
        general: {
          navigation: 'filesSidebar',
          filesSidebarPosition: { calendar: 'personal', contacts: 'spaces', tasks: 'deleted' }
        }
      },
      {}
    )
    const byApp = Object.fromEntries(
      filesItems(settings).map((item) => [item.id.split('.').pop(), item.navItem.priority])
    )

    expect(byApp).toEqual({ calendar: 11, contacts: 42, tasks: 53 })
    // Sorted the way the host renders it (ascending priority).
    expect(filesItems(settings).map((item) => item.navItem.priority)).toEqual([11, 42, 53])
  })

  it('files sidebar shows only apps listed in general.filesSidebar', () => {
    const settings = resolveSettings(
      { general: { navigation: 'filesSidebar', filesSidebar: ['calendar'] } },
      {}
    )
    const items = filesItems(settings)

    const visible = items
      .filter((item) => item.navItem.isVisible?.())
      .map((item) => item.id.split('.').pop())

    expect(visible).toEqual(['calendar'])
    // A hidden app is not registered *and* not visible: both filters agree.
    expect(items).toHaveLength(3)
  })

  it('nothing is visible in the app-menu-only navigation mode', () => {
    const settings = resolveSettings(
      { general: { navigation: 'drawerOnly', filesSidebar: ['calendar', 'contacts', 'tasks'] } },
      {}
    )

    expect(filesItems(settings).every((item) => item.navItem.isVisible?.() === false)).toBe(true)
  })

  it('an empty general.filesSidebar hides every entry', () => {
    const settings = resolveSettings(
      { general: { navigation: 'filesSidebar', filesSidebar: [] } },
      {}
    )

    expect(filesItems(settings).every((item) => item.navItem.isVisible?.() === false)).toBe(true)
  })

  it('files sidebar entries stay hidden until the settings are loaded (logo must open Files)', () => {
    let ready = false
    const settings = resolveSettings({ general: { navigation: 'filesSidebar' } }, {})
    const items = buildFilesSidebarItems(['calendar'], settings, $gettext, () => ready)

    expect(items[0].navItem.isVisible?.()).toBe(false)
    ready = true
    expect(items[0].navItem.isVisible?.()).toBe(true)
  })

  it('admin-disabled app never appears in the Files sidebar even if listed', () => {
    // 'tasks' is admin-disabled but still listed in the (stale) document.
    const items = buildFilesSidebarItems(['calendar', 'contacts'], DEFAULT_SETTINGS, $gettext)

    expect(items.map((item) => item.id.split('.').pop())).toEqual(['calendar', 'contacts'])
    expect(items.some((item) => item.id.endsWith('tasks'))).toBe(false)
  })

  it('a locked position keeps the admin slot (user value is ignored)', () => {
    const settings = resolveSettings(
      { general: { filesSidebarPosition: { calendar: 'personal' } } },
      {
        defaults: { general: { filesSidebarPosition: { calendar: 'deleted' } } },
        locked: ['general.filesSidebarPosition']
      }
    )

    expect(filesSidebarPriority(settings, 'calendar')).toBe(51)
    expect(filesSidebarSlot(settings, 'calendar')).toBe('deleted')
  })
})

describe('buildInAppNavItems', () => {
  it('puts "Back to OpenCloud" above the apps, on every page', () => {
    const items = buildInAppNavItems(['calendar', 'tasks'], $gettext)
    const [home] = items

    expect(items.map((item) => item.name)).toEqual(['Back to OpenCloud', 'Calendar', 'Tasks'])
    expect(home.icon).toBe('arrow-left-s')
    // Sorted first by the host (ascending priority, apps have none).
    expect(home.priority).toBe(1)
    // No route-dependent visibility: the entry is there on Calendar, Contacts,
    // Tasks and Settings alike (there is no `isVisible` at all any more).
    expect(home.isVisible).toBeUndefined()
  })

  it('leads back to the OpenCloud start page (the Files app), not to an app', () => {
    const [home] = buildInAppNavItems(['calendar'], $gettext)

    expect(OPENCLOUD_HOME_ROUTE).toBe('/files/spaces/personal')
    expect(home.route).toEqual({ path: '/files/spaces/personal' })
    // A space *alias*, never a user id.
    expect(home.route?.path).not.toContain('@')
    expect(home.route?.path).not.toMatch(/\d{3,}/)
  })

  it('is never rendered as the active page', () => {
    const [home] = buildInAppNavItems(['calendar', 'contacts', 'tasks'], $gettext)

    // The host marks an item active when the current route starts with its own
    // route; this entry points into another app, so it must opt out explicitly.
    expect(home.isActive?.()).toBe(false)
    expect(home.activeFor).toBeUndefined()
  })

  it('lists the enabled apps with their own active-for entries', () => {
    const items = buildInAppNavItems(['calendar', 'tasks'], $gettext)
    const apps = items.slice(1)

    expect(apps.map((item) => item.name)).toEqual(['Calendar', 'Tasks'])
    expect(apps[0].activeFor).toEqual([{ path: '/planner/calendar' }])
    expect(items.some((item) => item.name === 'Contacts')).toBe(false)
  })

  it('keeps the per-app name icons (only the package itself is branded)', () => {
    const items = buildInAppNavItems(['calendar', 'contacts', 'tasks'], $gettext)

    // Plain names from the host icon set — not the Planner image icon.
    expect(items.slice(1).map((item) => item.icon)).toEqual(['calendar-2', 'contacts-book', 'task'])
    expect(items[0].icon).toBe('arrow-left-s')
  })
})

describe('routes', () => {
  it('builds app routes from the app id', () => {
    expect(appRoute('tasks')).toBe('/planner/tasks')
    expect(SETTINGS_ROUTE).toBe('/planner/settings')
  })

  it('disabled route redirects to first enabled', () => {
    expect(redirectForDisabledApp(['calendar', 'contacts'], 'tasks')).toBe('/planner/calendar')
    expect(redirectForDisabledApp(['contacts', 'tasks'], 'calendar')).toBe('/planner/contacts')
  })

  it('enabled routes are not redirected', () => {
    expect(redirectForDisabledApp(['calendar', 'contacts', 'tasks'], 'contacts')).toBeNull()
  })

  it('the default app is used when it is enabled, else the first enabled app', () => {
    expect(defaultAppRoute(['calendar', 'contacts', 'tasks'], 'tasks')).toBe('/planner/tasks')
    // Default app disabled (or admin-removed): first enabled app.
    expect(defaultAppRoute(['calendar', 'contacts'], 'tasks')).toBe('/planner/calendar')
    expect(defaultAppRoute(['contacts', 'tasks'], 'tasks')).toBe('/planner/tasks')
    // No preference, nothing enabled.
    expect(defaultAppRoute(['calendar'])).toBe('/planner/calendar')
    expect(defaultAppRoute([])).toBe('/planner/calendar')
    expect(defaultAppRoute(['tasks'], null)).toBe('/planner/tasks')
  })

  it('a disabled route redirects to the default app', () => {
    expect(redirectForDisabledApp(['calendar', 'tasks'], 'contacts', 'tasks')).toBe(
      '/planner/tasks'
    )
    expect(redirectForDisabledApp(['calendar', 'tasks'], 'contacts', 'contacts')).toBe(
      '/planner/calendar'
    )
  })

  it('one rule decides the default app (redirect, app menu and its Settings row)', () => {
    expect(effectiveDefaultApp(['calendar', 'contacts', 'tasks'], 'tasks')).toBe('tasks')
    expect(effectiveDefaultApp(['calendar', 'tasks'], 'contacts')).toBe('calendar')
    expect(effectiveDefaultApp(['tasks', 'calendar'], 'contacts')).toBe('calendar')
    expect(effectiveDefaultApp([], 'tasks')).toBe('calendar')
    // The redirect is that key's route — never a second implementation of the rule.
    expect(defaultAppRoute(['calendar', 'tasks'], 'contacts')).toBe(
      appRoute(effectiveDefaultApp(['calendar', 'tasks'], 'contacts'))
    )
  })

  it('files sidebar apps follow the navigation mode', () => {
    const filesSidebar = resolveSettings(
      { general: { navigation: 'filesSidebar', filesSidebar: ['calendar', 'tasks'] } },
      {}
    )
    const drawerOnly = resolveSettings({ general: { navigation: 'drawerOnly' } }, {})

    expect(filesSidebarApps(filesSidebar)).toEqual(['calendar', 'tasks'])
    expect(filesSidebarApps(drawerOnly)).toEqual([])
    // Nothing loaded yet: no Files entries.
    expect(filesSidebarApps(null)).toEqual([])
    // A document written before `general.navigation` existed still means
    // "show these apps in the Files sidebar" (`resolveSettings` restores it).
    expect(
      filesSidebarApps(resolveSettings({ general: { filesSidebar: ['calendar'] } }, {}))
    ).toEqual(['calendar'])

    // An empty list is a valid choice ("none of the apps there").
    expect(
      filesSidebarApps(
        resolveSettings({ general: { navigation: 'filesSidebar', filesSidebar: [] } }, {})
      )
    ).toEqual([])
  })

  it('the gear target is the plain settings path — no hash, no query', () => {
    expect(SETTINGS_TARGET).toEqual({ path: SETTINGS_ROUTE })
    expect(SETTINGS_TARGET).not.toHaveProperty('hash')
    expect(SETTINGS_TARGET).not.toHaveProperty('query')
  })

  it('/manage requests the Data tab and redirects to the plain settings path', () => {
    resetPendingTab()
    expect(legacyToolsRedirect()).toBe('/planner/settings')
    expect(takeSettingsTab()).toBe('data')
    // Taken once: the next visit is a plain one.
    expect(takeSettingsTab()).toBeNull()
  })

  it('settingsSectionForPath maps an app page to its tab, everything else to General', () => {
    expect(settingsSectionForPath('/planner/calendar')).toBe('calendar')
    expect(settingsSectionForPath('/planner/contacts')).toBe('contacts')
    expect(settingsSectionForPath('/planner/tasks')).toBe('tasks')

    // A birthdays page (if one lands) opens Settings → Contacts → Birthdays.
    expect(settingsSectionForPath('/planner/birthdays')).toBe('contacts')
    expect(settingsSectionForPath('/planner/birthdays/2026')).toBe('contacts')
    expect(settingsSectionForPath('/files/spaces/personal')).toBe('general')
    expect(settingsSectionForPath('')).toBe('general')
    expect(settingsSectionForPath(undefined)).toBe('general')
  })
})

describe('route table (src/index.ts)', () => {
  const setupApp = (config: Record<string, unknown> = {}) =>
    (app as unknown as { setup: (args: unknown) => any }).setup({
      applicationConfig: config
    })

  beforeEach(() => {
    settingsState.pendingLoad = null
    settingsState.waits = 0
    settingsState.defaultApp = 'calendar'
    settingsState.enabledApps = ['calendar', 'contacts', 'tasks']
  })

  it('reads the admin config from applicationConfig itself (the apps.yaml config block)', async () => {
    const { getAdminConfig } = await import('../../src/config/appConfig')
    setupApp({ enabledApps: ['calendar', 'tasks'], locked: ['general.filesSidebar'] })
    expect(getAdminConfig().enabledApps).toEqual(['calendar', 'tasks'])
    expect(getAdminConfig().locked).toEqual(['general.filesSidebar'])
  })

  it('registers one route per app, the settings page and the legacy tools redirect', () => {
    const result = setupApp()
    const paths = result.routes.map((route: any) => route.path)

    expect(paths).toEqual(['/', '/calendar', '/contacts', '/tasks', '/settings', '/manage'])

    resetPendingTab()
    const manage = result.routes.find((route: any) => route.path === '/manage')
    // The tab is handed over in memory; the URL stays the plain settings path.
    expect(manage.redirect()).toBe('/planner/settings')
    expect(takeSettingsTab()).toBe('data')

    const settings = result.routes.find((route: any) => route.path === '/settings')
    expect(settings.name).toBe('settings')
    expect(settings.meta.authContext).toBe('user')
  })

  it('the root target follows the default app setting', async () => {
    const root = () => setupApp().routes.find((route: any) => route.path === '/')
    // The `/` record redirects through its `beforeEnter` guard (see the waiting
    // test below) — the router calls it with no arguments and uses the return
    // value as the new location.
    const target = (route: any) => route.beforeEnter()

    expect(await target(root())).toBe('/planner/calendar')

    settingsState.defaultApp = 'tasks'
    expect(await target(root())).toBe('/planner/tasks')

    // Default app no longer enabled → the first enabled app.
    settingsState.defaultApp = 'contacts'
    settingsState.enabledApps = ['calendar', 'tasks']
    expect(await target(root())).toBe('/planner/calendar')

    settingsState.defaultApp = 'calendar'
    settingsState.enabledApps = ['calendar', 'contacts', 'tasks']
  })

  it('the root target waits for the stored settings document (fresh load)', async () => {
    // A fresh load: `setup()` runs before the token exists and the document is
    // read, so the store still resolves the built-in default app (Calendar).
    setSettingsState({ defaultApp: 'calendar' })
    let arrive: (loaded: boolean) => void = () => undefined
    settingsState.pendingLoad = new Promise<boolean>((resolve) => {
      arrive = resolve
    })

    const root = setupApp().routes.find((route: any) => route.path === '/')
    let settled = false
    const navigation = root.beforeEnter().then((target: string) => {
      settled = true
      return target
    })

    // The navigation is waiting for the document instead of opening Calendar…
    await Promise.resolve()
    expect(settled).toBe(false)

    // …which arrives with the user's choice (Tasks) while it waits.
    setSettingsState({ defaultApp: 'tasks' })
    arrive(true)

    await expect(navigation).resolves.toBe('/planner/tasks')

    // Nothing arrived in time (signed out, unreachable server): the navigation
    // still completes and uses what the store has instead of hanging.
    setSettingsState({ defaultApp: 'calendar' })
    settingsState.pendingLoad = Promise.resolve(false)
    await expect(root.beforeEnter()).resolves.toBe('/planner/calendar')
  })

  it('the in-app sidebar always leads back to the OpenCloud start page first', () => {
    // The entry is built once, at setup — no route state, no afterEach hook, so it
    // is present on Calendar, Contacts, Tasks and Settings alike.
    const nav = setupApp().navItems as any[]

    expect(nav.map((item) => item.name)).toEqual([
      'Back to OpenCloud',
      'Calendar',
      'Contacts',
      'Tasks'
    ])
    expect(nav[0].icon).toBe('arrow-left-s')
    expect(nav[0].route).toEqual({ path: '/files/spaces/personal' })
    expect(nav[0].isActive()).toBe(false)
  })

  it('starts the connection probe and the reminder engine at setup', () => {
    setupApp()

    expect(startConnectionProbe).toHaveBeenCalled()
    expect(startReminderWiring).toHaveBeenCalled()

    const call = (startReminderWiring as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    const options = call[0] as Record<string, unknown>
    const enabled = call[1] as { value: boolean }

    // The engine follows the resolved setting (default: on)…
    expect(enabled.value).toBe(true)
    expect((options.isEnabled as () => boolean)()).toBe(true)
    // …reads the task reminder default lazily…
    expect(typeof options.taskDefaultReminderMinutes).toBe('function')
    // …and never navigates with a full page reload.
    expect(typeof options.openItem).toBe('function')
    expect(typeof options.showMessage).toBe('function')
    expect(options.services).toBeTruthy()
  })

  it('declares exactly one app-menu entry and the Files sidebar items', () => {
    const result = setupApp()
    const extensions = result.extensions.value as any[]

    const menuItems = extensions.filter((extension) => extension.type === 'appMenuItem')
    expect(menuItems.map((item) => item.id)).toEqual(['app.planner.menuItem'])
    expect(menuItems[0].label()).toBe('Planner')
    expect(menuItems[0].path).toBe('/planner/')
    // The drawer entry and the app info show the same image icon, painted on the
    // shared tile colour, so the entry looks like the host's own entries.
    expect(menuItems[0].icon).toEqual(PLANNER_ICON)
    expect(menuItems[0].color).toBe(PLANNER_TILE_COLOR)
    expect(result.appInfo.icon).toEqual(PLANNER_ICON)

    const filesNav = extensions.filter((extension) => extension.type === 'sidebarNav')
    expect(filesNav).toHaveLength(3)
    expect(filesNav.every((item) => item.extensionPointIds[0] === 'app.files.navItems')).toBe(true)

    // Hidden until the host has mounted: the host picks the home route (logo) from the
    // first visible Files nav item at startup, and that must not be ours.
    expect(filesNav.some((item) => item.navItem.isVisible())).toBe(false)
    result.mounted()
    expect(filesNav.every((item) => item.navItem.isVisible())).toBe(true)

    // The Files sidebar follows the per-app list, without re-registering extensions.
    settingsState.filesSidebar = ['contacts']
    const toggled = setupApp()
    toggled.mounted()
    const afterToggle = toggled.extensions.value as any[]
    const filesNavAfterToggle = afterToggle.filter((extension) => extension.type === 'sidebarNav')
    expect(
      filesNavAfterToggle
        .filter((extension) => extension.navItem.isVisible())
        .map((extension) => extension.id.split('.').pop())
    ).toEqual(['contacts'])

    // …and the navigation mode: `drawerOnly` hides them all (the app menu entry
    // stays, it is not part of this list).
    settingsState.navigation = 'drawerOnly'
    const drawerOnly = setupApp()
    drawerOnly.mounted()
    const drawerNav = (drawerOnly.extensions.value as any[]).filter(
      (extension) => extension.type === 'sidebarNav'
    )
    expect(drawerNav.some((extension) => extension.navItem.isVisible())).toBe(false)
    expect(
      (drawerOnly.extensions.value as any[]).filter((extension) => extension.type === 'appMenuItem')
    ).toHaveLength(1)

    settingsState.filesSidebar = ['calendar', 'contacts', 'tasks']
    settingsState.navigation = 'filesSidebar'
  })

  it('a real router opens the stored default app for /, not the built-in one', async () => {
    // End-to-end shape of the fix, with the router the host uses: the guards only
    // run on a *matchable* record, so `/` must keep a component the guard always
    // redirects away from. A record with nothing but `beforeEnter` is skipped by
    // the matcher and the entry would silently do nothing.
    let arrive: (loaded: boolean) => void = () => undefined
    settingsState.pendingLoad = new Promise<boolean>((resolve) => {
      arrive = resolve
    })

    const routes = (setupApp().routes as any[]).map((route) => ({
      ...route,
      // The host prefixes every route with the app id; the index route has no
      // trailing slash (the router still matches `/planner/`).
      path: route.path === '/' ? `/${APP_ID}` : `/${APP_ID}${route.path}`,
      // The views are lazy imports and this test never renders one.
      ...(typeof route.component === 'function' ? { component: RouterStub } : {})
    }))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: routes as unknown as RouteRecordRaw[]
    })

    const navigation = router.push(APP_ROOT_ROUTE)
    // The navigation waits for the document instead of opening Calendar…
    for (let i = 0; i < 50 && settingsState.waits === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(settingsState.waits).toBe(1)

    // …which arrives with the user's choice: Tasks.
    setSettingsState({ defaultApp: 'tasks' })
    arrive(true)
    await navigation

    expect(router.currentRoute.value.path).toBe('/planner/tasks')
  })

  it('admin-disabled apps get no route target (guard redirects)', async () => {
    const result = setupApp({ enabledApps: ['calendar', 'contacts'] })
    const tasks = result.routes.find((route: any) => route.path === '/tasks')

    await expect(tasks.beforeEnter()).resolves.toBe('/planner/calendar')
    const calendar = result.routes.find((route: any) => route.path === '/calendar')
    await expect(calendar.beforeEnter()).resolves.toBe(true)
  })

  it('the app guards wait for the stored document before deciding', async () => {
    // The document has not arrived yet, so every app still looks enabled.
    let arrive: (loaded: boolean) => void = () => undefined
    settingsState.pendingLoad = new Promise<boolean>((resolve) => {
      arrive = resolve
    })
    const result = setupApp()
    const calendar = result.routes.find((route: any) => route.path === '/calendar')

    const guard = calendar.beforeEnter()
    // The document arrives and leaves Tasks as the only enabled app: Calendar is
    // disabled, so the guard must redirect — not let the view through.
    setSettingsState({ enabledApps: ['tasks'] })
    arrive(true)

    await expect(guard).resolves.toBe('/planner/tasks')
  })
})
