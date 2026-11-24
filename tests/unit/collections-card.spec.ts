// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mockState = vi.hoisted(() => ({
  calendarsRef: null as any,
  addressBooksRef: null as any,
  principal: 'https://cloud.example/caldav/user-1/'
}))

const fns = vi.hoisted(() => ({
  renameCollection: vi.fn(async () => undefined),
  setCollectionColor: vi.fn(async () => undefined),
  deleteCollection: vi.fn(async () => undefined),
  createCalendar: vi.fn(async () => 'https://cloud.example/caldav/user-1/new/'),
  createAddressBook: vi.fn(async () => 'https://cloud.example/carddav/user-1/new/'),
  isBirthdaySyncEnabled: vi.fn(() => true),
  setBirthdaySyncEnabled: vi.fn(),
  dispatchModal: vi.fn(),
  showMessage: vi.fn(),
  showErrorMessage: vi.fn()
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: fns.showMessage, showErrorMessage: fns.showErrorMessage }),
  useModals: () => ({ dispatchModal: fns.dispatchModal })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

vi.mock('../../src/composables/useCalendarService', async () => {
  const { ref } = await import('vue')
  const calendars = ref<any[]>([])
  mockState.calendarsRef = calendars
  return {
    useCalendarService: () => ({
      calendars,
      fetchCalendars: async () => calendars.value
    }),
    createCollection: vi.fn(),
    escapeXml: (value: string) => value
  }
})

vi.mock('../../src/composables/useContactsService', async () => {
  const { ref } = await import('vue')
  const addressBooks = ref<any[]>([])
  mockState.addressBooksRef = addressBooks
  return {
    useContactsService: () => ({
      addressBooks,
      fetchAddressBooks: async () => addressBooks.value
    })
  }
})

vi.mock('../../src/composables/useDAVClient', () => ({
  useDAVClient: () => ({
    getState: () => ({ principalUrl: mockState.principal })
  }),
  davFetch: vi.fn()
}))

vi.mock('../../src/composables/useCollections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composables/useCollections')>()
  return {
    ...actual,
    renameCollection: fns.renameCollection,
    setCollectionColor: fns.setCollectionColor,
    deleteCollection: fns.deleteCollection,
    createCalendar: fns.createCalendar,
    createAddressBook: fns.createAddressBook
  }
})

vi.mock('../../src/composables/useBirthdaySync', () => ({
  isBirthdaySyncEnabled: fns.isBirthdaySyncEnabled,
  setBirthdaySyncEnabled: fns.setBirthdaySyncEnabled
}))

import CollectionsCard from '../../src/components/CollectionsCard.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: {
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String as PropType<string>, default: '' },
    title: { type: String as PropType<string>, default: '' }
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          'aria-label': props.ariaLabel || undefined,
          title: props.title || undefined
        },
        slots.default?.()
      )
  }
})

const CALENDAR = {
  url: 'https://cloud.example/caldav/user-1/personal/',
  displayName: 'Personal',
  color: '#00677FFF',
  description: '',
  ctag: ''
}
const BIRTHDAYS = {
  url: 'https://cloud.example/caldav/user-1/birthdays/',
  displayName: 'Birthdays',
  color: '#C41E3AFF',
  description: '',
  ctag: ''
}
const BOOK = {
  url: 'https://cloud.example/carddav/user-1/contacts/',
  displayName: 'Contacts',
  description: '',
  ctag: ''
}

function mountCard() {
  return mount(CollectionsCard, {
    // Teleport stub keeps the dialog inside the wrapper so it can be queried.
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, teleport: true } }
  })
}

function group(wrapper: ReturnType<typeof mountCard>, index: number) {
  return wrapper.findAll('.collection-group')[index]
}

