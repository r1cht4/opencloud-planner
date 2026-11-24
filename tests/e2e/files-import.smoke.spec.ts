import { expect, test } from '@playwright/test'
import { login } from './login'
import { davFetch, deletePersonalFile, personalSpacePath, uploadPersonalFile } from './dav'

/**
 * Files context-menu import ("Import into calendar"), end to end.
 *
 * The extension registers an `action` on `global.files.context-actions` for a
 * single `.ics`/`.vcf` resource. Clicking it reads the file through the platform
 * WebDAV client and opens the shared import dialog **inside the Files app**
 * (platform modal shell, embedded dialog), so the user never leaves the file
 * list.
 *
 * The `.ics` is uploaded through WebDAV with `page.request` (no UI upload, so the
 * test does not depend on the Files upload menu), the import is done through the
 * context menu, and the created calendar, its event and the uploaded file are
 * removed again in a `finally`.
 *
 * Skipped unless OPENCLOUD_PASSWORD is set (same gate as the other deployed e2e).
 */

const password = process.env.OPENCLOUD_PASSWORD

test.describe('Files "Import into calendar"', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')
  test.describe.configure({ timeout: 240_000 })

  test('imports an uploaded .ics and reports it with a toast', async ({ page }) => {
    await login(page)

    // The host only knows its spaces once the Files app has loaded them; the
    // upload below needs the personal drive's WebDAV path.
    await page.goto('/files/spaces/personal', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/files\/spaces\/personal/)

    const stamp = Date.now()
    const uid = `e2e-files-import-${stamp}`
    const eventTitle = `E2E Files Import ${stamp}`
    const fileName = `${uid}.ics`
    const calendarName = `E2E Files Import ${stamp}`

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E//Files import//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260718T090000Z',
      'DTEND:20260718T100000Z',
      `SUMMARY:${eventTitle}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    let fileUrl: string | null = null
    let eventUrl: string | null = null
    let calendarUrl: string | null = null

    try {
      // ── Upload the .ics into the personal space ──────────────────────────
      const spacePath = await personalSpacePath(page)
      fileUrl = await uploadPersonalFile(page, spacePath, fileName, ics)

      // ── Import it through the file context menu ─────────────────────────
      await page.goto('/files/spaces/personal', { waitUntil: 'domcontentloaded' })
      // The Files app remembers grid vs. list per browser; rows only exist in the list view.
      const listToggle = page.getByRole('button', { name: /^(List|Liste)$/ })
      await expect(listToggle).toBeVisible({ timeout: 60_000 })
      if ((await listToggle.getAttribute('aria-pressed')) !== 'true') await listToggle.click()
      const fileRow = page.locator('tr', { hasText: fileName }).first()
      await expect(fileRow).toBeVisible({ timeout: 60_000 })

      // Single click selects the resource (the action requires exactly one
      // selection), right click opens the context menu.
      await fileRow.click()
      await fileRow.click({ button: 'right' })
      // Several (hidden) drop menus exist in the Files app; take the visible entry.
      await page
        .getByText(/^(Import into calendar|In den Kalender importieren)$/)
        .filter({ visible: true })
        .first()
        .click()

      // ── The import dialog is hosted by the platform modal shell ─────────
      const panel = page.locator('.import-panel')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      // Import into a fresh calendar, so cleanup is one DELETE.
      await panel.locator('input[type="radio"][value="new"]').check()
      await panel.locator('input[type="text"]').fill(calendarName)

      const importPut = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            response.url().includes('/caldav/') &&
            response.url().includes(uid),
          { timeout: 60_000 }
        ),
        panel.getByRole('button', { name: /^(Import|Importieren)$/ }).click()
      ]).then(([response]) => response)
      expect(importPut.status()).toBeGreaterThanOrEqual(200)
      expect(importPut.status()).toBeLessThan(300)

      eventUrl = importPut.url()
      calendarUrl = eventUrl.replace(/[^/]+$/, '')

      // ── The toast names what was imported ───────────────────────────────
      await expect(
        page.locator('.oc-notification-message', {
          hasText: /events? imported|Termine? importiert/
        })
      ).toBeVisible({ timeout: 30_000 })
      await expect(panel).toBeHidden()

      // ── Server side: the event really exists ────────────────────────────
      const stored = await davFetch(page, eventUrl)
      expect(stored.status).toBe(200)
      expect(stored.text).toContain(`SUMMARY:${eventTitle}`)
    } finally {
      // Deleting the collection removes its events as well.
      if (eventUrl) {
        await davFetch(page, eventUrl, 'DELETE').catch(() => {})
      }
      if (calendarUrl) {
        await davFetch(page, calendarUrl, 'DELETE').catch(() => {})
      }
      if (fileUrl) {
        await deletePersonalFile(page, fileUrl).catch(() => {})
      }
    }
  })
})
