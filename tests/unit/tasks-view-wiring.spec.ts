// @vitest-environment happy-dom
/**
 * The view wiring: `views/Tasks.vue` creates new tasks in `tasks.defaultCalendar`,
 * opens with the `tasks.showCompleted` filter, handles the `?open=<href>` deep
 * link (reminder clicks) and is wrapped in `ConnectionGate`.
 */
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

const settingsState = vi.hoisted(() => ({
  doc: {} as Record<string, unknown>,
  locked: [] as string[],
  admin: {} as Record<string, unknown>,
  calls: [] as Array<[string, unknown]>,
  loaded: true,
  error: null as string | null,
  docRef: undefined as unknown as { value: Record<string, unknown> } | undefined
}))

const routeState = vi.hoisted(() => ({
  path: '/planner/tasks',
  query: {} as Record<string, unknown>,
  hash: ''
}))

const probe = vi.hoisted(() => ({ outcome: null as unknown as { value: string } }))
const refreshReminders = vi.hoisted(() => vi.fn())

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() }),
  useModals: () => ({ dispatchModal: vi.fn() }),
  useRoute: () => ({
    get value() {
      return routeState
    }
  }),
  useRouter: () => ({ push: vi.fn() }),
  useAbility: () => ({ can: () => false })
}))

vi.mock('../../src/settings/settingsStore', async () => {
  const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
  return createSettingsStoreMock(settingsState)
})

vi.mock('../../src/composables/useConnectionProbe', async () => {
  const { ref: vueRef } = await import('vue')
  const outcome = vueRef<string>('ok')
  probe.outcome = outcome as unknown as { value: string }
  return {
    useConnectionProbe: () => ({
      outcome,
      probing: vueRef(false),
      lastResult: vueRef(null),
      retest: async (): Promise<void> => undefined
    }),
    probeOutcomeForStatus: () => 'ok'
  }
})

vi.mock('../../src/setup/reminders', () => ({
  refreshReminders,
  startReminderWiring: (): (() => void) => (): void => undefined
}))

import TasksView from '../../src/views/Tasks.vue'

const ORIGIN = 'http://localhost:3000'
const CAL_TASKS = `${ORIGIN}/caldav/user-1/tasks/`
const CAL_WORK = `${ORIGIN}/caldav/user-1/work/`

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

