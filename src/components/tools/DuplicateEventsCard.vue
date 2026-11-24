<!--
  DuplicateEventsCard – the duplicate cleanup block of Settings → Data → Clean up.

  Self-contained: no props, one event.
    props:  none
    emits:  `deleted` {deleted, failed} — duplicates were removed (host may refresh)

  Shows a calendar selector (hidden when only one calendar exists) and a
  **Find duplicates** button: the card loads that calendar's events, runs
  `findDuplicateEvents` and opens `DuplicateEventsDialog` with the groups.
-->
<template>
  <div class="settings-block duplicate-events-card">
    <p class="settings-block-title">{{ $gettext('Duplicate events') }}</p>

    <div class="settings-button-row">
      <select
        v-if="calendars.length > 1"
        v-model="selectedUrl"
        class="settings-select settings-select--grow"
        :aria-label="$gettext('Calendar')"
      >
        <option v-for="calendar in calendars" :key="calendar.url" :value="calendar.url">
          {{ calendar.displayName }}
        </option>
      </select>

      <oc-button appearance="outline" :disabled="busy || !selectedUrl" @click="findDuplicates">
        <oc-icon name="search" size="small" />
        <span>{{ $gettext('Find duplicates') }}</span>
      </oc-button>
    </div>

    <p v-if="busy" class="settings-hint" role="status">{{ $gettext('Searching…') }}</p>

    <DuplicateEventsDialog
      v-if="groups.length"
      :groups="groups"
      :calendar-name="selectedName"
      @close="groups = []"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useCalendarService } from '../../composables/useCalendarService'
import { findDuplicateEvents, type DuplicateGroup } from '../../tools/eventDuplicates'
import DuplicateEventsDialog from './DuplicateEventsDialog.vue'
import '../../styles/settings.css'

defineOptions({ name: 'DuplicateEventsCard' })

const emit = defineEmits<{ deleted: [counts: { deleted: number; failed: number }] }>()

const { $gettext, $ngettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()
const { calendars, fetchCalendars, fetchEvents } = useCalendarService()

const selectedUrl = ref('')
const groups = ref<DuplicateGroup[]>([])
const busy = ref(false)

const selectedName = computed(
  () => calendars.value.find((calendar) => calendar.url === selectedUrl.value)?.displayName ?? ''
)

onMounted(async () => {
  const cals = await fetchCalendars()
  selectedUrl.value = cals[0]?.url ?? ''
})

async function findDuplicates() {
  if (busy.value || !selectedUrl.value) return
  busy.value = true
  groups.value = []
  try {
    const events = await fetchEvents(selectedUrl.value)
    const found = findDuplicateEvents(events)
    if (!found.length) {
      showMessage({ title: $gettext('No duplicate events found') })
      return
    }
    groups.value = found
  } catch (err) {
    console.warn('[planner] duplicate search failed:', err)
    showErrorMessage({ title: $gettext('Could not search for duplicate events') })
  } finally {
    busy.value = false
  }
}

function onDeleted(counts: { deleted: number; failed: number }) {
  groups.value = []
  const parts: string[] = []
  if (counts.deleted > 0) {
    parts.push(
      $ngettext('%{count} event deleted', '%{count} events deleted', counts.deleted, {
        count: counts.deleted
      })
    )
  }
  if (counts.failed > 0) {
    parts.push(
      $ngettext('%{count} event failed', '%{count} events failed', counts.failed, {
        count: counts.failed
      })
    )
  }

  if (counts.deleted === 0 && counts.failed > 0) {
    showErrorMessage({ title: parts.join(', ') || $gettext('Could not delete the duplicates') })
  } else {
    showMessage({ title: parts.join(', ') || $gettext('No duplicate events found') })
  }
  emit('deleted', counts)
}
</script>

<style scoped></style>
