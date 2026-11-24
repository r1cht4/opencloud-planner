// @vitest-environment happy-dom
/**
 * The layout primitives of the redesigned Settings page.
 *
 * `SettingsSection` (group card), `SettingsRow` (one setting) and `SettingsMore`
 * ("More options") replaced the per-feature CSS and the repeated "read-only"
 * paragraphs. These tests pin the contract every tab relies on: label + hint +
 * control per row, a lock marker on locked rows, and `<details>`-based groups and
 * option blocks that start collapsed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

import SettingsRow from '../../src/components/settings/SettingsRow.vue'
import SettingsMore from '../../src/components/settings/SettingsMore.vue'
import SettingsLock from '../../src/components/settings/SettingsLock.vue'
import SettingsSection from '../../src/components/settings/SettingsSection.vue'

const stubs = {
  'oc-icon': defineComponent({
    name: 'OcIcon',
    props: { name: { type: String as PropType<string>, default: '' } },
    setup(props) {
      return () => h('i', { 'data-icon': props.name })
    }
  })
}

describe('SettingsLock', () => {
  it('is a lock icon with the shared explanation as title and label', () => {
    const wrapper = mount(SettingsLock, { global: { stubs } })

    const lock = wrapper.get('[aria-label="Set by your administrator."]')
    expect(lock.attributes('title')).toBe('Set by your administrator.')
    expect(lock.attributes('role')).toBe('img')
    expect(wrapper.find('[data-icon="lock"]').exists()).toBe(true)
  })
})

describe('SettingsRow', () => {
  it('renders label, one-line hint and the control slot', () => {
    const wrapper = mount(SettingsRow, {
      props: { label: 'Default view', hint: 'Shown when the calendar opens.' },
      slots: { default: '<select data-control="x"><option>Month</option></select>' },
      global: { stubs }
    })

    expect(wrapper.get('.settings-row-label').text()).toBe('Default view')
    expect(wrapper.get('.settings-row-hint').text()).toBe('Shown when the calendar opens.')
    expect(wrapper.find('.settings-row-control [data-control="x"]').exists()).toBe(true)
    // No lock without `locked`.
    expect(wrapper.find('[aria-label="Set by your administrator."]').exists()).toBe(false)
  })

  it('ties the label to a control id, so clicking the label toggles it', () => {
    const wrapper = mount(SettingsRow, {
      props: { label: 'Show weekends', labelFor: 'setting-weekends' },
      slots: { default: '<input id="setting-weekends" type="checkbox" />' },
      global: { stubs }
    })

    const label = wrapper.get('label.settings-row-label')
    expect(label.attributes('for')).toBe('setting-weekends')
  })

  it('marks a locked row with the lock icon next to the label', () => {
    const wrapper = mount(SettingsRow, {
      props: { label: 'Default view', locked: true },
      global: { stubs }
    })

    const lock = wrapper.find('.settings-row-label [aria-label="Set by your administrator."]')
    expect(lock.exists()).toBe(true)
  })

  it('has no hint element when no hint is given', () => {
    const wrapper = mount(SettingsRow, { props: { label: 'Clock' }, global: { stubs } })

    expect(wrapper.find('.settings-row-hint').exists()).toBe(false)
  })
})

describe('SettingsMore', () => {
  it('is a native details block that starts collapsed', () => {
    const wrapper = mount(SettingsMore, {
      slots: { default: '<p class="rare-setting">Day starts at</p>' },
      global: { stubs }
    })

    const details = wrapper.get('details.settings-more')
    expect(details.attributes('open')).toBeUndefined()
    // The content is in the DOM (native details hides it), so nothing can break it.
    expect(details.find('.rare-setting').exists()).toBe(true)
    expect(details.get('summary').text()).toContain('More options')
  })

  it('takes a custom summary label', () => {
    const wrapper = mount(SettingsMore, {
      props: { label: 'Show in the Files sidebar' },
      global: { stubs }
    })

    expect(wrapper.get('summary').text()).toContain('Show in the Files sidebar')
  })
})

describe('SettingsSection', () => {
  it('is a group card with an h2 heading, optional hint and the rows', () => {
    const wrapper = mount(SettingsSection, {
      props: { title: 'View', hint: 'How the grid looks.' },
      slots: { default: '<div class="row-x" />' },
      global: { stubs }
    })

    expect(wrapper.find('section.settings-section').exists()).toBe(true)
    expect(wrapper.get('h2.settings-section-title').text()).toBe('View')
    expect(wrapper.get('.settings-section-hint').text()).toBe('How the grid looks.')
    expect(wrapper.find('.settings-section-body .row-x').exists()).toBe(true)
  })

  it('spans both grid columns with the wide modifier', () => {
    const wide = mount(SettingsSection, {
      props: { title: 'Devices', wide: true },
      global: { stubs }
    })
    expect(wide.get('section').classes()).toContain('settings-section--wide')

    const normal = mount(SettingsSection, { props: { title: 'Tasks' }, global: { stubs } })
    expect(normal.get('section').classes()).not.toContain('settings-section--wide')
  })

  it('renders a collapsible group as a details element, collapsed', () => {
    const wrapper = mount(SettingsSection, {
      props: { title: 'Clean up', collapsible: true },
      slots: { default: '<p class="cleanup-row">Find duplicates</p>' },
      global: { stubs }
    })

    const details = wrapper.get('details.settings-section')
    expect(details.attributes('open')).toBeUndefined()
    // The heading is the summary, so the group title is visible while collapsed.
    expect(details.get('summary h2').text()).toBe('Clean up')
    expect(details.find('.cleanup-row').exists()).toBe(true)
  })

  it('links the section to its heading id when an id is given', () => {
    const wrapper = mount(SettingsSection, {
      props: { id: 'data', title: 'Data' },
      global: { stubs }
    })

    expect(wrapper.get('section').attributes('id')).toBe('data')
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe('data-title')
    expect(wrapper.get('h2').attributes('id')).toBe('data-title')
  })
})

/**
 * The page is a column flex container with a definite height, so a child whose
 * `overflow` is not `visible` may legally shrink to zero. That is what happened
 * to the tab bar in the deployed build: 1px tall, its tabs clipped, listed in the
 * a11y tree but impossible to click. These are source-level guards (jsdom does no
 * layout) for the two rules that keep the bar and the toolbar at their height.
 */
