// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Service boundary mock: the reminder engine is tested without DAV. The alarm
 * math (`collectDueAlarms`) still runs for real, only the network layer is
 * replaced. `expandRecurringEvents` is stubbed because expansion itself is
 * covered by `alarm-index.spec.ts`.
 */
const services = vi.hoisted(() => ({
  fetchCalendars: vi.fn(),
  fetchEvents: vi.fn(),
  fetchTasks: vi.fn(),
  /** Error refs mirroring the real services (fetchWindow throws on error). */
  calError: { value: null as string | null },
  tasksError: { value: null as string | null }
}))

vi.mock('../../src/composables/useCalendarService', () => ({
  expandRecurringEvents: async (events: unknown[]): Promise<unknown[]> => events,
  zonedWallClockToDate: (): null => null,
  useCalendarService: () => ({
    fetchCalendars: services.fetchCalendars,
    fetchEvents: services.fetchEvents,
    error: services.calError
  })
}))

vi.mock('../../src/composables/useTasksService', () => ({
  useTasksService: () => ({ fetchTasks: services.fetchTasks, error: services.tasksError })
}))

import {
  createCrossTabLock,
  createScheduler,
  GRACE_MS,
  SHOWN_STORAGE_KEY,
  SHOWN_RETENTION_MS
} from '../../src/reminders/scheduler'
import { davUserId } from '../../src/composables/useDAVClient'
import type { DueAlarm } from '../../src/reminders/alarmIndex'
import { notifyAlarm } from '../../src/reminders/notify'
import { startReminders } from '../../src/reminders'

const HREF = 'https://cloud.example/caldav/user-1/personal/meeting-1.ics'

function alarm(key: string, fireAt: Date): DueAlarm {
  return { key, fireAt, title: 'Team sync', start: fireAt, kind: 'event', href: HREF }
}

/** Minimal in-memory `Storage` so tests never touch the real localStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string): string | null => data.get(key) ?? null,
    key: (index: number): string | null => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value))
  } as Storage
}

/** A `BroadcastChannel` whose `postMessage` reaches every registered listener. */
function busChannel(): BroadcastChannel {
  const listeners: Array<(event: MessageEvent) => void> = []
  return {
    postMessage: (data: unknown) => {
      for (const listener of listeners) listener({ data } as MessageEvent)
    },
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
      listeners.push(listener)
    },
    removeEventListener: (): void => undefined,
    close: (): void => undefined
  } as unknown as BroadcastChannel
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 'YYYY-MM-DD HH:mm' wall clock (the event model's convention). */
function wallClock(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 11, 1, 10, 0, 0))
  services.fetchCalendars.mockResolvedValue([])
  services.fetchEvents.mockResolvedValue([])
  services.fetchTasks.mockResolvedValue([])
  services.fetchCalendars.mockClear()
  services.fetchEvents.mockClear()
  services.fetchTasks.mockClear()
  services.calError.value = null
  services.tasksError.value = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createScheduler', () => {
  it('late within grace fires once', async () => {
    let clock = new Date(2026, 11, 1, 10, 0, 0)
    const fireAt = new Date(2026, 11, 1, 10, 1, 0)
    const fetchWindow = vi.fn(async () => [alarm('a|single|-900:DEFAULT', fireAt)])
    const notify = vi.fn()
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null, now: () => clock })

    const scheduler = createScheduler({ fetchWindow, now: () => clock, notify, lock })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchWindow).toHaveBeenCalledTimes(1)

    // Tab was throttled / laptop asleep: the timer only runs 10 minutes late.
    clock = new Date(2026, 11, 1, 10, 11, 0)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].key).toBe('a|single|-900:DEFAULT')

    // A refresh must not show the same reminder a second time.
    scheduler.refresh()
    await vi.advanceTimersByTimeAsync(1)
    expect(notify).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('older than grace skipped', async () => {
    let clock = new Date(2026, 11, 1, 10, 0, 0)
    const fireAt = new Date(2026, 11, 1, 10, 1, 0)
    const fetchWindow = vi.fn(async () => [alarm('b|single|-900:DEFAULT', fireAt)])
    const notify = vi.fn()
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null, now: () => clock })

    const scheduler = createScheduler({ fetchWindow, now: () => clock, notify, lock })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)

    // 19 minutes late — beyond the 15 minute grace.
    clock = new Date(2026, 11, 1, 10, 20, 0)
    await vi.advanceTimersByTimeAsync(60_000 + GRACE_MS)

    expect(notify).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('two schedulers sharing a lock notify once', async () => {
    const fireAt = new Date(2026, 11, 1, 10, 1, 0)
    const storage = memoryStorage()
    const notifyA = vi.fn()
    const notifyB = vi.fn()

    const schedulerA = createScheduler({
      fetchWindow: async () => [alarm('c|single|-900:DEFAULT', fireAt)],
      now: () => new Date(),
      notify: notifyA,
      lock: createCrossTabLock({ storage, channel: null })
    })
    const schedulerB = createScheduler({
      fetchWindow: async () => [alarm('c|single|-900:DEFAULT', fireAt)],
      now: () => new Date(),
      notify: notifyB,
      lock: createCrossTabLock({ storage, channel: null })
    })

    schedulerA.start()
    schedulerB.start()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(notifyA.mock.calls.length + notifyB.mock.calls.length).toBe(1)
    schedulerA.stop()
    schedulerB.stop()
  })

  it('re-arms on refresh and drops alarms that disappeared', async () => {
    const first = alarm('d|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 1, 0))
    const second = alarm('e|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 2, 0))
    const fetchWindow = vi.fn(async () => [first])
    const notify = vi.fn()
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null })

    const scheduler = createScheduler({ fetchWindow, now: () => new Date(), notify, lock })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)

    // The user edits: the first reminder is gone, a new one exists.
    fetchWindow.mockImplementation(async () => [second])
    scheduler.refresh()
    await vi.advanceTimersByTimeAsync(1)

    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].key).toBe('e|single|-900:DEFAULT')
    scheduler.stop()
  })

  it('a failing delivery does not stop the other alarms', async () => {
    const notify = vi.fn().mockImplementationOnce(() => {
      throw new Error('toast backend exploded')
    })
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null })
    const fetchWindow = vi.fn(async () => [
      alarm('j|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 1, 0)),
      alarm('k|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 1, 1))
    ])

    const scheduler = createScheduler({ fetchWindow, now: () => new Date(), notify, lock })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(61_000)

    // The throwing first delivery is swallowed; the second one still goes out.
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[1][0].key).toBe('k|single|-900:DEFAULT')
    scheduler.stop()
  })

  it('stop() prevents a pending reminder from firing', async () => {
    const fetchWindow = vi.fn(async () => [
      alarm('f|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 1, 0))
    ])
    const notify = vi.fn()
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null })

    const scheduler = createScheduler({ fetchWindow, now: () => new Date(), notify, lock })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(notify).not.toHaveBeenCalled()
  })
})

