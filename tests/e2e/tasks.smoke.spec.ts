import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './login'
import { davFetch } from './dav'

/**
 * Task deep links, end to end against a deployed instance.
 *
 * `?open=<href>` is how a reminder (or a notification click) brings the user to
 * the task it is about: `src/index.ts` pushes `/planner/tasks` with the
 * resource URL in the query, and the view opens that task's edit dialog once the
 * list is loaded. The href is read from the create `PUT` response (that is the
 * resource the click in a reminder would carry), then the task is completed and
 * deleted again.
 *
 * Skipped unless OPENCLOUD_PASSWORD is set (same gate as the other deployed e2e).
 */

const password = process.env.OPENCLOUD_PASSWORD

const labels = {
  editTask: /Edit [Tt]ask|Aufgabe bearbeiten/,
  completedFilter: /Completed|Erledigt/,
  delete: /^(Delete|Löschen)$/
}

test.describe('Task deep link', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')
  test.describe.configure({ timeout: 180_000 })

  test('?open=<href> opens the edit dialog, then complete and delete', async ({ page }) => {
    await login(page)

    await page.goto('/planner/tasks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.tasks-page')).toBeVisible()

    const stamp = Date.now()
    const taskTitle = `E2E Deep Link ${stamp}`
    let taskUrl: string | null = null

    try {
      // ── New task dialog (Enter in the title submits) ──────────────────────
      const taskPut = await Promise.all([
        page.waitForResponse(
          (response) => response.request().method() === 'PUT' && response.url().includes('/caldav/')
        ),
        (async () => {
          await page.getByRole('button', { name: 'New task' }).click()
          await page.getByRole('dialog').getByLabel('Title').fill(taskTitle)
          await page.getByRole('dialog').getByLabel('Title').press('Enter')
        })()
      ]).then(([response]) => response)
      expect(taskPut.status()).toBeGreaterThanOrEqual(200)
      expect(taskPut.status()).toBeLessThan(300)
      taskUrl = taskPut.url()

      const row = page.locator('.task-row', { hasText: taskTitle })
      await expect(row).toBeVisible()
      await expect(row).toContainText(taskTitle)

      // ── Groups keep their full height when the list has to scroll ─────────
      // A low window forces the list to scroll; a squeezed group (flex child
      // with `overflow: hidden`) would clip its rows instead.
      const viewport = page.viewportSize()
      await page.setViewportSize({ width: viewport?.width ?? 1280, height: 360 })
      const clipped = await page
        .locator('.task-group')
        .evaluateAll(
          (groups) => groups.filter((group) => group.scrollHeight > group.clientHeight + 1).length
        )
      expect(clipped).toBe(0)
      if (viewport) await page.setViewportSize(viewport)

      // ── The deep link a reminder click uses ───────────────────────────────
      await page.goto(`/planner/tasks?open=${encodeURIComponent(taskUrl)}`, {
        waitUntil: 'domcontentloaded'
      })

      const dialog = page.locator('.modal-panel')
      await expect(dialog).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('#task-dialog-title')).toHaveText(labels.editTask)
      // The title lives in an input (its value is not part of the text content).
      await expect(
        page.getByRole('dialog').getByRole('textbox', { name: /^(Title|Titel)$/ })
      ).toHaveValue(taskTitle)

      // Escape closes the dialog (`useModalA11y`), the list is still there.
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // ── Complete through the row checkbox ─────────────────────────────────
      const completePut = await Promise.all([
        page.waitForResponse(
          (response) => response.request().method() === 'PUT' && response.url() === taskUrl
        ),
        page.locator('.task-row', { hasText: taskTitle }).locator('.task-checkbox').check()
      ]).then(([response]) => response)
      expect(completePut.status()).toBeGreaterThanOrEqual(200)
      expect(completePut.status()).toBeLessThan(300)

      const completed = await davFetch(page, taskUrl)
      expect(completed.status).toBe(200)
      expect(completed.text).toContain('BEGIN:VTODO')
      expect(completed.text).toContain('STATUS:COMPLETED')

      // ── Delete from the "Completed" filter ────────────────────────────────
      await page.locator('.filter-chip', { hasText: labels.completedFilter }).click()
      const completedRow = page.locator('.task-row', { hasText: taskTitle })
      await expect(completedRow).toBeVisible()

      const taskDelete = await Promise.all([
        page.waitForResponse(
          (response) => response.request().method() === 'DELETE' && response.url() === taskUrl
        ),
        confirmDelete(page, completedRow.locator('.task-delete'))
      ]).then(([response]) => response)
      expect(taskDelete.status()).toBeGreaterThanOrEqual(200)
      expect(taskDelete.status()).toBeLessThan(300)
      await expect(page.locator('.task-row', { hasText: taskTitle })).toHaveCount(0)
      taskUrl = null
    } finally {
      if (taskUrl) {
        // Cleanup even when an assertion above failed (a missing task is fine).
        await davFetch(page, taskUrl, 'DELETE').catch(() => {})
      }
    }
  })
})

/** Click `trigger`, then the confirm button of the platform delete dialog. */
async function confirmDelete(page: Page, trigger: Locator): Promise<void> {
  await trigger.click()
  const dialog = page.locator('[role="dialog"]').last()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: labels.delete }).last().click()
}
