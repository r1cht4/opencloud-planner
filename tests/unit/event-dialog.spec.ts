// @vitest-environment happy-dom
/**
 * EventDialog – the create/edit/preview modal extracted from Calendar.vue.
 *
 * Besides the dialog behaviour (preview → edit, save payload, delete, Escape),
 * this guards the DOM contract used by the deployed Playwright e2e spec:
 * inside `.modal-panel` there must be exactly two `input[type=text]` (title,
 * location), two `input[type=date]` (start, end), four `.scroll-time-input`
 * (start hour/minute, end hour/minute) and one `textarea`, in that order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

import EventDialog from '../../src/components/calendar/EventDialog.vue'
import type { CalendarCollection, CalendarEvent } from '../../src/types'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s })
}))

/** Minimal stand-ins for the OpenCloud design-system components. */
const OcTextInputStub = defineComponent({
  name: 'OcTextInput',
  props: { modelValue: { type: String, default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('input', {
        type: 'text',
        value: props.modelValue,
        disabled: props.disabled,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)
      })
})

const OcTextareaStub = defineComponent({
  name: 'OcTextarea',
  props: { modelValue: { type: String, default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('textarea', {
        value: props.modelValue,
        disabled: props.disabled,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
      })
})

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { submit: { type: String, default: null }, disabled: Boolean },
  emits: ['click'],
  setup:
    (props, { slots, emit }) =>
    () =>
      h(
        'button',
        {
          type: props.submit ?? 'button',
          disabled: props.disabled,
          onClick: (e: MouseEvent) => emit('click', e)
        },
        slots.default?.()
      )
})

const OcIconStub = defineComponent({
  name: 'OcIcon',
  setup: () => () => h('span', { class: 'oc-icon' })
})

const stubs = {
  'oc-text-input': OcTextInputStub,
  'oc-textarea': OcTextareaStub,
  'oc-button': OcButtonStub,
  'oc-icon': OcIconStub
}

const calendars: CalendarCollection[] = [
  { url: 'cal-1', displayName: 'Personal', color: '#00677F', description: '', ctag: '' }
]

const existingEvent: CalendarEvent = {
  id: 'ev-1',
  title: 'Standup',
  start: '2026-06-07 09:00',
  end: '2026-06-07 09:30',
  description: 'Daily sync',
  location: 'Room 1',
  calendarId: 'cal-1',
  reminders: [15]
}

let wrapper: VueWrapper | null = null

function mountDialog(props: Record<string, unknown>) {
  wrapper = mount(EventDialog, {
    props: { open: true, event: null, seed: null, calendars, ...props },
    global: { stubs },
    attachTo: document.body
  })
  return wrapper
}

function q<T extends Element>(selector: string): T {
  const el = document.body.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

function qa<T extends Element>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('EventDialog create mode', () => {
  it('keeps the DOM order the deployed e2e spec relies on', () => {
    mountDialog({ seed: { start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) } })

    expect(q('.modal-panel')).toBeTruthy()
    expect(qa('.modal-panel input[type="text"]')).toHaveLength(2)
    expect(qa('.modal-panel input[type="date"]')).toHaveLength(2)
    expect(qa('.modal-panel .scroll-time-input')).toHaveLength(4)
    expect(qa('.modal-panel textarea')).toHaveLength(1)
    expect(qa('.modal-panel button[type="submit"]')).toHaveLength(1)
    // Two-column start/end row, so the grid rows the e2e expects are intact.
    expect(qa('.modal-panel .form-row')).toHaveLength(1)
    expect(qa('.modal-panel .form-row input[type="date"]')).toHaveLength(2)
  })

  it('prefills start/end from the clicked slot', () => {
    mountDialog({ seed: { start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) } })
    const dates = qa<HTMLInputElement>('.modal-panel input[type="date"]')
    expect(dates[0].value).toBe('2026-06-07')
    expect(dates[1].value).toBe('2026-06-07')
    const times = qa<HTMLInputElement>('.modal-panel .scroll-time-input')
    expect(times.map((t) => t.value)).toEqual(['09', '00', '10', '00'])
  })

  it('disables Save until a title is entered and emits the normalised payload', async () => {
    mountDialog({ seed: { start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) } })

    const save = q<HTMLButtonElement>('.modal-panel button[type="submit"]')
    expect(save.disabled).toBe(true)

    const title = qa<HTMLInputElement>('.modal-panel input[type="text"]')[0]
    title.value = 'Standup'
    title.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()
    expect(save.disabled).toBe(false)

    q<HTMLFormElement>('.modal-panel form').dispatchEvent(new Event('submit', { cancelable: true }))
    await wrapper!.vm.$nextTick()

    const payloads = wrapper!.emitted('save') as unknown[][]
    expect(payloads).toHaveLength(1)
    expect(payloads[0][0]).toMatchObject({
      title: 'Standup',
      start: '2026-06-07 09:00',
      end: '2026-06-07 10:00',
      isAllDay: false,
      calendarUrl: 'cal-1'
    })
  })

  it('binds every text field and the all-day toggle to the form', async () => {
    mountDialog({ seed: { start: new Date(2026, 5, 7, 9, 0), end: new Date(2026, 5, 7, 10, 0) } })

    const texts = qa<HTMLInputElement>('.modal-panel input[type="text"]')
    texts[0].value = 'Standup'
    texts[0].dispatchEvent(new Event('input'))
    texts[1].value = 'Room 1'
    texts[1].dispatchEvent(new Event('input'))
    const textarea = q<HTMLTextAreaElement>('.modal-panel textarea')
    textarea.value = 'Daily sync'
    textarea.dispatchEvent(new Event('input'))

    const allDay = q<HTMLInputElement>('.modal-panel input[type="checkbox"]')
    allDay.checked = true
    allDay.dispatchEvent(new Event('change'))
    await wrapper!.vm.$nextTick()

    // All-day hides the time pickers and collapses the dates to date-only values.
    expect(qa('.modal-panel .scroll-time-input')).toHaveLength(0)

    q<HTMLFormElement>('.modal-panel form').dispatchEvent(new Event('submit', { cancelable: true }))
    await wrapper!.vm.$nextTick()

    const payload = (wrapper!.emitted('save') as unknown[][])[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      title: 'Standup',
      location: 'Room 1',
      description: 'Daily sync',
      isAllDay: true,
      start: '2026-06-07',
      end: '2026-06-08' // exclusive DTEND (single all-day day)
    })
  })

  it('emits close on Escape and on overlay click', async () => {
    const dialog = mountDialog({ open: false })
    await dialog.setProps({ open: true })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(dialog.emitted('close')).toHaveLength(1)

    q('.modal-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.emitted('close')).toHaveLength(2)
  })
})

