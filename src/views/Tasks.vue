<template>
  <main class="tasks-page">
    <ConnectionGate>
      <div class="toolbar">
        <div class="page-title-row">
          <h1 class="page-title">{{ $gettext('Tasks') }}</h1>
          <PageHeaderActions />
        </div>

        <div class="toolbar-actions">
          <oc-button
            appearance="filled"
            :disabled="calendars.length === 0"
            @click="openCreateDialog"
          >
            <oc-icon name="add" size="small" />
            <span>{{ $gettext('New task') }}</span>
          </oc-button>
        </div>

        <div class="toolbar-filter">
          <div class="filter-group" role="group" :aria-label="$gettext('Filter')">
            <button
              v-for="option in filterOptions"
              :key="option.value"
              type="button"
              class="filter-chip"
              :class="{ 'filter-chip--active': filter === option.value }"
              :aria-pressed="filter === option.value"
              @click="filter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="!initialized && loading" class="empty-state">
        <oc-spinner size="medium" />
        <span>{{ $gettext('Loading tasks...') }}</span>
      </div>

      <div v-else-if="!initialized && errorMessage" class="error-banner">
        <oc-icon name="warning" size="small" fill-type="fill" />
        <div>
          <p class="error-text">{{ errorMessage }}</p>
          <p class="error-hint">
            {{ $gettext('Check that the calendar server is running.') }}
          </p>
        </div>
      </div>

      <div v-else class="task-scroll">
        <div v-if="errorMessage" class="error-banner">
          <oc-icon name="warning" size="small" fill-type="fill" />
          <p class="error-text">{{ errorMessage }}</p>
        </div>

        <div v-if="calendars.length === 0" class="empty-state">
          <oc-icon name="task" size="xlarge" />
          <span>{{ $gettext('No calendar accepts tasks.') }}</span>
        </div>

        <div v-else-if="visibleTasks.length === 0" class="empty-state">
          <oc-icon name="task" size="xlarge" />
          <span>
            {{
              filter === 'completed' ? $gettext('No completed tasks.') : $gettext('No open tasks.')
            }}
          </span>
        </div>

        <template v-else>
          <section v-for="group in groups" :key="group.url" class="task-group">
            <h2 class="task-group-title">
              <span
                class="task-group-dot"
                :style="{ backgroundColor: group.color }"
                aria-hidden="true"
              />
              <span>{{ group.name }}</span>
              <span class="task-group-count">{{ group.tasks.length }}</span>
            </h2>

            <ul class="task-list">
              <li
                v-for="task in group.tasks"
                :key="task.id"
                class="task-row"
                :class="{ 'is-completed': isDone(task) }"
              >
                <input
                  type="checkbox"
                  class="task-checkbox"
                  :checked="isCompleted(task)"
                  :aria-label="
                    isCompleted(task) ? $gettext('Reopen task') : $gettext('Complete task')
                  "
                  @change="toggleComplete(task)"
                />
                <button type="button" class="task-main" @click="openEditDialog(task)">
                  <span class="task-title">{{ task.title }}</span>
                  <span class="task-meta">
                    <span
                      v-if="task.due"
                      class="task-due"
                      :class="{ 'is-overdue': isOverdue(task) }"
                    >
                      <oc-icon name="calendar-event" size="small" />
                      <span>{{ formatDue(task.due) }}</span>
                    </span>
                    <span v-if="isOverdue(task)" class="task-badge task-badge--overdue">
                      {{ $gettext('Overdue') }}
                    </span>
                    <span v-if="task.priority" class="task-badge">
                      {{ priorityLabel(task.priority) }}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  class="task-delete"
                  :aria-label="$gettext('Delete task')"
                  :title="$gettext('Delete task')"
                  @click="confirmDelete(task)"
                >
                  <oc-icon name="delete-bin" size="small" />
                </button>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </ConnectionGate>

    <TaskDialog
      :open="showDialog"
      :edit-mode="editMode"
      :task="editingTask"
      :calendars="calendars"
      :default-calendar-url="defaultTaskCalendarUrl"
      @close="closeDialog"
      @save="saveTask"
      @delete="onDeleteFromDialog"
    />
  </main>
</template>

<script setup lang="ts">
/**
 * TasksView – page shell for the tasks app.
 *
 * The page is wiring-only: the list/write logic lives in
 * `useTasksView`, the task form dialog in `components/tasks/TaskDialog.vue`.
 * The rendered DOM, classes and e2e selectors are unchanged.
 */
