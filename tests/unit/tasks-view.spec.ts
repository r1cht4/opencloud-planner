// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

const messages: string[] = []
const modals: Array<{ title: string; message?: string; onConfirm?: () => Promise<void> }> = []

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useRoute: () => ({ value: { path: '/planner/tasks', query: {}, hash: '' } }),
  useRouter: () => ({ push: (): undefined => undefined }),
  useMessages: () => ({
    showMessage: ({ title }: { title: string }) => messages.push(title),
    showErrorMessage: ({ title }: { title: string }) => messages.push(title)
  }),
  useModals: () => ({
    dispatchModal: (modal: { title: string; onConfirm?: () => Promise<void> }) => modals.push(modal)
  })
}))

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (message: string) => message })
}))

// The view is wrapped in ConnectionGate; this spec is about the task list, so the
// probe reports a healthy backend (the gate has its own specs).
vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref } = await import('vue')
  const outcome = ref('ok')
  return {
    useConnectionProbe: () => ({
      outcome,
      probing: ref(false),
      lastResult: ref(null),
      retest: async (): Promise<void> => undefined
    }),
    probeOutcomeForStatus: () => 'ok'
  }
})

import { resetDAVClient } from '../../src/composables/useDAVClient'
import TasksView from '../../src/views/Tasks.vue'

const ORIGIN = 'http://localhost:3000'
const CAL_TASKS = `${ORIGIN}/caldav/user-1/tasks/`

/** Pinned "now": the overdue fixture is dated 2020-01-01, so it must stay in the past. */
const NOW = new Date('2026-06-01T10:00:00Z')

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/</d:href>
    <d:propstat>
      <d:prop><d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const calendarsXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${CAL_TASKS}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Tasks</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        <c:calendar-color>#FF0000FF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

function vtodo(uid: string, summary: string, extra: string[] = []): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20260101T080000Z',
    `SUMMARY:${summary}`,
    ...extra,
    'END:VTODO',
    'END:VCALENDAR'
  ].join('\r\n')
}

const OVERDUE_ICS = vtodo('overdue-1', 'Ship the overdue report', ['DUE;VALUE=DATE:20200101'])
const UNDATED_ICS = vtodo('undated-1', 'Someday maybe')
const DONE_ICS = vtodo('done-1', 'Already finished', [
  'DUE;VALUE=DATE:20200102',
  'STATUS:COMPLETED',
  'PERCENT-COMPLETE:100'
])

const reportXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
${[
  { uid: 'overdue-1', etag: '"e1"', data: OVERDUE_ICS },
  { uid: 'undated-1', etag: '"e2"', data: UNDATED_ICS },
  { uid: 'done-1', etag: '"e3"', data: DONE_ICS }
]
  .map(
    (r) => `  <d:response>
    <d:href>${CAL_TASKS}${r.uid}.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>${r.etag}</d:getetag><c:calendar-data>${r.data}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`

interface Call {
  url: string
  method: string
  headers: Headers
  body: string
}

function stubFetch() {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any = {}) => {
      const method = String(init.method || 'GET')
      const body = String(init.body ?? '')
      calls.push({ url: String(url), method, headers: new Headers(init.headers), body })

      const respond = (status: number, text = '', headers: Record<string, string> = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        headers: new Headers(headers)
      })

      if (method === 'PROPFIND') {
        return respond(207, body.includes('current-user-principal') ? principalXml : calendarsXml)
      }
      if (method === 'REPORT') return respond(207, reportXml)
      if (method === 'PUT') {
        // Status/ETag only — the view re-parses its own document on the next load.
        return respond(201, '', { ETag: '"etag-new"' })
      }
      if (method === 'DELETE') return respond(204)
      return respond(404)
    })
  )
  return calls
}

function mountView(): VueWrapper {
  return mount(TasksView, {
    global: {
      mocks: { $gettext: (message: string) => message },
      stubs: {
        teleport: true,
        'oc-icon': true,
        'oc-spinner': true,
        'oc-button': true,
        'oc-text-input': true,
        'oc-textarea': true
      }
    }
  })
}

