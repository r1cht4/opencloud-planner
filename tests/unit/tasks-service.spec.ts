// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import { resetDAVClient } from '../../src/composables/useDAVClient'
import {
  buildTaskQueryBody,
  buildTodoIcs,
  filterTasks,
  isTaskDone,
  sortTasks,
  parseVtodoToTask,
  patchTodoIcs,
  setTodoCompletedIcs,
  supportsTasks,
  useTasksService
} from '../../src/composables/useTasksService'
import type { Task } from '../../src/types'

afterEach(() => {
  vi.unstubAllGlobals()
  resetDAVClient()
})

// ── Fixtures authored the way other clients write them ──────────────────────

/** Thunderbird: X-MOZ-* bookkeeping, VALARM, zoned DUE/DTSTART, CATEGORIES. */
const THUNDERBIRD_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN',
  'VERSION:2.0',
  'BEGIN:VTODO',
  'CREATED:20260301T080000Z',
  'LAST-MODIFIED:20260302T080000Z',
  'DTSTAMP:20260302T080000Z',
  'UID:thunderbird-task-1@example.org',
  'SUMMARY:Write quarterly report',
  'DESCRIPTION:Numbers for Q1',
  'DUE;TZID=Europe/Berlin:20260315T170000',
  'DTSTART;TZID=Europe/Berlin:20260310T090000',
  'PRIORITY:1',
  'STATUS:IN-PROCESS',
  'PERCENT-COMPLETE:40',
  'CATEGORIES:Work,Admin',
  'X-MOZ-GENERATION:3',
  'X-MOZ-LASTACK:20260301T090000Z',
  'X-MOZ-SNOOZE-TIME:20260316T070000Z',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Write quarterly report',
  'END:VALARM',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

/** Apple Reminders: date-only DUE, X-APPLE-* props, no STATUS. */
const APPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//iOS 17.0//EN',
  'BEGIN:VTODO',
  'CREATED:20260110T090000Z',
  'DTSTAMP:20260110T090000Z',
  'LAST-MODIFIED:20260110T090000Z',
  'UID:apple-reminder-1',
  'SUMMARY:Buy milk',
  'DESCRIPTION:2 litres',
  'DUE;VALUE=DATE:20260112',
  'PRIORITY:5',
  'CATEGORIES:Errands',
  'X-APPLE-SORT-ORDER:731243118',
  'X-APPLE-DEFAULT-ALARM:TRUE',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

/** Minimal VTODO as the app itself writes it. */
const MINIMAL_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//OpenCloud//Planner//EN',
  'BEGIN:VTODO',
  'UID:minimal-1',
  'DTSTAMP:20260401T080000Z',
  'SUMMARY:Minimal task',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

/** Recurring master: no expansion, the master is shown as-is. */
const RECURRING_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VTODO',
  'UID:recurring-1',
  'DTSTAMP:20260401T080000Z',
  'SUMMARY:Water plants',
  'DUE;VALUE=DATE:20260401',
  'RRULE:FREQ=WEEKLY',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

function icsLines(ics: string): string[] {
  return ics.split(/\r\n|\n/)
}

function findLine(ics: string, prefix: string): string | undefined {
  return icsLines(ics).find((line) => line.startsWith(prefix))
}

const baseTask = {
  id: 'task-1',
  title: 'Write quarterly report',
  priority: 0,
  status: 'NEEDS-ACTION' as const,
  percentComplete: 0,
  calendarId: 'http://localhost:3000/caldav/user-1/tasks/'
}

