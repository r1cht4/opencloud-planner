/**
 * Navigation — one app ("Planner") with three views.
 *
 * Everything here is derived from the *effective* enabled apps
 * (admin `enabledApps` ∩ user `general.enabledApps`): the app menu, the Files
 * app sidebar entries, the in-app sidebar and the route guards all use the same
 * list, so a disabled app leaves no trace anywhere.
 *
 * Two things are deliberately **not** translated: the product name `APP_NAME`
 * (it is a brand, the same in every language) and the app id (a stable technical
 * identifier that routes, folders and storage keys are built from).
 *
 * The builders are pure functions taking the `$gettext` function, which keeps
 * them testable without a mounted app and keeps all string extraction inside
 * `$gettext`.
 */

import type {
  AppMenuItemExtension,
  AppNavigationItem,
  SidebarNavExtension
} from '@opencloud-eu/web-pkg'
import type { AdminConfig } from './config/appConfig'
import {
  APP_DRAWER_SLOTS,
  APP_KEYS,
  FILES_SIDEBAR_SLOTS,
  normalizeAppOrder,
  type AppDrawerMode,
  type AppDrawerSlot,
  type AppKey,
  type FilesSidebarSlot,
  type Settings
} from './settings/schema'
import { PLANNER_ICON, PLANNER_TILE_COLOR } from './brandIcon'
import { requestSettingsTab } from './settings/pendingTab'

/** App id (module-federation name, route prefix, extension id prefix). */
export const APP_ID = 'planner'

/**
 * Product name shown inside the app (app menu entry, window/document titles).
 *
 * A brand name: **not** wrapped in `$gettext` and never translated.
 */
export const APP_NAME = 'Planner'

/**
 * The app's image icon (white `Planner` glyph) and the tile colour it is drawn on,
 * used for `appInfo` and the app-menu entries — the host paints `color` as the
 * rounded tile behind the image, like it does for the built-in apps (see
 * `brandIcon.ts`).
 */
export { PLANNER_ICON, PLANNER_TILE_COLOR }

/** Extension point of the Files app's left sidebar. */
const FILES_NAV_EXTENSION_POINT = 'app.files.navItems'

/** The three apps, in display order (owned by the settings schema). */
export { APP_KEYS }

/**
 * Rank of one app inside a user-ordered list, 0-based.
 *
 * The lists come from the settings (`general.filesSidebarOrder`,
 * `general.appDrawerOrder`) and are normalised to a full permutation of
 * `APP_KEYS` by the schema, so the rank always lands in 0…2 — i.e. inside the
 * slot's gap (the slot base plus 0…2). A list this version cannot use (hand-edited
 * document, older write, an admin typo) falls back to the built-in order instead
 * of colliding ranks.
 */
function orderRank(order: AppKey[] | null | undefined, key: AppKey): number {
  return orderedApps(order).indexOf(key)
}

/**
 * The three apps sorted the way `order` puts them — the rows of a Settings gear
 * section and the entries of one slot follow the same list.
 */
export function orderedApps(order: AppKey[] | null | undefined): AppKey[] {
  return normalizeAppOrder(order) ?? [...APP_KEYS]
}

interface AppMeta {
  /** Untranslated source string; always passed through `$gettext` when used. */
  label: string
  icon: string
}

/**
 * Name and icon per app. The Files-sidebar *position* is not part of it any more:
 * it comes from `general.filesSidebarPosition` (see `filesSidebarPriority`).
 */
const APP_META: Record<AppKey, AppMeta> = {
  calendar: { label: 'Calendar', icon: 'calendar-2' },
  contacts: { label: 'Contacts', icon: 'contacts-book' },
  tasks: { label: 'Tasks', icon: 'task' }
}

type Translate = (text: string) => string

/** Route of one app, e.g. `/planner/calendar`. */
export function appRoute(key: AppKey): string {
  return `/${APP_ID}/${key}`
}

/** Root route of the package — the target of the single app-menu entry. */
export const APP_ROOT_ROUTE = `/${APP_ID}/`

/** Settings page route (not part of the sidebar; opened via the ⚙ button). */
export const SETTINGS_ROUTE = `/${APP_ID}/settings`

/** Router target of the Settings page: the path, nothing else (no hash, no query). */
export const SETTINGS_TARGET = { path: SETTINGS_ROUTE }

/**
 * Legacy Tools route — kept as a redirect so old bookmarks/links keep working.
 *
 * The tab is handed over in memory (`requestSettingsTab`), the URL stays plain:
 * `/manage` → `/planner/settings` with the Data tab open.
 */
export function legacyToolsRedirect(): string {
  requestSettingsTab('data')
  return SETTINGS_ROUTE
}

