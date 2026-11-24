import { type RouteRecordRaw } from 'vue-router'
import { computed, defineComponent, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import {
  defineWebApplication,
  useMessages,
  useRouter,
  type ActionExtension,
  type ApplicationSetupOptions,
  type Extension
} from '@opencloud-eu/web-pkg'
import { getAdminConfig, setAdminConfig } from './config/appConfig'
import { useSettings, whenSettingsLoaded } from './settings/settingsStore'
import { useCalendarService } from './composables/useCalendarService'
import { useTasksService } from './composables/useTasksService'
import { startConnectionProbe } from './setup/connection'
import { startReminderWiring } from './setup/reminders'
import {
  APP_ID,
  APP_NAME,
  PLANNER_ICON,
  PLANNER_TILE_COLOR,
  appRoute,
  buildAppMenuItems,
  buildFilesSidebarItems,
  buildInAppNavItems,
  defaultAppRoute,
  effectiveEnabledApps,
  legacyToolsRedirect,
  redirectForDisabledApp
} from './navigation'
import {
  FILE_ACTION_EXTENSION_POINT,
  useFileImportActions
} from './composables/useFileImportActions'
// The compiled gettext catalog (l10n:compile). JSON keys must keep the shape
// of `ApplicationTranslations` (string, or [singular, plural] for $ngettext).
import translations from '../l10n/translations.json'
import './styles/sidebar.css'
import { useFormatLocale } from './settings/formatLocale'

/**
 * Placeholder component of the `/` route: its `beforeEnter` guard returns the app
 * to open, so this is never rendered. A record needs a component (or a
 * `redirect`) to be a matchable route at all — without one the router skips the
 * record and its guard never runs.
 */
const startRedirect = defineComponent({
  name: 'PlannerStartRedirect',
  render: (): null => null
})

export default defineWebApplication({
  setup(args: ApplicationSetupOptions) {
    const { $gettext } = useGettext()
    const appId = APP_ID

    // Admin defaults, locks and DAV URLs. The host hands over the app's `config` block
    // from `apps.yaml` itself as `applicationConfig` (like the official extensions read
    // it, e.g. maps' `applicationConfig.folderViewEnabled`) — not wrapped in `.config`.
    setAdminConfig(args.applicationConfig)

    // Synced personal settings (one PROPFIND per session, then debounced saves).
    const { settings, loaded: settingsLoaded } = useSettings()

    // The host fixes the target of `/` (the OpenCloud logo) once, before it mounts, from
    // the first visible `app.files.navItems` entry it knows — and our extensions are
    // registered before the Files app's own. Keep ours hidden until `mounted`.
    const hostMounted = ref(false)

    // ── App-wide services ───────────────────────────────────────────────────
    // Everything below is captured **here**, at setup time: composables must
    // never be created from a watcher, timer or click handler (doing so once
    // broke the Files app).

    // "Is the DAV backend there?" — the views render SetupState through
    // ConnectionGate while it is not.
    startConnectionProbe()

    const { showMessage } = useMessages()
    const router = useRouter()

    // Marks Planner pages on <html> so styles/sidebar.css can turn the first sidebar
    // entry ("Back to OpenCloud") into an icon-only row without touching other apps.
    router?.afterEach?.((to) => {
      document.documentElement.classList.toggle('planner-app', to.path.startsWith(`/${appId}/`))
    })

    // The reminder engine reads calendars/tasks; the services (and their refs)
    // are created once and passed on, so a later restart after a settings toggle
    // does not instantiate composables outside setup.
    const calendarService = useCalendarService()
    const tasksService = useTasksService()

    /**
     * Open an item from a reminder: focus the tab and navigate to the owning page
     * without a full reload, so the page's `?open=<href>` handler can jump to the
     * date/task and open the dialog.
     */
    function openReminderItem(href: string, kind: 'event' | 'task'): void {
      if (typeof window !== 'undefined') window.focus()
      const path = appRoute(kind === 'task' ? 'tasks' : 'calendar')
      try {
        // Path-based navigation: the host registers our routes, so a name-based
        // push finds no match (see `navigation.ts`).
        void Promise.resolve(router?.push({ path, query: { open: href } })).catch((err) => {
          console.warn('[planner] opening the reminder item failed:', err)
        })
      } catch (err) {
        console.warn('[planner] opening the reminder item failed:', err)
      }
    }

    const formatLocale = useFormatLocale()
    startReminderWiring(
      {
        isEnabled: () => settings.value.reminders.enabled,
        services: { calendarService, tasksService },
        showMessage: (message) => showMessage(message),
        openItem: openReminderItem,
        taskDefaultReminderMinutes: () => settings.value.tasks.defaultReminder,
        getLocale: () => formatLocale.value
      },
      computed(() => settings.value.reminders.enabled)
    )

    /**
     * Effective apps = admin `enabledApps` ∩ user `general.enabledApps`. Reactive:
     * the drawer and Files entries follow the settings as soon as they are loaded.
     */
    const enabledApps = computed(() => effectiveEnabledApps(getAdminConfig(), settings.value))

    const appInfo = {
      id: appId,
      // Brand name — the same in every language (never translated).
      name: APP_NAME,
      // Image icon (white Planner glyph) plus the tile colour the app menu paints
      // behind it — the same combination the built-in apps use (see `brandIcon.ts`).
      icon: PLANNER_ICON,
      color: PLANNER_TILE_COLOR
    }

    /**
     * Wait (briefly) for the user's settings document before a route decides
     * where to go.
     *
     * `setup()` runs before the host has the access token and the document is
     * read with one DAV PROPFIND, so for a moment `settings.value` only holds the
     * built-in/admin values — the default app in there is not the user's choice.
     * The wait is bounded (`whenSettingsLoaded`): a signed-out tab or an
     * unreachable server navigates with the current values instead of hanging.
     *
     * Every guard below waits first, so a fresh load decides with the user's own
     * settings; a disabled app then redirects to the default app
     * instead of rendering a view the user switched off.
     */
    const guardFor = (key: 'calendar' | 'contacts' | 'tasks') => async () => {
      await whenSettingsLoaded()
      return (
        redirectForDisabledApp(enabledApps.value, key, settings.value.general.defaultApp) ?? true
      )
    }

    const routes: RouteRecordRaw[] = [
      {
        // The single app-menu entry points here: open the user's default app.
        //
        // A `beforeEnter` guard, not a `redirect`: the router resolves a redirect
        // synchronously, before the stored settings could arrive, so `/` would
        // always open the built-in default app (see `guardFor`). The guard always
        // returns a path, so `startRedirect` is never rendered — it only exists
        // because a record without a component (or `redirect`) is not a matchable
        // route at all, and its guard would never run.
        path: '/',
        component: startRedirect,
        beforeEnter: async () => {
          await whenSettingsLoaded()
          return defaultAppRoute(enabledApps.value, settings.value.general.defaultApp)
        }
      },
      {
        path: '/calendar',
        name: 'calendar',
        component: () => import('./views/Calendar.vue'),
        beforeEnter: guardFor('calendar'),
        meta: {
          authContext: 'user',
          title: $gettext('Calendar')
        }
      },
      {
        path: '/contacts',
        name: 'contacts',
        component: () => import('./views/Contacts.vue'),
        beforeEnter: guardFor('contacts'),
        meta: {
          authContext: 'user',
          title: $gettext('Contacts')
        }
      },
      {
        path: '/tasks',
        name: 'tasks',
        component: () => import('./views/Tasks.vue'),
        beforeEnter: guardFor('tasks'),
        meta: {
          authContext: 'user',
          title: $gettext('Tasks')
        }
      },
      {
        // Settings is opened from the ⚙ button in every page header, not from the
        // sidebar (`navItems` below). The wanted tab is handed over in memory
        // (`settings/pendingTab.ts`) — the URL is always the plain path.
        path: '/settings',
        name: 'settings',
        component: () => import('./views/Settings.vue'),
        meta: {
          authContext: 'user',
          title: $gettext('Settings')
        }
      },
      {
        // The Tools page became the Data tab of Settings (`legacyToolsRedirect`
        // requests that tab before sending the user to the plain Settings path).
        path: '/manage',
        redirect: legacyToolsRedirect
      }
    ]

    // In-app sidebar: "Back to OpenCloud" on every page, then the enabled apps.
    const navItems = buildInAppNavItems(enabledApps.value, $gettext)

    // Files app integration actions (file context menu). Registered on the
    // `global.files.context-actions` extension point below.
    const { actions: fileImportActions } = useFileImportActions()

    const extensions = computed<Extension[]>(() => {
      const enabled = enabledApps.value

      // App menu: one entry for the package (default) or one per ticked app.
      const menuItems = buildAppMenuItems(settings.value, enabled, $gettext)

      // Files app sidebar: only in the `filesSidebar` navigation mode, and then
      // only the apps the user put there (`general.filesSidebar` is a list).
      const filesNavItems = buildFilesSidebarItems(
        enabled,
        settings.value,
        $gettext,
        () => hostMounted.value && settingsLoaded.value
      )

      // Files app integration: "Import into calendar" / "Import into contacts"
      // in the file context menu for a single .ics / .vcf resource.
      const fileActionExtensions: ActionExtension[] = fileImportActions.value.map((action) => ({
        id: `app.${appId}.action.${action.name}`,
        type: 'action',
        extensionPointIds: [FILE_ACTION_EXTENSION_POINT],
        action
      }))

      return [...menuItems, ...filesNavItems, ...fileActionExtensions]
    })

    return {
      appInfo,
      navItems,
      routes,
      extensions,
      translations,
      mounted: () => {
        hostMounted.value = true
      }
    }
  }
})
