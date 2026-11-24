// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const fns = vi.hoisted(() => ({
  showMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  prepareImport: vi.fn(),
  loadTargets: vi.fn(),
  runImport: vi.fn(),
  reportImport: vi.fn(),
  downloadBlob: vi.fn()
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: fns.showMessage, showErrorMessage: fns.showErrorMessage }),
  useAuthStore: () => ({ accessToken: '' })
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

vi.mock('../../src/composables/download', () => ({ downloadBlob: fns.downloadBlob }))

import CsvDialog from '../../src/components/tools/CsvDialog.vue'
import { GOOGLE_CSV } from './fixtures/contacts-csv'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { disabled: { type: Boolean, default: false } },
  setup(props, { slots, attrs }) {
    return () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.())
  }
})

const BOOK = { url: 'https://cloud.example/carddav/user-1/contacts/', displayName: 'Contacts' }

function mountDialog(props: Record<string, unknown>) {
  return mount(CsvDialog, {
    props: { mode: 'import', ...(props as any) },
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true, teleport: true } }
  })
}

function actionButtons(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('.modal-actions button')
}

beforeEach(() => {
  fns.loadTargets.mockResolvedValue([BOOK])
  fns.prepareImport.mockResolvedValue({ kind: 'contacts', items: [], suggestedName: 'Contacts' })
  fns.runImport.mockResolvedValue({
    kind: 'contacts',
    created: 1,
    exists: 0,
    failed: 0,
    targetUrl: BOOK.url
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CsvDialog (import)', () => {
  it('detects the Google format and previews the contacts', async () => {
    const wrapper = mountDialog({ text: GOOGLE_CSV, fileName: 'contacts.csv' })
    await flushPromises()

    expect(wrapper.text()).toContain('Import contacts from CSV')
    expect(wrapper.text()).toContain('1 contact in this file')
    expect(wrapper.text()).toContain('Google Contacts')
    expect(wrapper.text()).toContain('Maria Weber')
    // Known format → no mapping UI, only the target selects.
    expect(wrapper.findAll('.mapping-row')).toHaveLength(0)
  })

  it('shows the column mapping for unknown headers and uses it', async () => {
    const text = ['Spalte A;Spalte B', 'Anna Schmidt;anna@example.com'].join('\r\n')
    const wrapper = mountDialog({ text, fileName: 'unbekannt.csv' })
    await flushPromises()

    expect(wrapper.text()).toContain('Unknown')
    const rows = wrapper.findAll('.mapping-row')
    expect(rows).toHaveLength(2)

    await rows[0].find('select').setValue('displayName')
    await flushPromises()

    expect(wrapper.text()).toContain('Anna Schmidt')
  })

  it('imports the contacts as vCards through the shared import path', async () => {
    const wrapper = mountDialog({ text: GOOGLE_CSV, fileName: 'contacts.csv' })
    await flushPromises()

    const buttons = actionButtons(wrapper)
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    const [kind, vcards, fileName] = fns.prepareImport.mock.calls[0]
    expect(kind).toBe('contacts')
    expect(fileName).toBe('contacts.csv')
    expect(vcards).toContain('BEGIN:VCARD')
    expect(vcards).toContain('FN:Maria Weber')
    expect(vcards).toContain('EMAIL;TYPE=home:maria@example.com')

    expect(fns.runImport).toHaveBeenCalledWith(expect.anything(), {
      mode: 'existing',
      targetUrl: BOOK.url
    })
    expect(fns.reportImport).toHaveBeenCalled()
    expect(wrapper.emitted('imported')?.[0]).toEqual([{ created: 1, exists: 0, failed: 0 }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

describe('CsvDialog (export)', () => {
  const contact = {
    id: 'maria-1',
    displayName: 'Maria Weber',
    firstName: 'Maria',
    lastName: 'Weber',
    emails: [{ type: 'home', value: 'maria@example.com' }],
    phones: [{ type: 'cell', value: '+49 170 1234567' }],
    addresses: [] as any[],
    organization: 'Example GmbH',
    title: 'Developer',
    notes: '',
    birthday: '1990-05-04'
  }

  it('writes a Google-compatible CSV and downloads it', async () => {
    const wrapper = mountDialog({
      mode: 'export',
      contacts: [contact],
      addressBookName: 'Contacts'
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Export contacts as CSV')
    expect(wrapper.text()).toContain('1 contact will be exported')

    const buttons = actionButtons(wrapper)
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()

    expect(fns.downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, fileName] = fns.downloadBlob.mock.calls[0]
    expect(fileName).toBe('contacts.csv')
    const csv = await (blob as Blob).text()
    expect(csv).toContain('E-mail 1 - Value')
    expect(csv).toContain('maria@example.com')
    expect(csv).toContain('1990-05-04')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