function calendarsXml(): string {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
${[
  { url: CAL_TASKS, name: 'Tasks' },
  { url: CAL_WORK, name: 'Work' }
]
  .map(
    (cal) => `  <d:response>
    <d:href>${cal.url}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>${cal.name}</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        <c:calendar-color>#00677FFF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`
}

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

const OPEN_ICS = vtodo('open-1', 'Prepare the deck', ['DUE;VALUE=DATE:20260610'])
const DONE_ICS = vtodo('done-1', 'Send the invoice', [
  'DUE;VALUE=DATE:20260611',
  'STATUS:COMPLETED',
  'PERCENT-COMPLETE:100'
])

function reportXml(): string {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
${[
  { uid: 'open-1', etag: '"e1"', data: OPEN_ICS },
  { uid: 'done-1', etag: '"e2"', data: DONE_ICS }
]
  .map(
    (row) => `  <d:response>
    <d:href>${CAL_TASKS}${row.uid}.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>${row.etag}</d:getetag><c:calendar-data>${row.data}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
  )
  .join('\n')}
</d:multistatus>`
}

const emptyReportXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"></d:multistatus>`

function stubFetch(): Array<{ method: string; url: string; body: string }> {
  const calls: Array<{ method: string; url: string; body: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any = {}) => {
      const method = String(init.method || 'GET')
      const body = String(init.body ?? '')
      calls.push({ method, url: String(url), body })
      const respond = (status: number, text = '', headers: Record<string, string> = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        headers: new Headers(headers)
      })
      if (method === 'PROPFIND') {
        if (body.includes('current-user-principal')) return respond(207, principalXml)
        return respond(207, calendarsXml())
      }
      // The work calendar holds no tasks — only `/tasks/` has fixtures, otherwise
      // every calendar's REPORT would report the same two tasks.
      if (method === 'REPORT') {
        return respond(207, String(url).startsWith(CAL_WORK) ? emptyReportXml : reportXml())
      }
      if (method === 'PUT') return respond(201, '', { ETag: '"new"' })
      return respond(404)
    })
  )
  return calls
}

let wrapper: VueWrapper | null = null

async function mountTasks(): Promise<VueWrapper> {
  wrapper = mount(TasksView, {
    global: {
      stubs: {
        PageHeaderActions: true,
        'oc-icon': true,
        'oc-button': true,
        'oc-spinner': true,
        'oc-text-input': true,
        'oc-textarea': true,
        teleport: true
      }
    }
  })
  await vi.waitFor(() => expect(wrapper!.findAll('.task-row').length).toBeGreaterThan(0), {
    timeout: 10_000
  })
  return wrapper
}

beforeEach(() => {
  setMockSettingsDocument(settingsState, {})
  settingsState.locked = []
  settingsState.admin = {}
  settingsState.calls = []
  settingsState.loaded = true
  settingsState.error = null
  routeState.query = {}
  routeState.path = '/planner/tasks'
  probe.outcome.value = 'ok'
  refreshReminders.mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('Tasks view honours the tasks settings', () => {
  it('quick-add task uses tasks.defaultCalendar', async () => {
    setMockSettingsDocument(settingsState, { tasks: { defaultCalendar: CAL_WORK } })
    const calls = stubFetch()
    const view = await mountTasks()

    await view.find('#quick-add-input').setValue('Write the report')
    await view.find('form.quick-add').trigger('submit')

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const put = calls.find((call) => call.method === 'PUT')!
    expect(put.url.startsWith(CAL_WORK)).toBe(true)
  })

  it('showCompleted opens the All filter so completed tasks are visible', async () => {
    setMockSettingsDocument(settingsState, { tasks: { showCompleted: true } })
    stubFetch()
    const view = await mountTasks()

    await vi.waitFor(() => expect(view.findAll('.task-row').length).toBe(2), { timeout: 10_000 })
    const all = view.findAll('.filter-chip').find((chip) => chip.text() === 'All')
    expect(all?.attributes('aria-pressed')).toBe('true')
  })

  it('hides completed tasks by default', async () => {
    stubFetch()
    const view = await mountTasks()

    expect(view.findAll('.task-row')).toHaveLength(1)
  })
})

describe('Tasks ?open deep link', () => {
  it('opens the task edit dialog for the linked task', async () => {
    const calls = stubFetch()
    routeState.query = { open: `${CAL_TASKS}open-1.ics` }

    const view = await mountTasks()

    await vi.waitFor(() => expect(view.find('[role="dialog"]').exists()).toBe(true), {
      timeout: 10_000
    })
    const dialog = view.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(view.find('#task-dialog-title').text()).toBe('Edit task')
    // No write happens just from opening.
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('ignores a link that matches no task', async () => {
    stubFetch()
    routeState.query = { open: `${CAL_TASKS}gone.ics` }

    const view = await mountTasks()

    expect(view.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('Tasks connection gate and reminder refresh', () => {
  it('wraps the view in ConnectionGate', async () => {
    stubFetch()
    const view = await mountTasks()
    expect(view.find('.quick-add').exists()).toBe(true)

    probe.outcome.value = 'unavailable'
    await vi.waitFor(() => expect(view.text()).toContain('The calendar server is not reachable'), {
      timeout: 10_000
    })
    expect(view.find('.quick-add').exists()).toBe(false)
  })

  it('refreshes reminders after completing a task', async () => {
    const calls = stubFetch()
    const view = await mountTasks()

    await view.findAll('.task-checkbox')[0].trigger('change')

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    await vi.waitFor(() => expect(refreshReminders).toHaveBeenCalled(), { timeout: 10_000 })
  })
})
