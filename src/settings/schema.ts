/**
 * Settings schema — types, built-in defaults, document parsing/serialising and
 * the three-level resolution (locked admin value → user value → admin default →
 * built-in default).
 *
 * Pure functions only: no DAV, no Vue, no localStorage. The storage layer lives
 * in `settingsStore.ts` and reuses everything here.
 *
 * Two invariants matter to the rest of the app:
 *  - a value of the wrong type never reaches `Settings` (it falls through to the
 *    next level, so a stale/hand-edited document cannot crash a view);
 *  - documents are handled as opaque records by the store, so properties this
 *    version does not know (newer versions, other tools) survive a save.
 */

import type { AdminConfig } from '../config/appConfig'

/** One of the three apps the package ships (app-drawer entries). */
export type AppKey = 'calendar' | 'contacts' | 'tasks'

/** The three apps in display order (drawer, Files sidebar, in-app nav). */
export const APP_KEYS: AppKey[] = ['calendar', 'contacts', 'tasks']

/** Dot path into `Settings`, e.g. `'calendar.defaultView'`. */
export type SettingPath = string

/**
 * Where the three apps are reachable from.
 *
 * - `filesSidebar`: Calendar/Contacts/Tasks appear individually in the Files app
 *   sidebar (which of them is `general.filesSidebar`); the app menu keeps its one
 *   entry either way.
 * - `drawerOnly`: no Files-sidebar entries — the app is opened from the app menu
 *   and switched inside its own sidebar.
 */
type GeneralNavigation = 'filesSidebar' | 'drawerOnly'

/**
 * Slot of the Files app sidebar an app's entry is shown in: right after one of the
 * host's own entries.
 *
 * The numbers behind them are the host's `navItem.priority` values
 * (`web-app-files/src/index.ts`): Personal 10, Favorites 20, Shares 30, Spaces 40,
 * Deleted files 50. Ours sit in the gap after the chosen one (11…19, 21…29, …), so
 * a slot never reorders the host's entries.
 */
export type FilesSidebarSlot = 'personal' | 'favorites' | 'shares' | 'spaces' | 'deleted'

/** Every slot, in the order of the host's sidebar. */
export const FILES_SIDEBAR_SLOTS: FilesSidebarSlot[] = [
  'personal',
  'favorites',
  'shares',
  'spaces',
  'deleted'
]

/**
 * How the app menu (the app switcher drawer in the top bar) lists Planner.
 *
 * - `single`: one entry for the package, opening the default app.
 * - `individual`: one entry per app the user picked (`general.appDrawerApps`), so
 *   Calendar, Contacts and Tasks can each sit next to the host's own apps.
 */
export type AppDrawerMode = 'single' | 'individual'

/**
 * Slot of the app menu (the app switcher in the top bar) an entry is shown in.
 *
 * The host sorts the switcher by `priority` ascending
 * (`web-runtime/src/components/Topbar/ApplicationsMenu.vue`) and the built-in
 * apps carry stable values: Files 10, Contacts/Mail/App Store 30, Admin Settings
 * 40 — everything without a priority (OpenCloud's own legacy "Calendar" account
 * entry, OCM) sorts last with `Number.MAX_SAFE_INTEGER`. So there are three real
 * gaps plus a first and a last place:
 *
 * - `first`        → before Files (1…9)
 * - `afterFiles`   → after Files, before the built-in apps (11…19)
 * - `afterApps`    → after Contacts/Mail/App Store, before Admin Settings (31…39)
 * - `afterSettings`→ after Admin Settings, before the priority-less entries (41…49)
 * - `last`         → with the priority-less entries (no priority at all)
 *
 * Contacts, Mail and App Store share priority 30, so "after one of them" is
 * "after all of them" — one slot, `afterApps`.
 */
export type AppDrawerSlot = 'first' | 'afterFiles' | 'afterApps' | 'afterSettings' | 'last'

