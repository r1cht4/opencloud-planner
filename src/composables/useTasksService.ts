/**
 * useTasksService – CalDAV VTODO (task) operations using direct fetch.
 *
 * Tasks live in the same calendars as events (Radicale's default collection
 * advertises VEVENT, VJOURNAL and VTODO). Discovery therefore reuses the
 * calendar principal and only keeps collections whose
 * `supported-calendar-component-set` accepts VTODO (or omits the set entirely,
 * which means "server default", RFC 4791 §5.2.3).
 *
 * Editing patches the raw ICS instead of rebuilding it: X-MOZ-*, X-APPLE-*,
 * VALARMs, RRULE and every other property the UI does not model survive a save.
 */

import { computed, ref, type Ref } from 'vue'
import { useDAVClient, davFetch, davResourceName } from './useDAVClient'
import { davPropData, davPropText, parseMultistatus } from './davXml'
import { discoverCollections, supportsComponent } from './davCollections'
import { formatIfMatch } from './useCalendarService'
import { DEFAULT_CALENDAR_COLOR } from './colorUtils'
import {
  TASK_COMPONENT,
  buildTaskQueryBody,
  buildTodoIcs,
  parseVtodoToTask,
  patchTodoIcs,
  setTodoCompletedIcs
} from '../ics/vtodo'
import type { CalendarCollection, Task } from '../types'

export {
  buildTaskQueryBody,
  buildTodoIcs,
  filterTasks,
  isTaskDone,
  parseVtodoToTask,
  patchTodoIcs,
  setTodoCompletedIcs,
  sortTasks,
  supportsTasks
} from '../ics/vtodo'
export type { TaskFilter } from '../ics/vtodo'

async function taskQuery(calendarUrl: string): Promise<string> {
  const resp = await davFetch(calendarUrl, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body: buildTaskQueryBody()
  })
  if (!resp.ok && resp.status !== 207) {
    throw new Error(`REPORT calendar-query failed: ${resp.status}`)
  }
  return resp.text()
}

