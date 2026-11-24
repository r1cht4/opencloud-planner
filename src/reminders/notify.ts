/**
 * Reminder delivery — a system notification when the user allowed them, an
 * in-app message otherwise.
 *
 * Permission is **never** requested from here: the anti-goals forbid permission
 * prompts on page load, so the only caller of `Notification.requestPermission()`
 * is the explicit "Allow desktop notifications" button in
 * `components/settings/RemindersSettings.vue`. This module only reads the state.
 */

import type { DueAlarm } from './alarmIndex'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

/** Current permission, `'unsupported'` when the browser has no Notification API. */
export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Ask the browser for permission. Only for the explicit button in Settings.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return notificationPermission()
  }
}

/**
 * Locale-aware moment of the item the alarm belongs to (no translated words,
 * so no gettext round-trip is needed here). All-day items have no meaningful
 * time, so midnight starts render date-only.
 */
function formatAlarmTime(alarm: DueAlarm, locale?: string): string {
  const at = alarm.start ?? alarm.fireAt
  const hasTime = at.getHours() !== 0 || at.getMinutes() !== 0
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {})
    }).format(at)
  } catch {
    return at.toLocaleString()
  }
}

export interface NotifyDeps {
  /** In-app fallback (`useMessages().showMessage` captured at setup). */
  showMessage(message: { title: string; desc?: string }): void
  /** Open the event/task the reminder belongs to. */
  openItem(href: string, kind: 'event' | 'task'): void
  /** Injectable constructor, used by tests. */
  createNotification?(title: string, options: NotificationOptions): Notification
  locale?: string
}

/**
 * Show `alarm`. Returns how it was delivered, which keeps the decision testable
 * ("desktop" vs. "toast").
 */
export function notifyAlarm(alarm: DueAlarm, deps: NotifyDeps): 'desktop' | 'toast' {
  const body = formatAlarmTime(alarm, deps.locale)

  if (notificationPermission() === 'granted') {
    try {
      const create =
        deps.createNotification ??
        ((title: string, options: NotificationOptions) => new Notification(title, options))
      const notification = create(alarm.title, { body, tag: alarm.key })
      notification.onclick = () => {
        if (typeof window !== 'undefined') window.focus()
        deps.openItem(alarm.href, alarm.kind)
        notification.close()
      }
      return 'desktop'
    } catch (err) {
      // Some platforms expose the API but refuse to construct (e.g. no backend).
      console.warn('[planner] desktop notification failed:', err)
    }
  }

  deps.showMessage({ title: alarm.title, desc: body })
  return 'toast'
}