/** Every app-menu slot, in the order of the switcher. */
export const APP_DRAWER_SLOTS: AppDrawerSlot[] = [
  'first',
  'afterFiles',
  'afterApps',
  'afterSettings',
  'last'
]

export type CalendarDefaultView = 'month' | 'week' | 'day' | 'list'
export type ContactSortField = 'firstName' | 'lastName'
export type ContactDisplayOrder = 'firstLast' | 'lastFirst'

export interface GeneralSettings {
  /**
   * Apps shown in the Files app's left sidebar — per app, because wanting the
   * calendar next to your files says nothing about wanting the address book
   * there. Effective entries = this list ∩ effective enabled apps.
   */
  filesSidebar: AppKey[]
  /**
   * Where each app's Files-sidebar entry sits, per app: after Personal,
   * Favorites, Shares, Spaces or Deleted files (see `FilesSidebarSlot`).
   */
  filesSidebarPosition: Record<AppKey, FilesSidebarSlot>
  /**
   * Order of the Files-sidebar entries *inside* their slot, first to last.
   *
   * The slot decides where the apps sit among the host's entries; this list
   * decides in which order the apps that share a slot appear (and in which order
   * the Settings rows are listed). Always a permutation of `APP_KEYS`.
   */
  filesSidebarOrder: AppKey[]
  /** One app-menu entry for the package, or one per app (see `AppDrawerMode`). */
  appDrawer: AppDrawerMode
  /** Apps with their own app-menu entry in `individual` mode. */
  appDrawerApps: AppKey[]
  /**
   * Where each app's own app-menu entry sits, per app: first, after Files, after
   * the built-in apps, after Admin Settings or last (see `AppDrawerSlot`). In
   * `single` mode the one entry takes the slot of the default app, because that
   * is the app it opens.
   */
  appDrawerPosition: Record<AppKey, AppDrawerSlot>
  /** Order of the app-menu entries inside their slot (see `filesSidebarOrder`). */
  appDrawerOrder: AppKey[]
  /** Apps the user keeps enabled (intersected with the admin `enabledApps`). */
  enabledApps: AppKey[]
  /** Where the apps are reachable from (see `GeneralNavigation`). */
  navigation: GeneralNavigation
  /**
   * App the app menu entry (`/planner/`) opens. Falls back to the first
   * enabled app when the chosen one is disabled.
   */
  defaultApp: AppKey
  /**
   * Region for date/time formats (`'DE'`, `'US'`, …) or `'auto'` for the
   * browser's format region. Texts keep the OpenCloud language
   * (see `formatLocale.ts`).
   */
  formatRegion: string
  /** `'auto'` follows the region; `'24h'` / `'12h'` force the clock. */
  timeFormat: 'auto' | '24h' | '12h'
}

export interface CalendarSettings {
  defaultView: CalendarDefaultView
  /** `'HH:MM'` — where the day/week grid scrolls to on open. */
  dayStart: string
  /** 0 (Sunday) … 6 (Saturday), or `'locale'` for the browser rule. */
  weekStart: number | 'locale'
  weekNumbers: boolean
  showWeekends: boolean
  /** Collection URL (never a display name — collections can be renamed/shared). */
  defaultCalendar?: string
  /** Default event duration in minutes. */
  defaultDuration: number
  /** Default reminder lead times in minutes (UI-managed DISPLAY alarms). */
  defaultReminders: number[]
}

interface ContactsSettings {
  /** Address-book URL (never a display name). */
  defaultAddressBook?: string
  sortBy: ContactSortField
  displayOrder: ContactDisplayOrder
}

interface TasksSettings {
  defaultCalendar?: string
  showCompleted: boolean
  defaultReminder?: number
}

interface BirthdaysSettings {
  enabled: boolean
  /** Calendar URL the birthday events are materialised into. */
  calendar?: string
  reminder?: number
}

interface RemindersSettings {
  enabled: boolean
}

export interface Settings {
  version: 1
  general: GeneralSettings
  calendar: CalendarSettings
  contacts: ContactsSettings
  tasks: TasksSettings
  birthdays: BirthdaysSettings
  reminders: RemindersSettings
}

