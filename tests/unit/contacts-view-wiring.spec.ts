// @vitest-environment happy-dom
/**
 * The view wiring: `views/Contacts.vue` orders and labels the list from
 * `contacts.sortBy` / `contacts.displayOrder`, opens `contacts.defaultAddressBook`
 * first and is wrapped in `ConnectionGate`.
 */
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

const settingsState = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  admin: {} as Record<string, unknown>,
  calls: [] as Array<[string, unknown]>,
  loaded: true,
  error: null as string | null,
  docRef: undefined as unknown as { value: Record<string, unknown> } | undefined
}))

const probe = vi.hoisted(() => ({ outcome: null as unknown as { value: string } }))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() }),
  useModals: () => ({ dispatchModal: vi.fn() }),
  useAbility: () => ({ can: () => false })
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
  return createSettingsStoreMock(settingsState)
})

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref: vueRef } = await import('vue')
  const outcome = vueRef<string>('ok')
  probe.outcome = outcome as unknown as { value: string }
  return {
    useConnectionProbe: () => ({
      outcome,
      probing: vueRef(false),
      lastResult: vueRef(null),
      retest: async (): Promise<void> => undefined
    }),
    probeOutcomeForStatus: () => 'ok'
  }
})

import ContactsView from '../../src/views/Contacts.vue'

const ORIGIN = 'http://localhost:3000'
const BOOK_PERSONAL = `${ORIGIN}/carddav/user-1/personal/`
const BOOK_WORK = `${ORIGIN}/carddav/user-1/work/`

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/carddav/</d:href>
    <d:propstat>
      <d:prop><d:current-user-principal><d:href>/carddav/user-1/</d:href></d:current-user-principal></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const addressBooksXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>${BOOK_PERSONAL}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>${BOOK_WORK}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:displayname>Work</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

type TestContact = {
  uid: string
  fn: string
  first: string
  last: string
  bday?: string
}

const CONTACTS: TestContact[] = [
  { uid: 'ada', fn: 'Ada Lovelace', first: 'Ada', last: 'Lovelace' },
  { uid: 'grace', fn: 'Grace Hopper', first: 'Grace', last: 'Hopper' },
  { uid: 'zoe', fn: 'Zoe Adams', first: 'Zoe', last: 'Adams' }
]

/** Contacts of the next mount (tests swap in their own fixtures). */
let currentContacts: TestContact[] = CONTACTS

