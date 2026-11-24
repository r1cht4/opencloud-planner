// @vitest-environment happy-dom
/**
 * ContactsToolsCard – the two halves of Settings → Data.
 *
 * `part="import"` renders the `.vcf` block of "Import & export" (address-book
 * selection, resync on `refreshKey`, import dialog, export/toast, `changed` after an
 * import); `part="cleanup"` renders the collapsed "Clean up" group (its own
 * address-book selector, merge duplicates) and loads the address books lazily when
 * that section is opened. The birthday sync lives in Settings → Contacts →
 * Birthdays (`BirthdaysSettings.vue`) now.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { Contact } from '../../src/types'

const state = vi.hoisted(() => ({
  addressBooks: null as unknown,
  contacts: null as unknown
}))

const fns = vi.hoisted(() => ({
  fetchAddressBooks: vi.fn(),
  fetchContacts: vi.fn(),
  showMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  prepareImport: vi.fn()
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({
    showMessage: fns.showMessage,
    showErrorMessage: fns.showErrorMessage
  })
}))

vi.mock('../../src/composables/useDAVClient', () => ({
  useDAVClient: () => ({ ensureReady: async () => true }),
  ensureReady: async () => true
}))

vi.mock('../../src/composables/useContactsService', async () => {
  const { ref: vueRef } = await import('vue')
  const addressBooks = vueRef<unknown[]>([])
  const contacts = vueRef<unknown[]>([])
  state.addressBooks = addressBooks
  state.contacts = contacts
  return {
    useContactsService: () => ({
      addressBooks,
      contacts,
      fetchAddressBooks: fns.fetchAddressBooks,
      fetchContacts: fns.fetchContacts,
      updateContact: vi.fn(),
      deleteContact: vi.fn()
    })
  }
})

vi.mock('../../src/composables/useImport', () => ({
  useImport: () => ({ prepareImport: fns.prepareImport })
}))

vi.mock('../../src/components/ImportDialog.vue', () => ({
  default: {
    name: 'ImportDialog',
    emits: ['close', 'imported'],
    template: '<div class="import-dialog-stub" />'
  }
}))

import ContactsToolsCard from '../../src/components/tools/ContactsToolsCard.vue'

const BOOKS = [
  { url: 'http://dav/card/user/work/', displayName: 'Work', description: '', ctag: '' },
  { url: 'http://dav/card/user/family/', displayName: 'Family', description: '', ctag: '' }
]

const WORK = BOOKS[0].url
const FAMILY = BOOKS[1].url

/** Minimal Contact: the merge groups by display name and by e-mail. */
function contact(id: string, displayName: string, email: string): Contact {
  return {
    id,
    displayName,
    firstName: '',
    lastName: '',
    emails: [{ type: 'home', value: email }],
    phones: [],
    addresses: [],
    organization: '',
    title: '',
    notes: ''
  }
}

const ALICE = contact('alice-1', 'Alice Adams', 'alice@example.com')
const ALICE_AGAIN = contact('alice-2', 'Alice Adams', 'a.adams@example.com')

/** The cleanup half rendered where it really sits: inside the collapsible section. */
const CleanupSection = defineComponent({
  components: { ContactsToolsCard },
  template: '<details class="clean-up"><ContactsToolsCard part="cleanup" /></details>'
})

function mountCard(props: Record<string, unknown> = {}) {
  return mount(ContactsToolsCard, {
    props,
    // The merge dialog is teleported to the body: query it there.
    attachTo: document.body,
    global: {
      stubs: {
        'oc-button': { template: '<button v-bind="$attrs"><slot /></button>' },
        'oc-icon': true
      }
    }
  })
}

function mountCleanupSection() {
  return mount(CleanupSection, {
    attachTo: document.body,
    global: {
      stubs: {
        'oc-button': { template: '<button v-bind="$attrs"><slot /></button>' },
        'oc-icon': true
      }
    }
  })
}

