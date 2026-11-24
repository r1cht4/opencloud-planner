// @vitest-environment happy-dom
/**
 * Settings storage — the one place that talks DAV for the settings document.
 *
 * `fetch` is mocked end-to-end (a tiny stateful Radicale principal) so the real
 * PROPFIND/PROPPATCH bodies are asserted, not a stubbed helper's arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAdminConfig } from '../../src/config/appConfig'

const PRINCIPAL = 'https://cloud.example/caldav/user-1/'

const dav = vi.hoisted(() => {
  const state = {
    /** Raw JSON text stored in the dead property (null = property missing). */
    stored: null as string | null,
    requests: [] as Array<{ method: string; url: string; body: string; keepalive: boolean }>,
    /** Force a status for the next PROPPATCH (save-failure test). */
    patchStatus: 207,
    /** Status inside the multistatus propstat of a 207 PROPPATCH. */
    patchPropstat: 200,
    /** Force the PROPFIND status — non-2xx simulates an unreadable document. */
    propfindStatus: 207,
    /** Optional gate each PROPPATCH waits for (serialization test). */
    patchGate: null as null | (() => Promise<void>),
    ready: true
  }

  function multistatus(withProperty: boolean): string {
    const prop = withProperty ? `<x:settings>${state.stored ?? ''}</x:settings>` : '<x:settings/>'
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:x="urn:x-planner"><d:response><d:href>/caldav/user-1/</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
  }

  /** A 207 whose propstat reports `state.patchPropstat` for the `x:settings` prop. */
  function patchMultistatus(): string {
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:x="urn:x-planner"><d:response><d:href>/caldav/user-1/</d:href><d:propstat><d:prop><x:settings/></d:prop><d:status>HTTP/1.1 ${state.patchPropstat} ${state.patchPropstat === 200 ? 'OK' : 'Forbidden'}</d:status></d:propstat></d:response></d:multistatus>`
  }

  async function fetchMock(url: string, init: any = {}): Promise<any> {
    const method = init.method || 'GET'
    const body = typeof init.body === 'string' ? init.body : ''
    state.requests.push({ method, url, body, keepalive: !!init.keepalive })

    if (method === 'PROPFIND') {
      if (state.propfindStatus !== 207 && state.propfindStatus !== 200) {
        return { status: state.propfindStatus, ok: false, text: async () => '' }
      }
      return {
        status: 207,
        ok: true,
        text: async () => multistatus(state.stored !== null)
      }
    }
    if (method === 'PROPPATCH') {
      if (state.patchStatus !== 207 && state.patchStatus !== 200)
        return { status: state.patchStatus, ok: false, text: async () => '' }
      if (state.patchGate) await state.patchGate()
      const match = /<x:settings>([\s\S]*)<\/x:settings>/.exec(body)
      state.stored = match ? match[1] : ''
      return { status: 207, ok: true, text: async () => patchMultistatus() }
    }
    return { status: 200, ok: true, text: async () => '' }
  }

  return { state, fetchMock }
})

vi.stubGlobal('fetch', dav.fetchMock)

/**
 * Auth bridge of `useDAVClient` (the real one wraps web-pkg's auth store). The
 * token is empty until the host hands it over, exactly like in the live app where
 * `defineWebApplication.setup()` runs before the sign-in finished.
 */
const auth = vi.hoisted(() => ({
  token: 'test-token',
  waiters: [] as Array<(token: string) => void>
}))

vi.mock('../../src/composables/useDAVClient', () => ({
  isAuthenticated: () => auth.token !== '',
  watchAccessToken: (onToken: (token: string) => void): (() => void) => {
    // Already signed in → nothing to wait for.
    if (auth.token) return (): void => undefined
    auth.waiters.push(onToken)
    return (): void => {
      auth.waiters = auth.waiters.filter((waiter) => waiter !== onToken)
    }
  },
  davFetch: (url: string, init: any = {}) => fetch(url, init),
  propfind: async (url: string, props: string, depth = '0', opts: any = {}) => {
    const resp = await fetch(url, {
      method: 'PROPFIND',
      body: props,
      headers: { Depth: depth },
      ...(opts.keepalive ? { keepalive: true } : {})
    })
    if (resp.status !== 207 && resp.status !== 200) {
      throw new Error(`PROPFIND ${url} failed: ${resp.status}`)
    }
    return resp.text()
  },
  useDAVClient: () => ({
    ensureReady: async () => dav.state.ready,
    getState: () => ({ principalUrl: PRINCIPAL, baseUrl: 'https://cloud.example/caldav' })
  })
}))

import {
  flushSettingsSave,
  loadUserSettings,
  saveUserSettings,
  resetSettingsStore,
  useSettings,
  whenSettingsLoaded
} from '../../src/settings/settingsStore'
import { parseSettingsDocument } from '../../src/settings/schema'

function propfinds() {
  return dav.state.requests.filter((r) => r.method === 'PROPFIND')
}
function propertyWrites() {
  return dav.state.requests.filter((r) => r.method === 'PROPPATCH')
}

/** Stored document, decoded from the escaped XML text. */
function storedDocument(): Record<string, unknown> {
  if (dav.state.stored === null) return {}
  return parseSettingsDocument(dav.state.stored)
}

/** Simulate the host putting an access token in the auth store. */
function emitAccessToken(token = 'test-token') {
  auth.token = token
  const waiters = auth.waiters
  auth.waiters = []
  for (const waiter of waiters) waiter(token)
}

beforeEach(() => {
  auth.token = 'test-token'
  auth.waiters = []
  dav.state.stored = null
  dav.state.requests.length = 0
  dav.state.patchStatus = 207
  dav.state.patchPropstat = 200
  dav.state.propfindStatus = 207
  dav.state.patchGate = null
  dav.state.ready = true
  localStorage.clear()
  setAdminConfig(undefined)
  resetSettingsStore()
})

afterEach(() => {
  resetSettingsStore()
  vi.restoreAllMocks()
})

describe('loadUserSettings', () => {
  it('PROPFIND reads property on principal', async () => {
    dav.state.stored = '{"version":1,"calendar":{"defaultView":"day"}}'

    const doc = await loadUserSettings()

    expect(doc).toEqual({ version: 1, calendar: { defaultView: 'day' } })
    const [request] = propfinds()
    expect(request.url).toBe(PRINCIPAL)
    // The dead property is requested in the app's own namespace.
    expect(request.body).toContain('urn:x-planner')
    expect(request.body).toContain('settings')
  })

  it('missing property → {}', async () => {
    expect(await loadUserSettings()).toEqual({})
  })

  it('malformed document → {}', async () => {
    dav.state.stored = '{not json'

    expect(await loadUserSettings()).toEqual({})
  })

  it('unreachable server → {} (the app keeps working on defaults)', async () => {
    dav.state.ready = false

    expect(await loadUserSettings()).toEqual({})
    expect(propfinds()).toHaveLength(0)
  })
})

describe('saveUserSettings', () => {
  it('PROPPATCH body escapes < and &', async () => {
    await saveUserSettings({ version: 1, note: 'a<b & c>d' })

    const [request] = propertyWrites()
    expect(request.url).toBe(PRINCIPAL)
    expect(request.body).toContain('propertyupdate')
    expect(request.body).toContain('&lt;b &amp; c&gt;')
    expect(request.body).not.toContain('a<b')
  })

  it('throws when the server rejects the write', async () => {
    dav.state.patchStatus = 500

    await expect(saveUserSettings({ version: 1 })).rejects.toThrow(/PROPPATCH/)
  })
})

describe('useSettings', () => {
  it('settings load waits for the access token', async () => {
    auth.token = ''
    const { settings, loaded, error } = useSettings()
    await flushSettingsSave()

    // Setup runs before the host stores the token: no DAV request (the proxy
    // would answer 401 and log "DAV init failed"), no error, nothing loaded.
    expect(propfinds()).toHaveLength(0)
    expect(loaded.value).toBe(false)
    expect(error.value).toBeNull()

    // ... the sign-in finishes and the token appears ...
    emitAccessToken()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    // Exactly one load — a later useSettings() (e.g. from a view) reuses it.
    expect(propfinds()).toHaveLength(1)
    useSettings()
    await flushSettingsSave()
    expect(propfinds()).toHaveLength(1)
    expect(settings.value.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])
  })

  it('resolves the stored document on load', async () => {
    dav.state.stored = '{"version":1,"calendar":{"defaultView":"day","weekNumbers":false}}'

    const { settings, loaded } = useSettings()
    await flushSettingsSave()
    // Wait for the single-flight load started by useSettings().
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    expect(settings.value.calendar.defaultView).toBe('day')
    expect(settings.value.calendar.weekNumbers).toBe(false)
    // Untouched settings keep their defaults.
    expect(settings.value.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])
  })

  it('update is debounced to one PROPPATCH', async () => {
    const { settings, update } = useSettings()
    await vi.waitFor(() => expect(propfinds().length).toBe(1))

    update('general.filesSidebar', ['calendar'])
    update('calendar.defaultView', 'month')
    update('general.enabledApps', ['calendar'])

    // Optimistic: visible immediately, nothing written yet.
    expect(settings.value.general.filesSidebar).toEqual(['calendar'])
    expect(propertyWrites()).toHaveLength(0)

    await flushSettingsSave()

    expect(propertyWrites()).toHaveLength(1)
    const stored = storedDocument()
    expect(stored.general).toMatchObject({ filesSidebar: ['calendar'], enabledApps: ['calendar'] })
    expect(stored.calendar).toMatchObject({ defaultView: 'month' })
    expect(stored.version).toBe(1)
  })

  it('save failure surfaces error', async () => {
    const { settings, update, error } = useSettings()
    await vi.waitFor(() => expect(propfinds().length).toBe(1))

    dav.state.patchStatus = 500
    update('general.filesSidebar', ['tasks'])
    await flushSettingsSave()

    expect(error.value).toMatch(/PROPPATCH/)
    // The local value is kept — the UI must not silently revert the user's choice.
    expect(settings.value.general.filesSidebar).toEqual(['tasks'])
  })

  it('keeps keys it does not know when saving', async () => {
    dav.state.stored = '{"version":1,"future":{"a":1},"calendar":{"defaultView":"week"}}'

    const { update, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    update('calendar.weekNumbers', false)
    await flushSettingsSave()

    expect(storedDocument().future).toEqual({ a: 1 })
  })

  it('boolean legacy value migrates', async () => {
    // Written by the first 2.0 pass: one on/off switch for all apps.
    dav.state.stored = '{"version":1,"general":{"filesSidebar":false}}'

    const { settings, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))
    await flushSettingsSave()

    expect(settings.value.general.filesSidebar).toEqual([])
    // The document is rewritten in the per-app shape (one PROPPATCH)...
    expect(propertyWrites()).toHaveLength(1)
    expect(storedDocument().general).toMatchObject({ filesSidebar: [] })
  })

  it('legacy true becomes every app', async () => {
    dav.state.stored = '{"version":1,"general":{"filesSidebar":true}}'

    const { settings, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))
    await flushSettingsSave()

    expect(settings.value.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])
    expect(storedDocument().general).toMatchObject({
      filesSidebar: ['calendar', 'contacts', 'tasks']
    })
  })

  it('migrates localStorage birthday toggle once', async () => {
    localStorage.setItem('cc-birthday-sync-enabled', '1')

    const { settings } = useSettings()
    await flushSettingsSave()
    await vi.waitFor(() => expect(propertyWrites().length).toBeGreaterThan(0))

    expect(settings.value.birthdays.enabled).toBe(true)
    expect(propertyWrites()).toHaveLength(1)
    expect(storedDocument().birthdays).toMatchObject({ enabled: true })
    expect(localStorage.getItem('cc-birthday-sync-enabled')).toBeNull()
  })

  it('does not resurrect a migrated birthday setting', async () => {
    localStorage.setItem('cc-birthday-sync-enabled', '1')

    const first = useSettings()
    await flushSettingsSave()
    await vi.waitFor(() => expect(first.loaded.value).toBe(true))

    resetSettingsStore()
    const second = useSettings()
    await second.reload()
    await flushSettingsSave()

    expect(second.settings.value.birthdays.enabled).toBe(true)
    // The one-off migration must not run a second time.
    expect(propertyWrites()).toHaveLength(1)
  })

  it('isLocked reflects the admin configuration', async () => {
    setAdminConfig({ locked: ['general.filesSidebar'] })

    const { isLocked, settings } = useSettings()

    expect(isLocked('general.filesSidebar')).toBe(true)
    expect(isLocked('calendar.defaultView')).toBe(false)
    expect(settings.value.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])
  })

  it('reload picks up a document changed elsewhere', async () => {
    const { settings, loaded, reload } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(settings.value.calendar.defaultView).toBe('week')

    dav.state.stored = '{"version":1,"calendar":{"defaultView":"list"}}'
    await reload()

    expect(settings.value.calendar.defaultView).toBe('list')
  })

  // ── Read-merge-write instead of blind overwrite ───────────────────────────

  it('a failed load never wipes the stored document (no PROPPATCH without a read)', async () => {
    dav.state.stored =
      '{"version":1,"calendar":{"defaultView":"day"},"reminders":{"enabled":false}}'
    // The server is up but the settings PROPFIND fails (e.g. Radicale restarting).
    dav.state.propfindStatus = 500

    const { update, error, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    update('calendar.defaultView', 'month')
    await flushSettingsSave()

    // No write happened: without a successful re-read there is nothing to merge
    // on top of, and saving the local `{}` would delete every stored key.
    expect(propertyWrites()).toHaveLength(0)
    expect(storedDocument().calendar).toMatchObject({ defaultView: 'day' })
    expect(error.value).toMatch(/read|load|PROPFIND/i)
  })

  it('keys changed on the server survive an update of another key', async () => {
    dav.state.stored = '{"version":1,"calendar":{"defaultView":"day","weekNumbers":false}}'

    const { update, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    // Another device changed weekNumbers while this one was running; a save
    // of only the locally changed key must not revert it.
    dav.state.stored =
      '{"version":1,"calendar":{"defaultView":"day","weekNumbers":false,"unknownKey":42}}'
    update('calendar.defaultView', 'month')
    await flushSettingsSave()

    const stored = storedDocument() as { calendar: Record<string, unknown> }
    expect(stored.calendar).toMatchObject({ defaultView: 'month', weekNumbers: false })
    // Keys this build does not model stay untouched as well.
    expect(stored.calendar.unknownKey).toBe(42)
  })

  it('an update made before the load is applied on top of the loaded document', async () => {
    auth.token = ''

    const { update, loaded } = useSettings()
    update('calendar.defaultView', 'month')

    // ... the sign-in finishes: the server document carries a different key.
    dav.state.stored = '{"version":1,"calendar":{"weekNumbers":false}}'
    emitAccessToken()
    await vi.waitFor(() => expect(loaded.value).toBe(true))
    await flushSettingsSave()

    const stored = storedDocument()
    expect(stored.calendar).toMatchObject({ defaultView: 'month', weekNumbers: false })
  })

  it('one save in flight at a time — a queued change waits and keeps its order', async () => {
    const { update, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    let release: () => void = () => undefined
    dav.state.patchGate = () => new Promise<void>((resolve) => (release = resolve))

    update('calendar.defaultView', 'month')
    const firstSave = flushSettingsSave()
    // The first PROPPATCH is in flight; a second change queues behind it.
    await vi.waitFor(() => expect(propertyWrites()).toHaveLength(1))
    update('calendar.weekNumbers', false)
    const secondSave = flushSettingsSave()
    await vi.waitFor(() => expect(propertyWrites()).toHaveLength(1))

    dav.state.patchGate = null
    release()
    await firstSave
    // The second save only starts once the first one landed.
    await vi.waitFor(() => expect(propertyWrites()).toHaveLength(2))
    await secondSave

    const [first, second] = propertyWrites()
    // The first write carries the first change only …
    expect(first.body).toContain('"defaultView":"month"')
    expect(first.body).not.toContain('"weekNumbers":false')
    // … and the second one lands after it, carrying the queued change (merged
    // on top of what the first write stored).
    expect(second.body).toContain('"defaultView":"month"')
    expect(second.body).toContain('"weekNumbers":false')
    expect(storedDocument().calendar).toMatchObject({ defaultView: 'month', weekNumbers: false })
  })

  // ── PROPPATCH propstat is checked, not just the status code ───────────────

  it('a 207 whose propstat was refused is a failed save', async () => {
    const { update, error, loaded, settings } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    dav.state.patchPropstat = 403
    update('general.filesSidebar', ['tasks'])
    await flushSettingsSave()

    expect(error.value).toMatch(/settings|rejected/i)
    expect(settings.value.general.filesSidebar).toEqual(['tasks'])
  })

  it('update refuses locked paths and invalid values', async () => {
    setAdminConfig({ locked: ['calendar.defaultView'] })

    const { update, loaded, settings } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(settings.value.calendar.defaultView).toBe('week')

    update('calendar.defaultView', 'month')
    update('calendar.dayStart', 'not-a-time')
    await flushSettingsSave()

    // Neither change is applied locally nor written to the server.
    expect(settings.value.calendar.defaultView).toBe('week')
    expect(settings.value.calendar.dayStart).toBe('06:00')
    expect(propertyWrites()).toHaveLength(0)
  })

  // ── The pagehide flush must survive the unload ────────────────────────────

  it('a save flushed on pagehide uses keepalive', async () => {
    const { update, loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    update('calendar.defaultView', 'month')
    window.dispatchEvent(new Event('pagehide'))
    await flushSettingsSave()

    // Both requests that make up the read-merge-write are sent with keepalive
    // so the browser finishes them after the page goes away.
    const reads = propfinds()
    const writes = propertyWrites()
    expect(reads.some((r) => r.keepalive)).toBe(true)
    expect(writes.some((r) => r.keepalive)).toBe(true)
    expect((storedDocument().calendar as Record<string, unknown>).defaultView).toBe('month')
  })
})

// ── The route guards' bounded wait for the document ────────────────────────

describe('whenSettingsLoaded', () => {
  it('answers at once when the document is already there', async () => {
    const { loaded } = useSettings()
    await vi.waitFor(() => expect(loaded.value).toBe(true))

    await expect(whenSettingsLoaded(1000)).resolves.toBe(true)
  })

  it('waits for the access token and the document instead of the built-in defaults', async () => {
    // `setup()` runs before the host stores the token: the document cannot be
    // read yet, and the navigation must not decide on the built-in default app.
    auth.token = ''
    const { loaded } = useSettings()
    let answered: boolean | null = null
    const waiting = whenSettingsLoaded(5000).then((arrived) => {
      answered = arrived
      return arrived
    })

    await Promise.resolve()
    expect(answered).toBeNull()
    expect(propfinds()).toHaveLength(0)

    // The sign-in finishes → the token appears → the single load runs.
    emitAccessToken()
    await expect(waiting).resolves.toBe(true)
    expect(loaded.value).toBe(true)
    expect(propfinds()).toHaveLength(1)
  })

  it('gives up after the timeout so a navigation never hangs', async () => {
    vi.useFakeTimers()
    try {
      // Nobody signs in: without the timeout this wait would never settle.
      auth.token = ''
      const waiting = whenSettingsLoaded(250)

      await vi.advanceTimersByTimeAsync(250)

      await expect(waiting).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
