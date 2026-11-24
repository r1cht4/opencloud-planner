/**
 * Settings store — one document per user, kept on the *Radicale principal* as a
 * dead property (`{urn:x-planner}settings`), so it follows the user to
 * every device and lives next to the data it configures.
 *
 * Design notes:
 *  - Module-level singleton: `useSettings()` can be called from any view/setup
 *    and always talks to the same reactive state; the document is loaded once per
 *    session (and again on `reload()`).
 *  - `update()` is optimistic and debounced (500 ms) — the UI reacts instantly,
 *    one PROPPATCH follows. A failed save keeps the local value and surfaces
 *    `error` (the Settings page shows it); nothing silently reverts.
 *  - The store never throws on load: an unreachable server, a missing property or
 *    a malformed document all resolve to `{}`, so the app runs on admin +
 *    built-in defaults (see `resolveSettings`).
 *  - The raw document is the source of truth for writes, so keys this version
 *    does not model (newer versions, other tools) survive every save.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getAdminConfig } from '../config/appConfig'
import {
  davFetch,
  isAuthenticated,
  propfind,
  useDAVClient,
  watchAccessToken
} from '../composables/useDAVClient'
import { davPropText, parseMultistatus } from '../composables/davXml'
import { parseProppatchResponse } from '../composables/useCollections'
import {
  deleteSettingPath,
  FILES_SIDEBAR_PATH,
  isValidSettingValue,
  normalizeFilesSidebar,
  parseSettingsDocument,
  readSettingPath,
  resolveSettings,
  serializeSettingsDocument,
  SETTINGS_NAMESPACE,
  writeSettingPath,
  type SettingPath,
  type Settings
} from './schema'

/** Debounce window for `update()` → one PROPPATCH. */
const SAVE_DEBOUNCE_MS = 500

/**
 * Legacy per-device birthday toggle (`useBirthdaySync.ts`), imported into the
 * synced document once and then removed.
 */
const LEGACY_BIRTHDAY_KEY = 'cc-birthday-sync-enabled'

export interface UseSettings {
  /** Resolved settings (user → admin default → built-in default, locks applied). */
  settings: ComputedRef<Settings>
  /** True once the stored document has been read (or defaulted). */
  loaded: Ref<boolean>
  /** Last load/save failure, cleared by the next successful operation. */
  error: Ref<string | null>
  /** Optimistically set a value and schedule a debounced save. */
  update: (path: SettingPath, value: unknown) => void
  /** True when the admin locked this path (the UI renders it read-only). */
  isLocked: (path: SettingPath) => boolean
  /** Force a re-read (settings changed elsewhere / user switch). */
  reload: () => Promise<void>
}