describe('createCrossTabLock', () => {
  it('claims a key exactly once', () => {
    const lock = createCrossTabLock({ storage: memoryStorage(), channel: null })
    expect(lock.tryClaim('u1|single|-900:DEFAULT')).toBe(true)
    expect(lock.tryClaim('u1|single|-900:DEFAULT')).toBe(false)
    expect(lock.tryClaim('u2|single|-900:DEFAULT')).toBe(true)
  })

  it('prunes claims older than seven days', () => {
    let clock = new Date(2026, 11, 1, 10, 0, 0)
    const storage = memoryStorage()
    const lock = createCrossTabLock({ storage, channel: null, now: () => clock })

    expect(lock.tryClaim('old|single|-900:DEFAULT')).toBe(true)
    expect(storage.getItem(SHOWN_STORAGE_KEY)).toContain('old|single|-900:DEFAULT')

    // More than a week later the claim is stale (pruned from store *and* from
    // the in-memory mirror) and the reminder may be shown again.
    clock = new Date(2026, 11, 1, 10, 0, SHOWN_RETENTION_MS / 1000 + 1)
    expect(lock.tryClaim('old|single|-900:DEFAULT')).toBe(true)

    // Inside the retention window it stays claimed.
    clock = new Date(2026, 11, 2, 10, 0, 0)
    expect(lock.tryClaim('old|single|-900:DEFAULT')).toBe(false)
  })

  it('de-duplicates over the broadcast channel when storage is unavailable', () => {
    const channel = busChannel()
    const lockA = createCrossTabLock({
      storage: null,
      channel,
      now: () => new Date(2026, 11, 1, 10, 0)
    })
    const lockB = createCrossTabLock({
      storage: null,
      channel,
      now: () => new Date(2026, 11, 1, 10, 0)
    })

    expect(lockA.tryClaim('shared|single|-900:DEFAULT')).toBe(true)
    expect(lockB.tryClaim('shared|single|-900:DEFAULT')).toBe(false)
  })
})

