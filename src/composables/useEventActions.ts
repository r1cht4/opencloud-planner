/**
 * useEventActions – the Calendar page's dialog + write logic.
 *
 * Extracted from `views/Calendar.vue`: the event dialog state, the
 * recurrence-scope question and the save/delete/move persistence.
 *
 * Editing or dragging ONE occurrence of a recurring series
 * asks the RecurrenceScopeDialog first; scope "single" writes a
 * RECURRENCE-ID override (`upsertRecurrenceOverrideIcs`), scope "series"
 * shifts the whole master by the occurrence's delta (`shiftSeriesTimes`), so
 * the series keeps its history. Unchanged times leave the master's DTSTART/
 * DTEND values untouched.
 *
 * Service error strings are mapped to translated messages
 * (`davErrorMessages`) before they reach a toast.
 */

import { ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useModals } from '@opencloud-eu/web-pkg'
import {
  addExdateToIcs,
  upsertRecurrenceOverrideIcs,
  useCalendarService
} from './useCalendarService'
import { isConflictErrorMessage, mapDavError } from './davErrorMessages'
import { shiftSeriesTimes } from '../ics/seriesEdit'
import { formatMoveDetails, isBirthdayEvent } from './calendarViewUtils'
import { refreshReminders } from '../setup/reminders'
import type { EventFormSeed, EventSavePayload } from './useEventForm'
import type { CalendarEvent, EventMoveInfo, RecurrenceScope } from '../types'
import type { EventDragRequest } from './useCalendarGrid'

/** Recurrence-scope dialog modes (the dialog renders one title/text per mode). */
export type RecurrenceDialogMode = 'save' | 'delete' | 'move'

export interface UseEventActionsOptions {
  calendars: import('vue').Ref<import('../types').CalendarCollection[]>
  events: import('vue').Ref<CalendarEvent[]>
  rawEvents: import('vue').Ref<CalendarEvent[]>
  error: import('vue').Ref<string | null>
  /** Reload the events (and the grid) after a write. */
  refresh: (onlyUrls?: string[]) => Promise<void>
  /** Re-read the change markers of the written calendar. */
  markSynced: (urls: string[]) => Promise<void>
  getLocale: () => string
  /** Show the "birthdays are managed in the contact" message. */
  onBirthdayGuard: () => void
}

