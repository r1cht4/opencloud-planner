<template>
  <SettingsSection :title="$gettext('Tasks')">
    <SettingsRow
      :label="$gettext('Default calendar')"
      :hint="
        $gettext(
          'New tasks are created here. A calendar that no longer exists falls back to the first one.'
        )
      "
      :locked="isLocked('tasks.defaultCalendar')"
      label-for="setting-tasks-default-calendar"
    >
      <select
        id="setting-tasks-default-calendar"
        class="settings-select"
        data-setting="tasks.defaultCalendar"
        :value="settings.tasks.defaultCalendar ?? ''"
        :disabled="isLocked('tasks.defaultCalendar')"
        @change="update('tasks.defaultCalendar', optionalUrl($event))"
      >
        <option value="">{{ $gettext('First calendar') }}</option>
        <option v-for="calendar in choices" :key="calendar.url" :value="calendar.url">
          {{ calendar.displayName }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Reminder for new tasks')"
      :hint="
        $gettext('Tasks without their own reminder are announced this long before they are due.')
      "
      :locked="isLocked('tasks.defaultReminder')"
      label-for="setting-tasks-default-reminder"
    >
      <select
        id="setting-tasks-default-reminder"
        class="settings-select"
        data-setting="tasks.defaultReminder"
        :value="reminderValue"
        :disabled="isLocked('tasks.defaultReminder')"
        @change="update('tasks.defaultReminder', parseReminder(valueOf($event)))"
      >
        <option v-for="option in REMINDER_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Show completed tasks')"
      label-for="setting-tasks-show-completed"
      :locked="isLocked('tasks.showCompleted')"
    >
      <input
        id="setting-tasks-show-completed"
        class="settings-checkbox"
        data-setting="tasks.showCompleted"
        type="checkbox"
        :checked="settings.tasks.showCompleted"
        :disabled="isLocked('tasks.showCompleted')"
        @change="update('tasks.showCompleted', checkedOf($event))"
      />
    </SettingsRow>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * Settings → Tasks — one group: default calendar, the default reminder lead time
 * and the initial "show completed" filter.
 *
 * `tasks.defaultReminder` is the only setting whose "off" state is *absence*: the
 * select writes `undefined` for "No reminder", which removes the key (a stored
 * `0` would mean "at the due time"). It feeds the reminder engine's
 * `taskDefaultReminderMinutes` through `src/index.ts`.
 */
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useSettings } from '../../settings/settingsStore'
import { useCalendarChoices } from './useCollectionChoices'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import { checkedOf, optionalUrl, parseReminder, valueOf } from './settingsForm'
import '../../styles/settings.css'

defineOptions({ name: 'TasksSettings' })

const { $gettext } = useGettext()
const { settings, update, isLocked } = useSettings()
const { choices } = useCalendarChoices()

const REMINDER_OPTIONS = computed(() => [
  { value: 'none', label: $gettext('No reminder') },
  { value: '0', label: $gettext('At the due time') },
  { value: '15', label: $gettext('15 minutes before') },
  { value: '60', label: $gettext('1 hour before') },
  { value: '1440', label: $gettext('1 day before') }
])

const reminderValue = computed(() => {
  const minutes = settings.value.tasks.defaultReminder
  return typeof minutes === 'number' ? String(minutes) : 'none'
})
</script>