const PROPFIND_SETTINGS = `<x:settings xmlns:x="${SETTINGS_NAMESPACE}"/>`

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function propertyUpdateBody(document: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:x="${SETTINGS_NAMESPACE}">
  <d:set>
    <d:prop>
      <x:settings>${escapeXmlText(document)}</x:settings>
    </d:prop>
  </d:set>
</d:propertyupdate>`
}

/** The principal the document lives on (calendar service discovery is enough). */
async function principalUrl(): Promise<string | null> {
  const { ensureReady, getState } = useDAVClient()
  if (!(await ensureReady('calendar'))) return null
  return getState('calendar')?.principalUrl ?? null
}

/**
 * Read the stored document from the principal.
 *
 * Returns `{}` when the property is missing (first run) or when the value is
 * not valid JSON. Unlike `loadUserSettings` this variant **throws** when the
 * server cannot be reached at all — persist() needs to tell "the document is
 * empty" and "the document could not be read" apart (the second
 * must never end up in a write).
 */
async function readStoredSettings(
  opts: { keepalive?: boolean } = {}
): Promise<Record<string, unknown>> {
  // Signed out (setup runs before the host has the access token): nothing can
  // be read, so a save must not be attempted either.
  if (!isAuthenticated()) throw new Error('not signed in')

  const principal = await principalUrl()
  if (!principal) throw new Error('DAV server not reachable')

  const xml = await propfind(principal, PROPFIND_SETTINGS, '0', opts)

  for (const response of parseMultistatus(xml)) {
    const text = davPropText(response.el, 'settings')
    if (text) return parseSettingsDocument(text)
  }
  return {}
}

/**
 * Read the stored document, resolving to `{}` on every tolerated failure (the
 * app keeps working on admin + built-in defaults in those cases).
 */
export async function loadUserSettings(): Promise<Record<string, unknown>> {
  try {
    return await readStoredSettings()
  } catch (err) {
    console.warn('[planner] settings PROPFIND failed:', err)
    return {}
  }
}

/**
 * Write the document to the principal. Throws on failure — the caller decides how
 * to surface it (the store keeps the local value and sets `error`). The BODY's
 * per-property `propstat` is checked as well: a 207 whose propstat says 403/507
 * did not store anything.
 */
export async function saveUserSettings(
  doc: Record<string, unknown>,
  opts: { keepalive?: boolean } = {}
): Promise<void> {
  const principal = await principalUrl()
  if (!principal) throw new Error('DAV server not reachable')

  const resp = await davFetch(principal, {
    method: 'PROPPATCH',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: propertyUpdateBody(serializeSettingsDocument(doc)),
    // A fire-and-forget flush during `pagehide` is cancelled by the browser
    // unless the request is marked to survive the unload.
    ...(opts.keepalive ? { keepalive: true } : {})
  })
  if (resp.status !== 207 && resp.status !== 200) {
    throw new Error(`PROPPATCH of user settings failed: ${resp.status}`)
  }
  const { ok, failed } = parseProppatchResponse(await resp.text())
  if (!ok) {
    throw new Error(`PROPPATCH of user settings rejected by server: ${failed.join(', ')}`)
  }
}

// ── module-level singleton state ────────────────────────────────────────────

const userDocument = ref<Record<string, unknown>>({})
const loaded = ref(false)
const error = ref<string | null>(null)
const adminConfig = ref(getAdminConfig())

let loadPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Locally changed paths waiting to be written.
 *
 * Each entry stores the raw value to write (`undefined` = remove the path) so
 * an update made *before* the load finished survives the load replacing the
 * local document. Entries are removed only after the write landed; an entry
 * superseded by a newer `update()` (a fresh object) stays for the next save.
 */
interface PendingChange {
  readonly value: unknown
}
const pending: Map<SettingPath, PendingChange> = new Map()

/**
 * Saves run one after the other: a second save waits for the one
 * in flight, so an older read-merge-write can never land after a newer one.
 */
let saveChain: Promise<void> = Promise.resolve()

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

/**
 * One read-merge-write cycle:
 *
 *  1. re-read the stored document (PROPFIND) — the *server* copy is the base,
 *  2. apply only the locally changed paths on top of it,
 *  3. PROPPATCH the merged document (per-propstat checked).
 *
 * Refuses to write when the read failed (the changed paths stay queued and are
 * retried by the next flush/update/load) — writing the local document would
 * delete every server key this client never saw.
 */
async function persist(keepalive = false): Promise<void> {
  if (pending.size === 0) return
  // Not signed in (yet): keep the changes queued; the load after the token
  // retries them.
  if (!isAuthenticated()) return

  const snapshot = [...pending.entries()]

  let serverDoc: Record<string, unknown>
  try {
    serverDoc = await readStoredSettings({ keepalive })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error.value = `Could not read the stored settings before saving (${message}) — the change is kept and retried`
    console.warn('[planner] settings read before save failed, change queued:', err)
    return
  }

  try {
    const merged = serverDoc
    for (const [path, change] of snapshot) {
      if (change.value === undefined) deleteSettingPath(merged, path)
      else writeSettingPath(merged, path, change.value)
    }
    await saveUserSettings(merged, { keepalive })
    for (const [path, change] of snapshot) {
      if (pending.get(path) === change) pending.delete(path)
    }
    error.value = null
  } catch (err) {
    // The local value stays: the user sees it applied and gets told the save
    // failed, instead of watching their change silently bounce back. The paths
    // stay queued and are retried with the next update or flush.
    error.value = err instanceof Error ? err.message : String(err)
    console.error('[planner] saving settings failed:', err)
  }
}

/** Queue one persist behind the save in flight (serialization). */
function enqueuePersist(keepalive = false): Promise<void> {
  saveChain = saveChain.then(() => persist(keepalive))
  return saveChain
}

function scheduleSave(): void {
  clearSaveTimer()
  saveTimer = setTimeout(() => {
    saveTimer = null
    void enqueuePersist()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * `general.filesSidebar` used to be a single on/off switch (first 2.0 pass).
 * Rewrite a stored boolean into the per-app list so the document matches the
 * schema: `true` → every app, `false` → none. Reading already tolerates the old
 * shape (`normalizeFilesSidebar`); this persists the new one.
 */
function migrateFilesSidebarBoolean(doc: Record<string, unknown>): boolean {
  const stored = readSettingPath(doc, FILES_SIDEBAR_PATH)
  if (typeof stored !== 'boolean') return false
  writeSettingPath(doc, FILES_SIDEBAR_PATH, normalizeFilesSidebar(stored))
  return true
}

/**
 * Import the old per-device birthday toggle into the synced document (once).
 * The key is removed afterwards so the migration cannot run twice.
 */
function migrateLegacyBirthdayToggle(doc: Record<string, unknown>): boolean {
  let legacy: string | null = null
  try {
    legacy = localStorage.getItem(LEGACY_BIRTHDAY_KEY)
  } catch {
    return false
  }
  if (legacy === null) return false

  const birthdays =
    typeof doc.birthdays === 'object' && doc.birthdays !== null
      ? (doc.birthdays as Record<string, unknown>)
      : null
  if (birthdays === null || typeof birthdays.enabled !== 'boolean') {
    writeSettingPath(doc, 'birthdays.enabled', legacy === '1')
  }

  try {
    localStorage.removeItem(LEGACY_BIRTHDAY_KEY)
  } catch {
    /* localStorage unavailable — nothing to clean up */
  }
  return true
}

/** Run every document migration; true when the document changed. */
function migrateDocument(doc: Record<string, unknown>): boolean {
  // Both are best-effort and idempotent — never let a migration block the load.
  const filesSidebarMigrated = migrateFilesSidebarBoolean(doc)
  const birthdayMigrated = migrateLegacyBirthdayToggle(doc)
  if (filesSidebarMigrated) {
    pending.set(FILES_SIDEBAR_PATH, { value: readSettingPath(doc, FILES_SIDEBAR_PATH) })
  }
  if (birthdayMigrated) {
    pending.set('birthdays.enabled', { value: readSettingPath(doc, 'birthdays.enabled') })
  }
  return filesSidebarMigrated || birthdayMigrated
}

async function doLoad(): Promise<void> {
  adminConfig.value = getAdminConfig()
  const doc = await loadUserSettings()
  // Document migrations queue their rewritten paths as pending changes (they
  // then go through the same read-merge-write save as regular updates).
  migrateDocument(doc)
  userDocument.value = doc
  loaded.value = true
  // Migrations (or changes that piled up while the server was unreachable) are
  // written through the same read-merge-write path as regular updates — they
  // are queued, not saved blindly, so a failed read cannot wipe the document.
  if (pending.size > 0) await enqueuePersist()
}

function load(): Promise<void> {
  // A signed-out load is a no-op that must not be cached: the token watch below
  // starts the real (single) load once the user is authenticated.
  if (!isAuthenticated()) return Promise.resolve()
  if (!loadPromise) loadPromise = doLoad()
  return loadPromise
}

/** Stop function of the pending "wait for the access token" watch, if any. */
let authWatchStop: (() => void) | null = null

/**
 * Start the one settings load — but only once the user is signed in.
 *
 * `defineWebApplication.setup()` runs before OpenCloud stores the access token,
 * so the first DAV request (and the first view) must not happen yet: they would
 * 401 and log `calendar DAV init failed` several times per page load. We watch
 * the token once, then load; a later `useSettings()` call (views) retries in case
 * the watch never fired.
 */
function startLoadWhenAuthenticated(): void {
  if (isAuthenticated()) {
    void load()
    return
  }
  if (authWatchStop) return
  authWatchStop = watchAccessToken(() => {
    const stop = authWatchStop
    authWatchStop = null
    stop?.()
    void load()
  })
}

/**
 * How long a route may wait for the stored document before it decides with the
 * values it has (built-in defaults plus the admin configuration).
 *
 * The document needs the access token and one PROPFIND, so it cannot be there
 * when `defineWebApplication.setup()` builds the route table. Waiting is right —
 * the user's default app and enabled apps live in it — but never unbounded: a
 * tab whose sign-in never finishes, or an unreachable server, must still get a
 * page instead of a navigation that never completes.
 */
export const SETTINGS_LOAD_TIMEOUT_MS = 3000

/**
 * Resolve once the stored document has been read, or after `timeoutMs`.
 *
 * `true` means the document arrived (so `settings` is the user's own
 * resolution), `false` means the wait timed out — the caller decides what a
 * missing document means, and must fall back to the values it already has.
 *
 * Starts the (single, token-gated) load when nobody did yet, so a route guard
 * cannot wait for a load that was never requested.
 */
export function whenSettingsLoaded(timeoutMs: number = SETTINGS_LOAD_TIMEOUT_MS): Promise<boolean> {
  if (loaded.value) return Promise.resolve(true)
  startLoadWhenAuthenticated()

  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let stop: (() => void) | null = null

    const finish = (arrived: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      stop?.()
      stop = null
      resolve(arrived)
    }

    timer = setTimeout(() => finish(false), timeoutMs)
    stop = watch(loaded, (arrived) => {
      if (arrived) finish(true)
    })
  })
}

/**
 * Flush a debounced change when the page goes away (navigation, tab close) so a
 * quick click-then-leave cannot lose the setting. Registered once.
 */
let unloadHookRegistered = false
function registerUnloadHook(): void {
  if (unloadHookRegistered || typeof window === 'undefined') return
  unloadHookRegistered = true
  window.addEventListener('pagehide', () => {
    // keepalive: without it the browser cancels the in-flight
    // PROPFIND/PROPPATCH as soon as the page is torn down.
    void flushSettingsSave({ keepalive: true })
  })
}

/**
 * Settings API. Module-level singleton: one document, one debounced save, one
 * error state for the whole app.
 */
export function useSettings(): UseSettings {
  // The admin configuration is installed in `setup()` before the first view is
  // created; pick it up here as well so defaults/locks apply to the very first
  // render instead of after the document arrived.
  adminConfig.value = getAdminConfig()
  registerUnloadHook()
  startLoadWhenAuthenticated()

  const settings = computed<Settings>(() => resolveSettings(userDocument.value, adminConfig.value))

  /**
   * Optimistically set a value (debounced save). `undefined` **removes** the
   * key, which is how optional settings express "no choice" (e.g.
   * `tasks.defaultReminder`: absent = no reminder; any number would be a value).
   *
   * Locked paths are never written (the lock is real), and a value
   * the schema rejects never enters the document — the save would only fail
   * server-side or, worse, poison the local `settings` object.
   */
  function update(path: SettingPath, value: unknown): void {
    if (isLocked(path)) {
      console.warn('[planner] refusing to update the admin-locked setting', path)
      return
    }
    if (value !== undefined && !isValidSettingValue(path, value)) {
      console.warn('[planner] refusing an invalid settings value for', path, value)
      return
    }
    const next: Record<string, unknown> = JSON.parse(JSON.stringify(userDocument.value))
    if (value === undefined) deleteSettingPath(next, path)
    else writeSettingPath(next, path, value)
    userDocument.value = next
    pending.set(path, { value })
    scheduleSave()
  }

  function isLocked(path: SettingPath): boolean {
    const locked = getAdminConfig().locked
    return Array.isArray(locked) && locked.includes(path)
  }

  async function reload(): Promise<void> {
    if (loadPromise) await loadPromise
    loadPromise = null
    await load()
  }

  return { settings, loaded, error, update, isLocked, reload }
}

/**
 * Drop all state (tests, user switch). Pending saves are discarded, in-flight
 * saves are awaited by the caller through `flushSettingsSave()`.
 */
export function resetSettingsStore(): void {
  authWatchStop?.()
  authWatchStop = null
  clearSaveTimer()
  userDocument.value = {}
  loaded.value = false
  error.value = null
  adminConfig.value = getAdminConfig()
  loadPromise = null
  pending.clear()
  // A fresh chain: the discarded changes of the previous user/session must not
  // bleed into the next one.
  saveChain = Promise.resolve()
}

/** Persist a pending debounced change right away and wait for it (logout/close). */
export async function flushSettingsSave(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (saveTimer !== null) clearSaveTimer()
  if (pending.size > 0) await enqueuePersist(opts.keepalive === true)
  await saveChain
}
