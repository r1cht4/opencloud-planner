/**
 * Connection/status plumbing shared by the other lanes.
 *
 * `src/index.ts` calls `startConnectionProbe()` once inside `setup()`; the views
 * wrap their content in `<ConnectionGate>` and Settings shows `<AboutStatus>`.
 * Everything here is self-contained so the views only need one line each.
 *
 * The admin steps mirror what upstream `opencloud-compose` ships
 * (`radicale/radicale.yml` + `config/opencloud/proxy.yaml`), copied verbatim so
 * they can be pasted into a terminal/editor.
 */

import { useConnectionProbe, type ProbeState } from '../composables/useConnectionProbe'
import { hasAuthStore, isAuthenticated, watchAccessToken } from '../composables/useDAVClient'

/** Public install guide. */
export const INSTALL_GUIDE_URL =
  'https://github.com/r1cht4/opencloud-planner/blob/main/docs/INSTALL.md'

/** `.env`: enables the Radicale bundle (which also mounts `proxy.yaml`). */
const COMPOSE_FILE_LINE = 'COMPOSE_FILE=docker-compose.yml:radicale/radicale.yml'

/**
 * `config/opencloud/proxy.yaml` — the routes upstream ships inside
 * `additional_policies` → `name: default` → `routes:`. Copied from
 * opencloud-compose so a missing file can be recreated exactly.
 */
const PROXY_ROUTES_YAML = `- endpoint: /caldav/
  backend: http://radicale:5232
  remote_user_header: X-Remote-User
  skip_x_access_token: true
  additional_headers:
    - X-Script-Name: /caldav
- endpoint: /.well-known/caldav
  backend: http://radicale:5232
  remote_user_header: X-Remote-User
  skip_x_access_token: true
  additional_headers:
    - X-Script-Name: /caldav
- endpoint: /carddav/
  backend: http://radicale:5232
  remote_user_header: X-Remote-User
  skip_x_access_token: true
  additional_headers:
    - X-Script-Name: /carddav
- endpoint: /.well-known/carddav
  backend: http://radicale:5232
  remote_user_header: X-Remote-User
  skip_x_access_token: true
  additional_headers:
    - X-Script-Name: /carddav`

/** Restart the stack with the new compose file / route config. */
const COMPOSE_UP_COMMAND = 'docker compose up -d'

export type AdminSetupStepId = 'compose-file' | 'proxy-routes' | 'restart'

export interface AdminSetupStep {
  /** Stable id; the component maps it to its translated title. */
  id: AdminSetupStepId
  /** The copyable line/block for this step. */
  code: string
}

/** Ordered steps an administrator has to perform on the server. */
export const ADMIN_SETUP_STEPS: AdminSetupStep[] = [
  { id: 'compose-file', code: COMPOSE_FILE_LINE },
  { id: 'proxy-routes', code: PROXY_ROUTES_YAML },
  { id: 'restart', code: COMPOSE_UP_COMMAND }
]

/**
 * Translated, human-readable label for a probe outcome. Shared by the setup state
 * and About/Status so the two never name the same state differently. The
 * `$gettext` literals live here (not in the components) so they are extracted once.
 */
export function probeOutcomeLabel(outcome: ProbeState, $gettext: (text: string) => string): string {
  switch (outcome) {
    case 'ok':
      return $gettext('OK')
    case 'not-configured':
      return $gettext('Not configured')
    case 'unavailable':
      return $gettext('Unavailable')
    case 'unauthorized':
      return $gettext('Unauthorized')
    case 'error':
      return $gettext('Error')
    default:
      return $gettext('Checking…')
  }
}

/**
 * Start the first connection probe. Called once from the app's `setup()`.
 *
 * The composable's captured `retest` is used directly (no composable call inside
 * a timer or handler). Failures are already classified by the probe, so there is
 * nothing to catch — an unhandled rejection only appears if the probe itself is
 * broken, which the console names.
 *
 * The probe waits for the access token: `setup()` runs before OpenCloud stores it,
 * and a DAV request without `Authorization` answers 401 — which the probe reports
 * as `unauthorized`, gating every view behind the "connection broken" setup state
 * on a perfectly healthy install (the same bug the settings document had). While
 * signed out the shared outcome stays `pending`, so the gate shows its spinner
 * instead of a wrong diagnosis.
 */
export function startConnectionProbe(): void {
  const { retest } = useConnectionProbe()

  const run = (): void => {
    // `retest()` is single-flight, so an overlapping call (e.g. a user pressing
    // "Test connection") shares this request instead of racing it.
    void retest().catch((err) => {
      console.error('[planner] connection probe failed:', err)
    })
  }

  if (isAuthenticated() || !hasAuthStore()) {
    run()
    return
  }

  // Holder instead of a `let`: the watcher may fire during `watchAccessToken()`
  // (immediate), so the handle has to exist before the assignment.
  const handle: { stop?: () => void } = {}
  handle.stop = watchAccessToken(() => {
    handle.stop?.()
    run()
  })
}
