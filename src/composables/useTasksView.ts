/**
 * useTasksView – the Tasks page's state + DAV logic.
 *
 * Extracted from `views/Tasks.vue`: the filter chips, quick-add, grouping by
 * calendar, overdue/priority helpers, the `?open=<href>` deep link and the
 * create/update/complete/delete writes with ETag-conflict handling.
 *
 * The service's English error strings are mapped to translated messages
 * (`davErrorMessages`) before they reach the banner or a toast.
 * The task form dialog itself is `components/tasks/TaskDialog.vue`.
 */

import { computed, ref, watch, type Ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useModals, useRoute } from '@opencloud-eu/web-pkg'
import { useDAVClient } from './useDAVClient'
import { DEFAULT_CALENDAR_COLOR } from './colorUtils'
import {
  filterTasks,
  isTaskDone,
  sortTasks,
  useTasksService,
  type TaskFilter
} from './useTasksService'
import { isConflictErrorMessage, mapDavError } from './davErrorMessages'
import { useSettings } from '../settings/settingsStore'
import { formatClock, useFormatLocale } from '../settings/formatLocale'
import { preferredCollectionUrl } from '../settings/collectionDefaults'
import { openQueryHref, sameResourceHref } from '../setup/openQuery'
import { refreshReminders } from '../setup/reminders'
import type { CalendarCollection, Task } from '../types'
/** Priority levels the form offers (mapped to RFC 5545 PRIORITY on save). */
export type PriorityLevel = 'none' | 'low' | 'medium' | 'high'
export const PRIORITY_BY_LEVEL: Record<PriorityLevel, number> = {
  none: 0,
  low: 9,
  medium: 5,
  high: 1
}

export function priorityLevelOf(priority: number): PriorityLevel {
  if (!priority) return 'none'
  if (priority <= 4) return 'high'
  if (priority === 5) return 'medium'
  return 'low'
}

interface TaskGroup {
  url: string
  name: string
  color: string
  tasks: Task[]
}