/** Schema version written into every stored document. */
const SETTINGS_VERSION = 1 as const

/**
 * Dead property holding the document on the user's Radicale principal. Own
 * namespace on purpose (`urn:x-planner`), never OpenCloud's domain.
 */
export const SETTINGS_NAMESPACE = 'urn:x-planner'

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  general: {
    filesSidebar: [...APP_KEYS],
    // Default slot: after the host's *Spaces* entry, where the app switcher's
    // folder-like entries end and the trash bin starts.
    filesSidebarPosition: { calendar: 'spaces', contacts: 'spaces', tasks: 'spaces' },
    filesSidebarOrder: [...APP_KEYS],
    appDrawer: 'single',
    appDrawerApps: [...APP_KEYS],
    // Default slot: right after the host's Files entry, where the app menu's own
    // apps begin.
    appDrawerPosition: {
      calendar: 'afterFiles',
      contacts: 'afterFiles',
      tasks: 'afterFiles'
    },
    appDrawerOrder: [...APP_KEYS],
    enabledApps: [...APP_KEYS],
    navigation: 'drawerOnly',
    defaultApp: 'calendar',
    formatRegion: 'auto',
    timeFormat: 'auto'
  },
  calendar: {
    defaultView: 'week',
    dayStart: '06:00',
    weekStart: 'locale',
    weekNumbers: true,
    showWeekends: true,
    defaultDuration: 60,
    defaultReminders: []
  },
  contacts: {
    sortBy: 'lastName',
    displayOrder: 'firstLast'
  },
  tasks: {
    showCompleted: false
  },
  birthdays: {
    enabled: false
  },
  reminders: {
    enabled: true
  }
}

/** Plain-object guard for the untrusted YAML/DAV documents both readers parse. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isMinutes(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 7 * 24 * 60
}

function isUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isAppKey(value: unknown): value is AppKey {
  return value === 'calendar' || value === 'contacts' || value === 'tasks'
}

function isAppKeyList(value: unknown): value is AppKey[] {
  return Array.isArray(value) && value.length > 0 && value.every(isAppKey)
}

function isMinuteList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isMinutes)
}

/** Path of the per-app Files-sidebar list (migrated from a boolean in 2.0). */
export const FILES_SIDEBAR_PATH: SettingPath = 'general.filesSidebar'

/**
 * Normalise the Files-sidebar value.
 *
 * Accepts the `AppKey[]` shape (an **empty** list is valid: "show none in the
 * Files sidebar") and the legacy boolean from the first 2.0 pass
 * (`true` → all apps, `false` → none), so an existing document keeps its
 * meaning. Unknown app keys are dropped; a list with no usable entry at all is
 * treated as invalid so the next resolution level applies instead of silently
 * hiding everything.
 */
export function normalizeFilesSidebar(value: unknown): AppKey[] | undefined {
  if (typeof value === 'boolean') return value ? [...APP_KEYS] : []
  if (!Array.isArray(value)) return undefined
  const keys = value.filter(isAppKey)
  if (value.length > 0 && keys.length === 0) return undefined
  return [...new Set(keys)]
}

/** Path of the per-app Files-sidebar slot map. */
const FILES_SIDEBAR_POSITION_PATH: SettingPath = 'general.filesSidebarPosition'

/**
 * Normalise a per-app slot map (Files sidebar or app menu).
 *
 * A *partial* record is valid — an admin only has to name the apps they care
 * about (`defaults.general.filesSidebarPosition: { calendar: favorites }`), the
 * other apps keep the default slot. An app key with an unknown slot makes the
 * whole value invalid (a typo must not silently move an entry). The valid slots
 * are the `*_SLOTS` list itself, so the UI and the validator cannot drift apart.
 */