beforeEach(() => {
  mockState.calendarsRef.value = [CALENDAR]
  mockState.addressBooksRef.value = [BOOK]
  fns.isBirthdaySyncEnabled.mockReturnValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CollectionsCard', () => {
  it('lists calendars with a color swatch and address books', async () => {
    const wrapper = mountCard()
    await flushPromises()

    expect(group(wrapper, 0).text()).toContain('Personal')
    expect(group(wrapper, 1).text()).toContain('Contacts')
  })

  it('disables deletion of the last remaining calendar and explains why', async () => {
    const wrapper = mountCard()
    await flushPromises()

    const deleteButton = group(wrapper, 0).findAll('button')[2]
    expect(deleteButton.attributes('disabled')).toBeDefined()
    expect(deleteButton.attributes('title')).toContain('At least one calendar must remain.')
    expect(group(wrapper, 0).text()).toContain('At least one calendar must remain.')
  })

  it('allows deleting a calendar once another one exists', async () => {
    mockState.calendarsRef.value = [CALENDAR, BIRTHDAYS]
    const wrapper = mountCard()
    await flushPromises()

    expect(group(wrapper, 0).findAll('button')[2].attributes('disabled')).toBeUndefined()
  })

  it('deletes a calendar after confirmation and names it in the dialog', async () => {
    mockState.calendarsRef.value = [CALENDAR, BIRTHDAYS]
    const wrapper = mountCard()
    await flushPromises()

    await group(wrapper, 0).findAll('button')[2].trigger('click')

    expect(fns.dispatchModal).toHaveBeenCalledTimes(1)
    const opts = fns.dispatchModal.mock.calls[0][0] as any
    expect(opts.title).toBe('Delete calendar')
    expect(opts.message).toContain('Personal')
    expect(opts.message).toContain('deleted permanently')

    await opts.onConfirm()
    expect(fns.deleteCollection).toHaveBeenCalledWith(CALENDAR.url)
    // A normal calendar is unrelated to the birthday sync toggle.
    expect(fns.setBirthdaySyncEnabled).not.toHaveBeenCalled()
  })

  it('turns the birthday sync off when the birthday calendar is deleted', async () => {
    mockState.calendarsRef.value = [CALENDAR, BIRTHDAYS]
    const wrapper = mountCard()
    await flushPromises()

    expect(group(wrapper, 0).text()).toContain('Birthday calendar')

    const deleteButtons = group(wrapper, 0).findAll('button')
    await deleteButtons[4].trigger('click')

    const opts = fns.dispatchModal.mock.calls[0][0] as any
    expect(opts.message).toContain('Birthdays')

    await opts.onConfirm()
    expect(fns.deleteCollection).toHaveBeenCalledWith(BIRTHDAYS.url)
    expect(fns.setBirthdaySyncEnabled).toHaveBeenCalledWith(false)
  })

  it('keeps the birthday toggle when it was already off', async () => {
    fns.isBirthdaySyncEnabled.mockReturnValue(false)
    mockState.calendarsRef.value = [CALENDAR, BIRTHDAYS]
    const wrapper = mountCard()
    await flushPromises()

    await group(wrapper, 0).findAll('button')[4].trigger('click')
    await (fns.dispatchModal.mock.calls[0][0] as any).onConfirm()

    expect(fns.deleteCollection).toHaveBeenCalledWith(BIRTHDAYS.url)
    expect(fns.setBirthdaySyncEnabled).not.toHaveBeenCalled()
  })

  it('renames a calendar from the inline dialog', async () => {
    const wrapper = mountCard()
    await flushPromises()

    await group(wrapper, 0).findAll('button')[1].trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    const input = wrapper.find('[role="dialog"] input[type="text"]')
    expect((input.element as HTMLInputElement).value).toBe('Personal')
    await input.setValue('Work')
    await flushPromises()

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.renameCollection).toHaveBeenCalledWith(CALENDAR.url, 'Work')
  })

  it('sends the chosen color as #RRGGBB', async () => {
    const wrapper = mountCard()
    await flushPromises()

    const colorInput = group(wrapper, 0).find('input[type="color"]')
    await colorInput.setValue('#123456')
    await colorInput.trigger('change')
    await flushPromises()

    expect(fns.setCollectionColor).toHaveBeenCalledWith(CALENDAR.url, '#123456')
  })

  it('creates a calendar with name and color', async () => {
    const wrapper = mountCard()
    await flushPromises()

    const newCalendarButton = group(wrapper, 0).findAll('button')[0]
    await newCalendarButton.trigger('click')

    await wrapper.find('[role="dialog"] input[type="text"]').setValue('Team')
    await wrapper.find('[role="dialog"] input[type="color"]').setValue('#00aa55')
    await flushPromises()

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.createCalendar).toHaveBeenCalledWith('Team', '#00aa55')
    expect(fns.showMessage).toHaveBeenCalledWith({ title: 'Calendar created' })
  })

  it('creates an address book without a color', async () => {
    const wrapper = mountCard()
    await flushPromises()

    await group(wrapper, 1).findAll('button')[0].trigger('click')
    await wrapper.find('[role="dialog"] input[type="text"]').setValue('Family')
    await flushPromises()

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.createAddressBook).toHaveBeenCalledWith('Family')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