/** Everything the merge dialog renders lives in a Teleport to the body. */
function bodyQuery<T extends Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector)
}

function mergeCardNames(): string[] {
  return Array.from(document.body.querySelectorAll('.merge-card-name')).map(
    (name) => name.textContent?.trim() ?? ''
  )
}

/** Open the "Clean up" `<details>` — the event the real disclosure fires. */
async function openCleanupSection(wrapper: ReturnType<typeof mountCleanupSection>) {
  const details = wrapper.find('details').element as HTMLDetailsElement
  details.open = true
  details.dispatchEvent(new Event('toggle'))
  await flushPromises()
}

/** Press "Merge duplicates" (both mounts are attached to the body). */
async function clickMerge(): Promise<void> {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes('Merge duplicates')
  )
  expect(button).toBeTruthy()
  button!.click()
  await flushPromises()
}

function addressBooksRef() {
  return state.addressBooks as { value: unknown[] }
}

function contactsRef() {
  return state.contacts as { value: unknown[] }
}

afterEach(() => {
  vi.clearAllMocks()
  if (state.addressBooks) addressBooksRef().value = []
  if (state.contacts) contactsRef().value = []
  document.body.innerHTML = ''
})

describe('ContactsToolsCard', () => {
  it('mounts as one block of the import group and loads the address books', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS

    const wrapper = mountCard()
    await flushPromises()

    // A block inside the group card — no card chrome, no repeated heading.
    expect(wrapper.find('div.settings-block.contacts-tools-card').exists()).toBe(true)
    expect(wrapper.find('p.settings-block-title').text()).toBe('Contacts (.vcf)')
    expect(wrapper.find('.tool-card').exists()).toBe(false)
    expect(fns.fetchAddressBooks).toHaveBeenCalledTimes(1)
    // The first book becomes the selection and its contacts are fetched.
    expect(fns.fetchContacts).toHaveBeenCalledWith(BOOKS[0].url)

    const options = wrapper.findAll('select.settings-select option')
    expect(options.map((option) => option.text())).toEqual(['Work', 'Family'])
    expect(wrapper.find('select.settings-select').attributes('aria-label')).toBe('Address book')
    expect(wrapper.find('input[type="file"]').classes()).toContain('file-input-hidden')
  })

  it('re-loads when refreshKey changes', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS

    const wrapper = mountCard({ refreshKey: 1 })
    await flushPromises()
    expect(fns.fetchAddressBooks).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ refreshKey: 2 })
    await flushPromises()
    expect(fns.fetchAddressBooks).toHaveBeenCalledTimes(2)
  })

  it('keeps the export button and reports an empty selection', async () => {
    fns.fetchAddressBooks.mockResolvedValue([])
    addressBooksRef().value = []

    const wrapper = mountCard()
    await flushPromises()

    const exportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Export .vcf'))
    expect(exportButton).toBeTruthy()

    await exportButton!.trigger('click')
    expect(fns.showMessage).toHaveBeenCalledWith({ title: 'Nothing to export' })
  })

  it('opens the merge dialog only when duplicates exist', async () => {
    fns.fetchAddressBooks.mockResolvedValue([])
    addressBooksRef().value = []

    const wrapper = mountCard({ part: 'cleanup' })
    await flushPromises()

    await clickMerge()

    // No contacts → nothing to merge, no dialog.
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(fns.showMessage).toHaveBeenCalled()
  })

  it('loads the address books lazily in the Clean up half', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS

    const wrapper = mountCard({ part: 'cleanup' })
    await flushPromises()
    // Opening the Data tab must not fetch the same collections twice.
    expect(fns.fetchAddressBooks).not.toHaveBeenCalled()

    await clickMerge()

    expect(fns.fetchAddressBooks).toHaveBeenCalledTimes(1)
    expect(fns.fetchContacts).toHaveBeenCalledWith(BOOKS[0].url)
  })

  it('reads the address books when the Clean up section is opened', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS

    const wrapper = mountCleanupSection()
    await flushPromises()
    // Rendering the Data tab (section still collapsed) fetches nothing …
    expect(fns.fetchAddressBooks).not.toHaveBeenCalled()

    await openCleanupSection(wrapper)

    // … and opening it gives the cleanup half its own selector.
    expect(fns.fetchAddressBooks).toHaveBeenCalledTimes(1)
    const select = wrapper.find('select.settings-select')
    expect(select.attributes('aria-label')).toBe('Address book')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['Work', 'Family'])

    // Same layout as "Duplicate events": a title, then select + button on one row.
    expect(wrapper.find('.contacts-cleanup .settings-block-title').text()).toBe(
      'Duplicate contacts'
    )
    const row = wrapper.find('.contacts-cleanup .settings-button-row')
    expect(row.find('select').classes()).toContain('settings-select--grow')
    expect(row.text()).toContain('Merge duplicates')
  })

  it('merges the address book chosen in the Clean up select, not the first one', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS
    // Only the second book holds the duplicate pair.
    fns.fetchContacts.mockImplementation(async (url: string) => {
      contactsRef().value = url === FAMILY ? [ALICE, ALICE_AGAIN] : [ALICE]
    })

    const wrapper = mountCleanupSection()
    await openCleanupSection(wrapper)

    await wrapper.find('select.settings-select').setValue(FAMILY)
    await flushPromises()
    expect(fns.fetchContacts).toHaveBeenLastCalledWith(FAMILY)

    await clickMerge()

    // Merging `books[0]` (one contact) would report "No duplicates found".
    expect(fns.showMessage).not.toHaveBeenCalledWith({ title: 'No duplicates found' })
    expect(mergeCardNames()).toEqual(['Alice Adams', 'Alice Adams'])
    expect(fns.fetchContacts).toHaveBeenLastCalledWith(FAMILY)
  })

  it('re-reads the selected address book on every Merge duplicates press', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS
    // First read (mount) and first press: one contact. Second press: the pair that a
    // `.vcf` import in the other half added in the meantime.
    let reads = 0
    fns.fetchContacts.mockImplementation(async () => {
      reads++
      contactsRef().value = reads <= 2 ? [ALICE] : [ALICE, ALICE_AGAIN]
    })

    const wrapper = mountCleanupSection()
    await openCleanupSection(wrapper)

    await clickMerge()
    expect(bodyQuery('[role="dialog"]')).toBeNull()
    expect(fns.showMessage).toHaveBeenCalledWith({ title: 'No duplicates found' })

    await clickMerge()

    expect(fns.fetchContacts).toHaveBeenCalledTimes(3)
    expect(bodyQuery('[role="dialog"]')).not.toBeNull()
    expect(mergeCardNames()).toHaveLength(2)
  })

  it('reports a finished import to the page so the other cards refresh', async () => {
    fns.fetchAddressBooks.mockResolvedValue(BOOKS)
    addressBooksRef().value = BOOKS
    fns.prepareImport.mockResolvedValue({
      items: [{ name: 'a.vcf', text: 'BEGIN:VCARD\r\nEND:VCARD' }],
      suggestedName: 'contacts'
    })

    const wrapper = mountCard()
    await flushPromises()

    const file = new File(['BEGIN:VCARD\r\nEND:VCARD'], 'a.vcf', { type: 'text/vcard' })
    // happy-dom may not implement Blob.text(); the pipeline only needs the text.
    Object.defineProperty(file, 'text', {
      value: async () => 'BEGIN:VCARD\r\nEND:VCARD'
    })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    wrapper.findComponent({ name: 'ImportDialog' }).vm.$emit('imported', {
      kind: 'contacts',
      created: 1,
      exists: 0,
      failed: 0,
      targetUrl: BOOKS[0].url
    })
    await flushPromises()

    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