function normalizeSlotMap<Slot extends string>(
  value: unknown,
  defaults: Record<AppKey, Slot>,
  slots: readonly Slot[]
): Record<AppKey, Slot> | undefined {
  if (!isRecord(value)) return undefined
  const normalized = { ...defaults }
  for (const key of APP_KEYS) {
    const slot = value[key]
    if (slot === undefined) continue
    if (!slots.includes(slot as Slot)) return undefined
    normalized[key] = slot as Slot
  }
  return normalized
}

function normalizeFilesSidebarPosition(
  value: unknown
): Record<AppKey, FilesSidebarSlot> | undefined {
  return normalizeSlotMap(value, DEFAULT_SETTINGS.general.filesSidebarPosition, FILES_SIDEBAR_SLOTS)
}

/** True when `value` is a usable app-menu mode. */
function isAppDrawerMode(value: unknown): value is AppDrawerMode {
  return value === 'single' || value === 'individual'
}

/** Path of the per-app app-menu slot map. */
const APP_DRAWER_POSITION_PATH: SettingPath = 'general.appDrawerPosition'

function normalizeAppDrawerPosition(value: unknown): Record<AppKey, AppDrawerSlot> | undefined {
  return normalizeSlotMap(value, DEFAULT_SETTINGS.general.appDrawerPosition, APP_DRAWER_SLOTS)
}

/**
 * Paths of the two order lists (Files sidebar, app menu). Both are a permutation
 * of `APP_KEYS`; see `normalizeAppOrder`.
 */
export const FILES_SIDEBAR_ORDER_PATH: SettingPath = 'general.filesSidebarOrder'
export const APP_DRAWER_ORDER_PATH: SettingPath = 'general.appDrawerOrder'

/**
 * Normalise an app-order list.
 *
 * The order decides which app comes first *inside* a slot, so it must always be a
 * complete permutation of `APP_KEYS` — a stored list that names only some apps or
 * repeats one (hand-edited document, an older version, an admin typo) is repaired
 * instead of rejected where possible: unknown keys are dropped, duplicates
 * collapsed (first occurrence wins), and every app the list does not name is
 * appended in the built-in order (Calendar, Contacts, Tasks). A list with no
 * usable entry at all is invalid, so it falls through to the next level instead
 * of silently resetting the order.
 */
export function normalizeAppOrder(value: unknown): AppKey[] | undefined {
  if (!Array.isArray(value)) return undefined
  const named = value.filter(isAppKey)
  if (value.length > 0 && named.length === 0) return undefined
  const unique = [...new Set(named)]
  return [...unique, ...APP_KEYS.filter((key) => !unique.includes(key))]
}

/**
 * One validator per writable path. Both the resolver (level fall-through) and
 * the admin-config sanitiser use these, so admin defaults can never smuggle in a
 * value the app would refuse from the user document.
 */
const SETTING_VALIDATORS: Record<SettingPath, (value: unknown) => boolean> = {
  'general.filesSidebar': (value) => normalizeFilesSidebar(value) !== undefined,
  'general.filesSidebarPosition': (value) => normalizeFilesSidebarPosition(value) !== undefined,
  'general.filesSidebarOrder': (value) => normalizeAppOrder(value) !== undefined,
  'general.appDrawer': isAppDrawerMode,
  'general.appDrawerApps': isAppKeyList,
  'general.appDrawerPosition': (value) => normalizeAppDrawerPosition(value) !== undefined,
  'general.appDrawerOrder': (value) => normalizeAppOrder(value) !== undefined,
  'general.enabledApps': isAppKeyList,
  'general.navigation': (value) => value === 'filesSidebar' || value === 'drawerOnly',
  'general.defaultApp': isAppKey,
  'general.formatRegion': (value) =>
    value === 'auto' || (typeof value === 'string' && /^([A-Z]{2}|\d{3})$/.test(value)),
  'general.timeFormat': (value) => value === 'auto' || value === '24h' || value === '12h',
  'calendar.defaultView': (value) =>
    value === 'month' || value === 'week' || value === 'day' || value === 'list',
  'calendar.dayStart': (value) =>
    typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
  'calendar.weekStart': (value) =>
    value === 'locale' ||
    (isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 6),
  'calendar.weekNumbers': isBoolean,
  'calendar.showWeekends': isBoolean,
  'calendar.defaultCalendar': isUrl,
  'calendar.defaultDuration': (value) => isMinutes(value) && (value as number) > 0,
  'calendar.defaultReminders': isMinuteList,
  'contacts.defaultAddressBook': isUrl,
  'contacts.sortBy': (value) => value === 'firstName' || value === 'lastName',
  'contacts.displayOrder': (value) => value === 'firstLast' || value === 'lastFirst',
  'tasks.defaultCalendar': isUrl,
  'tasks.showCompleted': isBoolean,
  'tasks.defaultReminder': isMinutes,
  'birthdays.enabled': isBoolean,
  'birthdays.calendar': isUrl,
  'birthdays.reminder': isMinutes,
  'reminders.enabled': isBoolean
}

