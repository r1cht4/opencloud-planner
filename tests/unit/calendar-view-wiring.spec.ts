// @vitest-environment happy-dom
/**
 * The view wiring: `views/Calendar.vue` takes its grid configuration and its
 * new-event defaults from the synced settings, handles the `?open=<href>` deep
 * link (reminder clicks) and is wrapped in `ConnectionGate`.
 *
 * @event-calendar is replaced by a recording fake: the assertions are about the
 * options the view *chose*, not about the library rendering a grid.
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

const probe = vi.hoisted(() => ({
  outcome: null as unknown as { value: string }
}))

const refreshReminders = vi.hoisted(() => vi.fn())

/** Options every `createCalendar` call received, plus the `setOption` calls. */
const ec = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  setOptions: [] as Array<[string, unknown]>,
  destroyed: 0
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
  getLocaleFromLanguage: () => 'de'
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
  <d:response>
    <d:href>${CAL_WORK}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Work</d:displayname>
        <c:calendar-color>#FF0000FF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
}

const MEETING_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:meeting-1',
  'DTSTAMP:20260601T080000Z',
  'DTSTART;VALUE=DATE:20260607',
  'DTEND;VALUE=DATE:20260608',
  'SUMMARY:Board meeting',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const reportXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${CAL_PERSONAL}meeting-1.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"e1"</d:getetag><c:calendar-data>${MEETING_ICS}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

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
    defaults: { type: Object, default: null },
    calendars: { type: Array, default: (): unknown[] => [] }
  },
  emits: ['save', 'close', 'delete'],
  setup(props) {
    return () =>
      h('div', {
        class: 'event-dialog-stub',
        'data-open': String(props.open),
        'data-title': (props.event as { title?: string } | null)?.title ?? '',
        'data-defaults': JSON.stringify(props.defaults ?? {})
      })
  }
})

let wrapper: VueWrapper | null = null

async function mountCalendar(): Promise<VueWrapper> {
  wrapper = mount(CalendarView, {
    global: {
      stubs: {
        EventDialog: EventDialogStub,
        EventSearch: true,
        MoveConfirmDialog: true,
        RecurrenceScopeDialog: true,
        StackPopover: true,
        PageHeaderActions: true,
        'oc-icon': true,
        'oc-button': true,
        'oc-spinner': true
      }
    },
    attachTo: document.body
  })
  // The load is PROPFIND → PROPFIND → REPORT → ical.js import.
  await vi.waitFor(() => expect(ec.created.length).toBeGreaterThan(0), { timeout: 10_000 })
  return wrapper
}

function createdOptions(): Record<string, unknown> {
  return ec.created[ec.created.length - 1]
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
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Calendar view honours the calendar settings', () => {
  it('defaultView month mounts month view', async () => {
    setMockSettingsDocument(settingsState, { calendar: { defaultView: 'month' } })
    stubFetch()
    await mountCalendar()

    expect(createdOptions().view).toBe('dayGridMonth')
  })

  it("dayStart 08:00 → scrollTime 08:00:00 and weekStart 'locale' keeps the app's rule", async () => {
    setMockSettingsDocument(settingsState, {
      general: { formatRegion: 'DE' },
      calendar: { dayStart: '08:00', weekStart: 'locale' }
    })
    stubFetch()
    await mountCalendar()

    expect(createdOptions().scrollTime).toBe('08:00:00')
    // English UI + German format region (en-DE) → Monday: the week start follows the region.
    expect(createdOptions().firstDay).toBe(1)
    // …and the grid formats with en-DE (English names, 24 h), not the bare UI language.
    expect(createdOptions().locale).toBe('en-DE')
  })

  it('weekNumbers false → option false and showWeekends false → hiddenDays [0,6]', async () => {
    setMockSettingsDocument(settingsState, {
      calendar: { weekNumbers: false, showWeekends: false }
    })
    stubFetch()
    await mountCalendar()

    expect(createdOptions().weekNumbers).toBe(false)
    expect(createdOptions().hiddenDays).toEqual([0, 6])
  })

  it('applies a settings change live through setOption (no re-mount)', async () => {
    stubFetch()
    await mountCalendar()
    const mounted = ec.created.length

    // Change the setting after mount: the view pushes it into the running grid.
    setMockSettingsDocument(settingsState, {
      calendar: { defaultView: 'month', showWeekends: false }
    })
    await vi.waitFor(() => expect(ec.setOptions.length).toBeGreaterThan(0), { timeout: 10_000 })

    expect(ec.setOptions).toContainEqual(['view', 'dayGridMonth'])
    expect(ec.setOptions).toContainEqual(['hiddenDays', [0, 6]])
    expect(ec.created).toHaveLength(mounted)
  })

  it('new events get defaultDuration, defaultReminders and defaultCalendar', async () => {
    setMockSettingsDocument(settingsState, {
      calendar: { defaultDuration: 30, defaultReminders: [15], defaultCalendar: CAL_WORK }
    })
    stubFetch()
    const view = await mountCalendar()

    const defaults = view.findComponent(EventDialogStub).props('defaults') as {
      durationMinutes?: number
      reminders?: number[]
      calendarUrl?: string
    }
    expect(defaults.durationMinutes).toBe(30)
    expect(defaults.reminders).toEqual([15])
    // The configured default calendar exists, so it is preselected.
    expect(defaults.calendarUrl).toBe(CAL_WORK)
  })
})