describe('Settings page layout invariants', () => {
  it('keeps the tab bar out of the page flex shrink and sticky', () => {
    const source = readFileSync('src/components/settings/SettingsTabs.vue', 'utf8')
    const style = source.slice(source.indexOf('<style scoped>'))
    const rule = style.slice(style.indexOf('.settings-tabs {'), style.indexOf('.settings-tablist'))

    expect(rule).toContain('flex: none')
    expect(rule).toContain('position: sticky')
    expect(rule).toContain('top: 0')
  })

  it('gives every direct child of the scrolling page its natural height', () => {
    const source = readFileSync('src/views/Settings.vue', 'utf8')
    const start = source.indexOf('.settings-page > * {')

    expect(start).toBeGreaterThan(-1)
    const rule = source.slice(start, source.indexOf('}', start))
    expect(rule).toContain('flex: 0 0 auto')
  })

  it('ties every checkbox row to its checkbox (label-for), so the text names and toggles it', () => {
    // Without `label-for` SettingsRow renders a plain <span>: screen readers
    // announce an unnamed checkbox and clicking the text does nothing.
    const dir = 'src/components/settings'
    const offenders: string[] = []
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.vue'))) {
      const source = readFileSync(`${dir}/${name}`, 'utf8')
      for (const row of source.matchAll(/<SettingsRow\b([^>]*)>([\s\S]*?)<\/SettingsRow>/g)) {
        const [, attrs, body] = row
        for (const input of body.matchAll(/<input\b[^>]*>/g)) {
          if (!/type="checkbox"/.test(input[0])) continue
          const id = /\bid="([^"]+)"/.exec(input[0])?.[1]
          if (!id || !attrs.includes(`label-for="${id}"`))
            offenders.push(`${name}: ${id ?? '(no id)'}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the Data-tab select and button-row styles in settings.css, not per card', () => {
    const cards = [
      'CalendarToolsCard',
      'ContactsToolsCard',
      'ContactsCsvCard',
      'DuplicateEventsCard',
      'BackupCard'
    ]
    for (const card of cards) {
      const source = readFileSync(`src/components/tools/${card}.vue`, 'utf8')
      const style = source.slice(source.indexOf('<style'))
      expect(style, card).not.toMatch(/\.form-select|\.button-row|\.settings-button-row/)
    }
    const shared = readFileSync('src/styles/settings.css', 'utf8')
    expect(shared).toContain('.settings-select--fill')
    expect(shared).toContain('.settings-button-row')
  })
})
