// @vitest-environment happy-dom
/**
 * Reminder wiring (Part 1.1) — the engine runs exactly while the user's
 * `settings.reminders.enabled` is on, restarts on a toggle, and `refreshReminders()`
 * (called by the views after local writes) reaches the active scheduler.
 *
 * `startReminders` itself is mocked: its behaviour (fetch window, grace, cross-tab
 * lock) is covered by `reminder-scheduler.spec.ts`. Here only the *lifetime* is
 * under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const fns = vi.hoisted(() => ({
  startReminders: vi.fn()
}))

vi.mock('../../src/reminders', () => ({
  startReminders: fns.startReminders
}))

/**
 * The host's auth store: `defineWebApplication.setup()` runs
 * before the access token exists, and the reminder engine must not send its
 * first DAV fetch until it does. `null` = not running inside OpenCloud.
 */
const auth = vi.hoisted(() => ({
  store: null as null | { accessToken: string }
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => auth.store
}))

import { refreshReminders, startReminderWiring } from '../../src/setup/reminders'

interface FakeHandle {
  stop: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
}

function fakeHandle(): FakeHandle {
  return { stop: vi.fn(), refresh: vi.fn() }
}

const options = {
  isEnabled: (): boolean => true,
  showMessage: (): undefined => undefined,
  openItem: (): undefined => undefined
}

beforeEach(() => {
  fns.startReminders.mockReset()
  fns.startReminders.mockImplementation(() => fakeHandle())
  auth.store = reactive({ accessToken: 'test-token' })
})

describe('startReminderWiring', () => {
  it('does not start the scheduler when reminders are disabled', () => {
    const enabled = ref(false)
    startReminderWiring(options, enabled)

    expect(fns.startReminders).not.toHaveBeenCalled()
  })

  it('starts the scheduler when reminders are enabled', () => {
    const enabled = ref(true)
    startReminderWiring(options, enabled)

    expect(fns.startReminders).toHaveBeenCalledTimes(1)
    // The engine is started "enabled" — the wiring owns the switch now.
    expect(fns.startReminders.mock.calls[0][0].isEnabled()).toBe(true)
  })

  it('restarts on toggle and stops the previous handle', async () => {
    const enabled = ref(true)
    const first = fakeHandle()
    const second = fakeHandle()
    fns.startReminders.mockImplementationOnce(() => first).mockImplementationOnce(() => second)

    startReminderWiring(options, enabled)
    expect(fns.startReminders).toHaveBeenCalledTimes(1)

    enabled.value = false
    await nextTick()
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(fns.startReminders).toHaveBeenCalledTimes(1)

    enabled.value = true
    await nextTick()
    expect(fns.startReminders).toHaveBeenCalledTimes(2)
    expect(second.stop).not.toHaveBeenCalled()
  })

  it('keeps no reference to a stopped scheduler', async () => {
    const enabled = ref(true)
    const first = fakeHandle()
    fns.startReminders.mockImplementationOnce(() => first)

    startReminderWiring(options, enabled)
    enabled.value = false
    await nextTick()

    refreshReminders()
    expect(first.refresh).not.toHaveBeenCalled()
  })

  it('passes the setup-time services through on every (re)start', async () => {
    const enabled = ref(false)
    const services = {
      calendarService: { fetchCalendars: vi.fn(), fetchEvents: vi.fn() },
      tasksService: { fetchTasks: vi.fn() }
    }

    startReminderWiring({ ...options, services }, enabled)
    enabled.value = true
    await nextTick()

    expect(fns.startReminders.mock.calls[0][0].services).toBe(services)
  })

  it('forwards refreshReminders to the active handle', () => {
    const enabled = ref(true)
    const handle = fakeHandle()
    fns.startReminders.mockImplementationOnce(() => handle)

    startReminderWiring(options, enabled)
    refreshReminders()

    expect(handle.refresh).toHaveBeenCalledTimes(1)
    // The engine is only refreshed — never restarted — by a local write.
    expect(fns.startReminders).toHaveBeenCalledTimes(1)
  })

  it('is a no-op after the wiring was stopped', () => {
    const enabled = ref(true)
    const handle = fakeHandle()
    fns.startReminders.mockImplementationOnce(() => handle)

    const stop = startReminderWiring(options, enabled)
    stop()

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(() => refreshReminders()).not.toThrow()
  })
})

describe('startReminderWiring access-token gate', () => {
  it('starts nothing while signed out and starts once the token appears', async () => {
    const store = reactive({ accessToken: '' })
    auth.store = store
    const enabled = ref(true)

    startReminderWiring(options, enabled)

    // Signed out: `setup()` runs before the host has the token, and a DAV
    // fetch here would answer 401 and log "DAV init failed" on every page load.
    expect(fns.startReminders).not.toHaveBeenCalled()

    store.accessToken = 'token-1'
    await nextTick()

    expect(fns.startReminders).toHaveBeenCalledTimes(1)
    // A token refresh must not restart the engine a second time.
    store.accessToken = 'token-2'
    await nextTick()
    expect(fns.startReminders).toHaveBeenCalledTimes(1)
  })

  it('an enabled-toggle before the token does not start the engine either', async () => {
    const store = reactive({ accessToken: '' })
    auth.store = store
    const enabled = ref(false)

    const stop = startReminderWiring(options, enabled)
    enabled.value = true
    await nextTick()
    expect(fns.startReminders).not.toHaveBeenCalled()

    store.accessToken = 'token-1'
    await nextTick()
    expect(fns.startReminders).toHaveBeenCalledTimes(1)

    stop()
  })
})
