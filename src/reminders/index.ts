/**
 * Reminder entry point — wires the alarm index, the scheduler and the
 * notification delivery to the real DAV services.
 *
 * Call `startReminders()` from the extension's `setup()`, i.e. **synchronously
 * inside a setup context**: it instantiates the services there (composables must
 * not be created from a timer callback) and only then starts timers.
 *
 * ```ts
 * // src/index.ts — inside defineWebApplication({ setup() { ... } })
 * import { startReminders } from './reminders'
 *
 * const { showMessage } = useMessages()          // captured at setup
 * let reminders = startReminders({
 *   isEnabled: () => settings.reminders.enabled,
 *   showMessage: (message) => showMessage(message),
 *   openItem: (href, kind) => {
 *     window.focus()
 *     // Path-based navigation: the host rewrites route names.
 *     void router.push({
 *       path: appRoute(kind === 'task' ? 'tasks' : 'calendar'),
 *       query: { open: href }
 *     })
 *   },
 *   // opt-in: only tasks without a VALARM, per the tasks.defaultReminder setting
 *   taskDefaultReminderMinutes: () => settings.tasks.defaultReminder
 * })
 * ```
 *
 * Afterwards:
 *  - `refresh()` — call after **local** event/task writes (and after a settings
 *    change that affects reminders) so the newly armed/removed alarms apply at
 *    once instead of at the next 15-minute tick.
 *  - `stop()` — call when the user switches reminders off (and call
 *    `startReminders()` again when it is switched back on).
 */

import type { CalendarEvent } from '../types'
import { useCalendarService } from '../composables/useCalendarService'
import { useTasksService } from '../composables/useTasksService'
import { davUserId } from '../composables/useDAVClient'
import { collectDueAlarms, MAX_ALARM_LEAD_MS, type DueAlarm } from './alarmIndex'
import {
  createCrossTabLock,
  createScheduler,
  SHOWN_STORAGE_KEY,
  type CrossTabLock
} from './scheduler'
import { notifyAlarm } from './notify'

/**
 * The two DAV services the engine reads from.
 *
 * The app creates them **once** in `setup()` and passes them in here, so a later
 * restart (the user toggled reminders on) never has to call a composable from a
 * watcher/timer context.
 */
interface ReminderServices {
  calendarService: Pick<ReturnType<typeof useCalendarService>, 'fetchCalendars' | 'fetchEvents'> & {
    /** Present in the real services; optional so plain test stubs keep working. */
    error?: { value: string | null }
  }
  tasksService: Pick<ReturnType<typeof useTasksService>, 'fetchTasks'> & {
    error?: { value: string | null }
  }
}

export interface StartRemindersOptions {
  /** Read from the settings layer on every start; `false` starts nothing. */
  isEnabled(): boolean
  /** Setup-time services; created here only when omitted (tests, simple hosts). */
  services?: ReminderServices
  /** In-app fallback (`useMessages().showMessage` captured at setup). */
  showMessage(message: { title: string; desc?: string }): void
  /** Focus the tab and open the event/task behind the reminder. */
  openItem(href: string, kind: 'event' | 'task'): void
  /**
   * Opt-in reminder for tasks that carry no VALARM, in minutes before DUE
   * (`0` = at the due time) — maps to the `tasks.defaultReminder` setting.
   * `undefined` (the default) means those tasks stay silent; only alarms a
   * client actually wrote fire.
   */
  taskDefaultReminderMinutes?(): number | undefined
  /** Format locale for the notification time (see `settings/formatLocale.ts`). */
  getLocale?(): string
}

export interface ReminderHandle {
  stop(): void
  /** Re-collect now (after local writes or a settings change). */
  refresh(): void
}

function browserLocale(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return document.documentElement?.lang || undefined
}

/**
 * Start the browser reminder engine. Returns a no-op handle when reminders are
 * disabled, so callers can call it unconditionally at setup time.
 */
export function startReminders(options: StartRemindersOptions): ReminderHandle {
  if (!options.isEnabled()) {
    return { stop: () => undefined, refresh: () => undefined }
  }

  // Composables are created here, synchronously (setup time), and only used by
  // the async fetcher below — never from inside a timer callback. A host that
  // restarts the engine (settings toggle) passes the services it captured during
  // `setup()` instead.
  const calendarService = options.services?.calendarService ?? useCalendarService()
  const tasksService = options.services?.tasksService ?? useTasksService()

  // The shown log is keyed per DAV user, so two OpenCloud accounts
  // in the same browser never suppress each other's reminders. The key is a
  // function because discovery (and therefore the user id) happens later.
  const lock: CrossTabLock = createCrossTabLock({
    storageKey: () => `${SHOWN_STORAGE_KEY}.${davUserId()}`
  })

  async function fetchWindow(from: Date, to: Date): Promise<DueAlarm[]> {
    // The server filters with a time-range REPORT (masters count when any
    // occurrence intersects). Widening the upper bound by the largest lead time
    // keeps "one day before" reminders of events after the window.
    const range = { start: from, end: new Date(to.getTime() + MAX_ALARM_LEAD_MS) }

    // The background loop must never *create* data — a user with no
    // calendar (or the Calendar app disabled) gets an empty list, not an
    // MKCOL "default-calendar". The `error` refs stay readable below.
    const calendars = await calendarService.fetchCalendars({ autoCreate: false })
    const perCalendar = await Promise.all(
      calendars.map((calendar) => calendarService.fetchEvents(calendar.url, range))
    )
    const masters: CalendarEvent[] = perCalendar.flat()

    // `collectDueAlarms` expands the series itself (each occurrence keeps its own
    // alarm key), so the masters are passed through unexpanded.
    const tasks = await tasksService.fetchTasks()

    // The services swallow fetch errors and return []. Treating
    // that as "all alarms gone" would clear the armed timers on every hiccup —
    // throw instead, so the scheduler keeps them and retries on the next tick.
    if (calendarService.error?.value) {
      throw new Error(`calendar fetch failed: ${calendarService.error.value}`)
    }
    if (tasksService.error?.value) {
      throw new Error(`task fetch failed: ${tasksService.error.value}`)
    }

    return collectDueAlarms(masters, tasks, from, to, options.taskDefaultReminderMinutes?.())
  }

  const scheduler = createScheduler({
    fetchWindow,
    now: () => new Date(),
    notify: (alarm) =>
      notifyAlarm(alarm, {
        showMessage: options.showMessage,
        openItem: options.openItem,
        locale: options.getLocale?.() ?? browserLocale()
      }),
    lock
  })

  scheduler.start()

  return {
    stop: () => {
      scheduler.stop()
      // Releasing the BroadcastChannel here too — one lock per
      // engine run, no channel leak per off/on toggle.
      lock.close()
    },
    refresh: () => scheduler.refresh()
  }
}
