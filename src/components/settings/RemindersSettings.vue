<template>
  <SettingsRow
    :label="$gettext('Show reminders')"
    :hint="$gettext('Reminders are shown while OpenCloud is open in a browser tab.')"
    :locked="locked"
    label-for="setting-reminders-enabled"
  >
    <label class="reminder-toggle">
      <input
        id="setting-reminders-enabled"
        :checked="enabled"
        type="checkbox"
        class="settings-checkbox"
        :disabled="locked"
        @change="onToggle"
      />
    </label>

    <span class="reminder-state">
      {{ $gettext('Desktop notifications: %{state}', { state: permissionLabel }) }}
    </span>

    <!-- The only place in the app that asks for notification permission. -->
    <oc-button
      v-if="permission === 'default'"
      appearance="outline"
      size="small"
      :disabled="requesting"
      @click="allowDesktopNotifications"
    >
      {{ $gettext('Allow desktop notifications') }}
    </oc-button>
  </SettingsRow>
</template>

<script setup lang="ts">
/**
 * Reminder setting (General → group "Reminders") — the toggle plus the desktop
 * notification permission state and its one-time request button, all in one row.
 *
 * Self-contained on purpose: it only takes an `enabled` prop and emits
 * `update:enabled`. It is also the **only** place allowed to call
 * `Notification.requestPermission()` (permission prompts on page load are an
 * anti-goal).
 */
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import {
  notificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState
} from '../../reminders/notify'
import SettingsRow from './SettingsRow.vue'
import '../../styles/settings.css'

defineOptions({ name: 'RemindersSettings' })

const props = defineProps<{
  enabled: boolean
  /** Admin-locked setting: renders read-only. */
  locked?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:enabled', value: boolean): void
}>()

const { $gettext } = useGettext()

const permission = ref<NotificationPermissionState>(notificationPermission())
const requesting = ref(false)

const permissionLabel = computed(() => {
  switch (permission.value) {
    case 'granted':
      return $gettext('Allowed')
    case 'denied':
      return $gettext('Blocked')
    case 'default':
      return $gettext('Not requested yet')
    default:
      return $gettext('Not supported in this browser')
  }
})

/** The browser may have changed the permission while the page was hidden. */
function syncPermission(): void {
  permission.value = notificationPermission()
}

onMounted(syncPermission)

function onToggle(event: Event): void {
  if (props.locked) return
  emit('update:enabled', (event.target as HTMLInputElement).checked)
}

async function allowDesktopNotifications(): Promise<void> {
  if (requesting.value) return
  requesting.value = true
  try {
    permission.value = await requestNotificationPermission()
  } finally {
    requesting.value = false
  }
}
</script>

<style scoped>
.reminder-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface, #191c1d);
  cursor: pointer;
}

.reminder-toggle:has(.settings-checkbox:disabled) {
  cursor: default;
  opacity: 0.7;
}

.reminder-state {
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}
</style>
