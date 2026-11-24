// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const messages = vi.hoisted(() => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() }))
const user = vi.hoisted(() => ({ value: null as null | { onPremisesSamAccountName?: string } }))
const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async () => undefined) }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => messages,
  useUserStore: () => ({ user: user.value })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

import ConnectDevices from '../../src/components/ConnectDevices.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: {
    ariaLabel: { type: String as PropType<string>, default: '' }
  },
  setup(props, { slots, attrs }) {
    return () =>
      h('button', { ...attrs, 'aria-label': props.ariaLabel || undefined }, slots.default?.())
  }
})

function mountCard() {
  return mount(ConnectDevices, {
    global: {
      stubs: { 'oc-button': OcButtonStub, 'oc-icon': true }
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  messages.showMessage.mockClear()
  messages.showErrorMessage.mockClear()
  clipboard.writeText.mockClear()
  user.value = null
})

describe('ConnectDevices', () => {
  it('renders the CalDAV and CardDAV endpoint URLs', () => {
    const wrapper = mountCard()
    const text = wrapper.text()

    expect(text).toContain(`${window.location.origin}/caldav/`)
    expect(text).toContain(`${window.location.origin}/carddav/`)
  })

  it('lists the server address for apps with auto-discovery first', () => {
    const wrapper = mountCard()

    expect(wrapper.findAll('.connect-label')[0].text()).toBe('Server')
    expect(wrapper.findAll('.connect-value')[0].text()).toBe(window.location.origin)
    expect(wrapper.text()).not.toContain('auto-discovery')
  })

  it('shows the OpenCloud username when the user store has one', () => {
    user.value = { onPremisesSamAccountName: 'ada' }

    expect(mountCard().text()).toContain('ada')
  })

  it('hides the username row when it is unknown', () => {
    user.value = null
    const wrapper = mountCard()

    expect(wrapper.text()).not.toContain('Username')
    expect(wrapper.text()).not.toContain('ada')
  })

  it('links to the account page app-token panel', () => {
    const link = mountCard().find('a')

    expect(link.attributes('href')).toContain('/account/extension?extension-id=')
    expect(link.attributes('href')).toContain(
      'com.github.opencloud-eu.web.runtime.preferences-panels.app-tokens'
    )
  })

  it('copies the CalDAV URL to the clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mountCard()

    const copyButtons = wrapper.findAll('button')
    await copyButtons[1].trigger('click')
    await flushPromises()

    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/caldav/`)
    expect(messages.showMessage).toHaveBeenCalledTimes(1)
  })

  it('falls back to selecting the text when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const wrapper = mountCard()

    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()

    expect(messages.showErrorMessage).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="status"]').text()).toContain('Ctrl+C')
  })
})
