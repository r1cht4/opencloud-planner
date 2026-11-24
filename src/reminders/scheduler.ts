/**
 * Reminder scheduler — arms one timer per due alarm and shows it exactly once
 * across all open tabs.
 *
 * Two rules drive the design:
 *
 * 1. **Throttled / sleeping tabs**: browsers throttle timers in
 *    background tabs and suspend them entirely while a machine sleeps, so a
 *    timer may run minutes or hours after the moment it was armed for. Every
 *    fired timer therefore re-checks the wall clock: up to `GRACE_MS` late the
 *    reminder still fires (once); anything older is dropped silently — a two
 *    hour old "meeting in 5 minutes" is noise, not information.
 * 2. **One notification per reminder**, no matter how many tabs are open: the
 *    `CrossTabLock` claims `uid|occurrence|trigger` keys in `localStorage`
 *    (shared by every tab of the origin) and mirrors them over a
 *    `BroadcastChannel` so tabs without storage access still de-duplicate.
 *
 * The scheduler never writes to the DAV server — "acknowledged" is a local log.
 */

import type { DueAlarm } from './alarmIndex'

/** Re-fetch cadence (design: every 15 minutes and after local writes). */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000
/** Reminders up to this late still fire once (sleep/throttling tolerance). */
export const GRACE_MS = 15 * 60 * 1000
/** How far ahead alarms are collected. */
const HORIZON_MS = 24 * 60 * 60 * 1000
/** `localStorage` key of the "already shown" log. */
export const SHOWN_STORAGE_KEY = 'planner.reminders.shown'
/** Channel used to mirror the shown log between tabs. */
const REMINDER_CHANNEL_NAME = 'planner-reminders'
/** Shown keys are pruned after a week (bounded storage, no stale re-notifies). */
export const SHOWN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Claims a reminder key exactly once across tabs. */
export interface CrossTabLock {
  tryClaim(key: string): boolean
  /**
   * Release the underlying `BroadcastChannel`: every engine
   * off/on toggle used to leak one. Called by the engine's `stop()`.
   */
  close(): void
}

export interface ReminderScheduler {
  start(): void
  stop(): void
  refresh(): void
}

export interface SchedulerDeps {
  /** Collect the alarms due in `[from, to]`. */
  fetchWindow(from: Date, to: Date): Promise<DueAlarm[]>
  now(): Date
  notify(alarm: DueAlarm): void
  lock: CrossTabLock
}

export interface SchedulerOptions {
  refreshIntervalMs?: number
  graceMs?: number
  horizonMs?: number
}

type ShownLog = Record<string, number>

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Access can throw when storage is blocked by the browser.
    return null
  }
}

function defaultChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(REMINDER_CHANNEL_NAME)
  } catch {
    return null
  }
}

export interface CrossTabLockOptions {
  /** Injected for tests; defaults to `localStorage`. `null` disables persistence. */
  storage?: Storage | null
  /**
   * Storage key of the shown log. May be a function so the key
   * can pick up the signed-in user: two OpenCloud accounts in the same browser
   * must not share (or suppress each other's) reminders.
   */
  storageKey?: string | (() => string)
  retentionMs?: number
  now?: () => Date
  /** Injected for tests; defaults to a `BroadcastChannel` on `REMINDER_CHANNEL_NAME`. */
  channel?: BroadcastChannel | null
}

/**
 * `localStorage`-backed claim lock, pruned after `SHOWN_RETENTION_MS`.
 *
 * The storage document is read on every claim (it is the cross-tab source of
 * truth) and kept in a local map as well, so reminders are still de-duplicated
 * when the browser denies storage but allows `BroadcastChannel`.
 */
