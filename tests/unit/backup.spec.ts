import { beforeEach, describe, expect, it, vi } from 'vitest'

const fns = vi.hoisted(() => ({
  fetchCalendars: vi.fn(),
  fetchEvents: vi.fn(),
  fetchAddressBooks: vi.fn(),
  fetchContacts: vi.fn(),
  fetchTasks: vi.fn(),
  /** Mirrors of the real services' error refs. */
  calError: { value: null as string | null },
  tasksError: { value: null as string | null },
  contactsError: { value: null as string | null }
}))

vi.mock('../../src/composables/useCalendarService', () => ({
  useCalendarService: () => ({
    fetchCalendars: fns.fetchCalendars,
    fetchEvents: fns.fetchEvents,
    error: fns.calError
  }),
  createCollection: vi.fn(),
  escapeXml: (value: string) => value,
  formatIfMatch: (value: string) => value
}))

vi.mock('../../src/composables/useTasksService', () => ({
  useTasksService: () => ({
    fetchTasks: fns.fetchTasks,
    calendars: { value: [] as Array<{ url: string; displayName: string }> },
    error: fns.tasksError
  })
}))

vi.mock('../../src/composables/useContactsService', () => ({
  useContactsService: () => ({
    fetchAddressBooks: fns.fetchAddressBooks,
    fetchContacts: fns.fetchContacts,
    error: fns.contactsError
  })
}))

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_NAME,
  buildBackup,
  planRestore,
  type BackupManifest
} from '../../src/tools/backup'
import { readZip, type ZipEntry } from '../../src/tools/zip'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

const PERSONAL = {
  url: 'https://cloud.example/caldav/user-1/personal/',
  displayName: 'Personal',
  color: '#00677F',
  description: '',
  ctag: ''
}
const WORK = {
  url: 'https://cloud.example/caldav/user-1/work/',
  displayName: 'Work',
  color: '#C41E3A',
  description: '',
  ctag: ''
}
const CONTACTS_BOOK = {
  url: 'https://cloud.example/carddav/user-1/contacts/',
  displayName: 'Contacts',
  description: '',
  ctag: ''
}

const EVENT_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Foreign//Client//EN',
  'BEGIN:VEVENT',
  'UID:standup-1',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260105T090000Z',
  'DTEND:20260105T100000Z',
  'SUMMARY:Standup',
  'END:VEVENT',
  'END:VCALENDAR',
  ''
].join('\r\n')

const VCARD = ['BEGIN:VCARD', 'VERSION:3.0', 'UID:maria-1', 'FN:Maria Weber', 'END:VCARD', ''].join(
  '\r\n'
)

function entry(name: string, text: string): ZipEntry {
  return { name, data: encoder.encode(text) }
}

beforeEach(() => {
  fns.fetchCalendars.mockResolvedValue([PERSONAL, WORK])
  fns.fetchEvents.mockImplementation(async (url: string) =>
    url === PERSONAL.url
      ? [
          {
            id: 'standup-1',
            title: 'Standup',
            start: '2026-01-05 09:00',
            end: '2026-01-05 10:00',
            calendarId: PERSONAL.url,
            rawIcs: EVENT_ICS
          }
        ]
      : []
  )
  fns.fetchAddressBooks.mockResolvedValue([CONTACTS_BOOK])
  fns.fetchTasks.mockResolvedValue([])
  fns.calError.value = null
  fns.tasksError.value = null
  fns.contactsError.value = null
  fns.fetchContacts.mockResolvedValue([
    { id: 'maria-1', displayName: 'Maria Weber', rawVcard: VCARD }
  ])
})