export function useEventActions(opts: UseEventActionsOptions) {
  const { $gettext } = useGettext()
  const { showMessage, showErrorMessage } = useMessages()
  const { dispatchModal } = useModals()
  const { createEvent, updateEvent, updateEventIcs, deleteEvent } = useCalendarService()

  const showDialog = ref(false)
  const editingEvent = ref<CalendarEvent | null>(null)
  const createSeed = ref<EventFormSeed | null>(null)
  const recurrenceChoice = ref<{
    mode: RecurrenceDialogMode
    resolve: (scope: RecurrenceScope | null) => void
  } | null>(null)
  const moveConfirm = ref<EventMoveInfo | null>(null)
  /** Scope chosen for a pending move of a recurring occurrence. */
  const moveScope = ref<RecurrenceScope | null>(null)
  const moveSaving = ref(false)

  function isRecurringInstance(event: CalendarEvent): boolean {
    return !!event.recurringEventId && !!event.recurrenceId && !!event.rawIcs
  }

  function getMasterEvent(event: CalendarEvent): CalendarEvent {
    if (!event.recurringEventId) return event
    return opts.rawEvents.value.find((e) => e.id === event.recurringEventId) || event
  }

  function askRecurrenceScope(mode: RecurrenceDialogMode): Promise<RecurrenceScope | null> {
    return new Promise((resolve) => {
      recurrenceChoice.value = { mode, resolve }
    })
  }

  function resolveRecurrenceChoice(scope: RecurrenceScope) {
    const choice = recurrenceChoice.value
    recurrenceChoice.value = null
    choice?.resolve(scope)
  }

  function cancelRecurrenceChoice() {
    const choice = recurrenceChoice.value
    recurrenceChoice.value = null
    choice?.resolve(null)
  }

  /** The 412 conflict identifier on the service `error` ref. */
  function isConflictError(): boolean {
    return isConflictErrorMessage(opts.error.value)
  }

  function conflictToast() {
    showErrorMessage({
      title: mapDavError(opts.error.value, $gettext) ?? $gettext('Failed to update event')
    })
  }

  function openCreateDialog(start?: Date, end?: Date, allDay?: boolean) {
    editingEvent.value = null
    createSeed.value = { start, end, allDay }
    showDialog.value = true
  }

  function openEditDialog(event: CalendarEvent) {
    editingEvent.value = event
    createSeed.value = null
    showDialog.value = true
  }

  function closeDialog() {
    showDialog.value = false
    editingEvent.value = null
  }

  /** Popover entry: birthday events only navigate, they are edited in the contact. */
  function openStackedEvent(event: CalendarEvent, hidePopover: () => void) {
    hidePopover()
    if (isBirthdayEvent(event)) {
      opts.onBirthdayGuard()
      return
    }
    openEditDialog(event)
  }

  /**
   * Drag/resize of an occurrence asks the scope question before the move
   * confirmation; non-recurring events go straight to the confirmation.
   */
  async function onEventDrag(drag: EventDragRequest) {
    const { event: ev, newStart, newEnd, isAllDay, revert } = drag
    if (isBirthdayEvent(ev)) {
      opts.onBirthdayGuard()
      revert()
      await opts.refresh()
      return
    }

    let scope: RecurrenceScope | null = null
    if (isRecurringInstance(ev)) {
      scope = await askRecurrenceScope('move')
      if (!scope) {
        // Cancelled scope question: undo the drag on the grid.
        revert()
        await opts.refresh()
        return
      }
    }
    moveScope.value = scope

    const locale = opts.getLocale()
    const old = formatMoveDetails(ev.start, ev.end, isAllDay, locale)
    const neu = formatMoveDetails(newStart, newEnd, isAllDay, locale)
    moveConfirm.value = {
      title: ev.title,
      oldDate: old.line1,
      oldTime: old.line2,
      newDate: neu.line1,
      newTime: neu.line2,
      event: ev,
      updatedEvent: { ...ev, start: newStart, end: newEnd, isAllDay }
    }
  }

  function cancelMove() {
    if (moveSaving.value) return
    moveConfirm.value = null
    moveScope.value = null
    void opts.refresh()
  }

  async function confirmMove() {
    if (!moveConfirm.value || moveSaving.value) return
    moveSaving.value = true
    const { event: ev, updatedEvent } = moveConfirm.value
    const scope = moveScope.value
    try {
      let ok = false
      let writtenCalendarUrl: string | null = null
      if (scope === 'single' && ev.rawIcs && ev.recurrenceId) {
        // Single occurrence → RECURRENCE-ID override.
        const ics = await upsertRecurrenceOverrideIcs(ev.rawIcs, ev.recurrenceId, {
          title: updatedEvent.title,
          start: updatedEvent.start,
          end: updatedEvent.end,
          description: updatedEvent.description,
          location: updatedEvent.location,
          reminders: updatedEvent.reminders
        })
        writtenCalendarUrl = ev.calendarId
        ok = await updateEventIcs(ev, ics)
      } else if (scope === 'series' && ev.recurringEventId) {
        // Whole series → shift the master by the occurrence's delta.
        const master = getMasterEvent(ev)
        const shift = shiftSeriesTimes({
          masterStart: master.start,
          masterEnd: master.end,
          oldOccStart: ev.start,
          newOccStart: updatedEvent.start,
          newOccEnd: updatedEvent.end,
          isAllDay: updatedEvent.isAllDay ?? false
        })
        writtenCalendarUrl = master.calendarId
        ok = await updateEvent({ ...master, start: shift.start, end: shift.end })
      } else {
        writtenCalendarUrl = updatedEvent.calendarId
        ok = await updateEvent(updatedEvent)
      }

      if (ok) {
        showMessage({ title: $gettext('Event updated') })
        refreshReminders()
      } else if (isConflictError()) {
        conflictToast()
      } else {
        showErrorMessage({
          title: mapDavError(opts.error.value, $gettext) ?? $gettext('Failed to update event')
        })
      }
      await opts.refresh()
      // Our own write bumped the calendar's marker; re-read it so the poll does
      // not treat it as an external change and refetch again.
      if (writtenCalendarUrl) await opts.markSynced([writtenCalendarUrl])
    } finally {
      moveSaving.value = false
      moveConfirm.value = null
      moveScope.value = null
    }
  }

  async function onSaveEvent(payload: EventSavePayload) {
    const { title, start, end, description, location, isAllDay, rrule, reminders, calendarUrl } =
      payload
    let closeAfterSave = false
    // Calendar our write lands in, so its change marker can be re-read afterwards.
    let writtenCalendarUrl: string | null = null

    if (editingEvent.value) {
      const patch = { title, start, end, description, location, isAllDay, rrule, reminders }
      const scope = isRecurringInstance(editingEvent.value)
        ? await askRecurrenceScope('save')
        : 'series'
      if (!scope) return

      let ok = false
      if (scope === 'single' && editingEvent.value.rawIcs && editingEvent.value.recurrenceId) {
        const ics = await upsertRecurrenceOverrideIcs(
          editingEvent.value.rawIcs,
          editingEvent.value.recurrenceId,
          patch
        )
        writtenCalendarUrl = editingEvent.value.calendarId
        ok = await updateEventIcs(editingEvent.value, ics)
      } else {
        // Scope "series" shifts the MASTER by the occurrence's delta — never
        // write the occurrence's own times onto the master (that would re-anchor
        // the series and drop every earlier occurrence).
        const master = getMasterEvent(editingEvent.value)
        const shift = shiftSeriesTimes({
          masterStart: master.start,
          masterEnd: master.end,
          oldOccStart: editingEvent.value.start,
          newOccStart: start,
          newOccEnd: end,
          isAllDay
        })
        writtenCalendarUrl = master.calendarId
        ok = await updateEvent({
          ...master,
          ...patch,
          start: shift.start,
          end: shift.end
        })
      }

      const conflict = !ok && isConflictError()
      if (ok) {
        showMessage({ title: $gettext('Event updated') })
        closeAfterSave = true
      } else if (conflict) {
        conflictToast()
        closeAfterSave = true
      } else {
        showErrorMessage({
          title: mapDavError(opts.error.value, $gettext) ?? $gettext('Failed to update event')
        })
      }
    } else {
      const calUrl = calendarUrl || opts.calendars.value[0]?.url
      if (!calUrl) return
      writtenCalendarUrl = calUrl
      const created = await createEvent(calUrl, {
        id: crypto.randomUUID(),
        title,
        start,
        end,
        description,
        location,
        rrule,
        reminders
      })
      if (created) {
        showMessage({ title: $gettext('Event created') })
        closeAfterSave = true
      } else {
        showErrorMessage({
          title: mapDavError(opts.error.value, $gettext) ?? $gettext('Failed to create event')
        })
      }
    }

    // New/changed VALARMs must be armed now, not at the next 15-minute tick.
    if (closeAfterSave) refreshReminders()
    await opts.refresh()
    if (writtenCalendarUrl) await opts.markSynced([writtenCalendarUrl])
    if (closeAfterSave) closeDialog()
  }

  async function onDeleteEvent() {
    if (!editingEvent.value) return
    const ev = editingEvent.value
    const scope = isRecurringInstance(ev) ? await askRecurrenceScope('delete') : 'series'
    if (!scope) return

    dispatchModal({
      title: $gettext('Delete event'),
      message: $gettext('Are you sure you want to delete this event?'),
      confirmText: $gettext('Delete'),
      async onConfirm() {
        let ok = false
        if (scope === 'single' && ev.rawIcs && ev.recurrenceId) {
          const ics = await addExdateToIcs(ev.rawIcs, ev.recurrenceId)
          ok = await updateEventIcs(ev, ics)
        } else {
          ok = await deleteEvent(getMasterEvent(ev))
        }
        const conflict = !ok && isConflictError()
        if (ok) showMessage({ title: $gettext('Event deleted') })
        else if (conflict) conflictToast()
        else
          showErrorMessage({
            title: mapDavError(opts.error.value, $gettext) ?? $gettext('Failed to delete event')
          })
        // A deleted event must not leave an armed reminder behind.
        if (ok || conflict) refreshReminders()
        await opts.refresh()
        await opts.markSynced([ev.calendarId])
        if (ok || conflict) closeDialog()
      }
    })
  }

  return {
    showDialog,
    editingEvent,
    createSeed,
    recurrenceChoice,
    moveConfirm,
    moveSaving,
    resolveRecurrenceChoice,
    cancelRecurrenceChoice,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    openStackedEvent,
    onEventDrag,
    cancelMove,
    confirmMove,
    onSaveEvent,
    onDeleteEvent
  }
}
