/**
 * useImport — the shared import pipeline (Tools view + Files app actions).
 *
 * Services are mocked so the two target modes (existing collection vs. one
 * created on the fly), the verbatim PUT dispatch and the imported / skipped /
 * failed aggregation are covered without a DAV server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const messages = vi.hoisted(() => ({
  shown: [] as Array<{ title: string; desc?: string; status: string }>
}))

const services = vi.hoisted(() => ({
  importEventIcs: vi.fn(),
  importContactVcard: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchAddressBooks: vi.fn(),
  createCollection: vi.fn(),
  ensureReady: vi.fn(),
  getState: vi.fn()
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string) => text,
    // English plural rule with %{count} interpolation, like the real runtime.
    $ngettext: (singular: string, plural: string, n: number) =>
      (n === 1 ? singular : plural).replace('%{count}', String(n))
  })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({
    showMessage: (msg: { title: string; desc?: string }) =>
      messages.shown.push({ ...msg, status: 'success' }),
    showErrorMessage: (msg: { title: string; desc?: string }) =>
      messages.shown.push({ ...msg, status: 'error' })
  })
}))

vi.mock('../../src/composables/useDAVClient', () => ({
  useDAVClient: () => ({ ensureReady: services.ensureReady, getState: services.getState })
}))

vi.mock('../../src/composables/useCalendarService', () => ({
  useCalendarService: () => ({
    fetchCalendars: services.fetchCalendars,
    importEventIcs: services.importEventIcs
  }),
  createCollection: services.createCollection
}))

vi.mock('../../src/composables/useContactsService', () => ({
  useContactsService: () => ({
    fetchAddressBooks: services.fetchAddressBooks,
    importContactVcard: services.importContactVcard
  })
}))

import {
  fileBaseName,
  summariseImport,
  useImport,
  type PreparedImport
} from '../../src/composables/useImport'

const PRINCIPAL = 'http://dav.test/user-1/'
const CRLF = '\r\n'

function ics(lines: string[]): string {
  return lines.join(CRLF) + CRLF
}

const EVENT_ICS = ics([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Foreign//Client//EN',
  'X-WR-CALNAME:Family',
  'BEGIN:VEVENT',
  'UID:event-1',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260706T090000Z',
  'DTEND:20260706T100000Z',
  'SUMMARY:Standup',
  'END:VEVENT',
  'END:VCALENDAR'
])

const CARD_VCF = `BEGIN:VCARD${CRLF}VERSION:3.0${CRLF}UID:card-1${CRLF}FN:Ada${CRLF}END:VCARD${CRLF}`

function calendarPrepared(): PreparedImport {
  return {
    kind: 'calendar',
    items: [{ uid: 'u1', ics: 'ICS-1', summary: 'One' }],
    suggestedName: 'Imported'
  }
}

beforeEach(() => {
  messages.shown.length = 0
  Object.values(services).forEach((fn) => fn.mockReset())
  services.ensureReady.mockResolvedValue(true)
  services.getState.mockReturnValue({ principalUrl: PRINCIPAL })
  services.createCollection.mockResolvedValue(undefined)
})

describe('summariseImport', () => {
  const t = {
    $gettext: (text: string) => text,
    $ngettext: (singular: string, plural: string, n: number) =>
      (n === 1 ? singular : plural).replace('%{count}', String(n))
  }

  it('pluralises the imported events over the singular', () => {
    expect(summariseImport('calendar', { created: 3, exists: 0, failed: 0 }, t)).toEqual({
      title: '3 events imported',
      status: 'success'
    })
    expect(summariseImport('calendar', { created: 1, exists: 0, failed: 0 }, t)).toEqual({
      title: '1 event imported',
      status: 'success'
    })
  })

  it('counts created contacts and skipped duplicates', () => {
    expect(summariseImport('contacts', { created: 2, exists: 1, failed: 0 }, t)).toEqual({
      title: '2 contacts imported, 1 item skipped (already exists)',
      status: 'success'
    })
  })

  it('reports "already exists" when nothing was new', () => {
    expect(summariseImport('contacts', { created: 0, exists: 2, failed: 0 }, t)).toEqual({
      title: 'Everything in this file already exists',
      status: 'success'
    })
  })

  it('is an error when everything failed', () => {
    const summary = summariseImport('calendar', { created: 0, exists: 0, failed: 2 }, t)
    expect(summary.status).toBe('error')
    expect(summary.title).toBe('2 items failed')
  })

  it('stays a success when only some items failed', () => {
    const summary = summariseImport('calendar', { created: 1, exists: 0, failed: 1 }, t)
    expect(summary.status).toBe('success')
    expect(summary.title).toBe('1 event imported, 1 item failed')
  })
})

describe('fileBaseName', () => {
  it('strips the extension and trims', () => {
    expect(fileBaseName('holidays-2026.ics')).toBe('holidays-2026')
    expect(fileBaseName(' team.vcf ')).toBe('team')
  })
})

describe('prepareImport', () => {
  it('prefills the new calendar name from X-WR-CALNAME', async () => {
    const prepared = await useImport().prepareImport('calendar', EVENT_ICS, 'ignored.ics')
    expect(prepared?.suggestedName).toBe('Family')
    expect(prepared?.kind).toBe('calendar')
    expect(prepared?.items).toHaveLength(1)
    expect((prepared?.items[0] as { ics: string }).ics).toContain('SUMMARY:Standup')
  })

  it('falls back to the file name, then to a generic name', async () => {
    const withoutName = EVENT_ICS.replace(`X-WR-CALNAME:Family${CRLF}`, '')
    expect(
      (await useImport().prepareImport('calendar', withoutName, 'holidays-2026.ics'))?.suggestedName
    ).toBe('holidays-2026')
    expect((await useImport().prepareImport('calendar', withoutName, ''))?.suggestedName).toBe(
      'Calendar'
    )
  })

  it('reports a file without events instead of importing nothing', async () => {
    const prepared = await useImport().prepareImport('calendar', 'not an ics file', 'empty.ics')
    expect(prepared).toBeNull()
    expect(messages.shown.at(-1)).toMatchObject({
      title: 'No events found in file',
      status: 'error'
    })
  })

  it('splits vCards and prefills the address book name from the file name', async () => {
    const prepared = await useImport().prepareImport('contacts', CARD_VCF, 'team.vcf')
    expect(prepared?.kind).toBe('contacts')
    expect(prepared?.suggestedName).toBe('team')
    expect((prepared?.items[0] as { vcard: string }).vcard).toContain('FN:Ada')
  })

  it('reports a file without contacts', async () => {
    const prepared = await useImport().prepareImport('contacts', 'nothing here', 'empty.vcf')
    expect(prepared).toBeNull()
    expect(messages.shown.at(-1)).toMatchObject({
      title: 'No contacts found in file',
      status: 'error'
    })
  })
})

describe('loadTargets', () => {
  it('maps calendars and address books to selectable targets', async () => {
    services.fetchCalendars.mockResolvedValue([
      {
        url: `${PRINCIPAL}personal/`,
        displayName: 'Personal',
        color: '',
        description: '',
        ctag: ''
      }
    ])
    services.fetchAddressBooks.mockResolvedValue([
      { url: `${PRINCIPAL}contacts/`, displayName: 'Contacts', description: '', ctag: '' }
    ])

    const { loadTargets } = useImport()
    expect(await loadTargets('calendar')).toEqual([
      { url: `${PRINCIPAL}personal/`, displayName: 'Personal' }
    ])
    expect(await loadTargets('contacts')).toEqual([
      { url: `${PRINCIPAL}contacts/`, displayName: 'Contacts' }
    ])
  })
})

describe('runImport into an existing target', () => {
  it('PUTs every event verbatim and aggregates the counts', async () => {
    services.importEventIcs
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('exists')
      .mockResolvedValueOnce('failed')

    const prepared: PreparedImport = {
      kind: 'calendar',
      items: [
        { uid: 'u1', ics: 'ICS-1', summary: 'One' },
        { uid: 'u2', ics: 'ICS-2', summary: 'Two' },
        { uid: 'u3', ics: 'ICS-3', summary: 'Three' }
      ],
      suggestedName: 'Imported'
    }

    const counts = await useImport().runImport(prepared, {
      mode: 'existing',
      targetUrl: `${PRINCIPAL}personal/`
    })

    expect(counts).toEqual({
      kind: 'calendar',
      created: 1,
      exists: 1,
      failed: 1,
      targetUrl: `${PRINCIPAL}personal/`
    })
    // No collection is created for an existing target.
    expect(services.createCollection).not.toHaveBeenCalled()
    expect(services.importEventIcs).toHaveBeenNthCalledWith(
      1,
      `${PRINCIPAL}personal/`,
      'u1',
      'ICS-1'
    )
    expect(services.importEventIcs).toHaveBeenNthCalledWith(
      3,
      `${PRINCIPAL}personal/`,
      'u3',
      'ICS-3'
    )
  })

  it('PUTs vCards through the contacts service', async () => {
    services.importContactVcard.mockResolvedValue('created')

    const counts = await useImport().runImport(
      {
        kind: 'contacts',
        items: [{ uid: 'c1', vcard: 'CARD-1', displayName: 'Ada' }],
        suggestedName: 'Team'
      },
      { mode: 'existing', targetUrl: `${PRINCIPAL}contacts/` }
    )

    expect(counts?.created).toBe(1)
    expect(services.importContactVcard).toHaveBeenCalledWith(
      `${PRINCIPAL}contacts/`,
      'c1',
      'CARD-1'
    )
  })

  it('does nothing without a target url', async () => {
    const counts = await useImport().runImport(calendarPrepared(), { mode: 'existing' })
    expect(counts).toBeNull()
    expect(services.importEventIcs).not.toHaveBeenCalled()
  })
})

describe('runImport into a new target', () => {
  it('creates the collection from the slug and imports into it', async () => {
    services.importEventIcs.mockResolvedValue('created')

    const counts = await useImport().runImport(calendarPrepared(), {
      mode: 'new',
      newName: 'Holidays 2026'
    })

    expect(services.createCollection).toHaveBeenCalledWith(
      `${PRINCIPAL}holidays-2026/`,
      'calendar',
      'Holidays 2026'
    )
    expect(counts?.targetUrl).toBe(`${PRINCIPAL}holidays-2026/`)
    expect(services.importEventIcs).toHaveBeenCalledWith(
      `${PRINCIPAL}holidays-2026/`,
      'u1',
      'ICS-1'
    )
  })

  it('creates an addressbook collection for contacts', async () => {
    services.importContactVcard.mockResolvedValue('created')

    const counts = await useImport().runImport(
      {
        kind: 'contacts',
        items: [{ uid: 'c1', vcard: 'CARD-1', displayName: 'Ada' }],
        suggestedName: 'Team'
      },
      { mode: 'new', newName: 'Team Book' }
    )

    expect(services.createCollection).toHaveBeenCalledWith(
      `${PRINCIPAL}team-book/`,
      'addressbook',
      'Team Book'
    )
    expect(counts?.targetUrl).toBe(`${PRINCIPAL}team-book/`)
  })

  it('retries once with a suffixed slug when the name is taken', async () => {
    services.importEventIcs.mockResolvedValue('created')
    services.createCollection
      .mockRejectedValueOnce(new Error('405 Method Not Allowed'))
      .mockResolvedValueOnce(undefined)

    const counts = await useImport().runImport(calendarPrepared(), {
      mode: 'new',
      newName: 'Duplicate'
    })

    expect(services.createCollection).toHaveBeenCalledTimes(2)
    const [secondUrl] = services.createCollection.mock.calls[1]
    expect(secondUrl).toMatch(new RegExp(`^${PRINCIPAL}duplicate-[a-z0-9]+/$`))
    expect(counts?.targetUrl).toBe(secondUrl)
  })

  it('reports that the collection could not be created', async () => {
    services.createCollection.mockRejectedValue(new Error('405 Method Not Allowed'))

    const counts = await useImport().runImport(calendarPrepared(), {
      mode: 'new',
      newName: 'Broken'
    })

    expect(counts).toBeNull()
    expect(services.importEventIcs).not.toHaveBeenCalled()
    expect(messages.shown.at(-1)).toMatchObject({
      title: 'Could not create calendar',
      status: 'error'
    })
  })

  it('reports a missing principal as an error, without creating anything', async () => {
    services.getState.mockReturnValue(null)

    const counts = await useImport().runImport(calendarPrepared(), {
      mode: 'new',
      newName: 'Nowhere'
    })

    expect(counts).toBeNull()
    expect(services.createCollection).not.toHaveBeenCalled()
    expect(messages.shown.at(-1)).toMatchObject({ title: 'Could not create calendar' })
  })
})

describe('importInto', () => {
  it('reports the counts together with the open-app hint', async () => {
    services.importContactVcard.mockResolvedValue('exists')

    const counts = await useImport().importInto(
      {
        kind: 'contacts',
        items: [{ uid: 'c1', vcard: 'CARD-1', displayName: 'Ada' }],
        suggestedName: 'Team'
      },
      { mode: 'existing', targetUrl: `${PRINCIPAL}contacts/` },
      { hint: 'Open Contacts to see the imported contacts.' }
    )

    expect(counts?.exists).toBe(1)
    expect(messages.shown.at(-1)).toMatchObject({
      title: 'Everything in this file already exists',
      desc: 'Open Contacts to see the imported contacts.',
      status: 'success'
    })
  })

  it('does not report anything when the import could not start', async () => {
    const counts = await useImport().importInto(calendarPrepared(), { mode: 'existing' })
    expect(counts).toBeNull()
    expect(messages.shown).toHaveLength(0)
  })
})
