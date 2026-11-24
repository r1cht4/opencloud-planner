// @vitest-environment happy-dom
/**
 * `startConnectionProbe()` must not probe before the access token exists.
 *
 * `defineWebApplication.setup()` runs before OpenCloud stores the token, and the
 * CalDAV proxy answers 401 to an unauthenticated request. Probing right away would
 * classify a healthy install as `unauthorized` and gate every view behind the setup
 * state (the same trap the settings document fell into).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

/** The host's auth store; `null` = not running inside OpenCloud. */
const auth = vi.hoisted(() => ({
  store: null as null | { accessToken: string }
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => auth.store
}))

import { resetConnectionProbe, useConnectionProbe } from '../../src/composables/useConnectionProbe'
import { startConnectionProbe } from '../../src/setup/connection'

/** Minimal reactive-enough store: `watch` needs a reactive getter to fire. */
async function makeStore(token: string): Promise<{ accessToken: string }> {
  const { reactive } = await import('vue')
  const store = reactive({ accessToken: token })
  auth.store = store as { accessToken: string }
  return auth.store as { accessToken: string }
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ status: 207 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  resetConnectionProbe()
  auth.store = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startConnectionProbe', () => {
  it('probes immediately when the token is already there', async () => {
    const fetchMock = stubFetch()
    const store = await makeStore('token-1')

    startConnectionProbe()
    await flushPromises()

    expect(store.accessToken).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useConnectionProbe().outcome.value).toBe('ok')
  })

  it('waits for the access token instead of reporting "unauthorized"', async () => {
    const fetchMock = stubFetch()
    const store = await makeStore('')

    startConnectionProbe()
    await flushPromises()

    // Signed out: no request, and the gate keeps showing its spinner.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useConnectionProbe().outcome.value).toBe('pending')

    store.accessToken = 'token-2'
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useConnectionProbe().outcome.value).toBe('ok')
  })

  it('probes right away when there is no host auth store (standalone/dev)', async () => {
    const fetchMock = stubFetch()
    auth.store = null

    startConnectionProbe()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('probes only once when the token arrives', async () => {
    const fetchMock = stubFetch()
    const store = await makeStore('')

    startConnectionProbe()
    store.accessToken = 'token-3'
    await nextTick()
    await flushPromises()
    // A second token change (a refresh) must not re-arm a second probe: the
    // watcher stops itself after the first token.
    store.accessToken = 'token-4'
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
