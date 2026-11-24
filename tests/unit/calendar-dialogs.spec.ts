// @vitest-environment happy-dom
/**
 * The two confirmation dialogs extracted from Calendar.vue. They must keep the
 * page's accessibility contract: role="dialog", labelled title, Escape closes,
 * focus moves into the dialog and returns to the trigger.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

import MoveConfirmDialog from '../../src/components/calendar/MoveConfirmDialog.vue'
import RecurrenceScopeDialog from '../../src/components/calendar/RecurrenceScopeDialog.vue'
import type { CalendarEvent, EventMoveInfo } from '../../src/types'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s })
}))

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { disabled: Boolean },
  emits: ['click'],
  setup:
    (props, { slots, emit }) =>
    () =>
      h(
        'button',
        { disabled: props.disabled, onClick: (e: MouseEvent) => emit('click', e) },
        slots.default?.()
      )
})

const OcIconStub = defineComponent({ name: 'OcIcon', setup: () => () => h('span') })

const stubs = { 'oc-button': OcButtonStub, 'oc-icon': OcIconStub }

const event: CalendarEvent = {
  id: 'ev-1',
  title: 'Standup',
  start: '2026-06-07 09:00',
  end: '2026-06-07 09:30',
  calendarId: 'cal-1'
}

const move: EventMoveInfo = {
  title: 'Standup',
  oldDate: 'Sun, 7 June',
  oldTime: '09:00 – 09:30',
  newDate: 'Mon, 8 June',
  newTime: '09:00 – 09:30',
  event,
  updatedEvent: { ...event, start: '2026-06-08 09:00', end: '2026-06-08 09:30' }
}

let wrapper: VueWrapper | null = null

function q<T extends Element>(selector: string): T {
  const el = document.body.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('MoveConfirmDialog', () => {
  it('shows the old/new comparison and confirms the move', async () => {
    wrapper = mount(MoveConfirmDialog, {
      props: { move },
      global: { stubs },
      attachTo: document.body
    })

    const panel = q<HTMLElement>('.modal-panel.modal-panel--compact')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-labelledby')).toBe('move-dialog-title')
    expect(panel.textContent).toContain('Standup')
    expect(panel.textContent).toContain('Sun, 7 June')
    expect(panel.textContent).toContain('Mon, 8 June')

    const buttons = Array.from(panel.querySelectorAll('button'))
    buttons.find((b) => b.textContent?.trim() === 'Move')!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('cancels on Escape and is closed without a pending move', async () => {
    wrapper = mount(MoveConfirmDialog, {
      props: { move: null },
      global: { stubs },
      attachTo: document.body
    })
    expect(document.body.querySelector('.modal-panel')).toBeNull()

    await wrapper.setProps({ move })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})

describe('RecurrenceScopeDialog', () => {
  it('offers "only this event", "entire series" and cancel for a save', async () => {
    wrapper = mount(RecurrenceScopeDialog, {
      props: { mode: 'save' },
      global: { stubs },
      attachTo: document.body
    })

    const panel = q<HTMLElement>('.modal-panel')
    expect(panel.textContent).toContain('Update recurring event')
    expect(panel.textContent).toContain('update only this event')

    const buttons = Array.from(panel.querySelectorAll('button'))
    buttons.find((b) => b.textContent?.trim() === 'Only this event')!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')?.[0]).toEqual(['single'])

    buttons.find((b) => b.textContent?.trim() === 'Entire series')!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')?.[1]).toEqual(['series'])
  })

  it('asks about deletion when mode is delete and closes on cancel', async () => {
    wrapper = mount(RecurrenceScopeDialog, {
      props: { mode: 'delete' },
      global: { stubs },
      attachTo: document.body
    })

    const panel = q<HTMLElement>('.modal-panel')
    expect(panel.textContent).toContain('Delete recurring event')

    Array.from(panel.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Cancel')!
      .click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('renders nothing while no choice is pending', () => {
    wrapper = mount(RecurrenceScopeDialog, {
      props: { mode: null },
      global: { stubs },
      attachTo: document.body
    })
    expect(document.body.querySelector('.modal-panel')).toBeNull()
  })
})
