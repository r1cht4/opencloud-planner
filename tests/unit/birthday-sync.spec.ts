/**
 * Birthday reconcile — the only data-*mutating* birthday path (it can DELETE).
 * Driven against a tiny in-memory DAV so create / update / prune and the
 * mass-deletion safety guard are exercised without a real server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared fake-DAV state + a davFetch that speaks just enough CalDAV.
const dav = vi.hoisted(() => {
  const server = new Map<string, string>() // href -> ICS body
  const ctx = { calExists: false }
  const calls: Array<{ method: string; url: string }> = []

  function multistatus(): string {
    const items = [...server.entries()]
      .map(
        ([href, ics]) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
          `<d:getetag>"etag"</d:getetag>` +
          `<cal:calendar-data>${ics}</cal:calendar-data>` +
          `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
      .join('')
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${items}</d:multistatus>`
  }

  async function davFetch(url: string, opts: any = {}): Promise<any> {
    const method = opts.method || 'GET'
    calls.push({ method, url })
    switch (method) {
      case 'PROPFIND':
        return { ok: ctx.calExists, status: ctx.calExists ? 207 : 404 }
      case 'MKCOL':
        ctx.calExists = true
        return { ok: true, status: 201 }
      case 'REPORT':
        return { ok: true, status: 207, text: async () => multistatus() }
      case 'PUT':
        server.set(url, opts.body)
        ctx.calExists = true
        return { ok: true, status: 201, headers: { get: () => '"etag"' } }
      case 'DELETE':
        server.delete(url)
        return { ok: true, status: 204 }
      default:
        return { ok: false, status: 500 }
    }
  }

  return { server, ctx, calls, davFetch }
})

// Contacts the reconcile will see (mutated per test), the address books it
// walks, and which of them fail.
const contactsState = vi.hoisted(() => ({
  list: [] as any[],
  books: [{ url: 'http://dav/card/user/book/' }] as Array<{ url: string }>,
  failingBooks: new Set<string>(),
  /** Mirrors the real service's error ref. */
  error: { value: null as string | null }
}))

// Synced settings document (enabled / calendar / reminder come from here).
const settingsState = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  admin: {} as Record<string, unknown>,
  calls: [] as Array<[string, unknown]>,
  loaded: true,
  error: null as string | null
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
  return createSettingsStoreMock(settingsState)
})

vi.mock('../../src/composables/useDAVClient', () => ({
  davFetch: (url: string, opts: any) => dav.davFetch(url, opts),
  propfind: vi.fn(),
  // Safe UIDs pass through, unsafe ones map to a deterministic fake hash.
  davResourceName: async (uid: string) =>
    /^[A-Za-z0-9._@-]+$/.test(uid ?? '') ? uid : 'x'.repeat(64),
  // Per-user storage keys get the user id from here.
  davUserId: () => 'user-1',
  useDAVClient: () => ({
    ensureReady: async () => true,
    getState: () => ({ principalUrl: 'http://dav/cal/user/', baseUrl: 'http://dav/cal/' })
  })
}))

vi.mock('../../src/composables/useContactsService', () => ({
  useContactsService: () => ({
    fetchAddressBooks: async () => contactsState.books,
    fetchContacts: async (url: string) => {
      if (contactsState.failingBooks.has(url)) {
        contactsState.error.value = 'REPORT addressbook-query failed: 500'
        return []
      }
      contactsState.error.value = null
      return contactsState.list
    },
    error: contactsState.error
  })
}))

import { buildIcs } from '../../src/composables/useCalendarService'
import {
  isBirthdaySyncEnabled,
  setBirthdaySyncEnabled,
  useBirthdaySync
} from '../../src/composables/useBirthdaySync'
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'

const CAL = 'http://dav/cal/user/birthdays/'

async function seed(href: string, opts: { id: string; title: string; start: string; end: string }) {
  dav.server.set(href, await buildIcs({ ...opts, rrule: 'FREQ=YEARLY' }))
}

beforeEach(() => {
  dav.server.clear()
  dav.calls.length = 0
  dav.ctx.calExists = false
  contactsState.list = []
  contactsState.books = [{ url: 'http://dav/card/user/book/' }]
  contactsState.failingBooks.clear()
  contactsState.error.value = null
  localStorage.clear()
  setMockSettingsDocument(settingsState, {})
  settingsState.calls = []
})
afterEach(() => vi.clearAllMocks())