describe('parseVtodoToTask', () => {
  it('reads a Thunderbird VTODO including X-MOZ props, priority and categories', async () => {
    const task = await parseVtodoToTask(
      THUNDERBIRD_ICS,
      'cal-tasks',
      'http://dav.test/cal/tb.ics',
      '"etag-tb"'
    )

    expect(task).not.toBeNull()
    expect(task!.id).toBe('thunderbird-task-1@example.org')
    expect(task!.title).toBe('Write quarterly report')
    expect(task!.description).toBe('Numbers for Q1')
    expect(task!.priority).toBe(1)
    expect(task!.status).toBe('IN-PROCESS')
    expect(task!.percentComplete).toBe(40)
    expect(task!.categories).toEqual(['Work', 'Admin'])
    expect(task!.completed).toBeUndefined()
    expect(task!.calendarId).toBe('cal-tasks')
    expect(task!.href).toBe('http://dav.test/cal/tb.ics')
    expect(task!.etag).toBe('"etag-tb"')
    // Round-trip fidelity: the untouched original is kept for patching.
    expect(task!.rawIcs).toBe(THUNDERBIRD_ICS)
  })

  it('resolves a zoned DUE to the same instant as its UTC equivalent', async () => {
    const zoned = await parseVtodoToTask(THUNDERBIRD_ICS, 'cal-tasks')
    const utcEquivalent = await parseVtodoToTask(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:x',
        'BEGIN:VTODO',
        'UID:thunderbird-task-1@example.org',
        'DUE:20260315T160000Z',
        'DTSTART:20260310T080000Z',
        'SUMMARY:Write quarterly report',
        'END:VTODO',
        'END:VCALENDAR'
      ].join('\r\n'),
      'cal-tasks'
    )

    // 17:00 Europe/Berlin in March (CET, UTC+1) == 16:00 UTC.
    expect(zoned!.due).toBe(utcEquivalent!.due)
    expect(zoned!.start).toBe(utcEquivalent!.start)
  })

  it('reads an Apple Reminders VTODO with a date-only DUE', async () => {
    const task = await parseVtodoToTask(APPLE_ICS, 'cal-reminders')

    expect(task!.due).toBe('2026-01-12')
    expect(task!.due!.includes(' ')).toBe(false)
    expect(task!.start).toBeUndefined()
    expect(task!.priority).toBe(5)
    expect(task!.percentComplete).toBe(0)
    // No STATUS and no COMPLETED stamp in the source.
    expect(task!.status).toBe('NEEDS-ACTION')
    expect(task!.categories).toEqual(['Errands'])
    expect(task!.completed).toBeUndefined()
  })

  it('applies RFC defaults to a minimal VTODO', async () => {
    const task = await parseVtodoToTask(MINIMAL_ICS, 'cal-tasks')

    expect(task).toMatchObject({
      id: 'minimal-1',
      title: 'Minimal task',
      priority: 0,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })
    expect(task!.due).toBeUndefined()
    expect(task!.description).toBeUndefined()
  })

  it('derives COMPLETED from a COMPLETED stamp when STATUS is absent', async () => {
    const task = await parseVtodoToTask(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:x',
        'BEGIN:VTODO',
        'UID:done-1',
        'SUMMARY:Done already',
        'COMPLETED:20260401T120000Z',
        'END:VTODO',
        'END:VCALENDAR'
      ].join('\r\n'),
      'cal-tasks'
    )

    expect(task!.status).toBe('COMPLETED')
    expect(task!.percentComplete).toBe(100)
    expect(task!.completed).toBeDefined()
  })

  it('returns the recurring master only, without expanding it', async () => {
    const task = await parseVtodoToTask(RECURRING_ICS, 'cal-tasks')

    expect(task!.title).toBe('Water plants')
    expect(task!.due).toBe('2026-04-01')
    expect(task!.rawIcs).toContain('RRULE:FREQ=WEEKLY')
  })

  it('returns null for a resource that holds no VTODO', async () => {
    const veventOnly = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:x',
      'BEGIN:VEVENT',
      'UID:e1',
      'DTSTART:20260401T100000Z',
      'SUMMARY:Meeting',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    expect(await parseVtodoToTask(veventOnly, 'cal-tasks')).toBeNull()
  })
})

