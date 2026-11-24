// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const probe = vi.hoisted(() => ({
  retest: vi.fn(async () => undefined),
  state: null as null | {
    outcome: { value: string }
    probing: { value: boolean }
    lastResult: { value: null | { outcome: string; status?: number; detail?: string } }
  }
}))

const ability = vi.hoisted(() => ({ admin: false }))

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref } = await import('vue')
  probe.state = { outcome: ref('not-configured'), probing: ref(false), lastResult: ref(null) }
  return {
    useConnectionProbe: () => ({ ...probe.state, retest: probe.retest }),
    retest: probe.retest,
    probeOutcomeForStatus: () => 'ok'
  }
})

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAbility: () => ({ can: () => ability.admin })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

import SetupState from '../../src/components/SetupState.vue'
import { INSTALL_GUIDE_URL } from '../../src/setup/connection'
import type { ProbeOutcome } from '../../src/composables/useConnectionProbe'

type FailureOutcome = Exclude<ProbeOutcome, 'ok'>

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

function mountState(outcome: FailureOutcome = 'not-configured') {
  return mount(SetupState, {
    props: { outcome },
    global: {
      stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, 'oc-spinner': true }
    }
  })
}

afterEach(() => {
  ability.admin = false
  probe.retest.mockClear()
  probe.state!.outcome.value = 'not-configured'
  probe.state!.lastResult.value = null
  probe.state!.probing.value = false
})

describe('SetupState', () => {
  it('tells a normal user that the administrator has to finish the setup', () => {
    ability.admin = false
    const wrapper = mountState()

    expect(wrapper.text()).toContain(
      'Your administrator still needs to finish the setup of Planner.'
    )
    expect(wrapper.text()).not.toContain('Administrator setup')
    expect(wrapper.text()).not.toContain('Test connection')
  })

  it('shows the administrator steps, the install guide and a Test connection button', () => {
    ability.admin = true
    const wrapper = mountState()
    const text = wrapper.text()

    // The three upstream compose steps, as copyable code.
    expect(text).toContain('COMPOSE_FILE=docker-compose.yml:radicale/radicale.yml')
    expect(text).toContain('backend: http://radicale:5232')
    expect(text).toContain('remote_user_header: X-Remote-User')
    expect(text).toContain('endpoint: /.well-known/caldav')
    expect(text).toContain('endpoint: /.well-known/carddav')
    expect(text).toContain('docker compose up -d')
    expect(text).toContain('Test connection')

    // Not the user-only wording.
    expect(text).not.toContain('Your administrator still needs to finish the setup')

    const guide = wrapper.find('a')
    expect(guide.attributes('href')).toBe(INSTALL_GUIDE_URL)
    expect(guide.attributes('rel')).toContain('noopener')
  })

  it('names a stopped server as unreachable, not as a missing setup', () => {
    ability.admin = false
    const down = mountState('unavailable')
    expect(down.find('h1').text()).toBe('The calendar server is not reachable')
    expect(down.text()).toContain('Please try again later.')
    expect(down.text()).not.toContain('still needs to finish the setup')
    expect(mountState('not-configured').find('h1').text()).toBe('Planner is not set up yet')
  })

  it('explains each probe outcome', () => {
    expect(mountState('not-configured').text()).toContain('does not route the DAV endpoints yet')
    expect(mountState('unavailable').text()).toContain('cannot be reached right now')
    expect(mountState('unauthorized').text()).toContain('could not sign in to the calendar server')
    expect(mountState('error').text()).toContain('answered with an unexpected error')
  })

  it('Test connection calls retest', async () => {
    ability.admin = true
    const wrapper = mountState()

    const button = wrapper.findAll('button').find((b) => b.text().includes('Test connection'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    expect(probe.retest).toHaveBeenCalledTimes(1)
  })

  it('reports a failed test in place', async () => {
    ability.admin = true
    probe.state!.outcome.value = 'unavailable'
    const wrapper = mountState('unavailable')

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Test connection'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="status"]').text()).toContain(
      'The connection test still fails (Unavailable).'
    )
  })

  it('copies a step to the clipboard', async () => {
    ability.admin = true
    const clipboard = { writeText: vi.fn(async (_text: string) => undefined) }
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mountState()

    const copyButtons = wrapper.findAll('button').filter((b) => b.attributes('aria-label'))
    expect(copyButtons.length).toBe(3)

    await copyButtons[1].trigger('click')
    await flushPromises()

    expect(clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(String(clipboard.writeText.mock.calls[0][0])).toContain('remote_user_header')

    vi.unstubAllGlobals()
  })
})
