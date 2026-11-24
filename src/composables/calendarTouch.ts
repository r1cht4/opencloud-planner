/**
 * calendarTouch – the touch-screen bits of the calendar grid.
 *
 * @event-calendar/core 5.7 already speaks pointer events: an event, a resize
 * handle and an empty slot all start the *same* action for a finger as for the
 * mouse (`validJsEvent()` only rejects a mouse whose button is not pressed, and
 * `common()` marks any `pointerType !== 'mouse'` as a long press candidate).
 * Two differences matter:
 *
 *  1. A finger starts nothing until it has rested for `longPressDelay`
 *     (default 1000 ms) — without that delay every swipe over the grid would
 *     grab an event instead of scrolling, so the library calls
 *     `jsEvent.preventDefault()` on `touchmove` *only* once the long press
 *     began interacting.
 *  2. The 5 px `eventDragMinDistance` / `selectMinDistance` thresholds are
 *     mouse-only; a finger drags as soon as the long press fired.
 *
 * So the touch behaviour is one option, and it is touch-only: the mouse path
 * never starts the timer (`jsEvent.pointerType === 'mouse'`), which is why 350 ms
 * here changes nothing on a desktop. `eventLongPressDelay` and
 * `selectLongPressDelay` are the per-action overrides and both fall back to
 * `longPressDelay`, so they stay unset on purpose — one value for events,
 * resize handles and empty slots.
 *
 * Nothing here touches `touch-action`: the browser keeps the swipe (scroll) and
 * only the library's own non-passive `touchmove` listener may take the gesture
 * away once a long press is in progress.
 */

/** How long a finger rests before a drag/select starts (ms); mouse unaffected. */
export const TOUCH_LONG_PRESS_DELAY = 350

/** Length of the haptic tick when a drag/resize starts (ms). */
export const TOUCH_VIBRATION_MS = 10

/**
 * Options handed to `createCalendar`. Spread into the options of
 * `useCalendarGrid` so the value lives in one place and a unit test can read it
 * without mounting the grid.
 */
export function touchGridOptions(): Record<string, number> {
  return { longPressDelay: TOUCH_LONG_PRESS_DELAY }
}

/** True on a coarse pointer (finger/stylus); the touch aids apply there only. */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Haptic tick when a drag or resize starts.
 *
 * Two guards, because a laptop can have both a touchscreen and a mouse:
 * the pointer that started the interaction must not be a mouse (`(pointer:
 * coarse)` is true whenever the *primary* pointer is a finger, so it alone would
 * buzz on a mouse drag of a hybrid device), and the capability is
 * feature-detected — `navigator.vibrate` does not exist in iOS Safari or on the
 * desktop.
 */
export function vibrateOnInteractionStart(jsEvent?: { pointerType?: string }): void {
  if (jsEvent?.pointerType === 'mouse') return
  if (!isCoarsePointer()) return
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  navigator.vibrate(TOUCH_VIBRATION_MS)
}
