import { expect, test } from '@playwright/test'
import { login } from './login'
import { davFetch } from './dav'

/**
 * Browser reminder, end to end against a deployed instance.
 *
 * Creates an event that starts in six minutes with a five-minute reminder
 * (entered through the event dialog, so the VALARM goes through the normal
 * `patchIcs` path) and waits for the reminder to fire.
 *
 * Delivery: the engine uses the Notification API when the user granted the
 * permission, otherwise `useMessages()` — an in-app toast. Headless Chromium
 * never grants it, so the toast (`.oc-notification-message`, rendered by the
 * host's message area) is what shows up. The design system's class is used
 * instead of a text match on the page, because the event title also appears in
 * the calendar grid.
 *
 * The event is deleted in a `finally`. Skipped unless OPENCLOUD_PASSWORD is set.
 */

const password = process.env.OPENCLOUD_PASSWORD

test.describe('Reminders', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')
  // Sign-in plus up to two minutes of waiting for the alarm.
  test.describe.configure({ timeout: 300_000 })

  test('a five-minute reminder shows an in-app toast', async ({ page }) => {
    await login(page)

    // Reminders are on by default; make sure, otherwise this spec would wait
    // two minutes for an engine that is switched off.
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
    // General tab → group "Reminders" (the default tab, no hash needed).
    const remindersToggle = page.locator('#setting-reminders-enabled')
    await expect(remindersToggle).toBeVisible()
    const remindersWereEnabled = await remindersToggle.isChecked()
    if (!remindersWereEnabled) {
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
        remindersToggle.check()
      ])
    }

    const eventTitle = `E2E Reminder ${Date.now()}`
    let eventUrl: string | null = null

    try {
      await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.calendar-page')).toBeVisible()

      // Starts in six minutes, reminder five minutes before → due in ~1 minute.
      const start = new Date(Date.now() + 6 * 60_000)
      const end = new Date(start.getTime() + 30 * 60_000)

      await page.locator('.calendar-page button', { hasText: /New [Ee]vent|Neuer Termin/ }).click()
      const dialog = page.locator('.modal-panel')
      await expect(dialog).toBeVisible()

      await dialog.locator('input[type="text"]').first().fill(eventTitle)
      await dialog.locator('input[type="date"]').nth(0).fill(isoDate(start))
      await dialog.locator('input[type="date"]').nth(1).fill(isoDate(end))
      // Two ScrollTime widgets: start hour/minute, then end hour/minute.
      const times = dialog.locator('.scroll-time-input')
      await times.nth(0).fill(pad2(start.getHours()))
      await times.nth(1).fill(pad2(start.getMinutes()))
      await times.nth(2).fill(pad2(end.getHours()))
      await times.nth(3).fill(pad2(end.getMinutes()))

      // Default reminders are empty unless the user configured some.
      if ((await dialog.locator('.reminder-row').count()) === 0) {
        await dialog.locator('.reminder-add').click()
      }
      await dialog.locator('.reminder-row select').first().selectOption('5')

      const eventPut = await Promise.all([
        page.waitForResponse(
          (response) => response.request().method() === 'PUT' && response.url().includes('/caldav/')
        ),
        dialog.locator('button[type="submit"]').click()
      ]).then(([response]) => response)
      expect(eventPut.status()).toBeGreaterThanOrEqual(200)
      expect(eventPut.status()).toBeLessThan(300)
      eventUrl = eventPut.url()

      // The stored event really carries the reminder (not just the dialog state).
      const stored = await davFetch(page, eventUrl)
      expect(stored.status).toBe(200)
      expect(stored.text).toContain('BEGIN:VALARM')
      expect(stored.text).toMatch(/TRIGGER:-PT5M/)

      // Creating the event re-collects alarms immediately, so the toast is due
      // about one minute from now — allow the full two minutes.
      await expect(page.locator('.oc-notification-message', { hasText: eventTitle })).toBeVisible({
        timeout: 120_000
      })
    } finally {
      if (eventUrl) {
        // 404/410 tolerated: the test may already have failed after the DELETE.
        await davFetch(page, eventUrl, 'DELETE').catch(() => {})
      }
      if (!remindersWereEnabled) {
        await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
        await remindersToggle.uncheck().catch(() => {})
      }
    }
  })
})

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYY-MM-DD` in the browser's local time (what `<input type="date">` wants). */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