describe('notifyAlarm', () => {
  it('uses a desktop notification when permission is granted', () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    const close = vi.fn()
    const createNotification = vi.fn(() => ({ onclick: null, close }))
    const showMessage = vi.fn()
    const openItem = vi.fn()
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)

    const target = alarm('g|single|-900:DEFAULT', new Date(2026, 11, 1, 10, 0))
    const result = notifyAlarm(target, {
      showMessage,
      openItem,
      createNotification: createNotification as never
    })

    expect(result).toBe('desktop')
    expect(showMessage).not.toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith('Team sync', {
      body: expect.any(String),
      tag: 'g|single|-900:DEFAULT'
    })

    // Clicking the notification focuses the tab and opens the item.
    const created = createNotification.mock.results[0].value as { onclick: (() => void) | null }
    created.onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(openItem).toHaveBeenCalledWith(HREF, 'event')
  })

  it('falls back to an in-app message without permission', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    const showMessage = vi.fn()

    const result = notifyAlarm(alarm('h|single|DUE', new Date(2026, 11, 1, 10, 0)), {
      showMessage,
      openItem: vi.fn()
    })

    expect(result).toBe('toast')
    expect(showMessage).toHaveBeenCalledWith({ title: 'Team sync', desc: expect.any(String) })
  })

  it('falls back to a toast when the platform refuses to construct a notification', () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    const showMessage = vi.fn()

    const result = notifyAlarm(alarm('i|single|DUE', new Date(2026, 11, 1, 10, 0)), {
      showMessage,
      openItem: vi.fn(),
      createNotification: () => {
        throw new Error('not supported')
      }
    })

    expect(result).toBe('toast')
    expect(showMessage).toHaveBeenCalledTimes(1)
  })
})

