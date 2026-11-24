// @vitest-environment happy-dom
/**
 * A new event starts from the `calendar.*` settings:
 * `defaultDuration` decides the end time, `defaultReminders` pre-fills the alarm
 * rows and `defaultCalendar` preselects the calendar (only while it still exists).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

import EventDialog from '../../src/components/calendar/EventDialog.vue'
import type { CalendarCollection } from '../../src/types'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s })
}))

const OcTextInputStub = defineComponent({
  name: 'OcTextInput',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('input', {
        type: 'text',
        value: props.modelValue,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)
      })
})

const stubs = {
  'oc-text-input': OcTextInputStub,
  'oc-textarea': defineComponent({
    name: 'OcTextarea',
    setup: () => () => h('textarea')
  }),
  'oc-button': defineComponent({
    name: 'OcButton',
    setup:
      (_, { slots }) =>
      () =>
        h('button', {}, slots.default?.())
  }),
  'oc-icon': defineComponent({ name: 'OcIcon', setup: () => () => h('span') })
}

function collection(url: string, displayName: string): CalendarCollection {
  return { url, displayName, color: '#00677F', description: '', ctag: '' }
}

const CAL_1 = collection('cal-1', 'Personal')
const CAL_2 = collection('cal-2', 'Work')

let wrapper: VueWrapper | null = null

function mountCreate(props: Record<string, unknown> = {}) {
  wrapper = mount(EventDialog, {
    props: {
      open: true,
      event: null,
      seed: { start: new Date(2026, 5, 7, 9, 0) },
      calendars: [CAL_1, CAL_2],
      ...props
    },
    global: { stubs },
    attachTo: document.body
  })
  return wrapper
}

function qa<T extends Element>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('new event defaults from settings', () => {
  it('new event uses defaultDuration 30', () => {
    mountCreate({ defaults: { durationMinutes: 30 } })

    const times = qa<HTMLInputElement>('.modal-panel .scroll-time-input').map(
      (input) => input.value
    )
    // Start 09:00 → end 09:30 (instead of the one-hour fallback).
    expect(times).toEqual(['09', '00', '09', '30'])
  })

  it('falls back to one hour when the duration is missing or invalid', () => {
    mountCreate({ defaults: {} })
    expect(qa<HTMLInputElement>('.modal-panel .scroll-time-input').map((i) => i.value)).toEqual([
      '09',
      '00',
      '10',
      '00'
    ])
  })

  it('pre-fills the default reminders', () => {
    mountCreate({ defaults: { reminders: [15, 1440] } })

    const rows = qa<HTMLSelectElement>('.modal-panel .reminder-row select')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.value)).toEqual(['15', '1440'])
  })

  it('new event preselects defaultCalendar when it exists', () => {
    mountCreate({ defaults: { calendarUrl: 'cal-2' } })

    const select = qa<HTMLSelectElement>('.modal-panel select').find((el) =>
      Array.from(el.options).some((option) => option.value === 'cal-2')
    )
    expect(select?.value).toBe('cal-2')
  })

  it('falls back to the first calendar when the default no longer exists', () => {
    mountCreate({ defaults: { calendarUrl: 'cal-deleted' } })

    const select = qa<HTMLSelectElement>('.modal-panel select').find((el) =>
      Array.from(el.options).some((option) => option.value === 'cal-1')
    )
    expect(select?.value).toBe('cal-1')
  })

  it('emits the selected default calendar in the save payload', async () => {
    mountCreate({ defaults: { calendarUrl: 'cal-2', durationMinutes: 45 } })

    const title = qa<HTMLInputElement>('.modal-panel input[type="text"]')[0]
    title.value = 'Planning'
    title.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()

    qa<HTMLFormElement>('.modal-panel form')[0].dispatchEvent(
      new Event('submit', { cancelable: true })
    )
    await wrapper!.vm.$nextTick()

    const payloads = wrapper!.emitted('save') as unknown[][]
    expect(payloads[0][0]).toMatchObject({
      title: 'Planning',
      calendarUrl: 'cal-2',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:45'
    })
  })
})
