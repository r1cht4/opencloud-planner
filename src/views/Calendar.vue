<template>
  <main class="calendar-page">
    <ConnectionGate>
      <div class="toolbar">
        <div class="page-title-row">
          <h1 class="page-title">{{ $gettext('Calendar') }}</h1>
          <PageHeaderActions />
        </div>

        <div class="toolbar-actions">
          <EventSearch :events="searchableEvents" :calendars="calendars" @select="onSearchSelect" />

          <input
            type="date"
            class="date-nav-input"
            :aria-label="$gettext('Go to date')"
            :value="navDate"
            @change="onDateNavChange"
          />

          <oc-button appearance="filled" @click="openCreateDialog()">
            <oc-icon name="add" size="small" />
            <span>{{ $gettext('New event') }}</span>
          </oc-button>
        </div>

        <div v-if="calendars.length > 0" class="calendar-chips">
          <button
            v-for="cal in calendars"
            :key="cal.url"
            class="calendar-chip"
            :class="{ 'calendar-chip--hidden': !visibleCalendars.has(cal.url) }"
            :aria-label="cal.displayName"
            :aria-pressed="visibleCalendars.has(cal.url)"
            :title="cal.displayName"
            @click="toggleCalendarVisibility(cal.url)"
          >
            <span class="calendar-chip-dot" :style="{ backgroundColor: cal.color }" />
            <span class="calendar-chip-label">{{ cal.displayName }}</span>
          </button>
        </div>
      </div>

      <div v-if="!initialized && loading" class="empty-state">
        <oc-spinner size="medium" />
        <span>{{ $gettext('Loading calendar...') }}</span>
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

      <div v-show="initialized" class="calendar-container">
        <div class="calendar-wrapper">
          <div ref="calendarEl" class="ec-calendar" />
        </div>
      </div>

      <EventDialog
        :open="showDialog"
        :event="editingEvent"
        :seed="createSeed"
        :calendars="calendars"
        :defaults="eventDefaults"
        @close="closeDialog"
        @save="onSaveEvent"
        @delete="onDeleteEvent"
      />

      <MoveConfirmDialog
        :move="moveConfirm"
        :saving="moveSaving"
        @cancel="cancelMove"
        @confirm="confirmMove"
      />

      <RecurrenceScopeDialog
        :mode="recurrenceChoice?.mode ?? null"
        @select="resolveRecurrenceChoice"
        @cancel="cancelRecurrenceChoice"
      />

      <StackPopover
        v-if="stackPopover"
        :events="stackPopover.events"
        :x="stackPopover.x"
        :y="stackPopover.y"
        @select="onStackSelect"
        @hover-start="cancelStackClose"
        @hover-end="scheduleStackClose"
      />
    </ConnectionGate>
  </main>
</template>

<script setup lang="ts">
/**
 * CalendarView – page shell for the calendar.
 *
 * The page is wiring-only: the grid lives in `useCalendarGrid`, the DAV
 * lifecycle in `useCalendarEvents` and the dialog/write logic (incl. the
 * recurring-series scope handling) in `useEventActions`. The dialog UI
 * itself lives in `src/components/calendar/`, the event form state in
 * `useEventForm`, colour helpers in `colorUtils` and the grid's
 * @event-calendar overrides in `styles/calendar-grid.css`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useRoute } from '@opencloud-eu/web-pkg'

import { useCalendarEvents } from '../composables/useCalendarEvents'
import { useCalendarGrid, type EventDragRequest } from '../composables/useCalendarGrid'
import { useEventActions } from '../composables/useEventActions'
import { mapDavError } from '../composables/davErrorMessages'
import { isBirthdayEvent } from '../composables/calendarViewUtils'
import { formatDate } from '../ics/datetime'
import type { EventFormDefaults } from '../composables/useEventForm'
import { useSettings } from '../settings/settingsStore'
import { useFormatLocale } from '../settings/formatLocale'
import {
  buildCalendarSettingsOptions,
  type CalendarSettingsOptions
} from '../settings/calendarViewOptions'
import { preferredCollectionUrl } from '../settings/collectionDefaults'
import { openQueryHref, sameResourceHref } from '../setup/openQuery'
import ConnectionGate from '../components/ConnectionGate.vue'
import EventDialog from '../components/calendar/EventDialog.vue'
import EventSearch from '../components/calendar/EventSearch.vue'
import MoveConfirmDialog from '../components/calendar/MoveConfirmDialog.vue'
import RecurrenceScopeDialog from '../components/calendar/RecurrenceScopeDialog.vue'
import StackPopover from '../components/calendar/StackPopover.vue'
import PageHeaderActions from '../components/PageHeaderActions.vue'
import type { CalendarEvent } from '../types'
import '@event-calendar/core/index.css'
import '../styles/modal.css'
import '../styles/calendar-grid.css'

defineOptions({ name: 'CalendarView' })

const { $gettext } = useGettext()
const { showMessage } = useMessages()
const route = useRoute()
const { settings } = useSettings()

const visibleCalendars = ref<Set<string>>(new Set())

/** Value of the "jump to date" field — always the grid's current date, so the
 *  native date input never shows an empty `mm/dd/yyyy` placeholder. */
