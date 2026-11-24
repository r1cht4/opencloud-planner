<template>
  <div class="about-status">
    <dl class="status-rows">
      <div class="status-row">
        <dt class="status-label">{{ $gettext('Connection') }}</dt>
        <dd class="status-value">
          <span class="status-badge" :class="`status-badge--${outcomeTone}`">
            {{ outcomeLabel }}
          </span>
          <code v-if="statusDetail" class="status-code">{{ statusDetail }}</code>
        </dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Account URL') }}</dt>
        <dd class="status-value">
          <code class="status-code">{{ principalUrl || $gettext('Unknown') }}</code>
        </dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Calendars') }}</dt>
        <dd class="status-value">{{ value(counts.calendars) }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Address books') }}</dt>
        <dd class="status-value">{{ value(counts.addressBooks) }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Events (last and next 6 months)') }}</dt>
        <dd class="status-value">{{ value(counts.events) }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Contacts') }}</dt>
        <dd class="status-value">{{ value(counts.contacts) }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Tasks') }}</dt>
        <dd class="status-value">{{ value(counts.tasks) }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Sync status') }}</dt>
        <dd class="status-value">{{ markersLabel }}</dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('App version') }}</dt>
        <dd class="status-value">
          <code class="status-code">{{ APP_VERSION }}</code>
        </dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('OpenCloud version') }}</dt>
        <dd class="status-value">
          <code class="status-code">{{ opencloudVersion || $gettext('Unknown') }}</code>
        </dd>
      </div>

      <div class="status-row">
        <dt class="status-label">{{ $gettext('Last check') }}</dt>
        <dd class="status-value">{{ lastCheckLabel }}</dd>
      </div>
    </dl>

    <p v-if="error" class="status-hint" role="status">
      {{ $gettext('Some values could not be loaded.') }}
      <span class="status-error">{{ error }}</span>
    </p>

    <div class="status-actions">
      <oc-button appearance="outline" size="small" :disabled="loading" @click="refresh">
        <oc-icon name="refresh" size="small" />
        <span>{{ loading ? $gettext('Checking…') : $gettext('Refresh') }}</span>
      </oc-button>

      <oc-button appearance="outline" size="small" @click="copyDiagnostics">
        <oc-icon name="file-copy" size="small" />
        <span>{{ $gettext('Copy diagnostics') }}</span>
      </oc-button>

      <p v-if="copyState" class="status-hint" role="status">{{ copyState }}</p>
    </div>

    <details class="status-report">
      <summary class="status-report-summary">{{ $gettext('Show diagnostics') }}</summary>
      <pre class="status-report-text">{{ diagnosticsText }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { propfind, useDAVClient } from '../../composables/useDAVClient'
import { CHANGE_MARKER_PROPS, parseChangeMarker } from '../../composables/useCollectionSync'
import { useCalendarService, type TimeRange } from '../../composables/useCalendarService'
import { useContactsService } from '../../composables/useContactsService'
import { useTasksService } from '../../composables/useTasksService'
import { useConnectionProbe } from '../../composables/useConnectionProbe'
import { probeOutcomeLabel } from '../../setup/connection'
import { APP_VERSION, buildDiagnostics } from '../../setup/diagnostics'

/**
 * About/Status – what is the app talking to, how much is there, which versions.
 *
 * Self-contained: it re-probes the DAV endpoint and counts collections/items on
 * mount (and on "Refresh"), so it works from any page — including when the views
 * are showing the setup state. Counts are read through the service layer, so a
 * collection that fails is reported instead of crashing the page.
 */

defineOptions({ name: 'AboutStatus' })

/** Same window the views load (view ±6 months); keeps the count honest. */
const COUNT_RANGE_MONTHS = 6

const { $gettext } = useGettext()
const { outcome, lastResult, retest } = useConnectionProbe()

const calendarService = useCalendarService()
const contactsService = useContactsService()
const tasksService = useTasksService()
const { getState } = useDAVClient()

const counts = reactive<{
  calendars: number | null
  addressBooks: number | null
  events: number | null
  contacts: number | null
  tasks: number | null
}>({
  calendars: null,
  addressBooks: null,
  events: null,
  contacts: null,
  tasks: null
})

const markers = reactive({ answered: 0, total: 0 })
const opencloudVersion = ref('')
const lastCheck = ref<number | null>(null)
const loading = ref(false)
const error = ref('')
const copyState = ref('')

const principalUrl = computed(() => getState('calendar')?.principalUrl || '')

const outcomeLabel = computed(() => probeOutcomeLabel(outcome.value, $gettext))

const statusDetail = computed(() => lastResult.value?.detail || '')

const outcomeTone = computed(() => {
  if (outcome.value === 'ok') return 'ok'
  if (outcome.value === 'pending') return 'pending'
  if (outcome.value === 'not-configured' || outcome.value === 'unavailable') return 'warn'
  return 'error'
})

const markersLabel = computed(() => {
  if (markers.total === 0) return $gettext('Unknown')
  return $gettext('%{answered} of %{total} calendars and address books answered', {
    answered: markers.answered,
    total: markers.total
  })
})

const lastCheckLabel = computed(() =>
  lastCheck.value === null
    ? $gettext('Not checked yet')
    : new Date(lastCheck.value).toLocaleString()
)

const diagnosticsText = computed(() =>
  buildDiagnostics({
    outcome: outcome.value,
    status: lastResult.value?.status,
    detail: lastResult.value?.detail,
    principal: principalUrl.value,
    opencloudVersion: opencloudVersion.value,
    calendars: counts.calendars,
    addressBooks: counts.addressBooks,
    events: counts.events,
    contacts: counts.contacts,
    tasks: counts.tasks,
    lastCheck: lastCheck.value
  })
)

function value(count: number | null): string {
  return count === null ? $gettext('Unknown') : String(count)
}

function countRange(): TimeRange {
  const now = new Date()
  const start = new Date(now)
  start.setMonth(start.getMonth() - COUNT_RANGE_MONTHS)
  const end = new Date(now)
  end.setMonth(end.getMonth() + COUNT_RANGE_MONTHS)
  return { start, end }
}

function resetCounts(): void {
  counts.calendars = null
  counts.addressBooks = null
  counts.events = null
  counts.contacts = null
  counts.tasks = null
  markers.answered = 0
  markers.total = 0
}

/**
 * Change markers (ctag/sync-token) per collection: the quiet signal that tells
 * the views whether another client changed something. `answered` counts the
 * collections that expose one — a server without markers still works, it just
 * polls blindly.
 */
async function countSyncMarkers(urls: string[]): Promise<void> {
  markers.total = urls.length
  markers.answered = 0
  for (const url of urls) {
    try {
      const xml = await propfind(url, CHANGE_MARKER_PROPS, '0')
      if (parseChangeMarker(xml, url)) markers.answered++
    } catch {
      /* no marker on this collection — not an error worth reporting */
    }
  }
}

async function loadCounts(): Promise<void> {
  const range = countRange()

  const calendars = await calendarService.fetchCalendars()
  counts.calendars = calendars.length
  let events = 0
  for (const calendar of calendars) {
    events += (await calendarService.fetchEvents(calendar.url, range)).length
  }
  counts.events = events

  const books = await contactsService.fetchAddressBooks()
  counts.addressBooks = books.length
  let contacts = 0
  for (const book of books) {
    contacts += (await contactsService.fetchContacts(book.url)).length
  }
  counts.contacts = contacts

  await tasksService.fetchCalendars()
  counts.tasks = (await tasksService.fetchTasks()).length

  await countSyncMarkers([...calendars.map((c) => c.url), ...books.map((b) => b.url)])

  const failures = [
    calendarService.error.value,
    contactsService.error.value,
    tasksService.error.value
  ].filter(Boolean)
  if (failures.length > 0) error.value = failures.join(' ')
}

async function loadOpenCloudVersion(): Promise<void> {
  try {
    const resp = await fetch(`${window.location.origin}/status.php`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    })
    if (!resp.ok) return
    const data = (await resp.json()) as { productversion?: string }
    opencloudVersion.value = data.productversion || ''
  } catch {
    /* status.php is a convenience; the page works without it */
  }
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  copyState.value = ''
  try {
    await retest()
    // The check itself happened, whatever it found.
    lastCheck.value = Date.now()
    if (outcome.value !== 'ok') {
      // Nothing to count while the backend is down — keep the page honest.
      resetCounts()
      return
    }
    await loadCounts()
    await loadOpenCloudVersion()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function copyDiagnostics(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(diagnosticsText.value)
    copyState.value = $gettext('Diagnostics copied')
  } catch {
    // No clipboard (insecure context, denied permission): the report is also
    // rendered below and can be selected by hand.
    copyState.value = $gettext('Press Ctrl+C to copy the selected text.')
  }
}

onMounted(refresh)
</script>

<style scoped>
/* No card chrome: the status list is the content of the About group card. */
.about-status {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.status-rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.875rem;
}

.status-label {
  min-width: 15rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.status-value {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--oc-role-on-surface, #191c1d);
}

.status-code {
  font-family: var(--oc-font-family-monospace, monospace);
  font-size: 0.8125rem;
  word-break: break-all;
}

.status-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid currentColor;
}

.status-badge--ok {
  color: var(--oc-role-success, #1a7f37);
}

.status-badge--warn {
  color: var(--oc-role-warning, #8a5b00);
}

.status-badge--error {
  color: var(--oc-role-error, #b3261e);
}

.status-badge--pending {
  color: var(--oc-role-on-surface-variant, #40484c);
}

.status-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.status-error {
  color: var(--oc-role-error, #b3261e);
}

.status-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.status-report summary {
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface, #191c1d);
}

.status-report-text {
  margin: 8px 0 0;
  padding: 8px 10px;
  background: var(--oc-role-surface, #fbfcfe);
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  font-family: var(--oc-font-family-monospace, monospace);
  font-size: 0.75rem;
  overflow-x: auto;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .status-label {
    min-width: 0;
    width: 100%;
  }
}
</style>