/**
 * Wait until the page has actually finished loading instead of counting ticks.
 *
 * The load is `PROPFIND → PROPFIND → REPORT → ical.js dynamic import()`, so the
 * number of microtask turns is not fixed — and the dynamic import resolves on a
 * later macrotask, which is why a fixed number of `flushPromises()` is flaky on a
 * loaded machine. `vi.waitFor` polls the rendered output with real timers.
 */
async function waitForRows(target: VueWrapper, count: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(target.findAll('.task-row')).toHaveLength(count)
    },
    { timeout: 10_000, interval: 10 }
  )
}

let wrapper: VueWrapper | null = null

/** Mount and wait for the default "Open" view to be rendered (2 fixture tasks). */
async function mountLoaded(): Promise<VueWrapper> {
  wrapper = mountView()
  await waitForRows(wrapper, 2)
  return wrapper
}

beforeEach(() => {
  // Date-only mock (no fake timers, so `vi.waitFor` keeps using real timers).
  vi.setSystemTime(NOW)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  vi.useRealTimers() // restores the real Date
  resetDAVClient()
  messages.length = 0
  modals.length = 0
})

describe('Tasks view', () => {
  it('groups the open tasks by calendar, sorted by due date', async () => {
    stubFetch()
    const view = await mountLoaded()

    const groups = view.findAll('.task-group')
    expect(groups).toHaveLength(1)
    expect(groups[0].text()).toContain('Tasks')

    // The completed task is hidden by the default "Open" filter; undated last.
    expect(view.findAll('.task-title').map((t) => t.text())).toEqual([
      'Ship the overdue report',
      'Someday maybe'
    ])
  })

  it('marks overdue open tasks', async () => {
    stubFetch()
    const view = await mountLoaded()

    const badges = view.findAll('.task-badge--overdue')
    expect(badges).toHaveLength(1)
    expect(badges[0].text()).toBe('Overdue')
    expect(view.findAll('.task-due.is-overdue')).toHaveLength(1)
  })

  it('filters to completed tasks', async () => {
    stubFetch()
    const view = await mountLoaded()

    const completedChip = view.findAll('.filter-chip').find((chip) => chip.text() === 'Completed')!
    await completedChip.trigger('click')

    await vi.waitFor(() => expect(view.findAll('.task-row')).toHaveLength(1), { timeout: 10_000 })
    const rows = view.findAll('.task-row')
    expect(rows[0].find('.task-title').text()).toBe('Already finished')
    expect(rows[0].classes()).toContain('is-completed')
  })

  it('adds a task from the quick-add input', async () => {
    const calls = stubFetch()
    const view = await mountLoaded()

    await view.find('#quick-add-input').setValue('Water the plants')
    await view.find('form.quick-add').trigger('submit')

    await vi.waitFor(() => expect(messages).toContain('Task created'), { timeout: 10_000 })

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.headers.get('If-None-Match')).toBe('*')
    expect(put.body).toContain('SUMMARY:Water the plants')

    await vi.waitFor(
      () => expect(view.findAll('.task-title').map((t) => t.text())).toContain('Water the plants'),
      { timeout: 10_000 }
    )
  })

  it('completes a task from its checkbox', async () => {
    const calls = stubFetch()
    const view = await mountLoaded()

    await view.findAll('.task-checkbox')[0].trigger('change')

    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1), {
      timeout: 10_000
    })

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.headers.get('If-Match')).toBe('"e1"')
    expect(put.body).toContain('STATUS:COMPLETED')
    expect(put.body).toContain('PERCENT-COMPLETE:100')
  })

  it('opens an accessible edit dialog when a row is clicked', async () => {
    stubFetch()
    const view = await mountLoaded()

    await view.findAll('.task-main')[0].trigger('click')

    await vi.waitFor(() => expect(view.find('[role="dialog"]').exists()).toBe(true), {
      timeout: 10_000
    })

    const dialog = view.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('task-dialog-title')
    expect(view.find('#task-dialog-title').text()).toBe('Edit task')
  })

  it('asks for confirmation before deleting', async () => {
    stubFetch()
    const view = await mountLoaded()

    await view.findAll('.task-delete')[0].trigger('click')

    await vi.waitFor(() => expect(modals).toHaveLength(1), { timeout: 10_000 })

    expect(modals[0].title).toBe('Delete task')
    expect(modals[0].message).toBe('Are you sure you want to delete this task?')
  })
})