export function useTasksService() {
  const { ensureReady, getState } = useDAVClient()

  const calendars: Ref<CalendarCollection[]> = ref([])
  const tasks: Ref<Task[]> = ref([])
  const error: Ref<string | null> = ref(null)

  // Counter-backed `loading`: fetchTasks and fetchCalendars can
  // overlap (views and the reminder loop), so a plain boolean would report
  // "done" the moment the *first* call finished.
  const inFlight = ref(0)
  const loading = computed(() => inFlight.value > 0)

  /** Error policy (parallel-safe): see useCalendarService — `error` is cleared
   *  only when a fresh top-level operation starts, never by a sibling. */
  function beginOperation(): void {
    if (inFlight.value === 0) error.value = null
    inFlight.value++
  }

  function endOperation(): void {
    if (inFlight.value > 0) inFlight.value--
  }

  /** Calendars that accept VTODOs (see `supportsTasks`). */
  async function fetchCalendars(): Promise<CalendarCollection[]> {
    beginOperation()
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const state = getState('calendar')!
      const origin = new URL(state.baseUrl).origin

      // Shared discovery (`davCollections`); this service only keeps the
      // calendars that accept VTODOs and keeps its historical raw colour value.
      const found: CalendarCollection[] = []
      for (const collection of await discoverCollections('calendar', state.principalUrl, {
        origin
      })) {
        if (!supportsComponent(collection, TASK_COMPONENT)) continue
        found.push({
          url: collection.url,
          displayName: collection.displayName || 'Calendar',
          color: collection.colorRaw || DEFAULT_CALENDAR_COLOR,
          description: collection.description,
          ctag: collection.ctag
        })
      }

      calendars.value = found
      return found
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] task calendar discovery failed:', err)
      return []
    } finally {
      endOperation()
    }
  }

  /**
   * Fetch the VTODOs of every task-capable calendar.
   *
   * The calendar list is re-discovered on **every** call (a cheap
   * PROPFIND) — a long-lived service instance (the reminder loop) then sees
   * lists created later, and a deleted list no longer poisons every fetch.
   * A single failing collection is recorded in `error` and skipped; the
   * others still load.
   */
  /**
   * Local writes made while a fetch is in flight (id → task, null = deleted). The
   * fetch's REPORT may have run before the write reached the server, so its result
   * would drop a task the user just added (or resurrect a deleted one). They are
   * applied on top of the fetch result, then forgotten once no fetch is running.
   */
  let fetchesInFlight = 0
  const writesDuringFetch = new Map<string, Task | null>()

  function recordLocalWrite(id: string, task: Task | null): void {
    if (fetchesInFlight > 0) writesDuringFetch.set(id, task)
  }

  function applyLocalWrites(parsed: Task[]): Task[] {
    if (writesDuringFetch.size === 0) return parsed
    const result = parsed.filter((t) => !writesDuringFetch.has(t.id))
    for (const task of writesDuringFetch.values()) if (task) result.push(task)
    return result
  }

  async function fetchTasks(): Promise<Task[]> {
    beginOperation()
    fetchesInFlight++
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const state = getState('calendar')!
      const origin = new URL(state.baseUrl).origin
      await fetchCalendars()

      const parsed: Task[] = []
      for (const calendar of calendars.value) {
        try {
          const xml = await taskQuery(calendar.url)
          for (const resp of parseMultistatus(xml)) {
            if (resp.href.endsWith('/')) continue
            if (!resp.href.endsWith('.ics')) continue

            const objUrl = resp.href.startsWith('http') ? resp.href : `${origin}${resp.href}`
            const etag = davPropText(resp.el, 'getetag') || undefined
            const icsData = davPropData(resp.el, 'calendar-data')
            if (!icsData) continue

            const task = await parseVtodoToTask(icsData, calendar.url, objUrl, etag)
            if (task) parsed.push(task)
          }
        } catch (err) {
          // One unavailable/deleted collection must not abort the loop.
          error.value = `Could not load tasks from ${calendar.displayName || calendar.url}: ${
            err instanceof Error ? err.message : String(err)
          }`
          console.warn('[planner] fetchTasks: skipping calendar', calendar.url, err)
          // Keep what this list showed before: a transient failure must not blank it.
          parsed.push(...tasks.value.filter((t) => t.calendarId === calendar.url))
        }
      }

      tasks.value = applyLocalWrites(parsed)
      return tasks.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] fetchTasks error:', err)
      return []
    } finally {
      fetchesInFlight--
      if (fetchesInFlight === 0) writesDuringFetch.clear()
      endOperation()
    }
  }

  async function createTask(
    calendarUrl: string,
    task: Omit<Task, 'calendarId'>
  ): Promise<Task | null> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const ics = await buildTodoIcs({ ...task, calendarId: calendarUrl })
      // Safe resource name (UID as-is when safe, else its SHA-256).
      const url = `${calendarUrl}${await davResourceName(task.id)}.ics`

      const resp = await davFetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*'
        },
        body: ics
      })
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      const created: Task = {
        ...task,
        calendarId: calendarUrl,
        rawIcs: ics,
        href: url,
        etag: resp.headers.get('ETag') || undefined
      }
      tasks.value.push(created)
      recordLocalWrite(created.id, created)
      return created
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] createTask error:', err)
      return null
    }
  }

  /** Replace the in-memory entry for `task` with a freshly parsed model. */
  async function replaceTask(task: Task, ics: string, href: string, etag?: string): Promise<Task> {
    const parsed = await parseVtodoToTask(ics, task.calendarId, href, etag)
    const next: Task = parsed ?? { ...task, rawIcs: ics, href, etag }
    const idx = tasks.value.findIndex((t) => t.id === task.id)
    if (idx !== -1) tasks.value[idx] = next
    recordLocalWrite(next.id, next)
    return next
  }

  /**
   * Persist an edited task. The raw ICS is patched (never rebuilt) so foreign
   * properties survive. A calendar change moves the resource: PUT into the new
   * collection first, then DELETE the old one.
   */
  async function updateTask(task: Task): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const ics = task.rawIcs ? await patchTodoIcs(task.rawIcs, task) : await buildTodoIcs(task)
      const oldUrl = task.href || `${task.calendarId}${await davResourceName(task.id)}.ics`
      const moving = !!task.href && !task.href.startsWith(task.calendarId)

      const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' }
      if (moving) headers['If-None-Match'] = '*'
      else if (task.etag) headers['If-Match'] = formatIfMatch(task.etag)

      const targetUrl = moving ? `${task.calendarId}${await davResourceName(task.id)}.ics` : oldUrl
      const resp = await davFetch(targetUrl, { method: 'PUT', headers, body: ics })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      if (moving) {
        const delHeaders: Record<string, string> = {}
        if (task.etag) delHeaders['If-Match'] = formatIfMatch(task.etag)
        const del = await davFetch(oldUrl, { method: 'DELETE', headers: delHeaders })
        if (del.status === 412) {
          // The copy landed, the old entry changed elsewhere: the user would
          // silently end up with the task in two lists. Say what
          // happened instead of throwing a bare DELETE error.
          error.value =
            'The task was copied to the new list, but its old entry was changed elsewhere — reload to delete it there.'
        } else if (!del.ok && del.status !== 404) {
          throw new Error(`DELETE failed: ${del.status}`)
        }
      }

      await replaceTask(task, ics, targetUrl, resp.headers.get('ETag') || undefined)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] updateTask error:', err)
      return false
    }
  }

  /** Complete / reopen a task by patching STATUS, COMPLETED and PERCENT-COMPLETE. */
  async function setTaskCompleted(task: Task, completed: boolean): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      if (!task.rawIcs) throw new Error('Task cannot be updated: original data unavailable')
      const ics = await setTodoCompletedIcs(task.rawIcs, completed)
      const url = task.href || `${task.calendarId}${await davResourceName(task.id)}.ics`

      const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' }
      if (task.etag) headers['If-Match'] = formatIfMatch(task.etag)

      const resp = await davFetch(url, { method: 'PUT', headers, body: ics })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      await replaceTask(task, ics, url, resp.headers.get('ETag') || task.etag)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] setTaskCompleted error:', err)
      return false
    }
  }

  async function deleteTask(task: Task): Promise<boolean> {
    try {
      if (!(await ensureReady('calendar'))) throw new Error('DAV server not reachable')
      const url = task.href || `${task.calendarId}${await davResourceName(task.id)}.ics`

      const headers: Record<string, string> = {}
      if (task.etag) headers['If-Match'] = formatIfMatch(task.etag)

      const resp = await davFetch(url, { method: 'DELETE', headers })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`DELETE failed: ${resp.status}`)

      tasks.value = tasks.value.filter((t) => t.id !== task.id)
      recordLocalWrite(task.id, null)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] deleteTask error:', err)
      return false
    }
  }

  return {
    calendars,
    tasks,
    loading,
    error,
    fetchCalendars,
    fetchTasks,
    createTask,
    updateTask,
    setTaskCompleted,
    deleteTask
  }
}