describe('useBirthdaySync.reconcile', () => {
  it('creates the calendar and a missing birthday event', async () => {
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 1, updated: 0, removed: 0 })
    expect(dav.calls.some((c) => c.method === 'MKCOL')).toBe(true)
    expect(dav.server.has(`${CAL}bday-c1.ics`)).toBe(true)
  })

  it('updates an event when the contact is renamed', async () => {
    dav.ctx.calExists = true
    await seed(`${CAL}bday-c1.ics`, {
      id: 'bday-c1',
      title: '🎂 Alice',
      start: '2026-06-15',
      end: '2026-06-16'
    })
    contactsState.list = [{ id: 'c1', displayName: 'Alice Smith', birthday: '1990-06-15' }]

    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 0, updated: 1, removed: 0 })
    expect(dav.server.get(`${CAL}bday-c1.ics`)).toContain('SUMMARY:🎂 Alice Smith')
  })

  it('is a no-op when nothing changed', async () => {
    dav.ctx.calExists = true
    await seed(`${CAL}bday-c1.ics`, {
      id: 'bday-c1',
      title: '🎂 Alice',
      start: '2026-06-15',
      end: '2026-06-16'
    })
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 0, updated: 0, removed: 0 })
  })

  it('prunes an orphaned birthday event', async () => {
    dav.ctx.calExists = true
    await seed(`${CAL}bday-c1.ics`, {
      id: 'bday-c1',
      title: '🎂 Alice',
      start: '2026-06-15',
      end: '2026-06-16'
    })
    await seed(`${CAL}bday-gone.ics`, {
      id: 'bday-gone',
      title: '🎂 Ghost',
      start: '2026-03-03',
      end: '2026-03-04'
    })
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 0, updated: 0, removed: 1 })
    expect(dav.server.has(`${CAL}bday-gone.ics`)).toBe(false)
    expect(dav.server.has(`${CAL}bday-c1.ics`)).toBe(true)
  })

  it('does NOT wipe the calendar when contacts come back empty (safety guard)', async () => {
    dav.ctx.calExists = true
    await seed(`${CAL}bday-c1.ics`, {
      id: 'bday-c1',
      title: '🎂 Alice',
      start: '2026-06-15',
      end: '2026-06-16'
    })
    contactsState.list = [] // simulates a transient contacts-fetch failure

    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 0, updated: 0, removed: 0 })
    expect(dav.server.has(`${CAL}bday-c1.ics`)).toBe(true)
    expect(dav.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('derives a URL-safe, deterministic resource name from an awkward contact id (UID untouched)', async () => {
    contactsState.list = [{ id: 'urn:uuid:AB/CD', displayName: 'Bob', birthday: '1985-12-01' }]

    await useBirthdaySync().reconcile()

    // The shared helper: safe UID as-is, unsafe → its (faked-)SHA-256 here.
    expect(dav.server.has(`${CAL}bday-${'x'.repeat(64)}.ics`)).toBe(true)
    // The birthday event keeps the *identity* of the chosen name in its data.
    const ics = dav.server.get(`${CAL}bday-${'x'.repeat(64)}.ics`)!
    expect(ics).toContain(`UID:bday-${'x'.repeat(64)}`)
  })

  it('a single failing address book does not get its birthdays pruned', async () => {
    dav.ctx.calExists = true
    contactsState.books = [
      { url: 'http://dav/card/user/book-a/' },
      { url: 'http://dav/card/user/book-b/' }
    ]
    // Both books' birthday events already exist from a previous, healthy sync.
    await seed(`${CAL}bday-alice.ics`, {
      id: 'bday-alice',
      title: '🎂 Alice',
      start: '2026-06-15',
      end: '2026-06-16'
    })
    await seed(`${CAL}bday-bob.ics`, {
      id: 'bday-bob',
      title: '🎂 Bob',
      start: '2026-03-03',
      end: '2026-03-04'
    })
    // Book A answers, book B fails — but the calendars show both events.
    contactsState.list = [{ id: 'alice', displayName: 'Alice', birthday: '1990-06-15' }]
    contactsState.failingBooks.add('http://dav/card/user/book-b/')

    const res = await useBirthdaySync().reconcile()

    // Bob's birthday is NOT an orphan (his book merely failed), so nothing is
    // deleted and nothing is recreated either (Alice is unchanged).
    expect(res).toMatchObject({ created: 0, updated: 0 })
    expect(dav.server.has(`${CAL}bday-bob.ics`)).toBe(true)
    expect(dav.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('the once-per-day throttle stamp is stored per DAV user', async () => {
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true } })
    contactsState.list = [{ id: 'alice', displayName: 'Alice', birthday: '1990-06-15' }]

    await useBirthdaySync().maybeAutoSync()

    expect(localStorage.getItem('cc-birthday-sync-last:user-1')).not.toBeNull()
    // The old global key is never written again — another account in the same
    // browser is not throttled by this user's run.
    expect(localStorage.getItem('cc-birthday-sync-last')).toBeNull()
  })
})