describe('patchTodoIcs', () => {
  it('preserves X-MOZ props, VALARM and CREATED while updating managed fields', async () => {
    const patched = await patchTodoIcs(THUNDERBIRD_ICS, {
      ...baseTask,
      id: 'thunderbird-task-1@example.org',
      title: 'Write quarterly report (rev. 2)',
      description: 'Numbers for Q1 and Q2',
      due: '2026-03-20',
      priority: 1,
      status: 'IN-PROCESS',
      percentComplete: 40,
      categories: ['Work', 'Admin', 'Reports']
    })

    expect(findLine(patched, 'SUMMARY:')).toBe('SUMMARY:Write quarterly report (rev. 2)')
    expect(findLine(patched, 'DESCRIPTION:')).toBe('DESCRIPTION:Numbers for Q1 and Q2')
    expect(findLine(patched, 'DUE')).toBe('DUE;VALUE=DATE:20260320')
    expect(findLine(patched, 'PRIORITY:')).toBe('PRIORITY:1')
    expect(findLine(patched, 'STATUS:')).toBe('STATUS:IN-PROCESS')
    expect(findLine(patched, 'PERCENT-COMPLETE:')).toBe('PERCENT-COMPLETE:40')
    expect(findLine(patched, 'CATEGORIES:')).toBe('CATEGORIES:Work,Admin,Reports')

    // Unmodelled data survives verbatim.
    expect(patched).toContain('X-MOZ-GENERATION:3')
    expect(patched).toContain('X-MOZ-LASTACK:20260301T090000Z')
    expect(patched).toContain('X-MOZ-SNOOZE-TIME:20260316T070000Z')
    expect(patched).toContain('CREATED:20260301T080000Z')
    expect(patched).toContain('BEGIN:VALARM')
    expect(patched).toContain('TRIGGER:-PT15M')
    expect(patched).toContain('UID:thunderbird-task-1@example.org')
    // DTSTART is not editable in the UI, so the stored value is left alone.
    expect(findLine(patched, 'DTSTART')).toBe('DTSTART;TZID=Europe/Berlin:20260310T090000')
  })

  it('keeps the RRULE of a recurring task untouched', async () => {
    const patched = await patchTodoIcs(RECURRING_ICS, {
      ...baseTask,
      id: 'recurring-1',
      title: 'Water plants (renamed)',
      due: '2026-04-08'
    })

    expect(findLine(patched, 'SUMMARY:')).toBe('SUMMARY:Water plants (renamed)')
    expect(findLine(patched, 'DUE')).toBe('DUE;VALUE=DATE:20260408')
    expect(findLine(patched, 'RRULE:')).toBe('RRULE:FREQ=WEEKLY')
  })

  it('drops DUE and PRIORITY when they are cleared', async () => {
    const patched = await patchTodoIcs(APPLE_ICS, {
      ...baseTask,
      id: 'apple-reminder-1',
      title: 'Buy milk',
      due: undefined,
      priority: 0
    })

    expect(findLine(patched, 'DUE')).toBeUndefined()
    expect(findLine(patched, 'PRIORITY:')).toBeUndefined()
    expect(patched).toContain('X-APPLE-SORT-ORDER:731243118')
    expect(patched).toContain('X-APPLE-DEFAULT-ALARM:TRUE')
  })

  it('replaces a DURATION with the DUE it cannot coexist with', async () => {
    const withDuration = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:x',
      'BEGIN:VTODO',
      'UID:duration-1',
      'DTSTAMP:20260401T080000Z',
      'SUMMARY:Has a duration',
      'DTSTART:20260410T090000Z',
      'DURATION:PT1H',
      'END:VTODO',
      'END:VCALENDAR'
    ].join('\r\n')

    const patched = await patchTodoIcs(withDuration, {
      ...baseTask,
      id: 'duration-1',
      due: '2026-04-10'
    })

    expect(findLine(patched, 'DUE')).toBe('DUE;VALUE=DATE:20260410')
    expect(findLine(patched, 'DURATION')).toBeUndefined()
    // DTSTART of a task the UI does not edit is left untouched.
    expect(findLine(patched, 'DTSTART:')).toBe('DTSTART:20260410T090000Z')
  })

  it('writes a date-only DUE as VALUE=DATE with no TZID', async () => {
    const patched = await patchTodoIcs(MINIMAL_ICS, {
      ...baseTask,
      id: 'minimal-1',
      due: '2026-04-01'
    })

    expect(findLine(patched, 'DUE')).toBe('DUE;VALUE=DATE:20260401')
    expect(patched).not.toContain('BEGIN:VTIMEZONE')
  })

  describe('timed DUE', () => {
    // The writer tags wall-clock digits with the machine zone; pin the zone so
    // the assertion is host-independent.
    beforeEach(() => {
      vi.stubGlobal('Intl', {
        ...Intl,
        DateTimeFormat: function () {
          return { resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }) }
        }
      } as any)
    })

    it('serialises a timed DUE with TZID and keeps the wall clock digits', async () => {
      const patched = await patchTodoIcs(MINIMAL_ICS, {
        ...baseTask,
        id: 'minimal-1',
        due: '2026-04-01 09:30'
      })

      expect(findLine(patched, 'DUE')).toBe('DUE;TZID=Europe/Berlin:20260401T093000')
    })
  })

  it('embeds a VTIMEZONE for a timed DUE', async () => {
    const ics = await buildTodoIcs({ ...baseTask, due: '2026-04-01 09:30' })

    expect(findLine(ics, 'DUE')).toMatch(/^DUE;TZID=[^:]+:20260401T093000$/)
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
  })
})

