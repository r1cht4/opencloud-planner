<template>
  <SettingsSection :title="$gettext('View')">
    <SettingsRow
      :label="$gettext('Default view')"
      :locked="isLocked('calendar.defaultView')"
      label-for="setting-calendar-default-view"
    >
      <select
        id="setting-calendar-default-view"
        class="settings-select"
        data-setting="calendar.defaultView"
        :value="settings.calendar.defaultView"
        :disabled="isLocked('calendar.defaultView')"
        @change="update('calendar.defaultView', valueOf($event))"
      >
        <option v-for="view in VIEWS" :key="view.value" :value="view.value">
          {{ view.label }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Week starts on')"
      :locked="isLocked('calendar.weekStart')"
      label-for="setting-calendar-week-start"
    >
      <select
        id="setting-calendar-week-start"
        class="settings-select"
        data-setting="calendar.weekStart"
        :value="weekStartValue"
        :disabled="isLocked('calendar.weekStart')"
        @change="update('calendar.weekStart', parseWeekStart(valueOf($event)))"
      >
        <option v-for="day in WEEK_STARTS" :key="day.value" :value="day.value">
          {{ day.label }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Show weekends')"
      label-for="setting-calendar-show-weekends"
      :locked="isLocked('calendar.showWeekends')"
    >
      <input
        id="setting-calendar-show-weekends"
        class="settings-checkbox"
        data-setting="calendar.showWeekends"
        type="checkbox"
        :checked="settings.calendar.showWeekends"
        :disabled="isLocked('calendar.showWeekends')"
        @change="update('calendar.showWeekends', checkedOf($event))"
      />
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Show week numbers')"
      label-for="setting-calendar-week-numbers"
      :locked="isLocked('calendar.weekNumbers')"
    >
      <input
        id="setting-calendar-week-numbers"
        class="settings-checkbox"
        data-setting="calendar.weekNumbers"
        type="checkbox"
        :checked="settings.calendar.weekNumbers"
        :disabled="isLocked('calendar.weekNumbers')"
        @change="update('calendar.weekNumbers', checkedOf($event))"
      />
    </SettingsRow>

    <SettingsMore>
      <SettingsRow
        :label="$gettext('Day starts at')"
        :hint="$gettext('The day and week views scroll to this time when they open.')"
        :locked="isLocked('calendar.dayStart')"
        label-for="setting-calendar-day-start"
      >
        <input
          id="setting-calendar-day-start"
          class="settings-time-input"
          data-setting="calendar.dayStart"
          type="time"
          :value="settings.calendar.dayStart"
          :disabled="isLocked('calendar.dayStart')"
          @change="update('calendar.dayStart', valueOf($event))"
        />
      </SettingsRow>
    </SettingsMore>
  </SettingsSection>

  <SettingsSection :title="$gettext('New events')">
    <SettingsRow
      :label="$gettext('Default calendar')"
      :hint="
        $gettext(
          'Used for new events. A calendar that no longer exists falls back to the first one.'
        )
      "
      :locked="isLocked('calendar.defaultCalendar')"
      label-for="setting-calendar-default-calendar"
    >
      <select
        id="setting-calendar-default-calendar"
        class="settings-select"
        data-setting="calendar.defaultCalendar"
        :value="settings.calendar.defaultCalendar ?? ''"
        :disabled="isLocked('calendar.defaultCalendar')"
        @change="update('calendar.defaultCalendar', optionalUrl($event))"
      >
        <option value="">{{ $gettext('First calendar') }}</option>
        <option v-for="calendar in choices" :key="calendar.url" :value="calendar.url">
          {{ calendar.displayName }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Default event duration')"
      :locked="isLocked('calendar.defaultDuration')"
      label-for="setting-calendar-default-duration"
    >
      <select
        id="setting-calendar-default-duration"
        class="settings-select"
        data-setting="calendar.defaultDuration"
        :value="settings.calendar.defaultDuration"
        :disabled="isLocked('calendar.defaultDuration')"
        @change="update('calendar.defaultDuration', Number(valueOf($event)))"
      >
        <option v-for="minutes in DURATIONS" :key="minutes" :value="minutes">
          {{ durationLabel(minutes) }}
        </option>
      </select>
    </SettingsRow>

    <SettingsMore>
      <fieldset class="settings-fieldset">
        <legend class="settings-fieldset-title">{{ $gettext('Default reminders') }}</legend>
        <div class="settings-checkbox-list">
          <div v-for="minutes in REMINDERS" :key="minutes" class="settings-checkbox-row">
            <input
              :id="`setting-calendar-reminder-${minutes}`"
              class="settings-checkbox"
              :data-setting="`calendar.defaultReminders.${minutes}`"
              type="checkbox"
              :checked="settings.calendar.defaultReminders.includes(minutes)"
              :disabled="isLocked('calendar.defaultReminders')"
              @change="toggleReminder(minutes, checkedOf($event))"
            />
            <label :for="`setting-calendar-reminder-${minutes}`">{{
              reminderLabel(minutes)
            }}</label>
            <SettingsLock v-if="isLocked('calendar.defaultReminders')" />
          </div>
        </div>
        <p class="settings-hint">
          {{ $gettext('New events start with these reminders. Each event can change them.') }}
        </p>
      </fieldset>
    </SettingsMore>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * Settings → Calendar — two groups: how the grid looks (`View`, with the rarely
 * changed day start behind "More options") and what a new event starts with
 * (`New events`, with the default reminders behind "More options").
 *
 * Every control writes straight through `useSettings().update()`, so a change is
 * applied optimistically and saved with the store's debounce; an admin-locked path
 * renders disabled with the lock marker. The values are consumed by
 * `views/Calendar.vue` (`settings/calendarViewOptions.ts` for the grid,
 * `useEventForm` defaults) — the grid applies a change live via `ec.setOption`,
 * no re-mount.
 */
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useSettings } from '../../settings/settingsStore'
import { useCalendarChoices } from './useCollectionChoices'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import SettingsMore from './SettingsMore.vue'
import SettingsLock from './SettingsLock.vue'
import { checkedOf, optionalUrl, valueOf } from './settingsForm'
import '../../styles/settings.css'

defineOptions({ name: 'CalendarSettings' })

const { $gettext } = useGettext()
const { settings, update, isLocked } = useSettings()
const { choices } = useCalendarChoices()

const VIEWS = computed(() => [
  { value: 'month', label: $gettext('Month') },
  { value: 'week', label: $gettext('Week') },
  { value: 'day', label: $gettext('Day') },
  { value: 'list', label: $gettext('Agenda') }
])

const WEEK_STARTS = computed(() => [
  { value: 'locale', label: $gettext('According to the region') },
  { value: '1', label: $gettext('Monday') },
  { value: '0', label: $gettext('Sunday') },
  { value: '6', label: $gettext('Saturday') }
])

const weekStartValue = computed(() => String(settings.value.calendar.weekStart))

function parseWeekStart(value: string): number | 'locale' {
  return value === 'locale' ? 'locale' : Number(value)
}

const DURATIONS = [15, 30, 45, 60, 90, 120]

function durationLabel(minutes: number): string {
  if (minutes === 60) return $gettext('1 hour')
  if (minutes % 60 === 0) return $gettext('%{hours} hours', { hours: minutes / 60 })
  if (minutes < 60) return $gettext('%{minutes} minutes', { minutes })
  return $gettext('%{minutes} minutes', { minutes })
}

/** Lead times offered as default reminders (minutes before the start). */
const REMINDERS = [0, 15, 30, 60, 1440]

function reminderLabel(minutes: number): string {
  if (minutes === 0) return $gettext('At the start')
  if (minutes < 60) return $gettext('%{minutes} minutes before', { minutes })
  if (minutes === 60) return $gettext('1 hour before')
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? $gettext('1 day before') : $gettext('%{days} days before', { days })
  }
  return $gettext('%{hours} hours before', { hours: Math.round(minutes / 60) })
}

function toggleReminder(minutes: number, on: boolean): void {
  const current = settings.value.calendar.defaultReminders
  const next = on
    ? [...current, minutes].filter((entry, index, all) => all.indexOf(entry) === index)
    : current.filter((entry) => entry !== minutes)
  update(
    'calendar.defaultReminders',
    next.sort((a, b) => a - b)
  )
}
</script>

<style scoped>
.settings-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-fieldset-title {
  padding: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--oc-role-on-surface, #191c1d);
}
</style>