export interface TasksViewState {
  calendars: Ref<CalendarCollection[]>
  tasks: Ref<Task[]>
  loading: Ref<boolean>
  errorMessage: Ref<string | null>
  filter: Ref<TaskFilter>
  filterOptions: Ref<Array<{ value: TaskFilter; label: string }>>
  selectedCalendarUrl: Ref<string>
  quickAddTitle: Ref<string>
  quickAddInput: Ref<HTMLInputElement | null>
  initialized: Ref<boolean>
  showDialog: Ref<boolean>
  editMode: Ref<boolean>
  editingTask: Ref<Task | null>
  visibleTasks: Ref<Task[]>
  groups: Ref<TaskGroup[]>
  defaultTaskCalendarUrl: Ref<string>
  loadInitial: () => Promise<void>
  quickAdd: () => Promise<void>
  isCompleted: (task: Task) => boolean
  isDone: (task: Task) => boolean
  isOverdue: (task: Task) => boolean
  formatDue: (due: string) => string
  priorityLabel: (priority: number) => string
  toggleComplete: (task: Task) => Promise<void>
  openCreateDialog: () => void
  openEditDialog: (task: Task) => void
  closeDialog: () => void
  saveTask: (fields: {
    title: string
    description?: string
    due?: string
    priority: number
    calendarUrl: string
  }) => Promise<void>
  confirmDelete: (task: Task) => void
  onDeleteFromDialog: () => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function todayStamp(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function nowStamp(): string {
  const now = new Date()
  return `${todayStamp()} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function useTasksView(): TasksViewState {
  const { $gettext } = useGettext()
  const { dispatchModal } = useModals()
  const { showMessage, showErrorMessage } = useMessages()
  const { ensureReady } = useDAVClient()
  const route = useRoute()
  const { settings } = useSettings()
  const formatLocale = useFormatLocale()
  const {
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
  } = useTasksService()

  /**
   * Initial filter from `tasks.showCompleted` ("All" when the user wants completed
   * tasks listed) — the chips take over from there.
   */
  const filter = ref<TaskFilter>(settings.value.tasks.showCompleted ? 'all' : 'open')
  const selectedCalendarUrl = ref('')
  const quickAddTitle = ref('')
  const quickAddInput = ref<HTMLInputElement | null>(null)
  const initialized = ref(false)
  const showDialog = ref(false)
  const editMode = ref(false)
  const editingTask = ref<Task | null>(null)

  const filterOptions = computed(() => [
    { value: 'open' as TaskFilter, label: $gettext('Open') },
    { value: 'completed' as TaskFilter, label: $gettext('Completed') },
    { value: 'all' as TaskFilter, label: $gettext('All') }
  ])

  function isCompleted(task: Task): boolean {
    return task.status === 'COMPLETED'
  }

  function isDone(task: Task): boolean {
    return isTaskDone(task)
  }

  /** Open task whose due date (or due date-time) lies in the past. */
  function isOverdue(task: Task): boolean {
    if (!task.due || isDone(task)) return false
    return task.due.includes(' ') ? task.due < nowStamp() : task.due < todayStamp()
  }

  function formatDue(due: string): string {
    const [datePart, timePart] = due.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const dateText = new Date(year, month - 1, day).toLocaleDateString(formatLocale.value, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
    return timePart ? `${dateText} ${formatClock(timePart, formatLocale.value)}` : dateText
  }

  function priorityLabel(priority: number): string {
    switch (priorityLevelOf(priority)) {
      case 'high':
        return $gettext('High')
      case 'medium':
        return $gettext('Medium')
      case 'low':
        return $gettext('Low')
      default:
        return ''
    }
  }

  const selectedCalendar = computed<CalendarCollection | null>(
    () =>
      calendars.value.find((c) => c.url === selectedCalendarUrl.value) || calendars.value[0] || null
  )

  /**
   * Calendar a new task is created in: `tasks.defaultCalendar` while that
   * collection still exists, else the currently selected/first one.
   */
  const defaultTaskCalendarUrl = computed(() =>
    preferredCollectionUrl(settings.value.tasks.defaultCalendar, calendars.value)
  )

  const visibleTasks = computed(() => sortTasks(filterTasks(tasks.value, filter.value)))

  const groups = computed<TaskGroup[]>(() => {
    const order = calendars.value.map((c) => c.url)
    const byCalendar = new Map<string, TaskGroup>()

    for (const task of visibleTasks.value) {
      let group = byCalendar.get(task.calendarId)
      if (!group) {
        const calendar = calendars.value.find((c) => c.url === task.calendarId)
        group = {
          url: task.calendarId,
          name: calendar?.displayName || $gettext('Calendar'),
          color: calendar?.color || DEFAULT_CALENDAR_COLOR,
          tasks: []
        }
        byCalendar.set(task.calendarId, group)
      }
      group.tasks.push(task)
    }

    return [...byCalendar.values()].sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url))
  })

  /** The service's English error strings are mapped to translated messages. */
  const errorMessage = computed(() => mapDavError(error.value, $gettext))

  /** The 412 conflict identifier on the service `error` ref. */
  function isConflictError(): boolean {
    return isConflictErrorMessage(error.value)
  }

  async function refresh() {
    await fetchTasks()
  }

  async function loadInitial(): Promise<void> {
    const ready = await ensureReady('calendar')
    if (!ready) {
      // Route the DAV failure through the service so the page shows its error banner.
      await fetchCalendars()
      initialized.value = true
      return
    }
    const found = await fetchCalendars()
    if (found.length > 0 && !found.some((c) => c.url === selectedCalendarUrl.value)) {
      selectedCalendarUrl.value = preferredCollectionUrl(
        settings.value.tasks.defaultCalendar,
        found
      )
    }
    await fetchTasks()
    initialized.value = true
    openItemFromQuery()
  }

  async function quickAdd() {
    const title = quickAddTitle.value.trim()
    const calendar = selectedCalendar.value
    if (!title || !calendar) return

    const created = await createTask(calendar.url, {
      id: crypto.randomUUID(),
      title,
      priority: 0,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })

    if (created) {
      quickAddTitle.value = ''
      // New tasks are open — make sure the list they land in shows them.
      if (filter.value === 'completed') filter.value = 'open'
      showMessage({ title: $gettext('Task created') })
      quickAddInput.value?.focus()
      // A due-date reminder must be armed now, not at the next 15-minute tick.
      refreshReminders()
    } else {
      showErrorMessage({
        title: mapDavError(error.value, $gettext) ?? $gettext('Failed to create task')
      })
    }
  }

  async function toggleComplete(task: Task) {
    const complete = !isCompleted(task)
    const ok = await setTaskCompleted(task, complete)
    if (ok) {
      showMessage({ title: complete ? $gettext('Task completed') : $gettext('Task reopened') })
      // Completed tasks owe no reminder any more.
      refreshReminders()
      return
    }
    const conflict = isConflictError()
    if (conflict) await refresh()
    showErrorMessage({
      title: conflict
        ? (mapDavError(error.value, $gettext) ??
          $gettext('Item was modified elsewhere. Latest version loaded.'))
        : (mapDavError(error.value, $gettext) ?? $gettext('Failed to update task'))
    })
  }

  function openCreateDialog() {
    editMode.value = false
    editingTask.value = null
    showDialog.value = true
  }

  function openEditDialog(task: Task) {
    editMode.value = true
    editingTask.value = task
    showDialog.value = true
  }

  function closeDialog() {
    showDialog.value = false
    editMode.value = false
    editingTask.value = null
  }

  /**
   * `?open=<href>` — entered from a reminder/notification click (`src/index.ts`).
   * Opens the task's edit dialog once per query value.
   */
  let openedFromQuery: string | null = null

  function openItemFromQuery(): void {
    const wanted = openQueryHref(route.value?.query)
    if (!wanted || !initialized.value || openedFromQuery === wanted) return
    const task = tasks.value.find(
      (entry) => sameResourceHref(entry.href, wanted) || entry.id === wanted
    )
    if (!task) return
    openedFromQuery = wanted
    openEditDialog(task)
  }

  watch(
    () => route.value?.query?.open,
    () => {
      openedFromQuery = null
      openItemFromQuery()
    }
  )

  async function saveTask(fields: {
    title: string
    description?: string
    due?: string
    priority: number
    calendarUrl: string
  }) {
    const title = fields.title.trim()
    if (!title) return
    const calendarUrl = fields.calendarUrl || selectedCalendar.value?.url
    if (!calendarUrl) return

    const patch = {
      title,
      description: fields.description,
      due: fields.due,
      priority: fields.priority
    }

    if (editMode.value && editingTask.value) {
      const updated: Task = {
        ...editingTask.value,
        ...patch,
        calendarId: calendarUrl
      }
      const ok = await updateTask(updated)
      if (ok) {
        showMessage({ title: $gettext('Task updated') })
        refreshReminders()
        closeDialog()
        return
      }
      const conflict = isConflictError()
      if (conflict) await refresh()
      showErrorMessage({
        title: conflict
          ? (mapDavError(error.value, $gettext) ??
            $gettext('Item was modified elsewhere. Latest version loaded.'))
          : (mapDavError(error.value, $gettext) ?? $gettext('Failed to update task'))
      })
      if (conflict) closeDialog()
      return
    }

    const created = await createTask(calendarUrl, {
      id: crypto.randomUUID(),
      ...patch,
      status: 'NEEDS-ACTION',
      percentComplete: 0
    })
    if (created) {
      if (filter.value === 'completed') filter.value = 'open'
      showMessage({ title: $gettext('Task created') })
      refreshReminders()
      closeDialog()
    } else {
      showErrorMessage({
        title: mapDavError(error.value, $gettext) ?? $gettext('Failed to create task')
      })
    }
  }

  function confirmDelete(task: Task) {
    dispatchModal({
      title: $gettext('Delete task'),
      message: $gettext('Are you sure you want to delete this task?'),
      confirmText: $gettext('Delete'),
      async onConfirm() {
        const ok = await deleteTask(task)
        if (ok) {
          if (editingTask.value?.id === task.id) closeDialog()
          showMessage({ title: $gettext('Task deleted') })
          // Drop the armed reminder of the deleted task.
          refreshReminders()
          return
        }
        const conflict = isConflictError()
        if (conflict) await refresh()
        showErrorMessage({
          title: conflict
            ? (mapDavError(error.value, $gettext) ??
              $gettext('Item was modified elsewhere. Latest version loaded.'))
            : (mapDavError(error.value, $gettext) ?? $gettext('Failed to delete task'))
        })
      }
    })
  }

  function onDeleteFromDialog() {
    if (editingTask.value) confirmDelete(editingTask.value)
  }

  return {
    calendars,
    tasks,
    loading,
    errorMessage,
    filter,
    filterOptions,
    selectedCalendarUrl,
    quickAddTitle,
    quickAddInput,
    initialized,
    showDialog,
    editMode,
    editingTask,
    visibleTasks,
    groups,
    defaultTaskCalendarUrl,
    loadInitial,
    quickAdd,
    isCompleted,
    isDone,
    isOverdue,
    formatDue,
    priorityLabel,
    toggleComplete,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    saveTask,
    confirmDelete,
    onDeleteFromDialog
  }
}
