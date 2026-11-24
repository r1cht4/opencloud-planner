/**
 * Admin configuration (`apps.yaml` → `applicationConfig.config`).
 *
 * Every key mirrors the settings tree so an admin can
 *  - point the app at a different DAV endpoint (`caldavUrl`, `carddavUrl`),
 *  - ship defaults (`defaults.*`, plus the `enabledApps` / `filesSidebar`
 *    shortcuts for the two most-edited general settings),
 *  - and lock a value (`locked: ['general.filesSidebar']`) so users cannot change
 *    it — locked values render read-only with a hint.
 *
 * The raw object comes from YAML, so it is treated as untrusted input: unknown
 * keys and mistyped values are dropped instead of reaching the application.
 */

import {
  isRecord,
  isValidSettingValue,
  isSettingPath,
  normalizeFilesSidebar,
  readSettingPath,
  SETTING_PATHS,
  writeSettingPath,
  type AppKey,
  type SettingPath,
  type Settings
} from '../settings/schema'

/** Recursive partial used for `defaults` (any subtree may be omitted). */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export interface AdminConfig {
  /** CalDAV base URL (defaults to the same-origin `/caldav`). */
  caldavUrl?: string
  /** CardDAV base URL (defaults to the same-origin `/carddav`). */
  carddavUrl?: string
  /** Apps offered at all; a user can disable more, never re-enable these. */
  enabledApps?: AppKey[]
  /**
   * Shortcut for `defaults.general.filesSidebar`: apps the admin wants in the
   * Files app sidebar (`[]` = none). Per app, so an install can offer e.g. only
   * the calendar next to the files.
   */
  filesSidebar?: AppKey[]
  /** Admin defaults for any settings path. */
  defaults?: DeepPartial<Settings>
  /** Settings paths the admin locked (read-only for users). */
  locked?: SettingPath[]
}

let adminConfig: AdminConfig = {}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function appKeyList(value: unknown): AppKey[] | undefined {
  if (!Array.isArray(value)) return undefined
  const keys = value.filter(
    (entry): entry is AppKey => entry === 'calendar' || entry === 'contacts' || entry === 'tasks'
  )
  // An admin list that sanitises down to nothing is a typo, not an intent to
  // disable every app — ignore it rather than brick the UI.
  return keys.length > 0 ? [...new Set(keys)] : undefined
}

function sanitizedDefaults(raw: unknown): DeepPartial<Settings> | undefined {
  if (!isRecord(raw)) return undefined
  const defaults: Record<string, unknown> = {}
  let found = false
  for (const path of SETTING_PATHS) {
    const value = readSettingPath(raw, path)
    if (value === undefined || !isValidSettingValue(path, value)) continue
    writeSettingPath(defaults, path, value)
    found = true
  }
  return found ? (defaults as DeepPartial<Settings>) : undefined
}

function lockedPaths(value: unknown): SettingPath[] | undefined {
  if (!Array.isArray(value)) return undefined
  const paths = value.filter(
    (entry): entry is SettingPath => typeof entry === 'string' && isSettingPath(entry)
  )
  return paths.length > 0 ? [...new Set(paths)] : undefined
}

/**
 * Validate and install the admin configuration. Called once from
 * `defineWebApplication.setup()` with `args.applicationConfig?.config`; calling it
 * again replaces the previous configuration.
 */
export function setAdminConfig(raw: unknown): void {
  const source = isRecord(raw) ? raw : {}
  const next: AdminConfig = {}

  const caldavUrl = nonEmptyString(source.caldavUrl)
  if (caldavUrl) next.caldavUrl = caldavUrl
  const carddavUrl = nonEmptyString(source.carddavUrl)
  if (carddavUrl) next.carddavUrl = carddavUrl

  const enabledApps = appKeyList(source.enabledApps)
  if (enabledApps) next.enabledApps = enabledApps

  const defaults: Record<string, unknown> = isRecord(source.defaults)
    ? ((sanitizedDefaults(source.defaults) as Record<string, unknown> | undefined) ?? {})
    : {}

  // The two documented shortcuts are settings defaults as well, so the rest of
  // the app only ever reads `defaults.*`. An empty Files-sidebar list is a valid
  // admin choice ("put none of the apps there"), unlike an empty app list.
  const filesSidebar = normalizeFilesSidebar(source.filesSidebar)
  if (filesSidebar) {
    next.filesSidebar = filesSidebar
    writeSettingPath(defaults, 'general.filesSidebar', filesSidebar)
  }
  if (enabledApps) writeSettingPath(defaults, 'general.enabledApps', enabledApps)

  if (Object.keys(defaults).length > 0) next.defaults = defaults as DeepPartial<Settings>

  const locked = lockedPaths(source.locked)
  if (locked) next.locked = locked

  adminConfig = next
}

/** The installed admin configuration (empty object when none was provided). */
export function getAdminConfig(): AdminConfig {
  return adminConfig
}