/** Every writable path, in document order. */
export const SETTING_PATHS = Object.keys(SETTING_VALIDATORS)

/** True when `path` is a setting this version understands. */
export function isSettingPath(path: string): path is SettingPath {
  return Object.prototype.hasOwnProperty.call(SETTING_VALIDATORS, path)
}

/** True when `value` is acceptable for `path` (see `SETTING_VALIDATORS`). */
export function isValidSettingValue(path: SettingPath, value: unknown): boolean {
  const validate = SETTING_VALIDATORS[path]
  if (!validate) return false
  return validate(value)
}

/** Read a dot path out of a nested record. */
export function readSettingPath(source: unknown, path: SettingPath): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

/** Write a dot path into a nested record, creating intermediate objects. */
export function writeSettingPath(
  target: Record<string, unknown>,
  path: SettingPath,
  value: unknown
): void {
  const segments = path.split('.')
  let current: Record<string, unknown> = target
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (!isRecord(next)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

/**
 * Remove a dot path from a document (used by "no default" choices such as
 * `tasks.defaultReminder`: absent means "no reminder", which no valid value can
 * express). Missing intermediate objects are ignored.
 */
export function deleteSettingPath(target: Record<string, unknown>, path: SettingPath): void {
  const segments = path.split('.')
  let current: unknown = target
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current)) return
    current = current[segment]
  }
  if (isRecord(current)) delete current[segments[segments.length - 1]]
}

function cloneDefaults(): Settings {
  return {
    version: SETTINGS_VERSION,
    general: {
      ...DEFAULT_SETTINGS.general,
      filesSidebar: [...DEFAULT_SETTINGS.general.filesSidebar],
      filesSidebarPosition: { ...DEFAULT_SETTINGS.general.filesSidebarPosition },
      filesSidebarOrder: [...DEFAULT_SETTINGS.general.filesSidebarOrder],
      appDrawerApps: [...DEFAULT_SETTINGS.general.appDrawerApps],
      appDrawerPosition: { ...DEFAULT_SETTINGS.general.appDrawerPosition },
      appDrawerOrder: [...DEFAULT_SETTINGS.general.appDrawerOrder],
      enabledApps: [...DEFAULT_SETTINGS.general.enabledApps]
    },
    calendar: {
      ...DEFAULT_SETTINGS.calendar,
      defaultReminders: [...DEFAULT_SETTINGS.calendar.defaultReminders]
    },
    contacts: { ...DEFAULT_SETTINGS.contacts },
    tasks: { ...DEFAULT_SETTINGS.tasks },
    birthdays: { ...DEFAULT_SETTINGS.birthdays },
    reminders: { ...DEFAULT_SETTINGS.reminders }
  }
}

/**
 * Value as it is written into the resolved settings: some paths accept a looser
 * stored shape (the Files-sidebar list also takes the legacy boolean, the
 * position map may name only some apps) and are normalised here once.
 */
