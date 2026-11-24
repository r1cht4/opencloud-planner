// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScrollTime from '../../src/components/ScrollTime.vue'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s })
}))

describe('ScrollTime accessibility', () => {
  it('renders two spinbutton inputs', () => {
    const wrapper = mount(ScrollTime, { props: { modelValue: '09:30' } })
    const spinbuttons = wrapper.findAll('[role="spinbutton"]')
    expect(spinbuttons).toHaveLength(2)
  })

  it('hours input has correct aria attributes', () => {
    const wrapper = mount(ScrollTime, { props: { modelValue: '09:30' } })
    const hoursInput = wrapper.findAll('[role="spinbutton"]')[0]
    expect(hoursInput.attributes('aria-valuenow')).toBe('9')
    expect(hoursInput.attributes('aria-valuemin')).toBe('0')
    expect(hoursInput.attributes('aria-valuemax')).toBe('23')
    expect(hoursInput.attributes('aria-label')).toBeTruthy()
  })

  it('minutes input has correct aria attributes', () => {
    const wrapper = mount(ScrollTime, { props: { modelValue: '09:30' } })
    const minutesInput = wrapper.findAll('[role="spinbutton"]')[1]
    expect(minutesInput.attributes('aria-valuenow')).toBe('30')
    expect(minutesInput.attributes('aria-valuemax')).toBe('59')
  })

  it('selects the whole field on click so typing replaces it', async () => {
    const wrapper = mount(ScrollTime, { props: { modelValue: '09:30' }, attachTo: document.body })
    for (const input of wrapper.findAll('[role="spinbutton"]')) {
      const el = input.element as HTMLInputElement
      const select = vi.spyOn(el, 'select')
      await input.trigger('click')
      expect(select).toHaveBeenCalled()
    }
    wrapper.unmount()
  })
})