const navDate = ref(formatDate(new Date()))

// Texts follow the OpenCloud language, date/time formats the region (see formatLocale.ts).
const formatLocale = useFormatLocale()

function getCalendarLocale(): string {
  return formatLocale.value
}

/** Grid options from the synced `calendar.*` settings (view, day start, week start/numbers, weekends). */
function currentViewOptions(): CalendarSettingsOptions {
  return buildCalendarSettingsOptions(settings.value.calendar, getCalendarLocale())
}

const data = useCalendarEvents({ birthdayCalendarName: () => $gettext('Birthdays') })
const { calendars, events, initialized, loading, error } = data

/** The service's English error strings are mapped to translated messages. */
const errorMessage = computed(() => mapDavError(error.value, $gettext))

/** Reload the events and push them into the running grid. */
async function refresh(onlyUrls?: string[]) {
  await data.refreshCalendarEvents(onlyUrls)
  grid.setEvents(events.value)
}

const actions = useEventActions({
  calendars,
  events,
  rawEvents: data.rawEvents,
  error,
  refresh,
  markSynced: data.markSynced,
  getLocale: getCalendarLocale,
  onBirthdayGuard: () =>
    showMessage({
      title: $gettext(
        'Birthdays are managed in the contact. Edit the birth date there and re-sync.'
      )
    })
})

const grid = useCalendarGrid({
  getLocale: getCalendarLocale,
  getViewOptions: currentViewOptions,
  buildOptions: () => ({
    ...currentViewOptions(),
    locale: getCalendarLocale(),
    buttonText: {
      dayGridMonth: $gettext('Month'),
      timeGridWeek: $gettext('Week'),
      timeGridDay: $gettext('Day'),
      listWeek: $gettext('Agenda'),
      today: $gettext('Today')
    }
  }),
  getCalendars: () => calendars.value,
  getVisible: () => visibleCalendars.value,
  getEvents: () => events.value,
  openEvent: (event) => {
    if (isBirthdayEvent(event)) {
      showMessage({
        title: $gettext(
          'Birthdays are managed in the contact. Edit the birth date there and re-sync.'
        )
      })
      return
    }
    actions.openEditDialog(event)
  },
  onEventDrag: (drag: EventDragRequest) => void actions.onEventDrag(drag),
  onDateClick: (start, end, allDay) => actions.openCreateDialog(start, end, allDay),
  onDateSelect: (start, end, allDay) => actions.openCreateDialog(start, end, allDay),
  onDatesSet: (range) => {
    navDate.value = formatDate(range.start)
    void data.handleDatesSet(range)
  }
})
const { calendarEl, stackPopover, cancelStackClose, scheduleStackClose, hideStackPopover } = grid

// A settings change is diffed into the running grid (never a re-mount), so the
// visible date and an open dialog survive.
watch(
  [() => settings.value.calendar, formatLocale],
  () => grid.applyViewOptions(currentViewOptions()),
  { deep: true }
)

// Every event reload (initial load, poll, own write) is pushed into the grid.
watch(events, (list) => grid.setEvents(list))

/** Defaults for a **new** event: `defaultCalendar` (while it exists), `defaultDuration`, `defaultReminders`. */
const eventDefaults = computed<EventFormDefaults>(() => ({
  calendarUrl: preferredCollectionUrl(settings.value.calendar.defaultCalendar, calendars.value),
  durationMinutes: settings.value.calendar.defaultDuration,
  reminders: settings.value.calendar.defaultReminders
}))

onMounted(async () => {
  await data.loadInitial()
  visibleCalendars.value = new Set(calendars.value.map((c) => c.url))
  grid.initCalendar(events.value)
  openItemFromQuery()
})

function toggleCalendarVisibility(url: string) {
  const s = new Set(visibleCalendars.value)
  if (s.has(url)) s.delete(url)
  else s.add(url)
  visibleCalendars.value = s
  grid.setEvents(events.value)
}

function onDateNavChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.value) return
  jumpTo(input.value)
}