describe('buildTodoIcs', () => {
  it('creates a minimal VTODO in a well-formed VCALENDAR', async () => {
    const ics = await buildTodoIcs({ ...baseTask, id: 'new-task-1', title: 'Call the dentist' })

    expect(ics).toContain('BEGIN:VTODO')
    expect(findLine(ics, 'UID:')).toBe('UID:new-task-1')
    expect(findLine(ics, 'SUMMARY:')).toBe('SUMMARY:Call the dentist')
    expect(findLine(ics, 'STATUS:')).toBe('STATUS:NEEDS-ACTION')
    expect(findLine(ics, 'PERCENT-COMPLETE:')).toBe('PERCENT-COMPLETE:0')
    expect(findLine(ics, 'DTSTAMP:')).toBeDefined()
    // PRIORITY:0 must not be written — 0 means "undefined priority".
    expect(findLine(ics, 'PRIORITY:')).toBeUndefined()
    expect(ics).not.toContain('DUE')
  })

  it('writes priority and multi-valued CATEGORIES', async () => {
    const ics = await buildTodoIcs({
      ...baseTask,
      id: 'new-task-2',
      priority: 1,
      categories: ['Work', 'Admin']
    })

    expect(findLine(ics, 'PRIORITY:')).toBe('PRIORITY:1')
    expect(findLine(ics, 'CATEGORIES:')).toBe('CATEGORIES:Work,Admin')
  })

  it('writes a date-only DUE without TZID', async () => {
    const ics = await buildTodoIcs({ ...baseTask, id: 'new-task-3', due: '2026-05-04' })

    expect(findLine(ics, 'DUE')).toBe('DUE;VALUE=DATE:20260504')
    expect(ics).not.toContain('BEGIN:VTIMEZONE')
  })
})

describe('setTodoCompletedIcs', () => {
  const now = new Date('2026-04-02T10:00:00Z')

  it('marks the task completed and preserves foreign properties', async () => {
    const out = await setTodoCompletedIcs(THUNDERBIRD_ICS, true, now)

    expect(findLine(out, 'STATUS:')).toBe('STATUS:COMPLETED')
    expect(findLine(out, 'COMPLETED:')).toBe('COMPLETED:20260402T100000Z')
    expect(findLine(out, 'PERCENT-COMPLETE:')).toBe('PERCENT-COMPLETE:100')
    expect(out).toContain('X-MOZ-GENERATION:3')
    expect(out).toContain('BEGIN:VALARM')
    expect(findLine(out, 'DUE;TZID=Europe/Berlin:20260315T170000')).toBeDefined()
    expect(findLine(out, 'SUMMARY:')).toBe('SUMMARY:Write quarterly report')
  })

  it('reopening restores NEEDS-ACTION, removes COMPLETED and resets the percentage', async () => {
    const completed = await setTodoCompletedIcs(THUNDERBIRD_ICS, true, now)
    const reopened = await setTodoCompletedIcs(completed, false, now)

    expect(findLine(reopened, 'STATUS:')).toBe('STATUS:NEEDS-ACTION')
    expect(findLine(reopened, 'COMPLETED:')).toBeUndefined()
    expect(findLine(reopened, 'PERCENT-COMPLETE:')).toBe('PERCENT-COMPLETE:0')
    expect(reopened).toContain('X-MOZ-LASTACK:20260301T090000Z')
  })

  it('completes a minimal VTODO that has no STATUS or PERCENT-COMPLETE yet', async () => {
    const out = await setTodoCompletedIcs(MINIMAL_ICS, true, now)

    expect(findLine(out, 'STATUS:')).toBe('STATUS:COMPLETED')
    expect(findLine(out, 'COMPLETED:')).toBe('COMPLETED:20260402T100000Z')
    expect(findLine(out, 'PERCENT-COMPLETE:')).toBe('PERCENT-COMPLETE:100')
  })
})

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: 'Task',
    priority: 0,
    status: 'NEEDS-ACTION',
    percentComplete: 0,
    calendarId: 'cal',
    ...overrides
  }
}

