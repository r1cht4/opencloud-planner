<template>
  <SettingsSection :title="$gettext('Birthdays')">
    <SettingsRow
      :label="$gettext('Create birthday events from contacts')"
      :locked="isLocked('birthdays.enabled')"
      label-for="setting-birthdays-enabled"
    >
      <input
        id="setting-birthdays-enabled"
        class="settings-checkbox"
        data-setting="birthdays.enabled"
        type="checkbox"
        :checked="settings.birthdays.enabled"
        :disabled="isLocked('birthdays.enabled')"
        @change="update('birthdays.enabled', checkedOf($event))"
      />
    </SettingsRow>

    <!-- Where and how: only meaningful while the events are generated. -->
    <template v-if="settings.birthdays.enabled">
      <SettingsRow
        :label="$gettext('Birthday calendar')"
        :hint="$gettext('Where the generated birthday events are stored.')"
        :locked="isLocked('birthdays.calendar')"
        label-for="setting-birthdays-calendar"
      >
        <select
          id="setting-birthdays-calendar"
          class="settings-select"
          data-setting="birthdays.calendar"
          :value="settings.birthdays.calendar ?? ''"
          :disabled="isLocked('birthdays.calendar')"
          @change="update('birthdays.calendar', optionalUrl($event))"
        >
          <option value="">{{ $gettext('Own “Birthdays” calendar') }}</option>
          <option v-for="calendar in choices" :key="calendar.url" :value="calendar.url">
            {{ calendar.displayName }}
          </option>
        </select>
      </SettingsRow>

      <SettingsRow
        :label="$gettext('Birthday reminder')"
        :hint="
          $gettext('Birthday events are all-day events, so reminders fire in the morning (09:00).')
        "
        :locked="isLocked('birthdays.reminder')"
        label-for="setting-birthdays-reminder"
      >
        <select
          id="setting-birthdays-reminder"
          class="settings-select"
          data-setting="birthdays.reminder"
          :value="reminderValue"
          :disabled="isLocked('birthdays.reminder')"
          @change="update('birthdays.reminder', parseReminder(valueOf($event)))"
        >
          <option v-for="option in REMINDER_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </SettingsRow>

      <!-- The birthday events are derived from the contacts: this is the only
           place to refresh them on demand (Data → Clean up no longer has it). -->
      <SettingsRow
        :label="$gettext('Birthdays in the calendar')"
        :hint="
          $gettext('Writes the birthday events of your contacts into the calendar right away.')
        "
      >
        <oc-button
          appearance="outline"
          data-action="sync-birthdays"
          :disabled="syncing"
          @click="syncNow"
        >
          <oc-icon name="refresh" size="small" />
          <span>{{ $gettext('Sync now') }}</span>
        </oc-button>
      </SettingsRow>
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * Settings → Contacts → group "Birthdays": enable the derived birthday calendar,
 * pick the target calendar, the reminder lead time and refresh it on demand
 * ("Sync now").
 *
 * The calendar and reminder rows only exist while birthdays are enabled (`v-if`):
 * a disabled switch makes both meaningless, and hiding them keeps the group one
 * row tall for the common case.
 *
 * All three values live in the synced document (`birthdays.*`) and are read by
 * `composables/useBirthdaySync.ts`: `enabled` gates the auto-sync, `calendar` is
 * the collection the events are reconciled into (`Own “Birthdays” calendar` clears
 * the key and keeps the app's own `birthdays/` collection) and `reminder` maps to
 * one DISPLAY VALARM per birthday event (see `settings/birthdayReminder.ts`).
 */
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useSettings } from '../../settings/settingsStore'
import { useBirthdaySync, type ReconcileResult } from '../../composables/useBirthdaySync'
import { useCalendarChoices } from './useCollectionChoices'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import { checkedOf, optionalUrl, parseReminder, valueOf } from './settingsForm'
import '../../styles/settings.css'

defineOptions({ name: 'BirthdaysSettings' })

const { $gettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()
const { settings, update, isLocked } = useSettings()
const { choices } = useCalendarChoices()
const { syncing, reconcile } = useBirthdaySync()

/**
 * Run the reconcile now (it is idempotent: it creates, updates and prunes only
 * what changed) and report the outcome like the tool it replaced.
 */
async function syncNow(): Promise<void> {
  const result: ReconcileResult | null = await reconcile({
    calendarName: $gettext('Birthdays')
  })
  if (!result) {
    showErrorMessage({ title: $gettext('Calendar service not available') })
    return
  }
  if (result.created + result.updated + result.removed > 0) {
    showMessage({ title: $gettext('Birthdays synced') })
  } else {
    showMessage({ title: $gettext('All birthdays already synced') })
  }
}

const REMINDER_OPTIONS = computed(() => [
  { value: 'none', label: $gettext('No reminder') },
  { value: '0', label: $gettext('At 09:00 on the birthday') },
  { value: '60', label: $gettext('1 hour before') },
  { value: '1440', label: $gettext('1 day before') }
])

const reminderValue = computed(() => {
  const minutes = settings.value.birthdays.reminder
  return typeof minutes === 'number' ? String(minutes) : 'none'
})
</script>