describe('EventDialog preview mode', () => {
  it('opens an existing event read-only with Edit/Delete actions', async () => {
    const dialog = mountDialog({ event: existingEvent })

    expect(q('#event-dialog-title').textContent?.trim()).toBe('Standup')
    // Read-only: no title input, description rendered as a disabled textarea.
    expect(qa('.modal-panel input[type="text"]')).toHaveLength(1)
    expect(q<HTMLInputElement>('.modal-panel input[type="date"]').disabled).toBe(true)
    expect(q<HTMLTextAreaElement>('.modal-panel textarea').disabled).toBe(true)

    const buttons = qa<HTMLButtonElement>('.modal-panel button')
    const deleteBtn = buttons.find((b) => b.textContent?.trim() === 'Delete')
    const editBtn = buttons.find((b) => b.textContent?.trim() === 'Edit')
    expect(deleteBtn).toBeTruthy()
    expect(editBtn).toBeTruthy()

    deleteBtn!.click()
    await wrapper!.vm.$nextTick()
    expect(dialog.emitted('delete')).toHaveLength(1)

    editBtn!.click()
    await wrapper!.vm.$nextTick()
    // Editable again: title + location inputs and an enabled Save button.
    expect(qa('.modal-panel input[type="text"]')).toHaveLength(2)
    const title = qa<HTMLInputElement>('.modal-panel input[type="text"]')[0]
    expect(title.value).toBe('Standup')
    expect(q<HTMLButtonElement>('.modal-panel button[type="submit"]').disabled).toBe(false)
  })

  it('shows the reminder and location of the stored event', () => {
    mountDialog({ event: existingEvent })
    // Repeat selector + one reminder row; the reminder keeps its stored value.
    const selects = qa<HTMLSelectElement>('.modal-panel select')
    expect(selects).toHaveLength(2)
    expect(selects[0].value).toBe('')
    expect(selects[1].value).toBe('15')
    expect(qa<HTMLInputElement>('.modal-panel input[type="text"]')[0].value).toBe('Room 1')
  })
})