describe('filterTasks / sortTasks', () => {
  const open = task({ id: 'open', title: 'Open task', due: '2026-05-02' })
  const openNoDue = task({ id: 'no-due', title: 'Someday' })
  const completed = task({ id: 'done', title: 'Done', status: 'COMPLETED', due: '2026-05-01' })
  const cancelled = task({ id: 'cancelled', title: 'Cancelled', status: 'CANCELLED' })
  const all = [open, openNoDue, completed, cancelled]

  it('treats COMPLETED and CANCELLED as done', () => {
    expect(isTaskDone(open)).toBe(false)
    expect(isTaskDone(completed)).toBe(true)
    expect(isTaskDone(cancelled)).toBe(true)
  })

  it('filters open, completed and all', () => {
    expect(filterTasks(all, 'open').map((t) => t.id)).toEqual(['open', 'no-due'])
    expect(filterTasks(all, 'completed').map((t) => t.id)).toEqual(['done', 'cancelled'])
    expect(filterTasks(all, 'all').map((t) => t.id)).toEqual([
      'open',
      'no-due',
      'done',
      'cancelled'
    ])
  })

  it('sorts by due date with undated tasks last, then by priority', () => {
    const sorted = sortTasks([
      task({ id: 'none-priority', due: '2026-05-03', priority: 0 }),
      task({ id: 'later', due: '2026-05-04', priority: 1 }),
      task({ id: 'high', due: '2026-05-03', priority: 1 }),
      task({ id: 'low', due: '2026-05-03', priority: 9 }),
      task({ id: 'undated', priority: 1 }),
      task({ id: 'earliest', due: '2026-05-01', priority: 5 })
    ])

    expect(sorted.map((t) => t.id)).toEqual([
      'earliest',
      'high',
      'low',
      'none-priority',
      'later',
      'undated'
    ])
  })

  it('does not mutate its input', () => {
    const input = [task({ id: 'b', due: '2026-05-02' }), task({ id: 'a', due: '2026-05-01' })]
    sortTasks(input)
    filterTasks(input, 'open')
    expect(input.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('supportsTasks', () => {
  function responseFor(propXml: string): Element {
    const doc = new DOMParser().parseFromString(
      `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/caldav/user-1/cal/</d:href>
          <d:propstat><d:prop>${propXml}</d:prop></d:propstat>
        </d:response>
      </d:multistatus>`,
      'application/xml'
    )
    return doc.getElementsByTagName('*')[0]
  }

  it('accepts a calendar that lists VTODO in its component set', () => {
    const el = responseFor(
      '<c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set>'
    )
    expect(supportsTasks(el)).toBe(true)
  })

  it('rejects a calendar that only advertises VEVENT', () => {
    const el = responseFor(
      '<c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VJOURNAL"/></c:supported-calendar-component-set>'
    )
    expect(supportsTasks(el)).toBe(false)
  })

  it('accepts an absent component set (server default)', () => {
    expect(supportsTasks(responseFor('<d:displayname>Calendar</d:displayname>'))).toBe(true)
  })

  it('accepts an empty component set element', () => {
    expect(supportsTasks(responseFor('<c:supported-calendar-component-set/>'))).toBe(true)
  })
})

describe('buildTaskQueryBody', () => {
  it('filters on VTODO inside VCALENDAR', () => {
    const body = buildTaskQueryBody()

    expect(body).toContain('<c:comp-filter name="VCALENDAR">')
    expect(body).toContain('<c:comp-filter name="VTODO"/>')
    expect(body).not.toContain('VEVENT')
    expect(body).toContain('<d:getetag/>')
    expect(body).toContain('<c:calendar-data/>')
  })
})

// ── Service CRUD against a stubbed Radicale ─────────────────────────────────

const ORIGIN = 'http://localhost:3000'
const CAL_TASKS = `${ORIGIN}/caldav/user-1/tasks/`
const CAL_EVENTS = `${ORIGIN}/caldav/user-1/events/`
const CAL_APPLE = `${ORIGIN}/caldav/user-1/reminders/`

const principalXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/caldav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/caldav/user-1/</d:href></d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const calendarsXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:x="http://apple.com/ns/ical/">
  <d:response>
    <d:href>${CAL_TASKS}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Tasks</d:displayname>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
          <c:comp name="VTODO"/>
        </c:supported-calendar-component-set>
        <c:calendar-color>#FF0000FF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>${CAL_EVENTS}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Events only</d:displayname>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
        </c:supported-calendar-component-set>
        <c:calendar-color>#0000FFFF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>${CAL_APPLE}</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-color/>
      </d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Reminders</d:displayname>
        <x:calendar-color>#00FF00FF</x:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

function reportXml(calendarUrl: string): string {
  const resources =
    calendarUrl === CAL_TASKS
      ? [
          {
            href: `${CAL_TASKS}thunderbird-task-1%40example.org.ics`,
            etag: '"etag-tb"',
            data: THUNDERBIRD_ICS
          },
          { href: `${CAL_TASKS}recurring-1.ics`, etag: '"etag-rec"', data: RECURRING_ICS }
        ]
      : [{ href: `${CAL_APPLE}apple-reminder-1.ics`, etag: '"etag-apple"', data: APPLE_ICS }]

  const responses = resources
    .map(
      (r) => `  <d:response>
    <d:href>${r.href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${r.etag}</d:getetag>
        <c:calendar-data>${r.data}</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`
    )
    .join('\n')

  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
${responses}
</d:multistatus>`
}

interface FetchStubOptions {
  putStatus?: number
  deleteStatus?: number
  putEtag?: string
}

/**
 * Mutable fake-server state: tests can add collections to the discovery
 * (lists created later) or fail single collections / gate the first REPORT
 * (concurrent operations).
 */
function stubFetch(options: FetchStubOptions = {}) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = []
  const stub = {
    /** Swapped by a test to change what the next discovery returns. */
    calendarsXmlText: calendarsXml,
    /** Calendars whose VTODO REPORT answers 500. */
    reportFailUrls: new Set<string>(),
    /** Optional gate every VTODO REPORT waits for. */
    reportGate: null as null | (() => Promise<void>)
  }

  const fetchMock = vi.fn(async (url: any, init: any = {}) => {
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
      return respond(
        207,
        body.includes('current-user-principal') ? principalXml : stub.calendarsXmlText
      )
    }
    if (method === 'REPORT') {
      if (stub.reportGate) await stub.reportGate()
      if (stub.reportFailUrls.has(String(url))) return respond(500)
      return respond(207, reportXml(String(url)))
    }
    if (method === 'PUT') {
      return respond(options.putStatus ?? 201, '', { ETag: options.putEtag ?? '"etag-new"' })
    }
    if (method === 'DELETE') return respond(options.deleteStatus ?? 204)
    return respond(404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls, stub }
}

async function loadedService() {
  const service = useTasksService()
  await service.fetchCalendars()
  await service.fetchTasks()
  return service
}

describe('useTasksService discovery', () => {
  it('requests the component set and keeps only task-capable calendars', async () => {
    stubFetch()
    const service = useTasksService()
    const found = await service.fetchCalendars()

    expect(found.map((c) => c.displayName)).toEqual(['Tasks', 'Reminders'])
    expect(found[0].url).toBe(CAL_TASKS)
    expect(found[0].color).toBe('#FF0000FF')
    // Colour from the Apple namespace wins over the empty CalDAV 404 propstat.
    expect(found[1].color).toBe('#00FF00FF')
  })
})

describe('useTasksService fetch', () => {
  it('runs a VTODO REPORT per task calendar and parses the results', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()

    const reports = calls.filter((c) => c.method === 'REPORT')
    expect(reports.map((r) => r.url)).toEqual([CAL_TASKS, CAL_APPLE])
    expect(reports[0].body).toContain('<c:comp-filter name="VTODO"/>')
    expect(reports[0].headers.get('Depth')).toBe('1')

    expect(service.tasks.value).toHaveLength(3)
    const titles = service.tasks.value.map((t) => t.title)
    expect(titles).toEqual(['Write quarterly report', 'Water plants', 'Buy milk'])
    expect(service.tasks.value.filter((t) => t.calendarId === CAL_APPLE)).toHaveLength(1)
  })

  it('a task list created after the app loaded is picked up by fetchTasks', async () => {
    const { calls, stub } = stubFetch()
    const service = await loadedService()
    expect(service.calendars.value.map((c) => c.url)).not.toContain(
      `${ORIGIN}/caldav/user-1/later/`
    )

    // Insert the new list before the closing tag — discovery returns valid XML.
    stub.calendarsXmlText = calendarsXml.replace(
      '</d:multistatus>',
      `  <d:response>
    <d:href>${ORIGIN}/caldav/user-1/later/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Made later</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
    )
    await service.fetchTasks()

    // The long-lived service (e.g. the reminder loop) sees the new list and its tasks.
    expect(service.calendars.value.map((c) => c.url)).toContain(`${ORIGIN}/caldav/user-1/later/`)
    expect(
      calls.some((c) => c.method === 'REPORT' && c.url === `${ORIGIN}/caldav/user-1/later/`)
    ).toBe(true)
  })

  it('one failing collection does not abort the fetch of the others', async () => {
    const { stub } = stubFetch()
    stub.reportFailUrls.add(CAL_APPLE)

    const service = useTasksService()
    const tasks = await service.fetchTasks()

    // A deleted/unavailable list must not leave the user without task reminders.
    expect(tasks.some((t) => t.id === 'thunderbird-task-1@example.org')).toBe(true)
    expect(service.error.value).toMatch(/Reminders/)
  })
})

describe('useTasksService transient list failures', () => {
  it('keeps the tasks a list showed before when its refresh fails', async () => {
    const { stub } = stubFetch()
    const service = await loadedService()
    expect(service.tasks.value.some((t) => t.id === 'apple-reminder-1')).toBe(true)

    stub.reportFailUrls.add(CAL_APPLE)
    await service.fetchTasks()

    expect(service.tasks.value.some((t) => t.id === 'apple-reminder-1')).toBe(true)
    expect(service.tasks.value.some((t) => t.id === 'thunderbird-task-1@example.org')).toBe(true)
  })
})

describe('useTasksService createTask', () => {
  it('PUTs a new VTODO with If-None-Match and stores the ETag', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()

    const created = await service.createTask(CAL_TASKS, {
      id: 'brand-new-1',
      title: 'Book flights',
      priority: 5,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })

    expect(created).not.toBeNull()
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(`${CAL_TASKS}brand-new-1.ics`)
    expect(put.headers.get('If-None-Match')).toBe('*')
    expect(put.body).toContain('SUMMARY:Book flights')
    expect(put.body).toContain('UID:brand-new-1')
    expect(put.body).toContain('PRIORITY:5')
    expect(created!.etag).toBe('"etag-new"')
    expect(service.tasks.value.some((t) => t.id === 'brand-new-1')).toBe(true)
  })

  it('reports a failure when the PUT is rejected', async () => {
    stubFetch({ putStatus: 507 })
    const service = await loadedService()

    const created = await service.createTask(CAL_TASKS, {
      id: 'brand-new-2',
      title: 'Never stored',
      priority: 0,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })

    expect(created).toBeNull()
    expect(service.error.value).toContain('PUT failed: 507')
  })
})

