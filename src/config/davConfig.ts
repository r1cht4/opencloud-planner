/**
 * DAV endpoint configuration.
 *
 * Kept as the URL-getter facade the DAV client uses; the values now come from the
 * admin configuration (`appConfig.ts`), so there is exactly one source of truth
 * for `caldavUrl` / `carddavUrl`.
 */

import { getAdminConfig } from './appConfig'
import type { DAVConfig } from '../types'

/** Effective DAV base URLs (`undefined` → same-origin `/caldav` / `/carddav`). */
export function getDAVConfig(): DAVConfig {
  const { caldavUrl, carddavUrl } = getAdminConfig()
  return { caldavUrl, carddavUrl }
}