export function createCrossTabLock(options: CrossTabLockOptions = {}): CrossTabLock {
  const now = options.now ?? (() => new Date())
  const retentionMs = options.retentionMs ?? SHOWN_RETENTION_MS
  const storageKeyOption = options.storageKey ?? SHOWN_STORAGE_KEY
  const storageKey = (): string =>
    typeof storageKeyOption === 'function' ? storageKeyOption() : storageKeyOption
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  let channel = options.channel === undefined ? defaultChannel() : options.channel

  const memory: ShownLog = {}

  if (channel && typeof channel.addEventListener === 'function') {
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event?.data as { type?: string; key?: string } | undefined
      if (!data || data.type !== 'shown' || !data.key) return
      memory[data.key] = now().getTime()
    })
  }

  function prune(log: ShownLog): ShownLog {
    const cutoff = now().getTime() - retentionMs
    for (const [key, stamp] of Object.entries(log)) {
      if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp < cutoff) delete log[key]
    }
    // The in-memory mirror must expire with the store, otherwise a tab that ran
    // for a week would keep silently suppressing reminders.
    for (const [key, stamp] of Object.entries(memory)) {
      if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp < cutoff) delete memory[key]
    }
    return log
  }

  function read(): ShownLog {
    if (!storage) return { ...memory }
    try {
      const raw = storage.getItem(storageKey())
      const parsed = raw ? JSON.parse(raw) : null
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const log: ShownLog = {}
      for (const [key, stamp] of Object.entries(parsed as ShownLog)) {
        if (typeof stamp === 'number') log[key] = stamp
      }
      return log
    } catch {
      return {}
    }
  }

  function write(log: ShownLog): void {
    if (!storage) return
    try {
      storage.setItem(storageKey(), JSON.stringify(log))
    } catch {
      // Quota exceeded / storage disabled: the in-memory map still de-duplicates
      // this tab, and the broadcast below covers the other ones.
    }
  }

  return {
    tryClaim(key: string): boolean {
      const log = prune(read())
      if (typeof log[key] === 'number' || typeof memory[key] === 'number') {
        // Persist the pruned shape so the store does not grow forever.
        write(log)
        return false
      }
      log[key] = now().getTime()
      memory[key] = log[key]
      write(log)
      try {
        channel?.postMessage({ type: 'shown', key })
      } catch {
        // A closed channel must never break the reminder.
      }
      return true
    },
    close(): void {
      try {
        channel?.close()
      } catch {
        // Already closed — nothing to release.
      }
      channel = null
    }
  }
}

/**
 * Arm timers for the alarms the fetcher reports and re-fetch on a fixed cadence
 * (`refresh()` for local writes). `start()` is idempotent; `stop()` clears every
 * timer so a disabled setting really stops the work.
 */
export function createScheduler(
  deps: SchedulerDeps,
  options: SchedulerOptions = {}
): ReminderScheduler {
  const refreshIntervalMs = options.refreshIntervalMs ?? REFRESH_INTERVAL_MS
  const graceMs = options.graceMs ?? GRACE_MS
  const horizonMs = options.horizonMs ?? HORIZON_MS

  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Keys fired in this session — cheap guard on top of the cross-tab lock. */
  const fired = new Set<string>()
  let interval: ReturnType<typeof setInterval> | null = null
  let running = false
  /** Guards against a slow fetch from a previous run re-arming timers. */
  let generation = 0

  function clearTimers(): void {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }

  /**
   * Timer callback. The alarm may be far in the past (throttled tab, sleeping
   * laptop), so lateness decides: within grace → notify once, older → skip.
   */
  function fire(alarm: DueAlarm): void {
    timers.delete(alarm.key)
    if (!running) return
    if (fired.has(alarm.key)) return

    const late = deps.now().getTime() - alarm.fireAt.getTime()
    // Clock moved backwards / alarm collected too early: wait for the next refresh.
    if (late < 0) return
    if (late > graceMs) return

    if (!deps.lock.tryClaim(alarm.key)) return
    fired.add(alarm.key)
    try {
      deps.notify(alarm)
    } catch (err) {
      // A failing delivery must not take the other timers (or the refresh loop) down.
      console.warn('[planner] reminder delivery failed:', err)
    }
  }

  function schedule(alarm: DueAlarm): void {
    const delay = alarm.fireAt.getTime() - deps.now().getTime()
    if (delay <= 0) {
      // Already due (collected with the grace window around "now"): claim now.
      fire(alarm)
      return
    }
    const existing = timers.get(alarm.key)
    if (existing) clearTimeout(existing)
    timers.set(
      alarm.key,
      setTimeout(() => fire(alarm), delay)
    )
  }

  async function load(): Promise<void> {
    if (!running) return
    const current = ++generation
    const now = deps.now()
    const from = new Date(now.getTime() - graceMs)
    const to = new Date(now.getTime() + horizonMs)

    let alarms: DueAlarm[]
    try {
      alarms = await deps.fetchWindow(from, to)
    } catch (err) {
      console.warn('[planner] reminder fetch failed:', err)
      return
    }
    if (!running || current !== generation) return

    // Drop timers for alarms that disappeared (item deleted or rescheduled).
    const wanted = new Set(alarms.map((alarm) => alarm.key))
    for (const [key, timer] of timers) {
      if (wanted.has(key)) continue
      clearTimeout(timer)
      timers.delete(key)
    }

    for (const alarm of alarms) schedule(alarm)
  }

  return {
    start(): void {
      if (running) return
      running = true
      void load()
      interval = setInterval(() => void load(), refreshIntervalMs)
    },
    stop(): void {
      running = false
      generation++
      clearTimers()
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    },
    refresh(): void {
      void load()
    }
  }
}
