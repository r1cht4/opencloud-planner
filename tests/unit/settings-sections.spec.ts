// @vitest-environment happy-dom
/**
 * The per-app Settings sections render real controls and write
 * through `useSettings().update(...)`; admin-locked paths render disabled with a
 * hint. The store is mocked (transport only), the schema/resolver stay real.
 */
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const state = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  admin: {} as Record<string, unknown>,
  calls: [] as Array<[string, unknown]>,
  loaded: true,
  error: null as string | null
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

/** `useBirthdaySync` and its message toasts, so the Sync-now row is observable. */
const sync = vi.hoisted(() => ({
  syncing: { value: false },
  reconcile: null as unknown as ReturnType<typeof vi.fn>,
  showMessage: null as unknown as ReturnType<typeof vi.fn>,
  showErrorMessage: null as unknown as ReturnType<typeof vi.fn>
}))

sync.reconcile = vi.fn()
sync.showMessage = vi.fn()
sync.showErrorMessage = vi.fn()

vi.mock('../../src/composables/useBirthdaySync', async () => {
  const { ref } = await import('vue')
  const syncing = ref(false)
  sync.syncing = syncing as unknown as { value: boolean }
  return { useBirthdaySync: () => ({ syncing, reconcile: sync.reconcile }) }
})

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: sync.showMessage, showErrorMessage: sync.showErrorMessage })
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
  return createSettingsStoreMock(state)
})

import CalendarSettings from '../../src/components/settings/CalendarSettings.vue'
import ContactsSettings from '../../src/components/settings/ContactsSettings.vue'
import TasksSettings from '../../src/components/settings/TasksSettings.vue'
import BirthdaysSettings from '../../src/components/settings/BirthdaysSettings.vue'

let wrapper: VueWrapper | null = null

/** `oc-button` is registered by the host shell, which is not mounted here. */
const OcButtonStub = defineComponent({
  name: 'OcButtonStub',
  setup(_, { slots, attrs }) {
    return () => h('button', attrs, slots.default?.())
  }
})

function mountSection(component: unknown): VueWrapper {
  wrapper = mount(component as never, {
    global: { stubs: { 'oc-icon': true, 'oc-button': OcButtonStub } }
  })
  return wrapper
}

const ORIGIN = 'http://localhost:3000'
const CALENDAR_URL = `${ORIGIN}/caldav/user-1/personal/`
const ADDRESS_BOOK_URL = `${ORIGIN}/carddav/user-1/personal/`

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/</d:href>
    <d:propstat>
      <d:prop><d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

/** One principal listing that carries a calendar *and* an address book. */
const collectionsXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>${CALENDAR_URL}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
        <c:calendar-color>#00677FFF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>${ADDRESS_BOOK_URL}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

/** Minimal DAV so the collection selects have real options to select. */
function stubDav(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: any, init: any = {}) => {
      const body = String(init.body ?? '')
      const text = body.includes('current-user-principal') ? principalXml : collectionsXml
      return { ok: true, status: 207, text: async () => text, headers: new Headers() }
    })
  )
}

