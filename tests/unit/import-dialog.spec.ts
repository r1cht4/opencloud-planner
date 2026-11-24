/**
 * ImportDialog — the import-target dialog extracted from the Tools view.
 *
 * The Tools view hosts it standalone (own overlay + dialog semantics, the
 * selectors the deployed e2e flow relies on); the Files app actions host it in
 * the platform modal, where the shell owns the overlay and the title.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({
  loadTargets: vi.fn(),
  importInto: vi.fn()
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? '')),
    $ngettext: (
      singular: string,
      plural: string,
      n: number,
      params?: Record<string, string | number>
    ) =>
      (n === 1 ? singular : plural).replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) =>
        String(params?.[key] ?? '')
      )
  })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useModals: () => ({ removeModal: vi.fn() }),
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() })
}))

vi.mock('../../src/composables/useImport', async () => {
  const { ref } = await import('vue')
  return {
    useImport: () => ({
      importBusy: ref(false),
      loadTargets: state.loadTargets,
      importInto: state.importInto
    })
  }
})

import ImportDialog from '../../src/components/ImportDialog.vue'

const TARGETS = [
  { url: 'http://dav.test/user-1/personal/', displayName: 'Personal' },
  { url: 'http://dav.test/user-1/work/', displayName: 'Work' }
]

const ITEMS = [{ uid: 'u1', ics: 'ICS-1', summary: 'One' }]

async function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(ImportDialog, {
    props: { kind: 'calendar', items: ITEMS, ...props },
    global: {
      stubs: {
        // The standalone dialog teleports its overlay to <body>; keep it inline
        // so the rendered markup can be asserted directly.
        teleport: true,
        'oc-button': {
          template: '<button v-bind="$attrs"><slot /></button>'
        },
        'oc-icon': true
      }
    }
  })
  // Targets are resolved in onMounted; wait for the first flush so the
  // preselection (and the enabled Import button) is in place.
  await wrapper.vm.$nextTick()
  return wrapper
}

beforeEach(() => {
  state.loadTargets.mockReset().mockResolvedValue(TARGETS)
  state.importInto.mockReset().mockResolvedValue(null)
})

describe('ImportDialog standalone (Tools view)', () => {
  it('keeps the selectors the e2e import flow uses', async () => {
    const wrapper = await mountDialog({ suggestedName: 'Holidays' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.find('#import-dialog-title').text()).toBe('Import events')
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true)
    // Exactly one text input (the new-collection name) — the e2e fills it.
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)
    expect(wrapper.find('input[type="text"]').element).toHaveProperty('value', 'Holidays')
    expect(
      wrapper.findAll('input[type="radio"]').map((r) => (r.element as HTMLInputElement).value)
    ).toEqual(['existing', 'new'])
    // The count in the hint is a real plural, not "event(s)".
    expect(wrapper.find('.import-hint').text()).toBe('1 event in this file')
  })

  it('uses the plural form of the hint for several items', async () => {
    const wrapper = await mountDialog({ items: [...ITEMS, { uid: 'u2', ics: 'ICS-2' }] })
    expect(wrapper.find('.import-hint').text()).toBe('2 events in this file')
  })

  it('names contacts when the dialog imports contacts', async () => {
    const wrapper = await mountDialog({ kind: 'contacts' })
    expect(wrapper.find('.import-hint').text()).toBe('1 contact in this file')
  })

  it('preselects the requested target and lists the offered collections', async () => {
    const wrapper = await mountDialog({ targets: TARGETS, initialTargetUrl: TARGETS[1].url })
    await wrapper.vm.$nextTick()
    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).value).toBe(TARGETS[1].url)
    expect(select.findAll('option')).toHaveLength(2)
  })

  it('falls back to a new collection when none exists yet', async () => {
    const wrapper = await mountDialog({ targets: [] })
    await wrapper.vm.$nextTick()
    const radios = wrapper.findAll('input[type="radio"]')
    expect((radios[1].element as HTMLInputElement).checked).toBe(true)
  })

  it('loads the collections itself when no targets are passed (Files app flow)', async () => {
    const wrapper = await mountDialog()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(state.loadTargets).toHaveBeenCalledWith('calendar')
    expect(wrapper.findAll('option')).toHaveLength(2)
  })

  it('imports into the chosen target and reports the counts upward', async () => {
    const counts = { kind: 'calendar', created: 1, exists: 0, failed: 0, targetUrl: TARGETS[0].url }
    state.importInto.mockResolvedValue(counts)
    const wrapper = await mountDialog({ targets: TARGETS })

    const importButton = wrapper.findAll('button').at(-1)!
    expect(importButton.text()).toBe('Import')
    await importButton.trigger('click')
    await wrapper.vm.$nextTick()

    expect(state.importInto).toHaveBeenCalledWith(
      { kind: 'calendar', items: ITEMS, suggestedName: '' },
      { mode: 'existing', targetUrl: TARGETS[0].url, newName: '' },
      { hint: undefined }
    )
    expect(wrapper.emitted('imported')?.[0]).toEqual([counts])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('adds the open-app hint for the Files app flow', async () => {
    state.importInto.mockResolvedValue({
      kind: 'calendar',
      created: 1,
      exists: 0,
      failed: 0,
      targetUrl: TARGETS[0].url
    })
    const wrapper = await mountDialog({ targets: TARGETS, showOpenHint: true })

    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(state.importInto.mock.calls[0][2]).toEqual({
      hint: 'Open Calendar to see the imported events.'
    })
  })

  it('keeps the dialog open when the import could not start', async () => {
    const wrapper = await mountDialog({ targets: TARGETS })
    await wrapper.findAll('button').at(-1)!.trigger('click')
    expect(wrapper.emitted('imported')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
  })
})

describe('ImportDialog embedded (platform modal)', () => {
  it('has no dialog semantics of its own and no duplicated title', async () => {
    const wrapper = await mountDialog({ targets: TARGETS, standalone: false })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('#import-dialog-title').exists()).toBe(false)
    // The controls still render, so the platform shell can host them.
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2)
    expect(wrapper.findAll('button').at(-1)!.text()).toBe('Import')
  })
})
