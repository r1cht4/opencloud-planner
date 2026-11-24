// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mockState = vi.hoisted(() => ({
  calendars: null as any
}))

const fns = vi.hoisted(() => ({
  showMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchEvents: vi.fn(),
  deleteEvent: vi.fn()
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: fns.showMessage, showErrorMessage: fns.showErrorMessage })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? '')),
    $ngettext: (
      singular: string,
      plural: string,
      n: number,
      params?: Record<string, string | number>
    ) =>
      (n === 1 ? singular : plural).replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) =>
        String(params?.[key] ?? '')
      )
  })
}))

vi.mock('../../src/composables/useCalendarService', async () => {
  const { ref } = await import('vue')
  const calendars = ref<any[]>([])
  mockState.calendars = calendars
  return {
    useCalendarService: () => ({
      calendars,
      fetchCalendars: fns.fetchCalendars,
      fetchEvents: fns.fetchEvents,
      deleteEvent: fns.deleteEvent
    }),
    createCollection: vi.fn(),
    escapeXml: (value: string) => value,
    formatIfMatch: (value: string) => value
  }
})

import DuplicateEventsCard from '../../src/components/tools/DuplicateEventsCard.vue'
import type { CalendarEvent } from '../../src/types'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: {
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String as PropType<string>, default: '' }
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'button',
        { ...attrs, disabled: props.disabled, 'aria-label': props.ariaLabel || undefined },
        slots.default?.()
      )
  }
})

const CAL_A = {
  url: 'https://cloud.example/caldav/user-1/personal/',
  displayName: 'Personal',
  color: '#00677F',
  description: '',
  ctag: ''
}
const CAL_B = {
  url: 'https://cloud.example/caldav/user-1/work/',
  displayName: 'Work',
  color: '#C41E3A',
  description: '',
  ctag: ''
}

function ics(uid: string, extra: string[] = []): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T100000Z',
    'DTSTART:20260301T090000Z',
    'DTEND:20260301T100000Z',
    'SUMMARY:Standup',
    ...extra,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function event(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: 'Standup',
    start: '2026-03-01 09:00',
    end: '2026-03-01 10:00',
    calendarId: CAL_A.url,
    href: `${CAL_A.url}${id}.ics`,
    etag: `"${id}"`,
    rawIcs: ics(id, [`UID:${id}`]),
    ...overrides
  }
}

function mountCard() {
  return mount(DuplicateEventsCard, {
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, teleport: true } }
  })
}

async function findDuplicates(wrapper: ReturnType<typeof mountCard>) {
  // buttons: [Find duplicates]
  await wrapper.find('button').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  mockState.calendars.value = [CAL_A]
  fns.fetchCalendars.mockImplementation(async () => mockState.calendars.value)
  fns.fetchEvents.mockResolvedValue([event('a'), event('b')])
  fns.deleteEvent.mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DuplicateEventsCard', () => {
  it('looks like the Duplicate contacts block: title, then select + button on one row', async () => {
    mockState.calendars.value = [CAL_A, CAL_B]
    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.find('.settings-block-title').text()).toBe('Duplicate events')
    expect(wrapper.find('.settings-hint').exists()).toBe(false)
    const row = wrapper.find('.settings-button-row')
    expect(row.find('select').classes()).toContain('settings-select--grow')
    expect(row.text()).toContain('Find duplicates')
  })

  it('searches the selected calendar and lists the duplicate groups', async () => {
    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.text()).toContain('Duplicate events')
    expect(fns.fetchCalendars).toHaveBeenCalled()

    await findDuplicates(wrapper)

    expect(fns.fetchEvents).toHaveBeenCalledWith(CAL_A.url)
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('Standup')
    expect(dialog.text()).toContain('will be deleted')
    // The group count is a real plural ("1 duplicate group", not "group(s)").
    expect(dialog.find('.card-hint').text()).toContain('1 duplicate group in "Personal".')
  })

  it('deletes the duplicates after confirmation and reports the count', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await findDuplicates(wrapper)

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.deleteEvent).toHaveBeenCalledTimes(1)
    expect(fns.deleteEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
    expect(fns.showMessage).toHaveBeenCalledWith({ title: '1 event deleted' })
    expect(wrapper.emitted('deleted')?.[0]).toEqual([{ deleted: 1, failed: 0 }])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('reports duplicates that could not be deleted (ETag conflict)', async () => {
    fns.deleteEvent.mockResolvedValue(false)

    const wrapper = mountCard()
    await flushPromises()
    await findDuplicates(wrapper)

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.showErrorMessage).toHaveBeenCalledWith({ title: '1 event failed' })
    expect(wrapper.emitted('deleted')?.[0]).toEqual([{ deleted: 0, failed: 1 }])
  })

  it('tells the user when the calendar has no duplicates', async () => {
    fns.fetchEvents.mockResolvedValue([event('a'), event('b', { start: '2026-03-02 09:00' })])

    const wrapper = mountCard()
    await flushPromises()
    await findDuplicates(wrapper)

    expect(fns.showMessage).toHaveBeenCalledWith({ title: 'No duplicate events found' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('offers a calendar selector when several calendars exist', async () => {
    mockState.calendars.value = [CAL_A, CAL_B]

    const wrapper = mountCard()
    await flushPromises()

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    expect(select.findAll('option')).toHaveLength(2)

    await select.setValue(CAL_B.url)
    await findDuplicates(wrapper)

    expect(fns.fetchEvents).toHaveBeenCalledWith(CAL_B.url)
  })
})