describe('buildBackup', () => {
  it('backup manifest lists all collections with colors', async () => {
    const { blob, failed } = await buildBackup()
    expect(failed).toEqual([])
    const entries = await readZip(await blob.arrayBuffer())

    const names = entries.map((e) => e.name)
    expect(names).toContain(BACKUP_MANIFEST_NAME)
    expect(names).toEqual([BACKUP_MANIFEST_NAME, 'personal.ics', 'work.ics', 'contacts.vcf'])

    const manifest = JSON.parse(
      decoder.decode(entries.find((e) => e.name === BACKUP_MANIFEST_NAME)!.data)
    ) as BackupManifest

    expect(manifest.app).toBe('planner')
    expect(manifest.version).toBe(BACKUP_FORMAT_VERSION)
    expect(manifest.created).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(manifest.collections).toEqual([
      { file: 'personal.ics', kind: 'calendar', displayName: 'Personal', color: '#00677F' },
      { file: 'work.ics', kind: 'calendar', displayName: 'Work', color: '#C41E3A' },
      { file: 'contacts.vcf', kind: 'addressbook', displayName: 'Contacts' }
    ])
  })

  it('writes one merged .ics per calendar and one .vcf per address book', async () => {
    const { blob } = await buildBackup()
    const entries = await readZip(await blob.arrayBuffer())

    const personal = decoder.decode(entries.find((e) => e.name === 'personal.ics')!.data)
    expect(personal).toContain('SUMMARY:Standup')
    expect(personal).toContain('X-WR-CALNAME:Personal')
    // An empty calendar still gets a (valid, event-less) VCALENDAR.
    const work = decoder.decode(entries.find((e) => e.name === 'work.ics')!.data)
    expect(work).toContain('BEGIN:VCALENDAR')
    expect(work).not.toContain('SUMMARY:')

    const contacts = decoder.decode(entries.find((e) => e.name === 'contacts.vcf')!.data)
    expect(contacts).toContain('FN:Maria Weber')
  })

  it('keeps file names unique when two collections share a name', async () => {
    fns.fetchCalendars.mockResolvedValue([
      { ...PERSONAL, displayName: 'My Calendar' },
      { ...WORK, displayName: 'My Calendar' }
    ])

    const { blob } = await buildBackup()
    const entries = await readZip(await blob.arrayBuffer())
    expect(entries.map((e) => e.name)).toEqual([
      BACKUP_MANIFEST_NAME,
      'my-calendar.ics',
      'my-calendar-2.ics',
      'contacts.vcf'
    ])
  })

  it('reports a collection whose fetch failed instead of shipping a silent empty backup', async () => {
    // The Work calendar's REPORT fails (the real services return [] and set
    // their error ref — mirrored here).
    fns.fetchEvents.mockImplementation(async (url: string) => {
      if (url === WORK.url) {
        fns.calError.value = 'REPORT calendar-query failed: 503'
        return []
      }
      fns.calError.value = null
      return [
        {
          id: 'standup-1',
          title: 'Standup',
          start: '2026-01-05 09:00',
          end: '2026-01-05 10:00',
          calendarId: PERSONAL.url,
          rawIcs: EVENT_ICS
        }
      ]
    })

    const { blob, failed } = await buildBackup()
    const entries = await readZip(await blob.arrayBuffer())

    expect(failed).toEqual([{ kind: 'calendar', displayName: 'Work' }])
    const manifest = JSON.parse(
      decoder.decode(entries.find((e) => e.name === BACKUP_MANIFEST_NAME)!.data)
    ) as BackupManifest
    // The failed collection did not make it into the backup or its manifest …
    expect(manifest.collections.map((c) => c.file)).toEqual(['personal.ics', 'contacts.vcf'])
    // … but the healthy ones did.
    const personal = decoder.decode(entries.find((e) => e.name === 'personal.ics')!.data)
    expect(personal).toContain('SUMMARY:Standup')
  })

  it('a failing address book is reported as well', async () => {
    fns.fetchAddressBooks.mockResolvedValue([
      CONTACTS_BOOK,
      {
        ...CONTACTS_BOOK,
        displayName: 'Broken',
        url: 'https://cloud.example/carddav/user-1/broken/'
      }
    ])
    fns.fetchContacts.mockImplementation(async (url: string) => {
      if (url.endsWith('broken/')) {
        fns.contactsError.value = 'REPORT addressbook-query failed: 500'
        return []
      }
      fns.contactsError.value = null
      return [{ id: 'maria-1', displayName: 'Maria Weber', rawVcard: VCARD }]
    })

    const { failed } = await buildBackup()

    expect(failed).toEqual([{ kind: 'addressbook', displayName: 'Broken' }])
  })

  it('tasks (VTODO) are exported next to the events of their calendar', async () => {
    const TODO_ICS = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Foreign//Client//EN',
      'BEGIN:VTODO',
      'UID:todo-1',
      'DTSTAMP:20260101T000000Z',
      'SUMMARY:File taxes',
      'DUE:20260301T100000Z',
      'END:VTODO',
      'END:VCALENDAR',
      ''
    ].join('\r\n')
    fns.fetchTasks.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'File taxes',
        due: '2026-03-01 10:00',
        calendarId: PERSONAL.url,
        rawIcs: TODO_ICS
      }
    ])

    const { blob, failed } = await buildBackup()
    expect(failed).toEqual([])
    const entries = await readZip(await blob.arrayBuffer())
    const personal = decoder.decode(entries.find((e) => e.name === 'personal.ics')!.data)

    // One file holds both the event and the task — a restore round-trips both.
    expect(personal).toContain('SUMMARY:Standup')
    expect(personal).toContain('BEGIN:VTODO')
    expect(personal).toContain('SUMMARY:File taxes')
  })
})

