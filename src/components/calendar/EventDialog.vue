<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div
        ref="panelRef"
        class="modal-panel modal-panel--event"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
      >
        <div class="modal-header">
          <h2
            id="event-dialog-title"
            class="modal-title"
            :class="{ 'modal-title-preview': preview }"
          >
            {{
              preview
                ? eventForm.title || $gettext('(untitled)')
                : editing
                  ? $gettext('Edit event')
                  : $gettext('New event')
            }}
          </h2>
          <button
            v-if="editing && preview"
            type="button"
            :aria-label="$gettext('Close')"
            class="modal-close"
            @click="emit('close')"
          >
            <oc-icon name="close" size="small" />
          </button>
        </div>

        <form class="modal-form" @submit.prevent="onSubmit">
          <div v-if="!editing && calendars.length > 1" class="form-group">
            <label class="form-label">{{ $gettext('Calendar') }}</label>
            <select v-model="eventForm.calendarUrl" class="form-input">
              <option v-for="cal in calendars" :key="cal.url" :value="cal.url">
                {{ cal.displayName }}
              </option>
            </select>
          </div>

          <oc-text-input
            v-if="!preview"
            v-model="eventForm.title"
            :label="$gettext('Title')"
            required-mark
          />

          <label v-if="!preview" class="form-toggle">
            <input
              v-model="eventForm.allDay"
              type="checkbox"
              class="form-checkbox"
              @change="onAllDayToggle"
            />
            <span>{{ $gettext('All day') }}</span>
          </label>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{ $gettext('Start') }}</label>
              <div class="date-time-row">
                <input
                  v-model="startDate"
                  type="date"
                  required
                  class="form-input"
                  :disabled="preview"
                  @wheel.prevent="onWheelDate('start', $event)"
                />
                <ScrollTime
                  v-if="!eventForm.allDay"
                  v-model="startTime"
                  :disabled="preview"
                  @day-offset="shiftDate('start', $event)"
                />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">{{ $gettext('End') }}</label>
              <div class="date-time-row">
                <input
                  v-model="endDate"
                  type="date"
                  required
                  class="form-input"
                  :min="startDate"
                  :disabled="preview"
                  @wheel.prevent="onWheelDate('end', $event)"
                />
                <ScrollTime
                  v-if="!eventForm.allDay"
                  v-model="endTime"
                  :disabled="preview"
                  @day-offset="shiftDate('end', $event)"
                />
              </div>
              <span v-if="endBeforeStart" class="form-error">{{
                $gettext('End must be after start')
              }}</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ $gettext('Repeat') }}</label>
            <select v-model="eventForm.rrule" class="form-input" :disabled="preview">
              <option value="">{{ $gettext('No repeat') }}</option>
              <option value="FREQ=DAILY">{{ $gettext('Daily') }}</option>
              <option value="FREQ=WEEKLY">{{ $gettext('Weekly') }}</option>
              <option value="FREQ=MONTHLY">{{ $gettext('Monthly') }}</option>
              <option value="FREQ=YEARLY">{{ $gettext('Yearly') }}</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">{{ $gettext('Reminders') }}</label>
            <div v-for="(_, idx) in eventForm.reminders" :key="idx" class="reminder-row">
              <select
                v-model="eventForm.reminders[idx]"
                class="form-input"
                :disabled="preview"
                :aria-label="$gettext('Reminder')"
              >
                <option value="0">{{ $gettext('At time of event') }}</option>
                <option value="5">{{ $gettext('5 minutes before') }}</option>
                <option value="15">{{ $gettext('15 minutes before') }}</option>
                <option value="30">{{ $gettext('30 minutes before') }}</option>
                <option value="60">{{ $gettext('1 hour before') }}</option>
                <option value="1440">{{ $gettext('1 day before') }}</option>
              </select>
              <button
                v-if="!preview"
                type="button"
                class="reminder-remove"
                :aria-label="$gettext('Remove reminder')"
                @click="removeReminder(idx)"
              >
                <oc-icon name="close" size="small" />
              </button>
            </div>
            <p v-if="preview && eventForm.reminders.length === 0" class="reminder-empty">
              {{ $gettext('No reminder') }}
            </p>
            <button v-if="!preview" type="button" class="reminder-add" @click="addReminder">
              <oc-icon name="add" size="small" />
              <span>{{ $gettext('Add reminder') }}</span>
            </button>
          </div>

          <div v-if="preview" class="form-group">
            <label class="form-label">{{ $gettext('Description') }}</label>
            <textarea :value="eventForm.description" class="form-input form-textarea" disabled />
          </div>
          <oc-textarea v-else v-model="eventForm.description" :label="$gettext('Description')" />

          <oc-text-input
            v-model="eventForm.location"
            :label="$gettext('Location')"
            :disabled="preview"
          />

          <!-- ORGANIZER / ATTENDEE are read-only: they belong to the inviting
               client, and `patchIcs` preserves them untouched on save. -->
          <div v-if="hasParticipants(peopleSource)" class="form-group event-people">
            <template v-if="peopleSource.organizer">
              <span id="event-organizer-label" class="form-label">{{ $gettext('Organizer') }}</span>
              <ul class="people-list" aria-labelledby="event-organizer-label">
                <li class="people-item">
                  <span class="people-name">{{ personLabel(peopleSource.organizer) }}</span>
                  <span v-if="peopleSource.organizer.name" class="people-email">
                    {{ peopleSource.organizer.email }}
                  </span>
                </li>
              </ul>
            </template>

            <template v-if="(peopleSource.attendees?.length ?? 0) > 0">
              <span id="event-attendees-label" class="form-label">{{
                $gettext('Participants')
              }}</span>
              <ul class="people-list" aria-labelledby="event-attendees-label">
                <li
                  v-for="(attendee, idx) in peopleSource.attendees"
                  :key="`${attendee.email}-${idx}`"
                  class="people-item"
                >
                  <span class="people-name">{{ personLabel(attendee) }}</span>
                  <span v-if="attendee.name" class="people-email">{{ attendee.email }}</span>
                  <span
                    v-if="statusText(attendee.partstat)"
                    class="people-badge"
                    :class="`people-badge--${participantStatus(attendee.partstat)}`"
                  >
                    {{ statusText(attendee.partstat) }}
                  </span>
                </li>
              </ul>
            </template>

            <p v-if="!preview" class="people-hint">
              {{ $gettext('Participants are managed in the inviting calendar client.') }}
            </p>
          </div>

          <div class="modal-actions">
            <template v-if="editing && preview">
              <oc-button appearance="outline" class="delete-btn" @click.prevent="emit('delete')">
                {{ $gettext('Delete') }}
              </oc-button>
              <div class="spacer" />
              <oc-button appearance="filled" @click.prevent="preview = false">
                {{ $gettext('Edit') }}
              </oc-button>
            </template>
            <template v-else>
              <oc-button
                v-if="editing"
                appearance="outline"
                class="delete-btn"
                @click.prevent="emit('delete')"
              >
                {{ $gettext('Delete') }}
              </oc-button>
              <div class="spacer" />
              <oc-button appearance="outline" @click.prevent="emit('close')">
                {{ $gettext('Cancel') }}
              </oc-button>
              <oc-button
                appearance="filled"
                submit="submit"
                :disabled="endBeforeStart || !eventForm.title.trim()"
              >
                {{ $gettext('Save') }}
              </oc-button>
            </template>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * EventDialog – create / edit / preview modal for calendar events.
 *
 * Purely presentational: the form state and validation live in `useEventForm`,
 * persistence is the page's job. `save` carries the normalised event payload,
 * `delete` and `close` ask the page to do the corresponding DAV call / state
 * change. Existing events open in read-only preview mode; "Edit" switches to the
 * editable form (same flow as before the extraction).
 */