beforeEach(() => {
  setMockSettingsDocument(state, {})
  state.locked = []
  state.admin = {}
  state.calls = []
  state.loaded = true
  state.error = null
  sync.reconcile.mockReset()
  sync.showMessage.mockReset()
  sync.showErrorMessage.mockReset()
  stubDav()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('CalendarSettings', () => {
  it('writes the default view, day start, week start and toggles', async () => {
    const section = mountSection(CalendarSettings)
    await flushPromises()

    await section.find('select[data-setting="calendar.defaultView"]').setValue('month')
    expect(state.calls).toContainEqual(['calendar.defaultView', 'month'])

    await section.find('input[data-setting="calendar.dayStart"]').setValue('08:00')
    expect(state.calls).toContainEqual(['calendar.dayStart', '08:00'])

    await section.find('select[data-setting="calendar.weekStart"]').setValue('1')
    expect(state.calls).toContainEqual(['calendar.weekStart', 1])

    await section.find('select[data-setting="calendar.weekStart"]').setValue('locale')
    expect(state.calls).toContainEqual(['calendar.weekStart', 'locale'])

    await section.find('input[data-setting="calendar.weekNumbers"]').setValue(false)
    expect(state.calls).toContainEqual(['calendar.weekNumbers', false])

    await section.find('input[data-setting="calendar.showWeekends"]').setValue(false)
    expect(state.calls).toContainEqual(['calendar.showWeekends', false])
  })

  it('writes the default duration and the default reminders', async () => {
    setMockSettingsDocument(state, { calendar: { defaultReminders: [15] } })
    const section = mountSection(CalendarSettings)
    await flushPromises()

    await section.find('select[data-setting="calendar.defaultDuration"]').setValue('30')
    expect(state.calls).toContainEqual(['calendar.defaultDuration', 30])

    await section.find('input[data-setting="calendar.defaultReminders.1440"]').setValue(true)
    expect(state.calls).toContainEqual(['calendar.defaultReminders', [15, 1440]])

    await section.find('input[data-setting="calendar.defaultReminders.15"]').setValue(false)
    expect(state.calls).toContainEqual(['calendar.defaultReminders', [1440]])
  })

  it('renders locked fields disabled with the lock marker, not a repeated paragraph', async () => {
    state.locked = ['calendar.defaultView', 'calendar.showWeekends']
    const section = mountSection(CalendarSettings)
    await flushPromises()

    expect(
      section.find('select[data-setting="calendar.defaultView"]').attributes('disabled')
    ).toBeDefined()
    expect(
      section.find('input[data-setting="calendar.showWeekends"]').attributes('disabled')
    ).toBeDefined()

    // One lock icon per locked row (calendar.defaultView, calendar.showWeekends).
    const locks = section.findAll('[aria-label="Set by your administrator."]')
    expect(locks).toHaveLength(2)
    expect(locks[0].attributes('title')).toBe('Set by your administrator.')
    // The sentence that used to be repeated in every tab is gone.
    expect(section.text()).not.toContain('Settings marked as read-only')
  })

  it('splits the section into a View and a New events group, rare options collapsed', async () => {
    const section = mountSection(CalendarSettings)
    await flushPromises()

    const groups = section.findAll('.settings-section')
    expect(groups.map((group) => group.find('h2').text())).toEqual(['View', 'New events'])

    // "Day starts at" and the default reminders live behind "More options",
    // which is closed by default.
    const more = section.findAll('details.settings-more')
    expect(more).toHaveLength(2)
    for (const details of more) {
      expect(details.attributes('open')).toBeUndefined()
    }
    expect(more[0].find('input[data-setting="calendar.dayStart"]').exists()).toBe(true)
    expect(more[1].find('input[data-setting="calendar.defaultReminders.15"]').exists()).toBe(true)
  })
})

describe('ContactsSettings', () => {
  it('is one group whose rows carry the moved hints', async () => {
    const section = mountSection(ContactsSettings)
    await flushPromises()

    const groups = section.findAll('.settings-section')
    expect(groups).toHaveLength(1)
    expect(groups[0].find('h2').text()).toBe('Contacts')

    // "Show names as" explains that only the list label is formatted.
    const hints = section.findAll('.settings-row-hint').map((hint) => hint.text())
    expect(hints).toContain(
      'Only the list is formatted — the stored name of a contact is never changed.'
    )
  })

  it('writes sort field and display order', async () => {
    const section = mountSection(ContactsSettings)
    await flushPromises()

    await section.find('select[data-setting="contacts.sortBy"]').setValue('firstName')
    expect(state.calls).toContainEqual(['contacts.sortBy', 'firstName'])

    await section.find('select[data-setting="contacts.displayOrder"]').setValue('lastFirst')
    expect(state.calls).toContainEqual(['contacts.displayOrder', 'lastFirst'])
  })

  it('clears the default address book to "first one"', async () => {
    setMockSettingsDocument(state, { contacts: { defaultAddressBook: ADDRESS_BOOK_URL } })
    const section = mountSection(ContactsSettings)
    await flushPromises()

    const select = section.find('select[data-setting="contacts.defaultAddressBook"]')
    expect((select.element as HTMLSelectElement).value).toBe(ADDRESS_BOOK_URL)

    await select.setValue('')
    expect(state.calls).toContainEqual(['contacts.defaultAddressBook', undefined])
  })

  it('renders locked controls disabled', async () => {
    state.locked = ['contacts.sortBy']
    const section = mountSection(ContactsSettings)
    await flushPromises()

    expect(
      section.find('select[data-setting="contacts.sortBy"]').attributes('disabled')
    ).toBeDefined()
  })
})

describe('TasksSettings', () => {
  it('quick-add default calendar and completed filter are written through', async () => {
    const section = mountSection(TasksSettings)
    await flushPromises()

    await section.find('select[data-setting="tasks.defaultCalendar"]').setValue(CALENDAR_URL)
    expect(state.calls).toContainEqual(['tasks.defaultCalendar', CALENDAR_URL])

    await section.find('input[data-setting="tasks.showCompleted"]').setValue(true)
    expect(state.calls).toContainEqual(['tasks.showCompleted', true])
  })

  it('maps the reminder choices to minutes and "none" to no key', async () => {
    const section = mountSection(TasksSettings)
    await flushPromises()

    const select = section.find('select[data-setting="tasks.defaultReminder"]')
    expect((select.element as HTMLSelectElement).value).toBe('none')

    await select.setValue('60')
    expect(state.calls).toContainEqual(['tasks.defaultReminder', 60])

    await select.setValue('0')
    expect(state.calls).toContainEqual(['tasks.defaultReminder', 0])

    await select.setValue('none')
    expect(state.calls).toContainEqual(['tasks.defaultReminder', undefined])
  })

  it('shows a stored reminder as selected', async () => {
    setMockSettingsDocument(state, { tasks: { defaultReminder: 1440 } })
    const section = mountSection(TasksSettings)
    await flushPromises()

    expect(
      (section.find('select[data-setting="tasks.defaultReminder"]').element as HTMLSelectElement)
        .value
    ).toBe('1440')
  })
})

describe('BirthdaysSettings', () => {
  it('writes enabled, target calendar and reminder', async () => {
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    await section.find('input[data-setting="birthdays.enabled"]').setValue(true)
    expect(state.calls).toContainEqual(['birthdays.enabled', true])

    await section.find('select[data-setting="birthdays.reminder"]').setValue('1440')
    expect(state.calls).toContainEqual(['birthdays.reminder', 1440])

    await section.find('select[data-setting="birthdays.reminder"]').setValue('none')
    expect(state.calls).toContainEqual(['birthdays.reminder', undefined])
  })

  it('hides the calendar and reminder rows while birthdays are off', async () => {
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    // Only the switch is visible; both dependent rows do not exist at all.
    expect(section.find('input[data-setting="birthdays.enabled"]').exists()).toBe(true)
    expect(section.find('select[data-setting="birthdays.calendar"]').exists()).toBe(false)
    expect(section.find('select[data-setting="birthdays.reminder"]').exists()).toBe(false)
    expect(section.findAll('.settings-row')).toHaveLength(1)

    wrapper?.unmount()
    wrapper = null
    setMockSettingsDocument(state, { birthdays: { enabled: true } })
    const enabledSection = mountSection(BirthdaysSettings)
    await flushPromises()

    expect(enabledSection.find('select[data-setting="birthdays.calendar"]').exists()).toBe(true)
    expect(enabledSection.find('select[data-setting="birthdays.reminder"]').exists()).toBe(true)
    // …plus the on-demand refresh row.
    expect(enabledSection.findAll('.settings-row')).toHaveLength(4)
    // The 09:00 explanation is the reminder row's hint.
    expect(enabledSection.text()).toContain(
      'Birthday events are all-day events, so reminders fire in the morning (09:00).'
    )
  })

  it('enabling birthdays reveals the dependent rows without a reload', async () => {
    const section = mountSection(BirthdaysSettings)
    await flushPromises()
    expect(section.find('select[data-setting="birthdays.calendar"]').exists()).toBe(false)

    await section.find('input[data-setting="birthdays.enabled"]').setValue(true)
    await flushPromises()

    expect(state.calls).toContainEqual(['birthdays.enabled', true])
    expect(section.find('select[data-setting="birthdays.calendar"]').exists()).toBe(true)
  })

  it('clears the target calendar back to the app-owned one', async () => {
    setMockSettingsDocument(state, { birthdays: { enabled: true, calendar: CALENDAR_URL } })
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    await section.find('select[data-setting="birthdays.calendar"]').setValue('')
    expect(state.calls).toContainEqual(['birthdays.calendar', undefined])
  })

  it('syncs the birthdays on demand and reports what it did', async () => {
    setMockSettingsDocument(state, { birthdays: { enabled: true } })
    sync.reconcile.mockResolvedValue({ created: 2, updated: 1, removed: 0 })
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    // The row only exists while the feature is on (it replaced Data → Clean up).
    const button = section.find('[data-action="sync-birthdays"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Sync now')

    await button.trigger('click')
    await flushPromises()

    expect(sync.reconcile).toHaveBeenCalledWith({ calendarName: 'Birthdays' })
    expect(sync.showMessage).toHaveBeenCalledWith({ title: 'Birthdays synced' })
    expect(sync.showErrorMessage).not.toHaveBeenCalled()
  })

  it('does not claim a sync when nothing changed', async () => {
    setMockSettingsDocument(state, { birthdays: { enabled: true } })
    sync.reconcile.mockResolvedValue({ created: 0, updated: 0, removed: 0 })
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    await section.find('[data-action="sync-birthdays"]').trigger('click')
    await flushPromises()

    expect(sync.showMessage).toHaveBeenCalledWith({ title: 'All birthdays already synced' })
  })

  it('reports a missing calendar service instead of silently doing nothing', async () => {
    setMockSettingsDocument(state, { birthdays: { enabled: true } })
    sync.reconcile.mockResolvedValue(null)
    const section = mountSection(BirthdaysSettings)
    await flushPromises()

    await section.find('[data-action="sync-birthdays"]').trigger('click')
    await flushPromises()

    expect(sync.showErrorMessage).toHaveBeenCalledWith({ title: 'Calendar service not available' })
    expect(sync.showMessage).not.toHaveBeenCalled()
  })
})