/**
 * The Settings tabs, in display order (the Settings page renders them as one
 * `role="tablist"`).
 *
 * Shared with `PageHeaderActions.vue`, so the ⚙ button of a view opens the tab
 * that belongs to it (through `settings/pendingTab.ts`).
 */
export const SETTINGS_SECTION_IDS = [
  'general',
  'calendar',
  'contacts',
  'tasks',
  'data',
  'devices',
  'about'
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

/** Where a plain visit to `/settings` lands. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general'

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}

/**
 * Pages that are not an app of their own but still have a matching Settings tab.
 * Birthdays has no page yet (the birthday calendar is generated from contacts);
 * when one lands, the ⚙ button should open Settings → Contacts → Birthdays.
 */
const SETTINGS_SECTION_BY_PAGE: Record<string, SettingsSectionId> = {
  [`/${APP_ID}/birthdays`]: 'contacts'
}

/**
 * The tab that belongs to a page: Calendar → `calendar`, Contacts → `contacts`,
 * Tasks → `tasks`, a birthdays page → `contacts`, anything else (`/files/…`) →
 * `general`.
 */
export function settingsSectionForPath(path: unknown): SettingsSectionId {
  if (typeof path !== 'string' || path === '') return DEFAULT_SETTINGS_SECTION
  const match = APP_KEYS.find(
    (key) => path === appRoute(key) || path.startsWith(`${appRoute(key)}/`)
  )
  if (match) return match
  for (const [route, section] of Object.entries(SETTINGS_SECTION_BY_PAGE)) {
    if (path === route || path.startsWith(`${route}/`)) return section
  }
  return DEFAULT_SETTINGS_SECTION
}

/**
 * Admin-disabled apps cannot be re-enabled by the user; a user may hide further
 * apps. The result is never empty — the app always needs at least one entry.
 */
export function effectiveEnabledApps(
  admin: AdminConfig | null | undefined,
  user: Settings | null | undefined
): AppKey[] {
  const adminList = admin?.enabledApps ?? APP_KEYS
  const userList = user?.general?.enabledApps ?? APP_KEYS
  const enabled = APP_KEYS.filter((key) => adminList.includes(key) && userList.includes(key))
  return enabled.length > 0 ? enabled : [APP_KEYS[0]]
}

/**
 * The app the package opens on: the user's default app when it is enabled,
 * otherwise the first enabled app.
 *
 * One rule, three callers — the target of the `/` route, the single app-menu
 * entry (which takes that app's slot) and the Settings row that positions it.
 * They must never disagree: the row has to arrange the entry the user actually
 * gets, even when the chosen default app was disabled in the meantime.
 */
export function effectiveDefaultApp(
  enabled: AppKey[],
  preferred: AppKey | null | undefined = null
): AppKey {
  if (preferred && enabled.includes(preferred)) return preferred
  return APP_KEYS.find((key) => enabled.includes(key)) ?? APP_KEYS[0]
}

/**
 * Route the app opens on: the user's default app (Settings → General → Default
 * app) when it is enabled, otherwise the first enabled app.
 */
export function defaultAppRoute(
  enabled: AppKey[],
  preferred: AppKey | null | undefined = null
): string {
  return appRoute(effectiveDefaultApp(enabled, preferred))
}

/**
 * Where a disabled app's route sends the user (`null` = the route is fine).
 * Used by the route guards, so it reads the *current* settings on every
 * navigation.
 */
export function redirectForDisabledApp(
  enabled: AppKey[],
  key: AppKey,
  preferred: AppKey | null | undefined = null
): string | null {
  return enabled.includes(key) ? null : defaultAppRoute(enabled, preferred)
}

/**
 * The OpenCloud start page the sidebar's "Back to OpenCloud" entry opens.
 *
 * Leaving Planner means going back to the host: the Files app's personal-space
 * route is what the OpenCloud logo and `/` resolve to after login (the host takes
 * that target from the first visible Files nav item, which is *Personal*).
 * `personal` is the **space alias**, not a user id, so the path is the same for
 * every account — no id is built here.
 */
export const OPENCLOUD_HOME_ROUTE = '/files/spaces/personal'

/**
 * Apps the Files app sidebar shows.
 *
 * Only in the `filesSidebar` navigation mode, and then only the ones the user
 * picked (`general.filesSidebar`); `drawerOnly` keeps the Files sidebar free and
 * the app is reached through its one app-menu entry instead.
 */
export function filesSidebarApps(settings: Settings | null | undefined): AppKey[] {
  const general = settings?.general
  if (!general || general.navigation !== 'filesSidebar') return []
  return APP_KEYS.filter((key) => general.filesSidebar.includes(key))
}

/**
 * `navItem.priority` of the host's own Files-sidebar entries
 * (`packages/web-app-files/src/index.ts`): Personal 10, Favorites 20, Shares 30,
 * Spaces 40, Deleted files 50.
 */
const FILES_SLOT_PRIORITY: Record<FilesSidebarSlot, number> = {
  personal: 10,
  favorites: 20,
  shares: 30,
  spaces: 40,
  deleted: 50
}

/**
 * Priority of one app's Files-sidebar entry: the slot's host priority plus the
 * app's rank inside that slot (`general.filesSidebarOrder`, default Calendar,
 * Contacts, Tasks), so a slot lands *between* two host entries (41…43 after
 * Spaces) and never reorders one of them.
 */
export function filesSidebarPriority(settings: Settings | null | undefined, key: AppKey): number {
  const slot = settings?.general?.filesSidebarPosition?.[key]
  const base = FILES_SLOT_PRIORITY[slot ?? 'spaces'] ?? FILES_SLOT_PRIORITY.spaces
  return base + orderRank(settings?.general?.filesSidebarOrder, key) + 1
}

/** The slot an app is shown in (never undefined — `spaces` is the default). */
export function filesSidebarSlot(
  settings: Settings | null | undefined,
  key: AppKey
): FilesSidebarSlot {
  const slot = settings?.general?.filesSidebarPosition?.[key]
  return slot && FILES_SIDEBAR_SLOTS.includes(slot) ? slot : 'spaces'
}

/**
 * `priority` base of each app-menu slot.
 *
 * The host's own entries (`web-runtime/src/components/Topbar/ApplicationsMenu.vue`
 * sorts by priority ascending; each `packages/web-app-<name>/src/index.ts` or
 * `extensions.ts` defines them): Files 10, Contacts/Mail/App Store 30, Admin
 * Settings 40, and the rest without a priority. Ours sit one below the next host
 * entry (1…9, 11…19, 31…39, 41…49), so a slot lands between two host entries and
 * never reorders one.
 */
const DRAWER_SLOT_PRIORITY: Record<Exclude<AppDrawerSlot, 'last'>, number> = {
  first: 1,
  afterFiles: 11,
  afterApps: 31,
  afterSettings: 41
}

/** The app-menu slot of one app (never undefined — `afterFiles` is the default). */
export function appDrawerSlot(settings: Settings | null | undefined, key: AppKey): AppDrawerSlot {
  const slot = settings?.general?.appDrawerPosition?.[key]
  return slot && APP_DRAWER_SLOTS.includes(slot) ? slot : 'afterFiles'
}

/**
 * `priority` of one app's app-menu entry, or `undefined` for the `last` slot.
 *
 * The rank inside the slot comes from `general.appDrawerOrder` (default
 * Calendar, Contacts, Tasks), so two apps in the same slot keep the order the
 * user picked. `undefined` is the honest value for "last": the host sorts a
 * missing priority with `Number.MAX_SAFE_INTEGER`
 * (`(a.priority || MAX) - (b.priority || MAX)`), which is where OpenCloud's own
 * priority-less entries are.
 */
export function appDrawerPriority(
  settings: Settings | null | undefined,
  key: AppKey
): number | undefined {
  const slot = appDrawerSlot(settings, key)
  if (slot === 'last') return undefined
  return DRAWER_SLOT_PRIORITY[slot] + orderRank(settings?.general?.appDrawerOrder, key)
}

/**
 * The app-menu entries (the drawer in the top bar).
 *
 * - `single` (default): one entry for the whole package, pointing at the app root
 *   `/planner/` — which redirects to the *default app*, so it opens
 *   whatever the user picked in Settings → General. `label` is the brand name and
 *   therefore not translated. It takes the slot of that default app, because that
 *   is the app it opens.
 * - `individual`: one entry per ticked app (`general.appDrawerApps` ∩ enabled
 *   apps), each with its own name and icon and pointing at its own route. When
 *   that intersection is empty — the user hid every picked app, or the admin's
 *   `enabledApps` removed them — the one package entry of `single` mode is kept
 *   instead of an app menu without any Planner entry.
 *
 * Both modes use the same tile colour and the image/named-icon combination the host
 * paints a rounded, coloured tile behind (see `brandIcon.ts`), so the entries look
 * like the built-in apps' entries. The slot (`general.appDrawerPosition`) decides
 * where an entry sits among the host's own entries; apps in the same slot keep the
 * order of `general.appDrawerOrder` (default Calendar < Contacts < Tasks).
 */
export function buildAppMenuItems(
  settings: Settings | null | undefined,
  enabled: AppKey[],
  $gettext: Translate
): AppMenuItemExtension[] {
  const mode: AppDrawerMode =
    settings?.general?.appDrawer === 'individual' ? 'individual' : 'single'
  // The app the package itself opens — the target of the single entry and the
  // slot it takes. Same enabled-aware rule as the `/` redirect.
  const defaultKey = effectiveDefaultApp(enabled, settings?.general?.defaultApp)

  if (mode === 'individual') {
    const picked = settings?.general?.appDrawerApps ?? APP_KEYS
    const items = orderedApps(settings?.general?.appDrawerOrder)
      .filter((key) => picked.includes(key) && enabled.includes(key))
      .map((key) => {
        const priority = appDrawerPriority(settings, key)
        return {
          id: `app.${APP_ID}.menuItem.${key}`,
          type: 'appMenuItem' as const,
          label: () => $gettext(APP_META[key].label),
          color: PLANNER_TILE_COLOR,
          icon: APP_META[key].icon,
          path: appRoute(key),
          ...(priority === undefined ? {} : { priority })
        }
      })

    // Every picked app is disabled (the user turned them off, or the admin's
    // `enabledApps` dropped them): an empty app menu would leave the app with no
    // entry at all, so keep the one package entry of `single` mode.
    if (items.length > 0) return items
  }

  // The one entry opens the default app, so it sits where that app would sit.
  const priority = appDrawerPriority(settings, defaultKey)

  return [
    {
      id: `app.${APP_ID}.menuItem`,
      type: 'appMenuItem',
      label: () => APP_NAME,
      // The host paints `color` as the rounded tile and the white-glyph image on
      // top of it — exactly what the built-in apps' named icons + colours produce.
      color: PLANNER_TILE_COLOR,
      icon: PLANNER_ICON,
      path: APP_ROOT_ROUTE,
      ...(priority === undefined ? {} : { priority })
    }
  ]
}

/**
 * Files-app sidebar entries — one per *enabled* app, each independently visible
 * and independently positioned.
 *
 * Which of them is shown comes from `filesSidebarApps(settings)` (navigation mode
 * ∩ `general.filesSidebar` ∩ enabled apps), where they sit from
 * `general.filesSidebarPosition` → `filesSidebarPriority()`. Both are read here,
 * in the app's `extensions` computed, so the host's `useNavItems` re-sorts the
 * sidebar as soon as the value changes — **no reload, no re-registration**: the
 * registry hands out the objects of that computed and `useNavItems` sorts them on
 * every read.
 *
 * `ready` keeps the entries hidden until the settings document is loaded. The host
 * picks the target of the logo / `/` redirect once at startup from the first
 * *visible* Files nav item; if ours were visible by default (before login, before the
 * Files items are), the OpenCloud logo would open the calendar instead of Files.
 */
export function buildFilesSidebarItems(
  enabled: AppKey[],
  settings: Settings | null | undefined,
  $gettext: Translate,
  ready: () => boolean = () => true
): SidebarNavExtension[] {
  const shown = filesSidebarApps(settings)

  return APP_KEYS.filter((key) => enabled.includes(key)).map((key) => {
    const meta = APP_META[key]
    return {
      id: `app.${APP_ID}.filesNavItem.${key}`,
      type: 'sidebarNav',
      extensionPointIds: [FILES_NAV_EXTENSION_POINT],
      navItem: {
        name: $gettext(meta.label),
        icon: meta.icon,
        route: { path: appRoute(key) },
        priority: filesSidebarPriority(settings, key),
        isVisible: () => ready() && shown.includes(key)
      }
    }
  })
}

/**
 * In-app sidebar: "Back to OpenCloud" on top of the enabled apps.
 *
 * The entry is always there, on every Planner page (Calendar, Contacts, Tasks *and*
 * Settings) — it is the way out of the app, not a history-aware Back button, so it
 * needs no route state and survives a reload. `priority: 1` sorts it above the app
 * entries (the host sorts ascending by priority, then name).
 *
 * `isActive` is hard-wired to `false`: the host marks a nav item active when the
 * current route or one of its `activeFor` paths starts with the item's route, and
 * this entry leads to another app — it is never "the page you are on".
 */
export function buildInAppNavItems(enabled: AppKey[], $gettext: Translate): AppNavigationItem[] {
  const homeItem: AppNavigationItem = {
    name: $gettext('Back to OpenCloud'),
    icon: 'arrow-left-s',
    priority: 1,
    route: { path: OPENCLOUD_HOME_ROUTE },
    isActive: () => false
  }

  const apps: AppNavigationItem[] = APP_KEYS.filter((key) => enabled.includes(key)).map((key) => {
    const meta = APP_META[key]
    const path = appRoute(key)
    return {
      name: $gettext(meta.label),
      icon: meta.icon,
      route: { path },
      activeFor: [{ path }]
    }
  })

  return [homeItem, ...apps]
}
