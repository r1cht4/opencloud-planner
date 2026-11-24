<template>
  <ConnectionGate>
    <SettingsSection
      :title="$gettext('Calendars & address books')"
      :hint="
        $gettext(
          'Create, rename, color and delete your calendars and address books. Changes apply immediately on the server.'
        )
      "
      wide
    >
      <CollectionsCard @changed="emit('changed')" />
    </SettingsSection>

    <SettingsSection :title="$gettext('Import & export')" wide>
      <div class="settings-blocks">
        <CalendarToolsCard :refresh-key="refreshKey" />
        <ContactsToolsCard part="import" :refresh-key="refreshKey" @changed="emit('changed')" />
        <ContactsCsvCard @changed="emit('changed')" />
      </div>
    </SettingsSection>

    <SettingsSection :title="$gettext('Backup & restore')">
      <BackupCard @restored="emit('changed')" />
    </SettingsSection>

    <!-- Rarely needed and destructive: the whole group starts collapsed. -->
    <SettingsSection :title="$gettext('Clean up')" collapsible>
      <div class="settings-blocks settings-blocks--column">
        <DuplicateEventsCard @deleted="emit('changed')" />
        <ContactsToolsCard part="cleanup" :refresh-key="refreshKey" @changed="emit('changed')" />
      </div>
    </SettingsSection>
  </ConnectionGate>
</template>

<script setup lang="ts">
/**
 * Settings → Data — everything that moves or repairs data, grouped by job:
 * collections (which calendars/address books exist), import & export, backup &
 * restore and the collapsed clean-up actions.
 *
 * All of it talks DAV, so the whole tab sits behind `<ConnectionGate>`: without a
 * backend the gate explains why instead of showing seven failing cards.
 */
import { useGettext } from 'vue3-gettext'
import ConnectionGate from '../ConnectionGate.vue'
import SettingsSection from './SettingsSection.vue'
import CollectionsCard from '../CollectionsCard.vue'
import CalendarToolsCard from '../tools/CalendarToolsCard.vue'
import ContactsToolsCard from '../tools/ContactsToolsCard.vue'
import ContactsCsvCard from '../tools/ContactsCsvCard.vue'
import BackupCard from '../tools/BackupCard.vue'
import DuplicateEventsCard from '../tools/DuplicateEventsCard.vue'

defineOptions({ name: 'DataSettings' })

defineProps<{
  /** Bumped by the Settings page when a tool changed a collection. */
  refreshKey?: number
}>()

const emit = defineEmits<{ changed: [] }>()

const { $gettext } = useGettext()
</script>