/** Move the grid to a date and keep the date field in sync with it. */
function jumpTo(date: string) {
  navDate.value = date
  grid.setDate(date)
}

/** Search input source: the loaded REPORT window, visible calendars only. */
const searchableEvents = computed(() =>
  events.value.filter((e) => visibleCalendars.value.has(e.calendarId))
)

/**
 * Jump to a search result: move the grid to the event's date (the same
 * `setOption('date', …)` call the date picker uses) and open its preview.
 * Birthday events are generated from contacts, so they only navigate.
 */
function onSearchSelect(event: CalendarEvent) {
  jumpTo(event.start.slice(0, 10))
  if (isBirthdayEvent(event)) {
    showMessage({
      title: $gettext(
        'Birthdays are managed in the contact. Edit the birth date there and re-sync.'
      )
    })
    return
  }
  actions.openEditDialog(event)
}

function onStackSelect(event: CalendarEvent) {
  actions.openStackedEvent(event, hideStackPopover)
}

/**
 * `?open=<href>` — entered from a reminder/notification click (`src/index.ts`
 * pushes the calendar with the resource URL). Jump to the event's date and open
 * its preview. Runs once per query value, so closing the dialog does not reopen
 * it and the poll below is not disturbed.
 */
let openedFromQuery: string | null = null

function openItemFromQuery(): void {
  const wanted = openQueryHref(route.value?.query)
  if (!wanted || !initialized.value || openedFromQuery === wanted) return
  const event = events.value.find(
    (entry) => sameResourceHref(entry.href, wanted) || entry.id === wanted
  )
  if (!event) return
  openedFromQuery = wanted
  jumpTo(event.start.slice(0, 10))
  if (isBirthdayEvent(event)) {
    showMessage({
      title: $gettext(
        'Birthdays are managed in the contact. Edit the birth date there and re-sync.'
      )
    })
    return
  }
  actions.openEditDialog(event)
}

watch(
  () => route.value?.query?.open,
  () => {
    openedFromQuery = null
    openItemFromQuery()
  }
)

const {
  showDialog,
  editingEvent,
  createSeed,
  recurrenceChoice,
  moveConfirm,
  moveSaving,
  resolveRecurrenceChoice,
  cancelRecurrenceChoice,
  openCreateDialog,
  closeDialog,
  cancelMove,
  confirmMove,
  onSaveEvent,
  onDeleteEvent
} = actions
</script>

<style scoped>
.calendar-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
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

/* Title on its own row; below it the calendar chips (left) and the actions
   (right) share one row directly above the grid. The actions keep one order —
   search, date field, New event (rightmost) — and wrap as a group when the chips need the
   room. DOM order stays title → actions → chips for the tab order. */
.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-inline-start: auto;
  order: 2;
}

/* "New event" as tall as the search field and the date input next to it; the
   button would otherwise size to its font. 32px looks level with the 33px
   fields (their border is drawn inside, the button's fill reaches the edge). */
.toolbar-actions > .oc-button {
  height: 32px;
  box-sizing: border-box;
}

.calendar-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1 1 0;
  min-width: 0;
  order: 1;
}

.calendar-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 16px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    opacity 0.15s,
    border-color 0.15s;
  user-select: none;
}
.calendar-chip:hover {
  border-color: var(--oc-role-outline, #6f797d);
}
.calendar-chip--hidden {
  opacity: 0.4;
}
.calendar-chip-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.calendar-chip-label {
  white-space: nowrap;
}

/* The "jump to date" control: one native date input (its own picker icon is
   the single affordance), always showing the grid's current date. */
.date-nav-input {
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  display: block;
  padding: 2px 8px;
  height: 33px;
  box-sizing: border-box;
  font-size: 0.8rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  cursor: pointer;
}
.date-nav-input:focus {
  outline: none;
  border-color: var(--oc-role-secondary, #20434f);
}
.date-nav-input::-webkit-calendar-picker-indicator {
  cursor: pointer;
  opacity: 0.75;
}

.empty-state {
  display: flex;
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
  font-size: 0.9rem;
}
.error-hint {
  font-size: 0.75rem;
  margin-top: 4px;
  opacity: 0.8;
}

.calendar-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.calendar-wrapper {
  width: 100%;
  height: 100%;
}
.ec-calendar {
  width: 100%;
  height: 100%;
}

@media (max-width: 640px) {
  .calendar-page {
    padding: 8px;
  }

  .toolbar {
    align-items: center;
  }

  .calendar-chips {
    justify-content: center;
  }

  .toolbar-actions {
    width: 100%;
    margin-inline-start: 0;
    padding-inline: 8px;
    box-sizing: border-box;
    justify-content: space-between;
  }
}
</style>
