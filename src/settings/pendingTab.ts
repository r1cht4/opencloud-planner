/**
 * The Settings tab another page wants to open.
 *
 * The Settings URL is always the plain `/planner/settings`: the tab is
 * *not* part of the address (user decision — a reload of a tab is not needed and
 * a bookmark never shows a random tab). Instead the page that opens Settings —
 * the ⚙ button of an app view, or the legacy `/manage` redirect — drops the
 * wanted tab here right before navigating, and the Settings view takes it once
 * on mount and clears it.
 *
 * A module-level value is enough: it lives for one navigation and both sides run
 * in the same page (no storage, no router state, no cleanup).
 */
import type { SettingsSectionId } from '../navigation'

let pending: SettingsSectionId | null = null

/** Ask the Settings page to open `id` the next time it mounts. */
export function requestSettingsTab(id: SettingsSectionId): void {
  pending = id
}

/**
 * Read the requested tab and forget it.
 *
 * `null` means "nothing requested" (a plain visit, a reload, a bookmark) — the
 * caller then falls back to General.
 */
export function takeSettingsTab(): SettingsSectionId | null {
  const value = pending
  pending = null
  return value
}

/** Test helper: drop a request without reading it. */
export function resetPendingTab(): void {
  pending = null
}
