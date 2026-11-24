// @vitest-environment happy-dom
/**
 * Settings tab bar — the redesign of the section navigation.
 *
 * The bar is a real `tablist`: one tab per section, the active one marked with
 * `aria-selected` and primary colour, arrow keys / Home / End move through it
 * (the page itself only renders the panel of the selected tab). The sticky /
 * scrolling side is CSS and cannot be asserted here; what is testable is the
 * ARIA contract and the keyboard behaviour, which is what this spec pins down.
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

import SettingsTabs from '../../src/components/settings/SettingsTabs.vue'

const sections = [
  { id: 'general', label: 'General' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'data', label: 'Data' }
] as const

function mountTabs(modelValue: (typeof sections)[number]['id'] = 'general') {
  return mount(SettingsTabs, {
    props: { modelValue, sections: [...sections] },
    attachTo: document.body
  })
}

describe('SettingsTabs', () => {
  it('renders a labelled tablist with one tab per section', () => {
    const wrapper = mountTabs()

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.exists()).toBe(true)
    expect(tablist.attributes('aria-label')).toBe('Settings sections')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(sections.length)
    expect(tabs.map((tab) => tab.text())).toEqual(['General', 'Calendar', 'Data'])
    expect(tabs.map((tab) => tab.attributes('aria-controls'))).toEqual([
      'settings-panel-general',
      'settings-panel-calendar',
      'settings-panel-data'
    ])
    wrapper.unmount()
  })

  it('marks the active tab and keeps only it in the tab order', () => {
    const wrapper = mountTabs('calendar')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
    // Roving tabindex: Tab enters the bar once, the arrows move inside it.
    expect(tabs.map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(wrapper.find('.settings-tab--active').text()).toBe('Calendar')
    wrapper.unmount()
  })

  it('emits the section of a clicked tab and nothing for the active one', async () => {
    const wrapper = mountTabs('general')

    await wrapper.findAll('[role="tab"]')[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['data']])

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['data']])
    wrapper.unmount()
  })

  it('moves through the tabs with the arrow keys, wrapping at both ends', async () => {
    const wrapper = mountTabs('calendar')
    const tabs = wrapper.findAll('[role="tab"]')

    await tabs[1].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['data'])

    // Right on the last tab lands on the first one — a tab bar is a ring.
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['general'])

    await tabs[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['data'])
    wrapper.unmount()
  })

  it('jumps to the first/last tab with Home and End', async () => {
    const wrapper = mountTabs('calendar')
    const tabs = wrapper.findAll('[role="tab"]')

    await tabs[1].trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['data'])

    await tabs[1].trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['general'])
    wrapper.unmount()
  })

  it('leaves other keys alone', async () => {
    const wrapper = mountTabs('general')

    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'Tab' })
    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('moves focus to the newly selected tab (the inactive ones are not tabbable)', async () => {
    const wrapper = mountTabs('general')
    const tabs = wrapper.findAll('[role="tab"]')

    // Automatic activation: selecting and focusing happen together, so the
    // keyboard user is not left on an element with tabindex="-1".
    await tabs[0].trigger('keydown', { key: 'ArrowRight' })
    await wrapper.setProps({ modelValue: 'calendar' })

    expect(document.activeElement).toBe(tabs[1].element)
    wrapper.unmount()
  })

  it('is sticky above the scrolling sections, and scrolls sideways on narrow screens', () => {
    // happy-dom does not compute layout, so the stylesheet is what is checked:
    // the bar sticks to the top of the page's scrollport with an opaque
    // background and a stacking order above the content, and its own overflow
    // scrolls the tabs instead of the page. The page must not put an `overflow`
    // ancestor between them (that silently disables `position: sticky`).
    const bar = readFileSync(
      join(process.cwd(), 'src', 'components', 'settings', 'SettingsTabs.vue'),
      'utf8'
    )
    expect(bar).toContain('position: sticky')
    expect(bar).toContain('top: 0')
    expect(bar).toMatch(/z-index:\s*\d+/)
    expect(bar).toContain('background: var(--oc-role-surface, #fbfcfe)')
    expect(bar).toContain('overflow-x: auto')
    expect(bar).toContain('white-space: nowrap')

    const page = readFileSync(join(process.cwd(), 'src', 'views', 'Settings.vue'), 'utf8')
    // The page itself is the scrollport of the page (same contract as the other
    // app views) and keeps the tab bar full-bleed.
    expect(page).toContain('overflow-y: auto')
    expect(page).toContain('--settings-gutter: 16px')
    expect(page).not.toMatch(/\.settings-page\s*\{[^}]*padding:\s*16px/)
  })
})