describe('useTasksService updateTask', () => {
  it('patches the stored resource with If-Match and keeps foreign properties', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()
    const task = service.tasks.value.find((t) => t.id === 'thunderbird-task-1@example.org')!

    const ok = await service.updateTask({ ...task, title: 'Write report (v2)', due: '2026-03-20' })

    expect(ok).toBe(true)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(task.href)
    expect(put.headers.get('If-Match')).toBe('"etag-tb"')
    expect(put.body).toContain('SUMMARY:Write report (v2)')
    expect(put.body).toContain('DUE;VALUE=DATE:20260320')
    expect(put.body).toContain('X-MOZ-GENERATION:3')
    expect(put.body).toContain('BEGIN:VALARM')

    const updated = service.tasks.value.find((t) => t.id === task.id)!
    expect(updated.title).toBe('Write report (v2)')
    expect(updated.etag).toBe('"etag-new"')
  })

  it('reports a conflict on 412 and leaves the stored task alone', async () => {
    stubFetch({ putStatus: 412 })
    const service = await loadedService()
    const task = service.tasks.value[0]

    const ok = await service.updateTask({ ...task, title: 'Stale write' })

    expect(ok).toBe(false)
    expect(service.error.value).toContain('modified elsewhere')
    expect(service.tasks.value.find((t) => t.id === task.id)!.title).toBe(task.title)
  })

  it('moves a task to another calendar with PUT then DELETE', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()
    const task = service.tasks.value.find((t) => t.id === 'apple-reminder-1')!

    // fetchTasks stores the Apple calendar URL already; move it to CAL_TASKS.
    const ok = await service.updateTask({
      ...task,
      calendarId: CAL_TASKS,
      href: `${CAL_APPLE}apple-reminder-1.ics`
    })

    expect(ok).toBe(true)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(`${CAL_TASKS}apple-reminder-1.ics`)
    expect(put.headers.get('If-None-Match')).toBe('*')
    expect(put.body).toContain('X-APPLE-SORT-ORDER:731243118')

    const del = calls.find((c) => c.method === 'DELETE')!
    expect(del.url).toBe(`${CAL_APPLE}apple-reminder-1.ics`)
    expect(del.headers.get('If-Match')).toBe('"etag-apple"')
  })

  it('a move whose DELETE hits 412 reports the leftover, not a generic error', async () => {
    stubFetch({ deleteStatus: 412 })
    const service = await loadedService()
    const task = service.tasks.value.find((t) => t.id === 'apple-reminder-1')!

    const ok = await service.updateTask({
      ...task,
      calendarId: CAL_TASKS,
      href: `${CAL_APPLE}apple-reminder-1.ics`
    })

    // The PUT succeeded: the task lives in the new list now.
    expect(ok).toBe(true)
    // The user learns the old entry could not be deleted because it changed
    // elsewhere — instead of a bare "DELETE failed: 412".
    expect(service.error.value).toMatch(/copied/i)
    expect(service.error.value).toMatch(/changed elsewhere|old entry/i)
  })

  it('loading is a counter — it stays true while any operation runs', async () => {
    const { stub } = stubFetch()
    let release: () => void = () => undefined
    stub.reportGate = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const service = useTasksService()
    const slow = service.fetchTasks()
    const quick = service.fetchCalendars()
    await quick
    await Promise.resolve()

    // One call finished, the other is still waiting on the REPORT gate: a plain
    // boolean would already report "done" here (the clobbering fixed earlier).
    expect(service.loading.value).toBe(true)

    // Drop the gate first: fetchTasks REPORTs per calendar and must not be
    // blocked a second time.
    stub.reportGate = null
    release()
    await slow
    expect(service.loading.value).toBe(false)
  })
})