describe('Calendar touch support', () => {
  /** `window.matchMedia` stub: `(pointer: coarse)` as asked, nothing else. */
  function stubPointer(coarse: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: coarse && query.includes('pointer: coarse'),
          media: query,
          onchange: null,
          addEventListener: (): void => undefined,
          removeEventListener: (): void => undefined,
          addListener: (): void => undefined,
          removeListener: (): void => undefined,
          dispatchEvent: (): boolean => false
        }) as unknown as MediaQueryList
    )
  }

  function stubVibrate(): ReturnType<typeof vi.fn> {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true
    })
    return vibrate
  }

  const originalVibrate = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate')

  afterEach(() => {
    if (originalVibrate) Object.defineProperty(Navigator.prototype, 'vibrate', originalVibrate)
    else delete (Navigator.prototype as { vibrate?: unknown }).vibrate
  })

  it('creates the grid with a 350 ms long press and the mouse options untouched', async () => {
    stubFetch()
    await mountCalendar()

    const options = createdOptions()
    expect(options.longPressDelay).toBe(350)
    // Touch is allowed to move events/resize/select at all (unchanged), and the
    // per-action delays stay unset so `longPressDelay` covers all three.
    expect(options.editable).toBe(true)
    expect(options.selectable).toBe(true)
    expect(options.eventLongPressDelay).toBeUndefined()
    expect(options.selectLongPressDelay).toBeUndefined()
    // Mouse-only thresholds keep their library defaults (5 px, immediate drag).
    expect(options.eventDragMinDistance).toBeUndefined()
    expect(options.selectMinDistance).toBeUndefined()
  })

  it('vibrates when a drag starts on a touch screen only', async () => {
    stubFetch()
    await mountCalendar()
    const options = createdOptions()

    const vibrate = stubVibrate()
    stubPointer(true)
    const start = options.eventDragStart as (info: { jsEvent: { pointerType: string } }) => void
    const resize = options.eventResizeStart as (info: { jsEvent: { pointerType: string } }) => void

    start({ jsEvent: { pointerType: 'touch' } })
    resize({ jsEvent: { pointerType: 'touch' } })
    expect(vibrate).toHaveBeenCalledTimes(2)
    expect(vibrate).toHaveBeenCalledWith(10)

    // A mouse drag on a touchscreen laptop must not buzz, and a fine pointer
    // (desktop) never reaches the vibrate call at all.
    vibrate.mockClear()
    start({ jsEvent: { pointerType: 'mouse' } })
    expect(vibrate).not.toHaveBeenCalled()

    stubPointer(false)
    start({ jsEvent: { pointerType: 'touch' } })
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('Calendar ?open deep link', () => {
  it('?open= opens the event and jumps to its date', async () => {
    stubFetch()
    routeState.query = { open: `${CAL_PERSONAL}meeting-1.ics` }

    const view = await mountCalendar()

    const dialog = view.findComponent(EventDialogStub)
    expect(dialog.attributes('data-open')).toBe('true')
    expect(dialog.attributes('data-title')).toBe('Board meeting')
    // Jumped to the event's day.
    expect(ec.setOptions).toContainEqual(['date', '2026-06-07'])
  })

  it('ignores an open href that matches nothing', async () => {
    stubFetch()
    routeState.query = { open: `${CAL_PERSONAL}unknown.ics` }

    const view = await mountCalendar()

    expect(view.findComponent(EventDialogStub).attributes('data-open')).toBe('false')
  })
})

describe('Calendar writing paths', () => {
  it('refreshes the reminder engine after a saved event', async () => {
    const calls = stubFetch()
    const view = await mountCalendar()

    // Create an event through the dialog's save event.
    const dialog = view.findComponent(EventDialogStub)
    dialog.vm.$emit('save', {
      title: 'New meeting',
      start: '2026-06-07 09:00',
      end: '2026-06-07 09:30',
      isAllDay: false,
      reminders: [],
      calendarUrl: CAL_PERSONAL
    })

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {
      timeout: 10_000
    })
    await vi.waitFor(() => expect(refreshReminders).toHaveBeenCalled(), { timeout: 10_000 })
  })
})

describe('Calendar connection gate', () => {
  it('wraps the view content in ConnectionGate', async () => {
    stubFetch()
    const view = await mountCalendar()

    // The gate renders its slot while the probe is ok — the toolbar is visible.
    expect(view.find('.toolbar').exists()).toBe(true)
  })

  it('shows the setup state instead of the calendar when the DAV backend is missing', async () => {
    probe.outcome.value = 'not-configured'
    stubFetch()
    wrapper = mount(CalendarView, {
      global: {
        stubs: {
          EventDialog: EventDialogStub,
          EventSearch: true,
          MoveConfirmDialog: true,
          RecurrenceScopeDialog: true,
          StackPopover: true,
          PageHeaderActions: true,
          'oc-icon': true,
          'oc-button': true,
          'oc-spinner': true
        }
      }
    })
    await vi.waitFor(() => expect(wrapper!.text()).toContain('is not set up yet'), {
      timeout: 10_000
    })
    expect(wrapper.find('.toolbar').exists()).toBe(false)
  })
})

describe('Calendar teardown', () => {
  it('destroys the grid on unmount', async () => {
    stubFetch()
    await mountCalendar()
    wrapper!.unmount()
    wrapper = null

    expect(ec.destroyed).toBe(1)
  })
})
