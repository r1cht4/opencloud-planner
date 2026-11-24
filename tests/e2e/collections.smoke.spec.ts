import { expect, test, type Page } from '@playwright/test'
import { login } from './login'

const password = process.env.OPENCLOUD_PASSWORD

/**
 * Tools page collection manager against a deployed OpenCloud + Radicale.
 * Creates a calendar, renames it, sets its color and deletes it again, verifying
 * every step server-side through PROPFIND (so the test cannot pass on UI state
 * alone).
 *
 * Skipped unless OPENCLOUD_PASSWORD is set (same gate as the other deployed e2e).
 */
test.describe('Tools collection manager', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('creates, renames, colors and deletes a calendar', async ({ page }) => {
    await login(page)

    // Tools moved into the Settings page's Data tab; the tab is opened by a click
    // (the URL never names it), the card selectors inside it are unchanged.
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
    await page.locator('[role="tab"][data-section="data"]').click()
    const dataPanel = page.locator('[role="tabpanel"][data-tab="data"]')
    const card = dataPanel.locator('.collections-card')
    await expect(card).toBeVisible()

    // The native-client URLs live in their own Devices tab.
    await page.locator('[role="tab"][data-section="devices"]').click()
    await expect(page.locator('.connect-card')).toContainText(/CalDAV/i)
    await page.locator('[role="tab"][data-section="data"]').click()
    await expect(card).toBeVisible()

    const stamp = Date.now()
    const name = `E2E Calendar ${stamp}`
    const renamed = `${name} renamed`

    // ── Create ──────────────────────────────────────────────────────────
    await card
      .locator('.collection-group')
      .first()
      .locator('button', { hasText: /New calendar|Neuer Kalender/ })
      .click()
    const createDialog = page.locator('[role="dialog"]').last()
    await expect(createDialog).toBeVisible()
    await createDialog.locator('input[type="text"]').fill(name)
    await createDialog.locator('input[type="color"]').fill('#c41e3a')
    const [mkcol] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'MKCOL' && resp.url().includes('/caldav/')
      ),
      createDialog.getByRole('button', { name: /^Add$|^Hinzufügen$/ }).click()
    ])
    expect(mkcol.status()).toBeLessThan(300)
    const collectionUrl = mkcol.url()

    const created = await propfindFromPage(page, collectionUrl)
    expect(created.status).toBe(207)
    expect(created.text).toContain(name)
    // Colour is written to both namespaces; Radicale echoes at least one of them.
    expect(created.text).toMatch(/#c41e3a(ff)?/i)

    // ── Rename ──────────────────────────────────────────────────────────
    const row = card.locator('.collection-row', { hasText: name }).first()
    await expect(row).toBeVisible()
    await row.locator('button[aria-label^="Rename"], button[aria-label^="Umbenennen"]').click()
    const renameDialog = page.locator('[role="dialog"]').last()
    await renameDialog.locator('input[type="text"]').fill(renamed)
    await renameDialog.getByRole('button', { name: /^Save$|^Speichern$/ }).click()
    await expect(card.locator('.collection-row', { hasText: renamed })).toBeVisible()
    expect((await propfindFromPage(page, collectionUrl)).text).toContain(renamed)

    // ── Delete ──────────────────────────────────────────────────────────
    const renamedRow = card.locator('.collection-row', { hasText: renamed }).first()
    await renamedRow.locator('button[aria-label^="Delete"], button[aria-label^="Löschen"]').click()
    const confirm = page.locator('[role="dialog"]').last()
    await expect(confirm).toContainText(renamed)
    const [deleted] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'DELETE' && resp.url() === collectionUrl
      ),
      confirm
        .getByRole('button', { name: /^Delete$|^Löschen$/ })
        .last()
        .click()
    ])
    expect(deleted.status()).toBeLessThan(300)

    // Radicale answers 404 (or 410) once the collection is gone.
    expect((await propfindFromPage(page, collectionUrl)).status).toBeGreaterThanOrEqual(400)
  })
})

/** PROPFIND a collection from inside the app (same auth as the extension). */
async function propfindFromPage(page: Page, url: string) {
  return page.evaluate(async (target) => {
    // The host's OIDC user (localStorage) — independent of the module-federation runtime.
    const token = (() => {
      try {
        const k = Object.keys(localStorage).find((key) => key.startsWith('oc_oAuth.user:'))
        return k ? String(JSON.parse(localStorage.getItem(k) || '{}').access_token || '') : ''
      } catch {
        return ''
      }
    })()
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8'
    }
    if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`

    const response = await fetch(target, {
      method: 'PROPFIND',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><a:calendar-color/><c:calendar-color/></d:prop></d:propfind>'
    })

    return { status: response.status, text: await response.text() }
  }, url)
}
