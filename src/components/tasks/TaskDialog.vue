<!--
  TaskDialog – the "New/Edit Task" modal of the Tasks page.

  Moved out of `views/Tasks.vue`. Owns the form state (title, description, due
  date/time, priority, calendar) and the modal a11y; emits the normalised fields
  on save and `delete` for the in-dialog delete button.

    props:
      open: boolean
      editMode: boolean
      task: Task | null        the task being edited (null = create)
      calendars: CalendarCollection[]   calendar choices
      defaultCalendarUrl: string         prefill for a new task
    emits:
      close
      save [fields: { title, description?, due?, priority, calendarUrl }]
      delete
-->
<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div
        ref="taskPanelRef"
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
      >
        <h2 id="task-dialog-title" class="modal-title">
          {{ editMode ? $gettext('Edit task') : $gettext('New task') }}
        </h2>

        <form class="modal-form" @submit.prevent="onSubmit">
          <oc-text-input v-model="taskForm.title" :label="$gettext('Title')" />
          <oc-textarea v-model="taskForm.description" :label="$gettext('Description')" />

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="task-due-date">{{ $gettext('Due date') }}</label>
              <input
                id="task-due-date"
                v-model="taskForm.dueDate"
                type="date"
                class="form-input"
                @change="onDueDateChange"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="task-due-time">{{ $gettext('Due time') }}</label>
              <input
                id="task-due-time"
                v-model="taskForm.dueTime"
                type="time"
                class="form-input"
                :disabled="!taskForm.dueDate"
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="task-priority">{{ $gettext('Priority') }}</label>
              <select id="task-priority" v-model="taskForm.priorityLevel" class="form-select">
                <option v-for="option in priorityOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="task-calendar">{{ $gettext('Calendar') }}</label>
              <select id="task-calendar" v-model="taskForm.calendarUrl" class="form-select">
                <option v-for="cal in calendars" :key="cal.url" :value="cal.url">
                  {{ cal.displayName }}
                </option>
              </select>
            </div>
          </div>

          <div class="modal-actions">
            <oc-button
              v-if="editMode"
              appearance="outline"
              :disabled="!task"
              @click="emit('delete')"
            >
              <oc-icon name="delete-bin" size="small" />
              <span>{{ $gettext('Delete') }}</span>
            </oc-button>
            <div class="spacer" />
            <oc-button appearance="outline" @click="emit('close')">
              {{ $gettext('Cancel') }}
            </oc-button>
            <oc-button
              appearance="filled"
              color-role="primary"
              submit="submit"
              :disabled="!taskForm.title.trim()"
            >
              {{ $gettext('Save') }}
            </oc-button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useModalA11y } from '../../composables/useModalA11y'
import {
  PRIORITY_BY_LEVEL,
  priorityLevelOf,
  type PriorityLevel
} from '../../composables/useTasksView'
import type { CalendarCollection, Task } from '../../types'
import '../../styles/modal.css'

defineOptions({ name: 'TaskDialog' })

const props = defineProps<{
  open: boolean
  editMode: boolean
  task: Task | null
  calendars: CalendarCollection[]
  defaultCalendarUrl: string
}>()

const emit = defineEmits<{
  close: []
  save: [
    fields: {
      title: string
      description?: string
      due?: string
      priority: number
      calendarUrl: string
    }
  ]
  delete: []
}>()

const { $gettext } = useGettext()

const taskPanelRef = ref<HTMLElement | null>(null)
useModalA11y(
  taskPanelRef,
  computed(() => props.open),
  { onClose: () => emit('close') }
)

const taskForm = ref({
  title: '',
  description: '',
  dueDate: '',
  dueTime: '',
  priorityLevel: 'none' as PriorityLevel,
  calendarUrl: ''
})

const priorityOptions = computed(() => [
  { value: 'none' as PriorityLevel, label: $gettext('None') },
  { value: 'low' as PriorityLevel, label: $gettext('Low') },
  { value: 'medium' as PriorityLevel, label: $gettext('Medium') },
  { value: 'high' as PriorityLevel, label: $gettext('High') }
])

function resetForm() {
  taskForm.value = {
    title: '',
    description: '',
    dueDate: '',
    dueTime: '',
    priorityLevel: 'none',
    calendarUrl: props.defaultCalendarUrl || props.calendars[0]?.url || ''
  }
}

/** Fill the form when the dialog opens (create: defaults; edit: from the task). */
watch(
  () => [props.open, props.task] as const,
  () => {
    if (!props.open) return
    const task = props.task
    if (props.editMode && task) {
      taskForm.value = {
        title: task.title,
        description: task.description || '',
        dueDate: task.due ? task.due.slice(0, 10) : '',
        dueTime: task.due && task.due.includes(' ') ? task.due.slice(11) : '',
        priorityLevel: priorityLevelOf(task.priority),
        calendarUrl: task.calendarId
      }
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

function onDueDateChange() {
  if (!taskForm.value.dueDate) taskForm.value.dueTime = ''
}

function formDue(): string | undefined {
  const { dueDate, dueTime } = taskForm.value
  if (!dueDate) return undefined
  return dueTime ? `${dueDate} ${dueTime}` : dueDate
}

function onSubmit() {
  const title = taskForm.value.title.trim()
  if (!title) return
  const calendarUrl = taskForm.value.calendarUrl || props.calendars[0]?.url
  if (!calendarUrl) return
  emit('save', {
    title,
    description: taskForm.value.description.trim() || undefined,
    due: formDue(),
    priority: PRIORITY_BY_LEVEL[taskForm.value.priorityLevel],
    calendarUrl
  })
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.modal-panel {
  background: var(--oc-role-surface-container-lowest, #ffffff);
  color: var(--oc-role-on-surface, #191c1d);
  border-radius: 16px;
  padding: 12px 24px 24px;
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 14px;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-group {
  display: flex;
  flex-direction: column;
}
.form-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--oc-role-on-surface-variant, #40484c);
}
.form-input {
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.875rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  box-sizing: border-box;
}
.form-input:focus {
  outline: none;
  border-color: var(--oc-role-primary, #00677f);
}
.form-select {
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 0.875rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  height: 36px;
  box-sizing: border-box;
}
.form-select:focus {
  outline: none;
  border-color: var(--oc-role-primary, #00677f);
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  margin: 12px -24px -24px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  background: var(--oc-role-surface-container-lowest, #ffffff);
  position: sticky;
  bottom: -24px;
  border-radius: 0 0 16px 16px;
}
.spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
  .modal-panel {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
}
</style>
