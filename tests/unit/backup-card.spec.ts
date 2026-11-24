// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const fns = vi.hoisted(() => ({
  showMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  buildBackup: vi.fn(),
  downloadBlob: vi.fn(),
  planRestore: vi.fn(),
  readZip: vi.fn(),
  prepareImport: vi.fn(),
  loadTargets: vi.fn(),
  runImport: vi.fn(),
  reportImport: vi.fn()
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: fns.showMessage, showErrorMessage: fns.showErrorMessage })
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
        String(params?.[key] ?? n)
      )
  })
}))

vi.mock('../../src/tools/backup', () => ({
  buildBackup: fns.buildBackup,
  downloadBlob: fns.downloadBlob,
  planRestore: fns.planRestore
}))

vi.mock('../../src/tools/zip', () => ({ readZip: fns.readZip }))

vi.mock('../../src/composables/useImport', async () => {
  const { ref } = await import('vue')
  return {
    useImport: () => ({
      importBusy: ref(false),
      prepareImport: fns.prepareImport,
      loadTargets: fns.loadTargets,
      runImport: fns.runImport,
      reportImport: fns.reportImport
    })
  }
})

import BackupCard from '../../src/components/tools/BackupCard.vue'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: {
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String as PropType<string>, default: '' },
    title: { type: String as PropType<string>, default: '' }
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          'aria-label': props.ariaLabel || undefined,
          title: props.title || undefined
        },
        slots.default?.()
      )
  }
})

const PERSONAL = { url: 'https://cloud.example/caldav/user-1/personal/', displayName: 'Personal' }
const CONTACTS = { url: 'https://cloud.example/carddav/user-1/contacts/', displayName: 'Contacts' }

const ICS_TEXT = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

const PLAN = {
  manifest: {
    app: 'planner',
    version: 1,
    created: '2026-01-01T00:00:00Z',
    collections: [] as any[]
  },
  items: [
    {
      fileName: 'personal.ics',
      kind: 'calendar' as const,
      displayName: 'Personal',
      color: '#00677F',
      existingUrl: PERSONAL.url,
      suggestedName: 'Personal'
    }
  ],
  skipped: ['notes.txt']
}

function mountCard() {
  return mount(BackupCard, {
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, teleport: true } }
  })
}

async function chooseFile(wrapper: ReturnType<typeof mountCard>, file: unknown) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  fns.buildBackup.mockResolvedValue({
    blob: new Blob(['zip'], { type: 'application/zip' }),
    failed: []
  })
  fns.readZip.mockResolvedValue([
    { name: 'manifest.json', data: new Uint8Array() },
    { name: 'personal.ics', data: new TextEncoder().encode(ICS_TEXT) }
  ])
  fns.loadTargets.mockImplementation(async (kind: string) =>
    kind === 'calendar' ? [PERSONAL] : [CONTACTS]
  )
  fns.planRestore.mockReturnValue(PLAN)
  fns.prepareImport.mockResolvedValue({ kind: 'calendar', items: [], suggestedName: 'Personal' })
  fns.runImport.mockResolvedValue({
    kind: 'calendar',
    created: 2,
    exists: 1,
    failed: 0,
    targetUrl: PERSONAL.url
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BackupCard', () => {
  it('renders the backup and restore actions', () => {
    const wrapper = mountCard()

    // The heading is the group card's ("Backup & restore" in the Data tab); the
    // component itself only renders the two actions.
    expect(wrapper.text()).toContain('Create backup (.zip)')
    expect(wrapper.text()).toContain('Restore from backup')
    expect(wrapper.find('h2').exists()).toBe(false)
  })

  it('creates a backup and downloads it as a dated zip', async () => {
    const wrapper = mountCard()
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()

    expect(fns.buildBackup).toHaveBeenCalledTimes(1)
    expect(fns.downloadBlob).toHaveBeenCalledTimes(1)
    expect(fns.downloadBlob.mock.calls[0][1]).toMatch(/^planner-backup-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(fns.showMessage).toHaveBeenCalledWith({ title: 'Backup created' })
  })

  it('names the collections that could not be read instead of a silent success', async () => {
    fns.buildBackup.mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      failed: [
        { kind: 'calendar', displayName: 'Work' },
        { kind: 'addressbook', displayName: 'Broken' }
      ]
    })
    const wrapper = mountCard()
    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()

    // The download still happens, but the message says what is missing.
    expect(fns.downloadBlob).toHaveBeenCalledTimes(1)
    expect(fns.showErrorMessage).toHaveBeenCalledWith({
      title: 'Incomplete backup',
      desc: expect.stringContaining('Work, Broken')
    })
    expect(fns.showMessage).not.toHaveBeenCalled()
  })

  it('shows what will be restored and imports into the chosen collection', async () => {
    const wrapper = mountCard()

    await chooseFile(wrapper, {
      name: 'backup.zip',
      arrayBuffer: async () => new ArrayBuffer(4)
    })

    expect(fns.planRestore).toHaveBeenCalledWith(expect.any(Array), {
      calendars: [PERSONAL],
      addressBooks: [CONTACTS]
    })

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('Personal')
    expect(dialog.text()).toContain('personal.ics')
    expect(dialog.text()).toContain('Not used from this backup: notes.txt')

    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.prepareImport).toHaveBeenCalledWith(
      'calendar',
      expect.stringContaining('BEGIN:VCALENDAR'),
      'personal.ics'
    )
    expect(fns.runImport).toHaveBeenCalledWith(expect.anything(), {
      mode: 'existing',
      targetUrl: PERSONAL.url
    })
    expect(fns.showMessage).toHaveBeenCalledWith({
      title: '2 items restored, 1 item skipped (already exists)'
    })
    expect(wrapper.emitted('restored')).toBeTruthy()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('creates a new collection when the archive name is unknown', async () => {
    fns.planRestore.mockReturnValue({
      ...PLAN,
      items: [{ ...PLAN.items[0], existingUrl: null, suggestedName: 'Personal' }]
    })

    const wrapper = mountCard()
    await chooseFile(wrapper, { name: 'backup.zip', arrayBuffer: async () => new ArrayBuffer(4) })

    // No name match → the dialog defaults to "New" with the manifest name.
    const buttons = wrapper.findAll('[role="dialog"] button')
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.runImport).toHaveBeenCalledWith(expect.anything(), {
      mode: 'new',
      newName: 'Personal'
    })
  })

  it('reports an unreadable archive instead of opening the dialog', async () => {
    fns.readZip.mockRejectedValue(new Error('Not a zip file'))

    const wrapper = mountCard()
    await chooseFile(wrapper, { name: 'broken.zip', arrayBuffer: async () => new ArrayBuffer(4) })

    expect(fns.showErrorMessage).toHaveBeenCalledWith({
      title: 'This file is not a readable zip archive'
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('reports a backup without calendars or address books', async () => {
    fns.planRestore.mockReturnValue({ manifest: null, items: [], skipped: [] })

    const wrapper = mountCard()
    await chooseFile(wrapper, { name: 'empty.zip', arrayBuffer: async () => new ArrayBuffer(4) })

    expect(fns.showErrorMessage).toHaveBeenCalledWith({
      title: 'This backup contains no calendars or address books'
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