describe('startReminders', () => {
  it('no Notification.requestPermission on start', async () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })

    const now = new Date()
    const start = new Date(now.getTime() + 60 * 60 * 1000)
    services.fetchCalendars.mockResolvedValue([
      { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
    ])
    services.fetchEvents.mockResolvedValue([
      {
        id: 'planning-1',
        title: 'Planning',
        start: wallClock(start),
        end: wallClock(new Date(start.getTime() + 30 * 60 * 1000)),
        calendarId: 'https://cloud.example/caldav/user-1/personal/',
        reminders: [15]
      }
    ])

    const showMessage = vi.fn()
    const handle = startReminders({
      isEnabled: () => true,
      showMessage,
      openItem: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(services.fetchCalendars).toHaveBeenCalledTimes(1)
    expect(services.fetchEvents).toHaveBeenCalledTimes(1)
    expect(services.fetchTasks).toHaveBeenCalledTimes(1)
    // Fetching must never prompt; only the Settings button may.
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showMessage).not.toHaveBeenCalled()

    handle.stop()
  })

  it('task default reminder: off unless configured', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    services.fetchCalendars.mockResolvedValue([
      { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
    ])
    services.fetchTasks.mockResolvedValue([
      {
        id: 'tax-1',
        title: 'File taxes',
        due: wallClock(new Date(2026, 11, 1, 10, 40)),
        priority: 0,
        status: 'NEEDS-ACTION',
        percentComplete: 0,
        calendarId: 'https://cloud.example/caldav/user-1/personal/'
      }
    ])

    const showMessage = vi.fn()
    const handle = startReminders({ isEnabled: () => true, showMessage, openItem: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000)

    // No `taskDefaultReminderMinutes` → a task without a VALARM stays silent.
    expect(showMessage).not.toHaveBeenCalled()
    handle.stop()
  })

  it('task default reminder: N minutes before DUE when configured', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    services.fetchCalendars.mockResolvedValue([
      { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
    ])
    services.fetchTasks.mockResolvedValue([
      {
        id: 'tax-2',
        title: 'File taxes',
        due: wallClock(new Date(2026, 11, 1, 10, 40)),
        priority: 0,
        status: 'NEEDS-ACTION',
        percentComplete: 0,
        calendarId: 'https://cloud.example/caldav/user-1/personal/'
      }
    ])

    const showMessage = vi.fn()
    const handle = startReminders({
      isEnabled: () => true,
      showMessage,
      openItem: vi.fn(),
      taskDefaultReminderMinutes: () => 30
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000)

    expect(showMessage).toHaveBeenCalledWith({ title: 'File taxes', desc: expect.any(String) })
    handle.stop()
  })

  it('disabled setting → scheduler not started', async () => {
    const handle = startReminders({
      isEnabled: () => false,
      showMessage: vi.fn(),
      openItem: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(services.fetchCalendars).not.toHaveBeenCalled()
    expect(services.fetchTasks).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    // The returned handle is safe to call regardless of the setting.
    handle.refresh()
    handle.stop()
    await vi.advanceTimersByTimeAsync(1)
    expect(services.fetchCalendars).not.toHaveBeenCalled()
  })

  it('notifies when a fetched alarm comes due', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    const now = new Date()
    const fireAt = new Date(now.getTime() + 2 * 60 * 1000)
    services.fetchCalendars.mockResolvedValue([
      { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
    ])
    services.fetchEvents.mockResolvedValue([
      {
        id: 'retro-1',
        title: 'Retro',
        start: wallClock(new Date(fireAt.getTime() + 15 * 60 * 1000)),
        end: wallClock(new Date(fireAt.getTime() + 45 * 60 * 1000)),
        calendarId: 'https://cloud.example/caldav/user-1/personal/',
        reminders: [15]
      }
    ])

    const showMessage = vi.fn()
    const handle = startReminders({ isEnabled: () => true, showMessage, openItem: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1000)

    expect(showMessage).toHaveBeenCalledWith({ title: 'Retro', desc: expect.any(String) })
    handle.stop()
  })

  // ── Findings wired into the engine ─────────────────────────────────────────

  it('the engine never auto-creates collections (fetchCalendars runs without auto-create)', async () => {
    services.fetchCalendars.mockResolvedValue([])

    const handle = startReminders({
      isEnabled: () => true,
      showMessage: vi.fn(),
      openItem: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    // A user with no calendars must not get a "Calendar" MKCOL from the
    // background reminder loop — not even when the Calendar app is disabled.
    expect(services.fetchCalendars).toHaveBeenCalledWith({ autoCreate: false })
    handle.stop()
  })

  it('a failed fetch keeps the armed timers instead of dropping them', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    const now = new Date()
    const fireAt = new Date(now.getTime() + 2 * 60 * 1000)
    services.fetchCalendars.mockResolvedValue([
      { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
    ])
    services.fetchEvents.mockResolvedValue([
      {
        id: 'kept-1',
        title: 'Kept alarm',
        start: wallClock(new Date(fireAt.getTime() + 15 * 60 * 1000)),
        end: wallClock(new Date(fireAt.getTime() + 45 * 60 * 1000)),
        calendarId: 'https://cloud.example/caldav/user-1/personal/',
        reminders: [15]
      }
    ])

    const showMessage = vi.fn()
    const handle = startReminders({ isEnabled: () => true, showMessage, openItem: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    expect(showMessage).not.toHaveBeenCalled()

    // The next refresh fails on both services (server hiccup). The scheduler
    // must treat that as "unknown", not as "all alarms gone".
    services.calError.value = 'REPORT calendar-query failed: 503'
    services.tasksError.value = 'REPORT calendar-query failed: 503'
    services.fetchEvents.mockResolvedValue([])
    services.fetchTasks.mockResolvedValue([])
    handle.refresh()
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1000)

    expect(showMessage).toHaveBeenCalledWith({ title: 'Kept alarm', desc: expect.any(String) })
    handle.stop()
  })

  it('stopping the engine closes the cross-tab lock channel', () => {
    const instances: FakeChannel[] = []
    class FakeChannel {
      listeners: Array<(event: MessageEvent) => void> = []
      closed = false
      constructor() {
        instances.push(this)
      }
      postMessage(): void {
        for (const listener of this.listeners) listener({ data: {} } as MessageEvent)
      }
      addEventListener(_type: string, listener: (event: MessageEvent) => void): void {
        this.listeners.push(listener)
      }
      removeEventListener(): void {
        /* ignored by the fake */
      }
      close(): void {
        this.closed = true
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel)

    const handle = startReminders({
      isEnabled: () => true,
      showMessage: vi.fn(),
      openItem: vi.fn()
    })
    handle.stop()

    // Every off/on toggle used to leak one BroadcastChannel; stop() closes it.
    expect(instances.length).toBeGreaterThan(0)
    for (const channel of instances) expect(channel.closed).toBe(true)
  })

  it('the shown log is keyed per DAV user, so two accounts never share it', async () => {
    const storage = memoryStorage()
    const lockFor = (user: string) =>
      createCrossTabLock({ storage, storageKey: () => `${SHOWN_STORAGE_KEY}.${user}` })

    expect(lockFor('user-1').tryClaim('a|single|trigger')).toBe(true)
    // A second account in the same browser claims the same reminder independently.
    expect(lockFor('user-2').tryClaim('a|single|trigger')).toBe(true)
    // Each log only suppresses its own user's reminders.
    expect(lockFor('user-1').tryClaim('a|single|trigger')).toBe(false)
    expect(lockFor('user-2').tryClaim('a|single|trigger')).toBe(false)

    // Both accounts have their own log entry, neither sees the other's key.
    expect(storage.getItem('planner.reminders.shown.user-1')).toContain('"a|single|trigger"')
    expect(storage.getItem('planner.reminders.shown.user-2')).toContain('"a|single|trigger"')
    expect(storage.getItem('planner.reminders.shown')).toBeNull()
    // davUserId is the identity source once discovery ran (see dav-client-state.spec).
    expect(typeof davUserId()).toBe('string')
  })
})
