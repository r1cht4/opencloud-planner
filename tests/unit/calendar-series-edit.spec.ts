// @vitest-environment happy-dom
/**
 * Regression tests — editing or dragging ONE occurrence of a recurring
 * series must not re-anchor the master.
 *
 *  - scope "series" (save or drag) shifts the master's DTSTART/DTEND by the
 *    occurrence's delta; a title-only edit leaves them at 2026-01-05
 *  - scope "single" writes a RECURRENCE-ID override and leaves the master
 *    untouched (drag path)
 *  - drag/resize asks the RecurrenceScopeDialog first
 *
 * The grid is the same recording fake as in `calendar-view-wiring.spec.ts`, so
 * the assertions are about the PUT bodies the view sends.
 */
import { setMockSettingsDocument } from './fixtures/settingsStoreMock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
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
  path: '/planner/calendar',
  query: {} as Record<string, unknown>,
  hash: ''
}))

const probe = vi.hoisted(() => ({ outcome: null as unknown as { value: string } }))
const refreshReminders = vi.hoisted(() => vi.fn())

const ec = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  setOptions: [] as Array<[string, unknown]>,
  destroyed: 0
}))

/** Occurrences captured through the (stubbed) EventSearch props. */
const searchCapture = vi.hoisted(() => ({
  events: [] as Array<{ id: string; recurringEventId?: string; start: string }>
}))

vi.mock('@event-calendar/core', () => {
  const fake = (): unknown => ({
    setOption: (name: string, value: unknown): number => ec.setOptions.push([name, value]),
    unselect: (): undefined => undefined
  })
  return {
    createCalendar: (_el: unknown, _plugins: unknown, options: Record<string, unknown>) => {
      ec.created.push(options)
      return fake()
    },
    destroyCalendar: () => {
      ec.destroyed++
    },
    TimeGrid: {},
    DayGrid: {},
    List: {},
    Interaction: {}
  }
})

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (text: string) => text, current: 'en' })
}))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useMessages: () => ({ showMessage: vi.fn(), showErrorMessage: vi.fn() }),
  useModals: () => ({ dispatchModal: vi.fn() }),
  useRoute: () => ({
    get value() {
      return routeState
    }
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useAbility: () => ({ can: () => false }),
  getLocaleFromLanguage: () => 'en'
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

import CalendarView from '../../src/views/Calendar.vue'

const ORIGIN = 'http://localhost:3000'
const CAL_PERSONAL = `${ORIGIN}/caldav/user-1/personal/`

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
    <d:href>${CAL_PERSONAL}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
        <c:calendar-color>#00677FFF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

// Weekly series from 2026-01-05 09:00 (floating = local wall clock); the loaded
// window is relative to the real "now", so the tests pick any expanded occurrence.
const SERIES_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:series-1',
  'DTSTAMP:20260101T080000Z',
  'DTSTART:20260105T090000',
  'DTEND:20260105T100000',
  'RRULE:FREQ=WEEKLY',
  'SUMMARY:Weekly sync',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const reportXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${CAL_PERSONAL}series-1.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"e1"</d:getetag><c:calendar-data>${SERIES_ICS}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

function stubFetch(): Array<{ method: string; url: string; body: string }> {
  const calls: Array<{ method: string; url: string; body: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: unknown = {}) => {
      const opts = init as { method?: string; body?: string }
      const method = String(opts.method || 'GET')
      const body = String(opts.body ?? '')
      calls.push({ method, url: String(url), body })
      const respond = (status: number, text = '', headers: Record<string, string> = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        headers: new Headers(headers)
      })
      if (method === 'PROPFIND') {
        if (body.includes('current-user-principal')) return respond(207, principalXml)
        return respond(207, calendarsXml)
      }
      if (method === 'REPORT') return respond(207, reportXml)
      if (method === 'PUT') return respond(201, '', { ETag: '"etag-new"' })
      if (method === 'DELETE') return respond(204)
      return respond(404)
    })
  )
  return calls
}

const EventDialogStub = defineComponent({
  name: 'EventDialog',
  props: {
    open: { type: Boolean, default: false },
    event: { type: Object, default: null },
    seed: { type: Object, default: null },
    calendars: { type: Array, default: (): unknown[] => [] },
    defaults: { type: Object, default: null }
  },
  emits: ['save', 'close', 'delete'],
  setup(props) {
    return () =>
      h('div', {
        class: 'event-dialog-stub',
        'data-open': String(props.open),
        'data-event-id': (props.event as { id?: string } | null)?.id ?? ''
      })
  }
})