import { computed, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'

import { useModalA11y } from '../../composables/useModalA11y'
import {
  useEventForm,
  type EventFormDefaults,
  type EventFormSeed,
  type EventSavePayload
} from '../../composables/useEventForm'
import {
  hasParticipants,
  participantStatus,
  participantStatusLabel,
  personLabel
} from '../../composables/eventPeople'
import ScrollTime from '../ScrollTime.vue'
import type { CalendarCollection, CalendarEvent, EventAttendee, EventOrganizer } from '../../types'

const { $gettext } = useGettext()

const props = defineProps<{
  open: boolean
  /** Event being edited/previewed (null when creating). */
  event: CalendarEvent | null
  /** Slot for a new event. */
  seed?: EventFormSeed | null
  calendars: CalendarCollection[]
  /**
   * Defaults for a new event from the synced calendar settings
   * (`defaultCalendar`, `defaultDuration`, `defaultReminders`).
   */
  defaults?: EventFormDefaults
}>()

const emit = defineEmits<{
  close: []
  save: [payload: EventSavePayload]
  delete: []
}>()

const editing = computed(() => !!props.event)
const isOpen = computed(() => props.open)
const panelRef = ref<HTMLElement | null>(null)
const preview = ref(false)

/** Participants come from the stored event, never from the form (read-only). */
const peopleSource = computed<{ organizer?: EventOrganizer; attendees?: EventAttendee[] }>(
  () => props.event ?? {}
)

/** Translated text of an attendee's PARTSTAT badge ('' when it has none). */
function statusText(partstat?: string): string {
  return participantStatusLabel(partstat, $gettext)
}

const {
  form: eventForm,
  startDate,
  startTime,
  endDate,
  endTime,
  endBeforeStart,
  onAllDayToggle,
  addReminder,
  removeReminder,
  onWheelDate,
  shiftDate,
  initCreate,
  initFromEvent,
  toSavePayload
} = useEventForm({ isPreview: preview, defaults: () => props.defaults ?? {} })

/**
 * Calendar a new event is created in: the configured default when that calendar
 * still exists, else the first one (a deleted/shared-away collection must not
 * leave the dialog pointing at a URL the server no longer has).
 */
const newEventCalendarUrl = computed(() => {
  const wanted = props.defaults?.calendarUrl
  const existing = wanted ? props.calendars.find((cal) => cal.url === wanted) : undefined
  return existing?.url || props.calendars[0]?.url || ''
})

useModalA11y(panelRef, isOpen, { onClose: () => emit('close') })

// Reset the form whenever the dialog opens (or is pointed at another event).
watch(
  isOpen,
  (open) => {
    if (!open) return
    if (props.event) {
      preview.value = true
      initFromEvent(props.event)
    } else {
      preview.value = false
      initCreate(props.seed ?? {}, newEventCalendarUrl.value)
    }
  },
  { immediate: true }
)

function onSubmit() {
  if (preview.value) return
  if (endBeforeStart.value) return
  if (!eventForm.title.trim()) return
  emit('save', toSavePayload())
}
</script>

<style scoped>
.modal-title {
  font-size: 1.1rem;
  margin: 0;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--oc-role-on-surface-variant, #40484c);
  cursor: pointer;
}
.modal-close:hover,
.modal-close:focus-visible {
  background: var(--oc-role-surface-container-low, #f5f6f8);
  outline: none;
}

.modal-title-preview {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.25;
  word-break: break-word;
}

/* Two date+time columns; the time picker needs room next to the date input. */
.date-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.date-time-row .form-input {
  height: 36px;
  box-sizing: border-box;
  padding-block: 0;
  flex: 1;
  min-width: 0;
}

.reminder-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.reminder-row .form-input {
  flex: 1;
  min-width: 0;
}

.reminder-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface-variant, #40484c);
  cursor: pointer;
}
.reminder-remove:hover,
.reminder-remove:focus-visible {
  border-color: var(--oc-role-error, #ba1a1a);
  color: var(--oc-role-error, #ba1a1a);
  outline: none;
}

.reminder-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-secondary, #20434f);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}
.reminder-add:hover,
.reminder-add:focus-visible {
  border-color: var(--oc-role-secondary, #20434f);
  outline: none;
}

.reminder-empty {
  font-size: 0.85rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

/* Focus ring + disabled look are specific to the event form's plain inputs. */
.form-input:focus {
  box-shadow: 0 0 0 2px var(--oc-role-primary-container, #b7eaff);
}
.form-input:disabled,
.form-checkbox:disabled {
  cursor: default;
  opacity: 0.72;
}

.form-textarea {
  min-height: 92px;
  resize: vertical;
}

.form-toggle {
  font-size: 0.9rem;
}

.delete-btn {
  --oc-color-text-default: var(--oc-role-error, #ba1a1a);
}

/* Organizer / participants — read-only data from the inviting client. */
.people-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.people-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.9rem;
}

.people-name {
  font-weight: 500;
}

.people-email {
  font-size: 0.8rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

/* The status is always spelled out ("Accepted") — the colour only reinforces it. */
.people-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border: 1px solid currentColor;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 600;
}
.people-badge--accepted {
  color: var(--oc-role-success, #1b6b2e);
}
.people-badge--declined {
  color: var(--oc-role-error, #ba1a1a);
}
.people-badge--tentative {
  color: var(--oc-role-warning, #8a5a00);
}
.people-badge--needs-action,
.people-badge--delegated {
  color: var(--oc-role-on-surface-variant, #40484c);
}

.people-hint {
  font-size: 0.8rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}
</style>