function normalizeSettingValue(path: SettingPath, value: unknown): unknown {
  if (path === FILES_SIDEBAR_PATH) return normalizeFilesSidebar(value)
  if (path === FILES_SIDEBAR_POSITION_PATH) return normalizeFilesSidebarPosition(value)
  if (path === FILES_SIDEBAR_ORDER_PATH) return normalizeAppOrder(value)
  if (path === APP_DRAWER_POSITION_PATH) return normalizeAppDrawerPosition(value)
  if (path === APP_DRAWER_ORDER_PATH) return normalizeAppOrder(value)
  return value
}

/**
 * True when one of the resolution levels (the user document, the admin defaults)
 * sets `path` to a value this version accepts. An unreadable/mistyped value does
 * not count — it would not have won the resolution either.
 */
function levelSets(level: unknown, path: SettingPath): boolean {
  const value = readSettingPath(level, path)
  return value !== undefined && isValidSettingValue(path, value)
}

/**
 * Build the effective settings object.
 *
 * Precedence per path: locked admin value > user value > admin default > built-in
 * default, where "value" means a value that passes the path's validator. A
 * document with a newer `version` than this build understands is ignored as a
 * whole (the app keeps working on defaults instead of guessing).
 */
export function resolveSettings(
  user: Record<string, unknown> | null | undefined,
  admin: AdminConfig | null | undefined
): Settings {
  const document = isRecord(user) ? user : {}
  const config: AdminConfig = isRecord(admin) ? admin : {}
  const locked = Array.isArray(config.locked) ? config.locked : []
  const newerDocument =
    isFiniteNumber(document.version) && (document.version as number) > SETTINGS_VERSION
  const userDocument = newerDocument ? {} : document

  const resolved = cloneDefaults() as unknown as Record<string, unknown>

  for (const path of SETTING_PATHS) {
    // A locked path has exactly one candidate — the admin default.
    // The user value is not a fallback any more, otherwise "locked without a
    // default" would keep whatever the user chose and lock nothing.
    const candidates = locked.includes(path)
      ? [readSettingPath(config.defaults, path)]
      : [readSettingPath(userDocument, path), readSettingPath(config.defaults, path)]

    for (const candidate of candidates) {
      if (candidate === undefined) continue
      if (!isValidSettingValue(path, candidate)) continue
      writeSettingPath(resolved, path, normalizeSettingValue(path, candidate))
      break
    }
    // A locked setting whose admin default is missing/invalid keeps the built-in
    // default — the lock only ever replaces the *user's* choice, but it does
    // remove the user value from the candidates (no silent fall-through to it).
  }

  // `general.navigation` is newer than `general.filesSidebar`: a document written
  // before it existed (or an admin default/lock that only names `filesSidebar`)
  // means "show the apps in the Files sidebar". Without this, the newer
  // `drawerOnly` default would silently hide every Files-sidebar entry those
  // settings asked for. An explicit mode at any level always wins, and a document
  // that sets neither key keeps the built-in default.
  const legacyFilesSidebar =
    levelSets(userDocument, FILES_SIDEBAR_PATH) ||
    levelSets(config.defaults, FILES_SIDEBAR_PATH) ||
    normalizeFilesSidebar(config.filesSidebar) !== undefined
  const navigationSet =
    levelSets(userDocument, 'general.navigation') ||
    levelSets(config.defaults, 'general.navigation')
  // A locked mode without an admin default keeps the built-in default by
  // design; the legacy rule must not override that decision.
  if (!navigationSet && legacyFilesSidebar && !locked.includes('general.navigation')) {
    writeSettingPath(resolved, 'general.navigation', 'filesSidebar')
  }

  return resolved as unknown as Settings
}

/**
 * Parse a stored document. Anything that is not a JSON object (empty property,
 * truncated write, plain array) resolves to `{}` so the app falls back to
 * defaults instead of throwing.
 */
export function parseSettingsDocument(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Serialise a document. Unknown keys are kept verbatim (forward compatibility)
 * and `version` is stamped when missing — never downgraded when newer.
 */
export function serializeSettingsDocument(doc: Record<string, unknown>): string {
  const version = isFiniteNumber(doc.version) ? doc.version : SETTINGS_VERSION
  return JSON.stringify({ version, ...doc })
}