describe('useTasksService setTaskCompleted', () => {
  it('completes a task with If-Match and refreshes the entry', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()
    const task = service.tasks.value.find((t) => t.id === 'apple-reminder-1')!

    expect(await service.setTaskCompleted(task, true)).toBe(true)

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(task.href)
    expect(put.headers.get('If-Match')).toBe('"etag-apple"')
    expect(put.body).toContain('STATUS:COMPLETED')
    expect(put.body).toContain('PERCENT-COMPLETE:100')
    expect(put.body).toMatch(/COMPLETED:\d{8}T\d{6}Z/)
    expect(put.body).toContain('X-APPLE-DEFAULT-ALARM:TRUE')

    const updated = service.tasks.value.find((t) => t.id === task.id)!
    expect(updated.status).toBe('COMPLETED')
    expect(updated.percentComplete).toBe(100)
  })

  it('reports a conflict on 412', async () => {
    stubFetch({ putStatus: 412 })
    const service = await loadedService()
    const task = service.tasks.value[0]

    expect(await service.setTaskCompleted(task, true)).toBe(false)
    expect(service.error.value).toContain('modified elsewhere')
  })
})

describe('useTasksService deleteTask', () => {
  it('DELETEs with If-Match and drops the task', async () => {
    const { calls } = stubFetch()
    const service = await loadedService()
    const task = service.tasks.value.find((t) => t.id === 'recurring-1')!

    expect(await service.deleteTask(task)).toBe(true)

    const del = calls.find((c) => c.method === 'DELETE')!
    expect(del.url).toBe(task.href)
    expect(del.headers.get('If-Match')).toBe('"etag-rec"')
    expect(service.tasks.value.some((t) => t.id === task.id)).toBe(false)
  })

  it('reports a conflict on 412 and keeps the task', async () => {
    stubFetch({ deleteStatus: 412 })
    const service = await loadedService()
    const task: Task = service.tasks.value[0]

    expect(await service.deleteTask(task)).toBe(false)
    expect(service.error.value).toContain('modified elsewhere')
    expect(service.tasks.value.some((t) => t.id === task.id)).toBe(true)
  })
})

describe('useTasksService writes during a running fetch', () => {
  it('a task created while fetchTasks is in flight stays in the list', async () => {
    const { stub } = stubFetch()
    const service = useTasksService()
    await service.fetchCalendars()

    // Hold the REPORTs: the fetch has started but its (older) result arrives later.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    stub.reportGate = () => gate
    const fetching = service.fetchTasks()

    const created = await service.createTask(CAL_TASKS, {
      id: 'quick-add-1',
      title: 'Added during load',
      priority: 0,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })
    expect(created).not.toBeNull()

    release()
    await fetching
    expect(service.tasks.value.map((t) => t.id)).toContain('quick-add-1')
  })

  it('a task deleted while fetchTasks is in flight does not come back', async () => {
    const { stub } = stubFetch()
    const service = await loadedService()
    const victim = service.tasks.value.find((t) => t.id === 'apple-reminder-1')!

    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    stub.reportGate = () => gate
    const fetching = service.fetchTasks()
    expect(await service.deleteTask(victim)).toBe(true)

    release()
    await fetching
    expect(service.tasks.value.map((t) => t.id)).not.toContain('apple-reminder-1')
  })
})
