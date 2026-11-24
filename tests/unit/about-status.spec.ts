// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const USER_ID = '5f0c3b1e-8a2d-4f7b-9c1e-3d2b4a5c6d7e'
const PRINCIPAL = `http://localhost:3000/caldav/${USER_ID}/`

const probe = vi.hoisted(() => ({
  state: null as null | { outcome: { value: string }; lastResult: { value: unknown } }
}))

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref } = await import('vue')
  probe.state = { outcome: ref('ok'), lastResult: ref({ outcome: 'ok', status: 207 }) }
  return {
    useConnectionProbe: () => ({
      outcome: probe.state!.outcome,
      lastResult: probe.state!.lastResult,
      probing: ref(false),
      retest: vi.fn(async () => undefined)
    }),
    retest: vi.fn(async () => undefined),
    probeOutcomeForStatus: () => 'ok'
  }
})

vi.mock('../../src/composables/useDAVClient', () => ({
  useDAVClient: () => ({ getState: () => ({ principalUrl: PRINCIPAL }) }),
  propfind: async () => ''
}))

vi.mock('../../src/composables/useCalendarService', () => ({
  useCalendarService: () => ({
    error: { value: null as string | null },
    fetchCalendars: async (): Promise<Array<{ url: string }>> => [
      { url: `http://localhost:3000/caldav/${USER_ID}/personal/` },
      { url: `http://localhost:3000/caldav/${USER_ID}/work/` }
    ],
    fetchEvents: async (): Promise<Array<{ id: string }>> => [{ id: 'a' }, { id: 'b' }]
  })
}))

vi.mock('../../src/composables/useContactsService', () => ({
  useContactsService: () => ({
    error: { value: null as string | null },
    fetchAddressBooks: async (): Promise<Array<{ url: string }>> => [
      { url: `http://localhost:3000/carddav/${USER_ID}/contacts/` }
    ],
    fetchContacts: async (): Promise<Array<{ id: string }>> => [
      { id: 'c1' },
      { id: 'c2' },
      { id: 'c3' }
    ]
  })
}))

vi.mock('../../src/composables/useTasksService', () => ({
  useTasksService: () => ({
    error: { value: null as string | null },
    fetchCalendars: async (): Promise<unknown[]> => [],
    fetchTasks: async (): Promise<Array<{ id: string }>> => [{ id: 't1' }]
  })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({
    $gettext: (text: string, params?: Record<string, string | number>) =>
      text.replace(/%\{\s*([\w.]+)\s*\}/g, (_m, key: string) => String(params?.[key] ?? ''))
  })
}))

import { readFileSync } from 'node:fs'
import AboutStatus from '../../src/components/settings/AboutStatus.vue'
import { APP_VERSION, buildDiagnostics, redactUserIds } from '../../src/setup/diagnostics'

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { ariaLabel: { type: String as PropType<string>, default: '' } },
  setup(props, { slots, attrs }) {
    return () =>
      h('button', { ...attrs, 'aria-label': props.ariaLabel || undefined }, slots.default?.())
  }
})

function mountStatus() {
  return mount(AboutStatus, {
    global: { stubs: { 'oc-button': OcButtonStub, 'oc-icon': true } }
  })
}

beforeEach(() => {
  // `onMounted` reads /status.php; never let a test reach the real network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ productversion: '9.2.0' }) }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('diagnostics', () => {
  it('diagnostics redact user id', () => {
    const report = buildDiagnostics({
      outcome: 'ok',
      status: 207,
      principal: PRINCIPAL,
      opencloudVersion: '9.2.0',
      calendars: 2,
      addressBooks: 1,
      events: 4,
      contacts: 3,
      tasks: 1,
      lastCheck: Date.UTC(2026, 10, 23, 20, 0, 0),
      now: new Date(Date.UTC(2026, 10, 23, 20, 5, 0)),
      userAgent: 'Mozilla/5.0 (Test)'
    })

    // No user id (Radicale principal and collection URLs contain it) anywhere.
    expect(report).not.toContain(USER_ID)
    expect(report).toContain('/caldav/<user>/')
    expect(report).toContain('OpenCloud 9.2.0')
    expect(report).toContain('DAV outcome: ok (HTTP 207)')
    expect(report).toContain('Calendars: 2')
    expect(report).toContain('Address books: 1')
    expect(report).toContain('Events (loaded range): 4')
    expect(report).toContain('Contacts: 3')
    expect(report).toContain('Tasks: 1')
    expect(report).toContain('Generated: 2026-11-23T20:05:00.000Z')
    // No names or e-mail addresses are part of the report at all.
    expect(report).not.toContain('@')
    expect(report).not.toContain('undefined')
  })

  it('injects the package version as __APP_VERSION__', () => {
    // vitest runs from the project root, so the manifest is a relative read.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).not.toBe('unknown')
  })

  it('redacts UUIDs in any case and keeps everything else', () => {
    expect(redactUserIds(`/caldav/${USER_ID.toUpperCase()}/x`)).toBe('/caldav/<user>/x')
    expect(redactUserIds('no ids here')).toBe('no ids here')
    expect(redactUserIds('/caldav/a/b/')).toBe('/caldav/a/b/')
  })
})

describe('AboutStatus', () => {
  it('shows the connection, counts and versions', async () => {
    const wrapper = mountStatus()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('OK')
    expect(text).toContain(PRINCIPAL)
    expect(text).toContain('Address books')
    expect(text).toContain('Events (last and next 6 months)')
    expect(text).toContain('9.2.0')
  })

  it('copies diagnostics without the user id', async () => {
    const clipboard = { writeText: vi.fn(async (_text: string) => undefined) }
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mountStatus()
    await flushPromises()

    const copyButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Copy diagnostics'))
    expect(copyButton).toBeTruthy()

    await copyButton!.trigger('click')
    await flushPromises()

    expect(clipboard.writeText).toHaveBeenCalledTimes(1)
    const report = String(clipboard.writeText.mock.calls[0][0])
    expect(report).toContain('/caldav/<user>/')
    expect(report).not.toContain(USER_ID)
    expect(report).toContain('OpenCloud 9.2.0')
    expect(wrapper.text()).toContain('Diagnostics copied')
  })

  it('renders the plain-text report for manual copying', async () => {
    const wrapper = mountStatus()
    await flushPromises()

    const report = wrapper.find('.status-report-text').text()
    expect(report).toContain('/caldav/<user>/')
    expect(report).not.toContain(USER_ID)
  })
})