describe('birthday settings', () => {
  it('enabled read from settings not localStorage', () => {
    // A stale per-device flag must not switch the feature on or off any more.
    localStorage.setItem('cc-birthday-sync-enabled', '1')
    setMockSettingsDocument(settingsState, { birthdays: { enabled: false } })
    expect(isBirthdaySyncEnabled()).toBe(false)

    localStorage.setItem('cc-birthday-sync-enabled', '0')
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true } })
    expect(isBirthdaySyncEnabled()).toBe(true)
    localStorage.removeItem('cc-birthday-sync-enabled')
  })

  it('writes the enable toggle into the synced settings', () => {
    setMockSettingsDocument(settingsState, {})

    setBirthdaySyncEnabled(true)

    expect(settingsState.calls).toContainEqual(['birthdays.enabled', true])
  })

  it('target calendar setting used for reconcile', async () => {
    const custom = 'http://dav/cal/user/family-birthdays/'
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true, calendar: custom } })
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    await useBirthdaySync().reconcile()

    // Every write landed in the configured collection, not in `birthdays/`.
    expect(dav.calls.some((call) => call.url === custom && call.method === 'PROPFIND')).toBe(true)
    expect(dav.calls.some((call) => call.url === custom && call.method === 'MKCOL')).toBe(true)
    expect(dav.server.has(`${custom}bday-c1.ics`)).toBe(true)
    expect(dav.calls.some((call) => call.url.startsWith(CAL))).toBe(false)
  })

  it('birthday reminder writes one DISPLAY VALARM per birthday event (-P1D at 09:00 → TRIGGER:-PT15H for all-day)', async () => {
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true, reminder: 1440 } })
    dav.ctx.calExists = true
    contactsState.list = [
      { id: 'c1', displayName: 'Alice', birthday: '1990-06-15' },
      { id: 'c2', displayName: 'Bob', birthday: '1985-12-01' }
    ]

    await useBirthdaySync().reconcile()

    const alice = dav.server.get(`${CAL}bday-c1.ics`)!
    expect(alice.match(/BEGIN:VALARM/g)).toHaveLength(1)
    expect(alice).toContain('ACTION:DISPLAY')
    // All-day event (midnight DTSTART): 09:00 the day before = -15 h.
    expect(alice).toContain('TRIGGER:-PT15H')

    const bob = dav.server.get(`${CAL}bday-c2.ics`)!
    expect(bob.match(/BEGIN:VALARM/g)).toHaveLength(1)
  })

  it('no reminder setting leaves the birthday events alarm-free', async () => {
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true } })
    dav.ctx.calExists = true
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    await useBirthdaySync().reconcile()

    expect(dav.server.get(`${CAL}bday-c1.ics`)).not.toContain('BEGIN:VALARM')
  })

  it('a changed reminder updates the existing events', async () => {
    dav.ctx.calExists = true
    contactsState.list = [{ id: 'c1', displayName: 'Alice', birthday: '1990-06-15' }]

    // First sync without a reminder…
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true } })
    await useBirthdaySync().reconcile()
    expect(dav.server.get(`${CAL}bday-c1.ics`)).not.toContain('BEGIN:VALARM')

    // …then the user turns one on: the next reconcile rewrites the event.
    setMockSettingsDocument(settingsState, { birthdays: { enabled: true, reminder: 60 } })
    const res = await useBirthdaySync().reconcile()

    expect(res).toEqual({ created: 0, updated: 1, removed: 0 })
    const ics = dav.server.get(`${CAL}bday-c1.ics`)!
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1)
    // 1 hour before 09:00 = 08:00 on the birthday → 8 h *after* the midnight start.
    expect(ics).toMatch(/TRIGGER:\+?PT8H/)
  })
})