/** Captures the searchable events (i.e. the expanded occurrences) via props. */
const EventSearchStub = defineComponent({
  name: 'EventSearch',
  props: { events: { type: Array, default: (): unknown[] => [] } },
  setup(props) {
    return () => {
      // assign in the render function so prop changes are captured
      searchCapture.events = props.events as Array<{
        id: string
        recurringEventId?: string
        start: string
      }>
      return h('div', { class: 'event-search-stub' })
    }
  }
})

/** oc-button passthrough that emits click (the dialogs use oc-button). */
const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: ['appearance', 'colorRole', 'disabled', 'submit'],
  emits: ['click'],
  template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`
})

let wrapper: VueWrapper | null = null

async function mountCalendar(): Promise<VueWrapper> {
  wrapper = mount(CalendarView, {
    global: {
      stubs: {
        EventDialog: EventDialogStub,
        EventSearch: EventSearchStub,
        MoveConfirmDialog: false,
        RecurrenceScopeDialog: false,
        StackPopover: true,
        PageHeaderActions: true,
        teleport: true,
        'oc-icon': true,
        'oc-button': OcButtonStub,
        'oc-spinner': true
      }
    },
    attachTo: document.body
  })
  await vi.waitFor(() => expect(ec.created.length).toBeGreaterThan(0), { timeout: 10_000 })
  return wrapper
}

/** Any expanded occurrence of the series (the loaded window is "now"-relative). */
function occurrence() {
  const occ = searchCapture.events.find((e) => e.recurringEventId === 'series-1')
  expect(occ, 'an expanded occurrence of the series').toBeTruthy()
  return occ!
}

/** `occ.start` shifted by `hours` (wall clock), as the model string. */
function shifted(start: string, hours: number): string {
  const d = new Date(start.replace(' ', 'T'))
  d.setHours(d.getHours() + hours)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function gridOptions(): Record<string, unknown> {
  return ec.created[ec.created.length - 1]
}

async function clickGridEvent(occId: string): Promise<void> {
  const handler = gridOptions().eventClick as (info: unknown) => void
  handler({ event: { id: occId }, el: document.createElement('div') })
  await vi.waitFor(
    () => expect(wrapper!.findComponent(EventDialogStub).attributes('data-open')).toBe('true'),
    { timeout: 10_000 }
  )
}

async function chooseScope(buttonText: string): Promise<void> {
  await vi.waitFor(() => expect(wrapper!.text()).toContain('recurring event'), { timeout: 10_000 })
  const button = wrapper!.findAll('button').find((b) => b.text() === buttonText)
  expect(button, `scope button "${buttonText}"`).toBeTruthy()
  await button!.trigger('click')
}

async function confirmMove(): Promise<void> {
  await vi.waitFor(() => expect(wrapper!.text()).toContain('Move event'), { timeout: 10_000 })
  const button = wrapper!.findAll('button').find((b) => b.text() === 'Move')
  expect(button, 'move confirm button').toBeTruthy()
  await button!.trigger('click')
}

function lastPutBody(calls: Array<{ method: string; body: string }>): string {
  const put = calls.filter((c) => c.method === 'PUT').pop()
  expect(put, 'a PUT happened').toBeTruthy()
  return put!.body
}

beforeEach(() => {
  setMockSettingsDocument(settingsState, {})
  settingsState.locked = []
  settingsState.admin = {}
  settingsState.calls = []
  settingsState.loaded = true
  settingsState.error = null
  routeState.query = {}
  routeState.path = '/planner/calendar'
  probe.outcome.value = 'ok'
  ec.created = []
  ec.setOptions = []
  ec.destroyed = 0
  refreshReminders.mockClear()
  searchCapture.events = []
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('saving an occurrence with scope "entire series"', () => {
  it('title-only edit keeps the master DTSTART at 2026-01-05 09:00', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await clickGridEvent(occ.id)
    const dialog = wrapper!.findComponent(EventDialogStub)
    dialog.vm.$emit('save', {
      title: 'Weekly sync (renamed)',
      start: occ.start,
      end: shifted(occ.start, 1),
      isAllDay: false,
      rrule: 'FREQ=WEEKLY',
      reminders: [],
      calendarUrl: CAL_PERSONAL
    })
    await chooseScope('Entire series')

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const body = lastPutBody(calls)
    // Master NOT re-anchored: DTSTART still 2026-01-05 09:00.
    expect(body).toMatch(/DTSTART[^:]*:20260105T090000/)
    expect(body).not.toMatch(new RegExp(`DTSTART[^:]*:${occ.start.slice(0, 10).replace(/-/g, '')}`))
    expect(body).toContain('SUMMARY:Weekly sync (renamed)')
    // No override was written for a series-wide save.
    expect(body).not.toContain('RECURRENCE-ID')
  })

  it('moving the occurrence +1h with scope "series" shifts the master +1h', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await clickGridEvent(occ.id)
    wrapper!.findComponent(EventDialogStub).vm.$emit('save', {
      title: 'Weekly sync',
      start: shifted(occ.start, 1),
      end: shifted(occ.start, 2),
      isAllDay: false,
      rrule: 'FREQ=WEEKLY',
      reminders: [],
      calendarUrl: CAL_PERSONAL
    })
    await chooseScope('Entire series')

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const body = lastPutBody(calls)
    expect(body).toMatch(/DTSTART[^:]*:20260105T100000/)
    expect(body).toMatch(/DTEND[^:]*:20260105T110000/)
    expect(body).not.toMatch(new RegExp(`DTSTART[^:]*:${occ.start.slice(0, 10).replace(/-/g, '')}`))
  })

  it('scope "single" writes a RECURRENCE-ID override and keeps the master', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await clickGridEvent(occ.id)
    wrapper!.findComponent(EventDialogStub).vm.$emit('save', {
      title: 'Weekly sync',
      start: shifted(occ.start, 1),
      end: shifted(occ.start, 2),
      isAllDay: false,
      rrule: 'FREQ=WEEKLY',
      reminders: [],
      calendarUrl: CAL_PERSONAL
    })
    await chooseScope('Only this event')

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const body = lastPutBody(calls)
    expect(body).toContain('RECURRENCE-ID')
    // The override carries the moved occurrence time …
    expect(body).toMatch(new RegExp(`DTSTART[^:]*:${occ.start.slice(0, 10).replace(/-/g, '')}T10`))
    // … while the master keeps its original DTSTART (history preserved).
    expect(body).toMatch(/DTSTART[^:]*:20260105T090000/)
  })
})

describe('dragging an occurrence', () => {
  async function dragOccurrence(occId: string, occStart: string) {
    const handler = gridOptions().eventDrop as (info: unknown) => void
    handler({
      event: {
        id: occId,
        start: new Date(shifted(occStart, 1).replace(' ', 'T')),
        end: new Date(shifted(occStart, 2).replace(' ', 'T')),
        allDay: false
      },
      el: document.createElement('div'),
      revert: vi.fn()
    })
  }

  it('asks the scope question (mode "move") before the move confirmation', async () => {
    stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await dragOccurrence(occ.id, occ.start)

    await vi.waitFor(() => expect(wrapper!.text()).toContain('Move recurring event'), {
      timeout: 10_000
    })
    await chooseScope('Entire series')
    await vi.waitFor(() => expect(wrapper!.text()).toContain('Move event'), { timeout: 10_000 })
  })

  it('scope "series" on drag shifts the master by the drag delta', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await dragOccurrence(occ.id, occ.start)
    await chooseScope('Entire series')
    await confirmMove()

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const body = lastPutBody(calls)
    // Master moved +1h, NOT re-anchored at 2026-11-23.
    expect(body).toMatch(/DTSTART[^:]*:20260105T100000/)
    expect(body).not.toMatch(new RegExp(`DTSTART[^:]*:${occ.start.slice(0, 10).replace(/-/g, '')}`))
    expect(body).not.toContain('RECURRENCE-ID')
  })

  it('scope "single" on drag writes an override and keeps the master', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await dragOccurrence(occ.id, occ.start)
    await chooseScope('Only this event')
    await confirmMove()

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    const body = lastPutBody(calls)
    expect(body).toContain('RECURRENCE-ID')
    expect(body).toMatch(new RegExp(`DTSTART[^:]*:${occ.start.slice(0, 10).replace(/-/g, '')}T10`))
    expect(body).toMatch(/DTSTART[^:]*:20260105T090000/)
  })

  it('cancelling the scope question reverts the drag without a PUT', async () => {
    const calls = stubFetch()
    await mountCalendar()
    const occ = occurrence()

    await dragOccurrence(occ.id, occ.start)
    await vi.waitFor(() => expect(wrapper!.text()).toContain('Move recurring event'), {
      timeout: 10_000
    })
    const cancel = wrapper!.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')

    await vi.waitFor(() => expect(wrapper!.text()).not.toContain('Move recurring event'), {
      timeout: 10_000
    })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})