function vcard(contact: TestContact): string {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${contact.uid}`,
    `FN:${contact.fn}`,
    `N:${contact.last};${contact.first};;;`,
    ...(contact.bday ? [`BDAY:${contact.bday}`] : []),
    'END:VCARD'
  ].join('\r\n')
}

function reportXml(): string {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
${currentContacts
  .map(
    (contact) => `  <d:response>
    <d:href>${BOOK_PERSONAL}${contact.uid}.vcf</d:href>
    <d:propstat>
      <d:prop><d:getetag>"e-${contact.uid}"</d:getetag><card:address-data>${vcard(contact)}</card:address-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`
}

function stubFetch(): Array<{ method: string; url: string; body: string }> {
  const calls: Array<{ method: string; url: string; body: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any = {}) => {
      const method = String(init.method || 'GET')
      const body = String(init.body ?? '')
      calls.push({ method, url: String(url), body })
      const respond = (status: number, text = '') => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        headers: new Headers()
      })
      if (method === 'PROPFIND') {
        if (body.includes('current-user-principal')) return respond(207, principalXml)
        return respond(207, addressBooksXml)
      }
      if (method === 'REPORT') return respond(207, reportXml())
      if (method === 'PUT') return respond(204)
      return respond(404)
    })
  )
  return calls
}

let wrapper: VueWrapper | null = null

async function mountContacts(): Promise<VueWrapper> {
  wrapper = mount(ContactsView, {
    global: {
      stubs: {
        ContactDetail: true,
        PageHeaderActions: true,
        'oc-icon': true,
        'oc-button': true,
        'oc-spinner': true,
        'oc-text-input': true,
        'oc-select': true
      }
    }
  })
  await vi.waitFor(() => expect(wrapper!.findAll('.contact-row').length).toBe(3), {
    timeout: 10_000
  })
  return wrapper
}

function listedNames(view: VueWrapper): string[] {
  return view.findAll('.contact-name').map((node) => node.text())
}

beforeEach(() => {
  currentContacts = CONTACTS
  setMockSettingsDocument(settingsState, {})
  settingsState.locked = []
  settingsState.admin = {}
  settingsState.calls = []
  settingsState.loaded = true
  settingsState.error = null
  probe.outcome.value = 'ok'
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('Contacts view keeps year-less birthdays', () => {
  it('saves the stored --MMDD back when the date picker stays empty', async () => {
    currentContacts = [
      {
        uid: 'bettina',
        fn: 'Bettina Yearless',
        first: 'Bettina',
        last: 'Yearless',
        bday: '--0415'
      },
      { uid: 'ada', fn: 'Ada Lovelace', first: 'Ada', last: 'Lovelace' },
      { uid: 'grace', fn: 'Grace Hopper', first: 'Grace', last: 'Hopper' }
    ]
    const calls = stubFetch()
    const view = await mountContacts()

    // Open the edit dialog of the year-less contact (`<script setup>` state
    // lives on the component instance's setupState, refs already unwrapped).
    const setupState = (view.vm.$ as unknown as { setupState: Record<string, unknown> })
      .setupState as unknown as {
      openEditDialog: (contact: Record<string, unknown>) => void
      displayContacts: Record<string, unknown>[]
    }
    const bettina = setupState.displayContacts.find(
      (contact) => contact.id === 'bettina'
    ) as Record<string, unknown>
    expect(bettina).toBeDefined()
    setupState.openEditDialog(bettina)
    await nextTick()

    // The dialog teleports to <body>; the date input shows nothing
    // (`type=date` cannot display --04-15), yet the hint tells the user the
    // value is kept.
    expect(document.body.textContent).toContain('Birthday without year')

    // Save without touching anything: the PUT must carry the year-less BDAY.
    const form = document.querySelector('form.modal-form') as HTMLFormElement | null
    expect(form).not.toBeNull()
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.body.includes('BDAY:--0415'))).toBe(true)
    )
  })
})

describe('Contacts view honours the contacts settings', () => {
  it('contacts sorted by firstName', async () => {
    setMockSettingsDocument(settingsState, { contacts: { sortBy: 'firstName' } })
    stubFetch()
    const view = await mountContacts()

    expect(listedNames(view)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Zoe Adams'])
  })

  it('sorts by last name by default', async () => {
    stubFetch()
    const view = await mountContacts()

    expect(listedNames(view)).toEqual(['Zoe Adams', 'Grace Hopper', 'Ada Lovelace'])
  })

  it('renders the list label in the configured display order', async () => {
    setMockSettingsDocument(settingsState, {
      contacts: { sortBy: 'firstName', displayOrder: 'lastFirst' }
    })
    stubFetch()
    const view = await mountContacts()

    expect(listedNames(view)).toEqual(['Lovelace, Ada', 'Hopper, Grace', 'Adams, Zoe'])
    // Only the list is formatted — the detail pane keeps the stored name.
    expect(view.text()).not.toContain('FN:')
  })

  it('opens the default address book first', async () => {
    setMockSettingsDocument(settingsState, { contacts: { defaultAddressBook: BOOK_WORK } })
    const calls = stubFetch()
    await mountContacts()

    // The contacts REPORT went to the configured book, not to the first one.
    const report = calls.find((call) => call.method === 'REPORT')
    expect(report?.url).toBe(BOOK_WORK)
  })

  it('feeds a settings change into the list without reloading', async () => {
    stubFetch()
    const view = await mountContacts()
    expect(listedNames(view)[0]).toBe('Zoe Adams')

    setMockSettingsDocument(settingsState, { contacts: { sortBy: 'firstName' } })
    await vi.waitFor(() => expect(listedNames(view)[0]).toBe('Ada Lovelace'), {
      timeout: 10_000
    })
  })

  it('wraps the view in ConnectionGate', async () => {
    stubFetch()
    const view = await mountContacts()
    expect(view.find('.contact-list').exists()).toBe(true)

    probe.outcome.value = 'unavailable'
    await vi.waitFor(() => expect(view.text()).toContain('The calendar server is not reachable'), {
      timeout: 10_000
    })
    expect(view.find('.contact-list').exists()).toBe(false)
  })
})
