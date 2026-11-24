<template>
  <div class="settings-block calendar-tools-card">
    <p class="settings-block-title">{{ $gettext('Calendar (.ics)') }}</p>

    <div class="settings-button-row">
      <select
        v-if="calendars.length > 1"
        v-model="selectedCalendarUrl"
        class="settings-select settings-select--fill"
        :aria-label="$gettext('Calendar')"
      >
        <option v-for="cal in calendars" :key="cal.url" :value="cal.url">
          {{ cal.displayName }}
        </option>
      </select>

      <!-- Import .ics — oc-button triggers a hidden file input -->
      <oc-button appearance="outline" @click="calendarFileInput?.click()">
        <oc-icon name="download" size="small" />
        <span>{{ $gettext('Import .ics') }}</span>
      </oc-button>
      <input
        ref="calendarFileInput"
        type="file"
        accept=".ics,text/calendar"
        class="file-input-hidden"
        @change="importCalendar"
      />

      <!-- Export .ics -->
      <oc-button appearance="outline" @click="exportCalendar">
        <oc-icon name="upload" size="small" />
        <span>{{ $gettext('Export .ics') }}</span>
      </oc-button>
    </div>

    <!-- Import target dialog (shared with the Files app actions) -->
    <ImportDialog
      v-if="showImportDialog"
      kind="calendar"
      :items="importItems"
      :targets="importTargets"
      :initial-target-url="importInitialTargetUrl"
      :suggested-name="importSuggestedName"
      @close="showImportDialog = false"
      @imported="onImported"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Settings → Data → group "Import & export": `.ics` import (verbatim PUT through
 * the shared target dialog) and merged `.ics` export for one calendar.
 *
 * One block of a group, not a card of its own (the group supplies the card and
 * the heading); the calendar selector sits next to the buttons, so the old
 * "Import and export apply to the selected calendar." sentence is gone.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useDAVClient } from '../../composables/useDAVClient'
import { useCalendarService } from '../../composables/useCalendarService'
import {
  collectionSlug,
  mergeIcsForExport,
  type IcsImportItem
} from '../../composables/importExport'
import { useImport, type ImportCounts, type ImportTarget } from '../../composables/useImport'
import ImportDialog from '../ImportDialog.vue'
import '../../styles/settings.css'

defineOptions({ name: 'CalendarToolsCard' })

const props = defineProps<{
  /** Bumped by the Settings page when the collection manager changed something. */
  refreshKey?: number
}>()

const { $gettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()
const { ensureReady } = useDAVClient()
const { calendars, fetchCalendars, fetchEvents } = useCalendarService()
const { prepareImport } = useImport()

const selectedCalendarUrl = ref<string>('')
const calendarFileInput = ref<HTMLInputElement | null>(null)

async function loadCalendars() {
  if (!(await ensureReady('calendar'))) return
  const cals = await fetchCalendars()
  if (!cals.some((c) => c.url === selectedCalendarUrl.value)) {
    selectedCalendarUrl.value = cals[0]?.url || ''
  }
}

onMounted(() => {
  void loadCalendars()
})

watch(
  () => props.refreshKey,
  () => {
    void loadCalendars()
  }
)

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function exportCalendar() {
  const cal = calendars.value.find((c) => c.url === selectedCalendarUrl.value)
  if (!cal) {
    showErrorMessage({ title: $gettext('Calendar service not available') })
    return
  }
  const events = await fetchEvents(cal.url)
  const raws = events.filter((e) => e.rawIcs).map((e) => e.rawIcs!)
  if (raws.length === 0) {
    showMessage({ title: $gettext('Nothing to export') })
    return
  }
  // One VCALENDAR per RFC 5545 — concatenating the stored per-event documents
  // would produce a file many importers truncate to the first block.
  const content = await mergeIcsForExport(raws, cal.displayName)
  downloadFile(content, `${collectionSlug(cal.displayName)}.ics`, 'text/calendar')
}

// ── Import (target dialog + verbatim PUT) ────────────────────────────────────
const showImportDialog = ref(false)
const importItems = ref<IcsImportItem[]>([])
const importSuggestedName = ref('')
const importInitialTargetUrl = ref('')

const importTargets = computed<ImportTarget[]>(() =>
  calendars.value.map((c) => ({ url: c.url, displayName: c.displayName }))
)

async function importCalendar(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''

  const prepared = await prepareImport('calendar', await file.text(), file.name)
  if (!prepared) return
  importItems.value = prepared.items as IcsImportItem[]
  importSuggestedName.value = prepared.suggestedName
  importInitialTargetUrl.value = selectedCalendarUrl.value || calendars.value[0]?.url || ''
  showImportDialog.value = true
}

/** The dialog reports the outcome; refresh the list so the new target shows up. */
async function onImported(counts: ImportCounts) {
  showImportDialog.value = false
  await fetchCalendars()
  const targetUrl = counts.targetUrl
  if (targetUrl && calendars.value.some((c) => c.url === targetUrl)) {
    selectedCalendarUrl.value = targetUrl
  }
}
</script>

<style scoped>
.file-input-hidden {
  display: none;
}
</style>
