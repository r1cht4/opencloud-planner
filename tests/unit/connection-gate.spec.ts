// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { mount } from '@vue/test-utils'

/** Filled in by the `useConnectionProbe` mock below (real refs, so the gate reacts). */
const probe = vi.hoisted(() => ({
  retest: vi.fn(async () => undefined),
  state: null as null | {
    outcome: { value: string }
    probing: { value: boolean }
    lastResult: { value: unknown }
    retest: () => Promise<void>
  }
}))

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref } = await import('vue')
  const outcome = ref<string>('pending')
  const probing = ref(false)
  const lastResult = ref<unknown>(null)
  probe.state = { outcome, probing, lastResult, retest: probe.retest }
  return {
    useConnectionProbe: () => probe.state,
    retest: probe.retest,
    probeOutcomeForStatus: () => 'ok'
  }
})

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAbility: () => ({ can: () => false })
}))

vi.mock('vue3-gettext', () => ({
  // The SetupState text interpolates the app name (`%{app}` → Planner).
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_match, key: string) => String(params?.[key] ?? ''))
  })
}))

import ConnectionGate from '../../src/components/ConnectionGate.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { ariaLabel: { type: String as PropType<string>, default: '' } },
  setup(props, { slots, attrs }) {
    return () =>
      h('button', { ...attrs, 'aria-label': props.ariaLabel || undefined }, slots.default?.())
  }
})

function mountGate() {
  return mount(ConnectionGate, {
    slots: { default: '<p class="view-content">Calendar grid</p>' },
    global: {
      stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, 'oc-spinner': true }
    }
  })
}

function setOutcome(outcome: string) {
  probe.state!.outcome.value = outcome
}

afterEach(() => {
  setOutcome('pending')
  probe.state!.probing.value = false
  probe.state!.lastResult.value = null
  probe.retest.mockClear()
})

describe('ConnectionGate', () => {
  it('shows a spinner while the first probe is pending', () => {
    const wrapper = mountGate()

    expect(wrapper.find('oc-spinner-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('Checking the calendar server…')
    expect(wrapper.find('.view-content').exists()).toBe(false)
  })

  it('renders the setup state when the DAV endpoint is not configured', () => {
    setOutcome('not-configured')
    const wrapper = mountGate()

    expect(wrapper.text()).toContain('Planner is not set up yet')
    expect(wrapper.text()).toContain('does not route the DAV endpoints yet')
    expect(wrapper.find('.view-content').exists()).toBe(false)
    expect(wrapper.find('oc-spinner-stub').exists()).toBe(false)
  })

  it('renders the setup state for an unavailable server instead of the view', () => {
    setOutcome('unavailable')

    const wrapper = mountGate()

    expect(wrapper.text()).toContain('cannot be reached right now')
    expect(wrapper.find('.view-content').exists()).toBe(false)
  })

  it('renders the slot content once the probe is ok', () => {
    setOutcome('ok')
    const wrapper = mountGate()

    expect(wrapper.find('.view-content').text()).toBe('Calendar grid')
    expect(wrapper.text()).not.toContain('is not set up yet')
  })

  it('switches from the setup state to the view when the probe recovers', async () => {
    setOutcome('unavailable')
    const wrapper = mountGate()
    expect(wrapper.find('.view-content').exists()).toBe(false)

    setOutcome('ok')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.view-content').exists()).toBe(true)
  })
})
