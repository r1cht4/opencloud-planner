import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './login'

/**
 * Calendar default view, end to end against a deployed instance.
 *
 * The view is a *synced* per-user setting (`calendar.defaultView`), so this
 * proves the whole chain: Settings page → debounced PROPPATCH of the settings
 * document → Calendar view reading it back into the @event-calendar grid.
 *
 * The grid tags its root with the view name (`ec-day-grid ec-month-view`,
 * `ec-time-grid ec-week-view`, …) and the toolbar marks the active view button
 * (`ec-active`), which is what the assertions use — no screenshot comparison.
 *
 * The original value is restored in a `finally`. Skipped unless
 * OPENCLOUD_PASSWORD is set (same gate as the other deployed e2e).
 */

const password = process.env.OPENCLOUD_PASSWORD

/** `select[data-setting="calendar.defaultView"]` on the Settings page. */
function defaultViewSelect(page: Page): Locator {
  return page.locator('select[data-setting="calendar.defaultView"]')
}

/** Open one Settings tab (only that section is rendered) and wait for its panel. */
async function openSettingsTab(page: Page, tab: string): Promise<void> {
  const button = page.locator(`[role="tab"][data-section="${tab}"]`)
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-selected')) !== 'true') await button.click()
  await expect(page.locator(`[role="tabpanel"][data-tab="${tab}"]`)).toBeVisible()
}

test.describe('Calendar default view setting', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('Month as default view renders the month grid', async ({ page }) => {
    await login(page)

    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()

    // The per-app settings moved behind their tab: open Settings → Calendar.
    await openSettingsTab(page, 'calendar')

    const select = defaultViewSelect(page)
    await expect(select).toBeVisible()
    const original = await select.inputValue()

    try {
      await setDefaultView(page, select, 'month')

      await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.calendar-page')).toBeVisible()

      // Month grid, not the week time grid.
      await expect(page.locator('.ec-day-grid.ec-month-view')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.ec-time-grid.ec-week-view')).toHaveCount(0)
      // The @event-calendar stylesheet is loaded (a view split once dropped it and the
      // grid rendered as plain stacked text): its toolbar is a flex row.
      await expect(page.locator('.ec-toolbar').first()).toHaveCSS('display', 'flex')
      // The toolbar highlights the month button.
      await expect(page.locator('.ec-toolbar button.ec-dayGridMonth.ec-active')).toBeVisible()
    } finally {
      // Back to Week (the built-in default); a different starting value is kept.
      await setDefaultView(page, select, original === 'month' ? 'week' : original)
    }

    if (original === 'week') {
      // Restored value is live again: the calendar opens on the week grid.
      await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.ec-time-grid.ec-week-view')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.ec-toolbar button.ec-timeGridWeek.ec-active')).toBeVisible()
    }
  })
})

/**
 * Change `calendar.defaultView` and wait for the debounced settings PROPPATCH,
 * so the following page load cannot read the old document.
 */
async function setDefaultView(page: Page, select: Locator, value: string): Promise<void> {
  if (!(await page.locator('.settings-page').isVisible())) {
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
  }
  await openSettingsTab(page, 'calendar')
  if ((await select.inputValue()) === value) return

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    select.selectOption(value)
  ])
}