import { onMounted } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useTasksView } from '../composables/useTasksView'
import ConnectionGate from '../components/ConnectionGate.vue'
import PageHeaderActions from '../components/PageHeaderActions.vue'
import TaskDialog from '../components/tasks/TaskDialog.vue'

defineOptions({ name: 'TasksView' })

const { $gettext } = useGettext()

const {
  calendars,
  loading,
  errorMessage,
  filter,
  filterOptions,
  initialized,
  showDialog,
  editMode,
  editingTask,
  visibleTasks,
  groups,
  defaultTaskCalendarUrl,
  loadInitial,
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
} = useTasksView()

onMounted(loadInitial)
</script>

<style scoped>
.tasks-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.page-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-basis: 100%;
}
.page-title {
  font-size: 1.25rem;
  font-weight: 600;
}
/* Row 2: the switch left, "New task" right (DOM keeps the button first for the
   tab order). */
.toolbar-filter {
  order: 1;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  order: 2;
  margin-inline-start: auto;
}

.filter-group {
  display: inline-flex;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 16px;
  overflow: hidden;
  background: var(--oc-role-surface, #fbfcfe);
}
.filter-chip {
  border: none;
  background: transparent;
  color: var(--oc-role-on-surface, #191c1d);
  font-size: 0.8125rem;
  padding: 5px 12px;
  cursor: pointer;
}
.filter-chip:hover {
  background: var(--oc-role-surface-container-low, #f2f4f5);
}
.filter-chip--active {
  background: var(--oc-role-secondary-container, #cfe6f1);
  font-weight: 600;
}
.filter-chip:focus-visible {
  outline: 2px solid var(--oc-role-secondary, #20434f);
  outline-offset: -2px;
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
  border-color: var(--oc-role-secondary, #20434f);
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
  border-color: var(--oc-role-secondary, #20434f);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--oc-role-error-container, #ffdad6);
  border-radius: 8px;
  padding: 16px;
  color: var(--oc-role-on-error-container, #410002);
}
.error-text {
  font-size: 0.875rem;
}
.error-hint {
  font-size: 0.8125rem;
  margin-top: 4px;
}

.task-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* `flex-shrink: 0`: a flex child with `overflow: hidden` may shrink below its
   content, so with many tasks every group was squeezed into the scroll area
   (cut-off rows) instead of the list scrolling. */
.task-group {
  flex-shrink: 0;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 12px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
  overflow: hidden;
}

.task-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 10px 16px;
  color: var(--oc-role-on-surface-variant, #40484c);
  border-bottom: 1px solid var(--oc-role-surface-container, #eceef0);
}
.task-group-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.task-group-count {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--oc-role-on-surface-variant, #40484c);
  background: var(--oc-role-surface-container, #eceef0);
  border-radius: 10px;
  padding: 0 8px;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--oc-role-surface-container, #eceef0);
  content-visibility: auto;
  contain-intrinsic-size: auto 56px;
}
.task-row:last-child {
  border-bottom: none;
}
.task-row:hover {
  background: var(--oc-role-surface-container-low, #f2f4f5);
}

.task-checkbox {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--oc-role-secondary, #20434f);
  cursor: pointer;
}
.task-checkbox:focus-visible {
  outline: 2px solid var(--oc-role-secondary, #20434f);
  outline-offset: 2px;
}

.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.task-main:focus-visible {
  outline: 2px solid var(--oc-role-secondary, #20434f);
  outline-offset: 2px;
  border-radius: 4px;
}
.task-title {
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.is-completed .task-title {
  text-decoration: line-through;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.75rem;
}
.task-due {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--oc-role-on-surface-variant, #40484c);
}
.task-due.is-overdue {
  color: var(--oc-role-error, #ba1a1a);
  font-weight: 600;
}

.task-badge {
  border-radius: 10px;
  padding: 0 8px;
  background: var(--oc-role-surface-container, #eceef0);
  color: var(--oc-role-on-surface-variant, #40484c);
  font-size: 0.6875rem;
  font-weight: 500;
}
.task-badge--overdue {
  background: var(--oc-role-error-container, #ffdad6);
  color: var(--oc-role-on-error-container, #410002);
}

.task-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  color: var(--oc-role-on-surface-variant, #40484c);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.task-delete:hover {
  color: var(--oc-role-error, #ba1a1a);
}
.task-delete:focus-visible {
  outline: 2px solid var(--oc-role-secondary, #20434f);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .tasks-page {
    padding: 8px;
  }
}
</style>
