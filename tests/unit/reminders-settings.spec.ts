// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

import RemindersSettings from '../../src/components/settings/RemindersSettings.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: {
    disabled: { type: Boolean, default: false }
  },
  setup(props, { slots, attrs }) {
    return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
  }
})

const OcIconStub = defineComponent({
  name: 'OcIcon',
  props: { name: { type: String as PropType<string>, default: '' } },
  setup() {
    return () => h('i')
  }
})

function mountSettings(props: { enabled: boolean; locked?: boolean }) {
  return mount(RemindersSettings, {
    props,
    global: { stubs: { OcButton: OcButtonStub, 'oc-icon': OcIconStub } }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RemindersSettings', () => {
  it('shows the enabled state and emits on toggle', async () => {
    const wrapper = mountSettings({ enabled: true })
    const checkbox = wrapper.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)

    await checkbox.setValue(false)
    expect(wrapper.emitted('update:enabled')).toEqual([[false]])
  })

  it('is read-only and lock-marked when the setting is locked', async () => {
    const wrapper = mountSettings({ enabled: false, locked: true })
    const checkbox = wrapper.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).disabled).toBe(true)

    // The repeated "read-only" paragraph is gone: one lock icon next to the label
    // carries the explanation (title + accessible name).
    const lock = wrapper.get('[aria-label="Set by your administrator."]')
    expect(lock.attributes('title')).toBe('Set by your administrator.')
    expect(wrapper.text()).not.toContain('managed by your administrator')

    await checkbox.trigger('change')
    expect(wrapper.emitted('update:enabled')).toBeUndefined()
  })

  it('keeps the tab-only explanation as the row hint', () => {
    const wrapper = mountSettings({ enabled: true })

    expect(wrapper.text()).toContain(
      'Reminders are shown while OpenCloud is open in a browser tab.'
    )
    expect(wrapper.find('label[for="setting-reminders-enabled"]').exists()).toBe(true)
  })

  it('shows the blocked permission state without the request button', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    const wrapper = mountSettings({ enabled: true })

    expect(wrapper.text()).toContain('Desktop notifications: Blocked')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('offers the allow button only while the permission is unrequested', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })

    const wrapper = mountSettings({ enabled: true })
    const button = wrapper.get('button')
    expect(button.text()).toBe('Allow desktop notifications')

    await button.trigger('click')
    await Promise.resolve()

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Desktop notifications: Allowed')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(
      'Without desktop notifications, reminders appear as in-app messages.'
    )
  })

  it('does not request permission on mount', () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })

    mountSettings({ enabled: true })

    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('degrades when the browser has no Notification API', () => {
    const wrapper = mountSettings({ enabled: true })

    expect(wrapper.text()).toContain('Desktop notifications: Not supported in this browser')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
