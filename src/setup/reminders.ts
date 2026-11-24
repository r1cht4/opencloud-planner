/**
 * Reminder wiring — keeps the reminder engine running exactly while the user
 * has reminders enabled, and lets views re-collect alarms after local writes.
 *
 * Two things live here instead of in `src/index.ts`:
 *
 *  - the **restart loop**: switching `settings.reminders.enabled` off stops the
 *    timers, switching it back on arms them again (a `watch` on the resolved
 *    setting runs outside a component, so the services the engine needs are
 *    created once at setup and injected — see `ReminderServices`);
 *  - `refreshReminders()`: the module-level handle views call after a local
 *    event/task write, so a just-created reminder is armed immediately instead
 *    of at the next 15-minute tick. It is a no-op while reminders are off.
 */

import { watch, type Ref } from 'vue'
import { hasAuthStore, isAuthenticated, watchAccessToken } from '../composables/useDAVClient'
import { startReminders, type ReminderHandle, type StartRemindersOptions } from '../reminders'

const NOOP_HANDLE: ReminderHandle = { stop: () => undefined, refresh: () => undefined }

/** The handle of the running engine (no-op when reminders are disabled). */
let active: ReminderHandle = NOOP_HANDLE

/**
 * Start the engine and follow the `enabled` state.
 *
 * Call from the app's `setup()`; the returned stop function is only needed by
 * tests (the engine lives as long as the page does).
 *
 * `setup()` runs before OpenCloud stores the access token, and the
 * engine's first fetchWindow would hit the DAV proxy unauthenticated (401 +
 * a "calendar DAV init failed" console error on every page load). Like the
 * settings load and the connection probe, the engine therefore waits for
 * `watchAccessToken()` before it starts; an `enabled` toggle before that only
 * arms the state, it never triggers a fetch.
 */
export function startReminderWiring(
  options: StartRemindersOptions,
  enabled: Ref<boolean>
): () => void {
  /** True once the engine may talk DAV (token seen, or no host auth store at all). */
  let tokenReady = isAuthenticated() || !hasAuthStore()

  function restart(isEnabled: boolean): void {
    active.stop()
    active = isEnabled ? startReminders({ ...options, isEnabled: () => true }) : NOOP_HANDLE
  }

  const stopWatch = watch(enabled, (isEnabled) => {
    // Before the token exists there is nothing to stop (the engine never
    // started) and nothing to start without causing an unauthenticated fetch.
    if (!tokenReady) return
    restart(!!isEnabled)
  })

  /** Stop of the pending token watch (unset once it fired). */
  let tokenWatchStop: (() => void) | null = null

  if (tokenReady) {
    restart(enabled.value)
  } else {
    // Holder instead of a `let`: the watcher may fire during
    // `watchAccessToken()` (immediate), before the assignment below happens.
    const holder: { stop?: () => void } = {}
    holder.stop = watchAccessToken(() => {
      holder.stop?.()
      tokenReady = true
      tokenWatchStop = null
      restart(enabled.value)
    })
    tokenWatchStop = holder.stop
  }

  return () => {
    stopWatch()
    tokenWatchStop?.()
    tokenWatchStop = null
    active.stop()
    active = NOOP_HANDLE
  }
}

/**
 * Re-collect alarms now (after a local event/task write). Cheap and safe when the
 * engine is off: the no-op handle swallows it.
 */
export function refreshReminders(): void {
  active.refresh()
}
