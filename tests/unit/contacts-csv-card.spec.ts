// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mockState = vi.hoisted(() => ({
  addressBooks: null as any,
  contacts: null as any
}))

const fns = vi.hoisted(() => ({
  fetchAddressBooks: vi.fn(),
  fetchContacts: vi.fn()
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

vi.mock('../../src/composables/useContactsService', async () => {
  const { ref } = await import('vue')
  const addressBooks = ref<any[]>([])
  const contacts = ref<any[]>([])
  mockState.addressBooks = addressBooks
  mockState.contacts = contacts
  return {
    useContactsService: () => ({
      addressBooks,
      contacts,
      fetchAddressBooks: fns.fetchAddressBooks,
      fetchContacts: fns.fetchContacts
    }),
    buildVcard: (contact: any) => `BEGIN:VCARD\r\nFN:${contact.displayName}\r\nEND:VCARD\r\n`,
    escapeVcardText: (value: string) => value
  }
})

vi.mock('../../src/components/tools/CsvDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'CsvDialog',
      props: {
        mode: { type: String, default: 'import' },
        text: { type: String, default: '' },
        fileName: { type: String, default: '' },
        contacts: {
          type: Array as PropType<any[]>,
          default: (): any[] => []
        },
        addressBookName: { type: String, default: '' }
      },
      emits: ['close', 'imported'],
      setup(props, { emit }) {
        return () =>
          h(
            'div',
            {
              class: 'csv-dialog-stub',
              'data-mode': props.mode,
              'data-file': props.fileName,
              'data-text': props.text,
              'data-count': String(props.contacts.length),
              'data-book': props.addressBookName
            },
            [
              h(
                'button',
                {
                  class: 'stub-imported',
                  onClick: () => emit('imported', { created: 1, exists: 0, failed: 0 })
                },
                'stub'
              )
            ]
          )
      }
    })
  }
})

import ContactsCsvCard from '../../src/components/tools/ContactsCsvCard.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { disabled: { type: Boolean, default: false } },
  setup(props, { slots, attrs }) {
    return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
  }
})

const BOOK_A = { url: 'https://cloud.example/carddav/user-1/contacts/', displayName: 'Contacts' }
const BOOK_B = { url: 'https://cloud.example/carddav/user-1/work/', displayName: 'Work' }

const MARIA = {
  id: 'maria-1',
  displayName: 'Maria Weber',
  firstName: 'Maria',
  lastName: 'Weber',
  emails: [{ type: 'home', value: 'maria@example.com' }],
  phones: [] as any[],
  addresses: [] as any[],
  organization: '',
  title: '',
  notes: ''
}

function mountCard() {
  return mount(ContactsCsvCard, {
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true } }
  })
}

beforeEach(() => {
  fns.fetchAddressBooks.mockImplementation(async () => mockState.addressBooks.value)
  fns.fetchContacts.mockImplementation(async () => mockState.contacts.value)
  mockState.addressBooks.value = [BOOK_A]
  mockState.contacts.value = [MARIA]
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ContactsCsvCard', () => {
  it('loads the address books and the contacts of the first one', async () => {
    const wrapper = mountCard()
    await flushPromises()

    expect(fns.fetchAddressBooks).toHaveBeenCalled()
    expect(fns.fetchContacts).toHaveBeenCalledWith(BOOK_A.url)
    expect(wrapper.text()).toContain('Contacts CSV')
    expect(wrapper.text()).toContain('Import CSV')
    expect(wrapper.text()).toContain('Export CSV')
  })

  it('shows an address book selector only with several books and reloads on change', async () => {
    mockState.addressBooks.value = [BOOK_A, BOOK_B]
    const wrapper = mountCard()
    await flushPromises()

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    expect(select.findAll('option')).toHaveLength(2)

    await select.setValue(BOOK_B.url)
    await flushPromises()

    expect(fns.fetchContacts).toHaveBeenLastCalledWith(BOOK_B.url)
  })

  it('opens the CSV dialog in import mode with the chosen file', async () => {
    const wrapper = mountCard()
    await flushPromises()

    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'contacts.csv', text: async () => 'Name\r\nMaria Weber\r\n' }],
      configurable: true
    })
    await input.trigger('change')
    await flushPromises()

    const dialog = wrapper.find('.csv-dialog-stub')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('data-mode')).toBe('import')
    expect(dialog.attributes('data-file')).toBe('contacts.csv')
    expect(dialog.attributes('data-text')).toContain('Maria Weber')
  })

  it('opens the CSV dialog in export mode with the contacts of the selected book', async () => {
    const wrapper = mountCard()
    await flushPromises()

    // buttons: [Import CSV, Export CSV]
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()

    const dialog = wrapper.find('.csv-dialog-stub')
    expect(dialog.attributes('data-mode')).toBe('export')
    expect(dialog.attributes('data-count')).toBe('1')
    expect(dialog.attributes('data-book')).toBe('Contacts')
  })

  it('disables the export button when the address book has no contacts', async () => {
    mockState.contacts.value = []
    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.findAll('button')[1].attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('No contacts to export in this address book.')
  })

  it('reloads and emits changed after an import', async () => {
    const wrapper = mountCard()
    await flushPromises()
    fns.fetchContacts.mockClear()

    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'contacts.csv', text: async () => 'Name\r\nMaria Weber\r\n' }],
      configurable: true
    })
    await input.trigger('change')
    await flushPromises()

    await wrapper.find('.stub-imported').trigger('click')
    await flushPromises()

    expect(fns.fetchContacts).toHaveBeenCalledWith(BOOK_A.url)
    expect(wrapper.emitted('changed')).toBeTruthy()
    expect(wrapper.find('.csv-dialog-stub').exists()).toBe(false)
  })
})
