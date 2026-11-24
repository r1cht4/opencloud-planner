// @vitest-environment happy-dom
/**
 * DataSettings – wiring of the group cards, not their content (each card has its own
 * spec). The page bumps a `refreshKey` when a card reports `changed`; both contacts
 * halves (Import & export, Clean up) must forward that, so a `.vcf` import refreshes
 * the cards around it.
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

import DataSettings from '../../src/components/settings/DataSettings.vue'

/** Stands in for both halves; the button reports a finished import. */
const ContactsToolsCardStub = defineComponent({
  name: 'ContactsToolsCard',
  props: { part: { type: String, default: 'import' }, refreshKey: { type: Number, default: 0 } },
  emits: ['changed'],
  setup(props, { emit }) {
    return () =>
      h(
        'button',
        { class: `contacts-tools-${props.part}`, onClick: () => emit('changed') },
        props.part
      )
  }
})

function mountData() {
  return mount(DataSettings, {
    props: { refreshKey: 0 },
    global: {
      stubs: {
        ConnectionGate: { template: '<div><slot /></div>' },
        CollectionsCard: true,
        CalendarToolsCard: true,
        ContactsCsvCard: true,
        BackupCard: true,
        DuplicateEventsCard: true,
        ContactsToolsCard: ContactsToolsCardStub,
        'oc-icon': true
      }
    }
  })
}

describe('DataSettings', () => {
  it('forwards the import half reporting a change to the page', async () => {
    const wrapper = mountData()

    await wrapper.find('.contacts-tools-import').trigger('click')

    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('forwards the clean-up half reporting a change to the page', async () => {
    const wrapper = mountData()

    await wrapper.find('.contacts-tools-cleanup').trigger('click')

    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