describe('planRestore', () => {
  const manifest = JSON.stringify({
    app: 'planner',
    version: 1,
    created: '2026-01-01T10:00:00.000Z',
    collections: [
      { file: 'personal.ics', kind: 'calendar', displayName: 'Personal', color: '#00677F' },
      { file: 'holidays.ics', kind: 'calendar', displayName: 'Holidays' },
      { file: 'contacts.vcf', kind: 'addressbook', displayName: 'Contacts' }
    ]
  })

  it('restore plan maps by displayName to existing collections, else new', () => {
    const plan = planRestore(
      [
        entry(BACKUP_MANIFEST_NAME, manifest),
        entry('personal.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
        entry('holidays.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
        entry('contacts.vcf', 'BEGIN:VCARD\r\nEND:VCARD\r\n'),
        entry('notes.txt', 'hello')
      ],
      {
        calendars: [{ url: PERSONAL.url, displayName: 'personal' }],
        addressBooks: [{ url: CONTACTS_BOOK.url, displayName: 'Contacts' }]
      }
    )

    expect(plan.manifest?.app).toBe('planner')
    expect(plan.items).toHaveLength(3)

    expect(plan.items[0]).toMatchObject({
      fileName: 'personal.ics',
      kind: 'calendar',
      displayName: 'Personal',
      color: '#00677F',
      existingUrl: PERSONAL.url,
      suggestedName: 'Personal'
    })
    // No collection is called "Holidays" → the user gets a new one.
    expect(plan.items[1]).toMatchObject({ displayName: 'Holidays', existingUrl: null })
    expect(plan.items[2]).toMatchObject({
      kind: 'addressbook',
      existingUrl: CONTACTS_BOOK.url
    })
    expect(plan.skipped).toEqual(['notes.txt'])
  })

  it('falls back to file names when the manifest is missing or foreign', () => {
    const plan = planRestore([entry('holidays.ics', 'x'), entry('contacts.vcf', 'y')])

    expect(plan.manifest).toBeNull()
    expect(plan.items.map((item) => [item.fileName, item.displayName, item.existingUrl])).toEqual([
      ['holidays.ics', 'holidays', null],
      ['contacts.vcf', 'contacts', null]
    ])
    expect(plan.skipped).toEqual([])
  })

  it('ignores macOS metadata entries in a zip from Finder', () => {
    const plan = planRestore([
      entry('personal.ics', 'x'),
      entry('__MACOSX/._personal.ics', 'binary'),
      entry('._personal.ics', 'binary')
    ])

    expect(plan.items.map((item) => item.fileName)).toEqual(['personal.ics'])
    expect(plan.skipped).toEqual(['__MACOSX/._personal.ics', '._personal.ics'])
  })

  it('ignores a manifest written by another app', () => {
    const plan = planRestore([
      entry(BACKUP_MANIFEST_NAME, JSON.stringify({ app: 'other-app', collections: [] })),
      entry('personal.ics', 'x')
    ])

    expect(plan.manifest).toBeNull()
    expect(plan.items[0].displayName).toBe('personal')
  })
})
