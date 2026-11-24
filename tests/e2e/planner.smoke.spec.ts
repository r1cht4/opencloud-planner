import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './login'

const password = process.env.OPENCLOUD_PASSWORD
const labels = {
  calendar: /Calendar|Kalender/,
  contacts: /Contacts|Kontakte/,
  tasks: /Tasks|Aufgaben/,
  completedFilter: /Completed|Erledigt/,
  newEvent: /New [Ee]vent|Neuer Termin/,
  newContact: /New [Cc]ontact|Neuer Kontakt/,
  edit: /Edit|Bearbeiten/,
  delete: /Delete|Löschen/
}

test.describe('Calendar & Contacts deployed app', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('loads app routes and persists new DAV objects', async ({ page }) => {
    const extensionMessages: string[] = []
    page.on('console', (msg) => {
      if (!['error', 'warning'].includes(msg.type())) return
      const text = msg.text()
      // Background requests (reminder engine, live refresh) aborted by the test's own
      // full-page navigations are not app errors.
      if (text.includes('Failed to fetch')) return
      if (
        text.includes('planner') ||
        text.includes('Module Federation') ||
        text.includes('Schedule-X')
      ) {
        extensionMessages.push(`${msg.type()}: ${text}`)
      }
    })
    page.on('pageerror', (err) => extensionMessages.push(`pageerror: ${err.message}`))

    await login(page)

    await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.calendar-page')).toContainText(labels.calendar)
    await expect(page.locator('.calendar-page')).toContainText(labels.newEvent)

    const stamp = Date.now()
    const eventTitle = `E2E Event ${stamp}`
    // Must be today: the post-reload assertion relies on the calendar's default
    // view (current week) containing the event.
    const now = new Date()
    const eventDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-')
    const eventStartHour = 2 + (stamp % 6)
    const eventEndHour = eventStartHour + 1
    await page.locator('.date-nav-input').fill(eventDate)
    await page.locator('.date-nav-input').dispatchEvent('change')
    await page.locator('.calendar-page button', { hasText: labels.newEvent }).click()
    await page.locator('.modal-panel input[type="text"]').nth(0).fill(eventTitle)
    await page.locator('.modal-panel input[type="date"]').nth(0).fill(eventDate)
    await page.locator('.modal-panel input[type="date"]').nth(1).fill(eventDate)
    await page
      .locator('.modal-panel .scroll-time-input')
      .nth(0)
      .fill(String(eventStartHour).padStart(2, '0'))
    await page.locator('.modal-panel .scroll-time-input').nth(1).fill('00')
    await page
      .locator('.modal-panel .scroll-time-input')
      .nth(2)
      .fill(String(eventEndHour).padStart(2, '0'))
    await page.locator('.modal-panel .scroll-time-input').nth(3).fill('00')
    await page.locator('.modal-panel textarea').fill('Created by Playwright e2e')
    await page.locator('.modal-panel input[type="text"]').nth(1).fill('OpenCloud')

    const eventPut = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url().includes('/caldav/')
      ),
      page.locator('.modal-panel button[type="submit"]').click()
    ]).then(([resp]) => resp)
    expect(eventPut.status()).toBeGreaterThanOrEqual(200)
    expect(eventPut.status()).toBeLessThan(300)

    const createdEvent = await davFetchFromPage(page, eventPut.url())
    expect(createdEvent.status).toBe(200)
    expect(createdEvent.text).toContain(`SUMMARY:${eventTitle}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.calendar-page')).toContainText(eventTitle)

    const editedEventTitle = `${eventTitle} edited`
    await page
      .getByRole('button', { name: new RegExp(escapeRegExp(eventTitle)) })
      .dispatchEvent('click')
    await expect(page.locator('.modal-panel')).toBeVisible()
    await page.locator('.modal-panel button', { hasText: labels.edit }).click()
    await page.locator('.modal-panel input[type="text"]').nth(0).fill(editedEventTitle)
    const eventUpdate = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url() === eventPut.url()
      ),
      page.locator('.modal-panel button[type="submit"]').click()
    ]).then(([resp]) => resp)
    expect(eventUpdate.status()).toBeGreaterThanOrEqual(200)
    expect(eventUpdate.status()).toBeLessThan(300)

    const editedEvent = await davFetchFromPage(page, eventPut.url())
    expect(editedEvent.status).toBe(200)
    expect(editedEvent.text).toContain(`SUMMARY:${editedEventTitle}`)

    const eventDelete = await davFetchFromPage(page, eventPut.url(), 'DELETE')
    expect(eventDelete.status).toBeGreaterThanOrEqual(200)
    expect(eventDelete.status).toBeLessThan(300)

    await page.goto('/planner/contacts', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.contacts-page')).toContainText(labels.contacts)
    await expect(page.locator('.contacts-page')).toContainText(labels.newContact)

    const contactFirstName = 'E2E'
    const contactLastName = `Contact ${stamp}`
    const contactName = `${contactFirstName} ${contactLastName}`
    const contactEmail = `e2e-${stamp}@example.com`
    await page.locator('.contacts-page button', { hasText: labels.newContact }).click()
    await page.locator('.modal-panel input[type="text"]').nth(0).fill(contactFirstName)
    await page.locator('.modal-panel input[type="text"]').nth(1).fill(contactLastName)
    await page.locator('.modal-panel input[type="email"]').fill(contactEmail)
    await page.locator('.modal-panel input[type="tel"]').fill('+49123456789')
    await page.locator('.modal-panel input[type="text"]').nth(2).fill('Example')
    await page.locator('.modal-panel input[type="text"]').nth(3).fill('Tester')
    await page.locator('.modal-panel textarea').fill('Created by Playwright e2e')

    const contactPut = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url().includes('/carddav/')
      ),
      page.locator('.modal-panel button[type="submit"]').click()
    ]).then(([resp]) => resp)
    expect(contactPut.status()).toBeGreaterThanOrEqual(200)
    expect(contactPut.status()).toBeLessThan(300)

    const createdContact = await davFetchFromPage(page, contactPut.url())
    expect(createdContact.status).toBe(200)
    expect(createdContact.text).toContain(`FN:${contactName}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.contact-row', { hasText: contactName }).click()
    await expect(page.locator('.contact-detail-pane')).toContainText(contactEmail)

    const editedContactLastName = `${contactLastName} edited`
    const editedContactName = `${contactFirstName} ${editedContactLastName}`
    await page.locator('.contact-detail-pane button', { hasText: labels.edit }).click()
    await page.locator('.modal-panel input[type="text"]').nth(1).fill(editedContactLastName)
    const contactUpdate = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url() === contactPut.url()
      ),
      page.locator('.modal-panel button[type="submit"]').click()
    ]).then(([resp]) => resp)
    expect(contactUpdate.status()).toBeGreaterThanOrEqual(200)
    expect(contactUpdate.status()).toBeLessThan(300)
    await expect(page.locator('.contact-detail-pane')).toContainText(editedContactName)

    const contactDelete = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'DELETE' && resp.url() === contactPut.url()
      ),
      confirmDelete(page, page.locator('.contact-detail-pane button', { hasText: labels.delete }))
    ]).then(([resp]) => resp)
    expect(contactDelete.status()).toBeGreaterThanOrEqual(200)
    expect(contactDelete.status()).toBeLessThan(300)
    await expect(page.locator('.contact-row', { hasText: editedContactName })).toHaveCount(0)

    expect(extensionMessages).toEqual([])
  })

  test('imports and exports through the Data tab with full fidelity', async ({ page }) => {
    await login(page)
    // The Tools page became the Data tab of Settings (no hash alias any more: the
    // tab is selected by a click, the URL stays plain).
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
    await page.locator('[role="tab"][data-section="data"]').click()
    const dataPanel = page.locator('[role="tabpanel"][data-tab="data"]')
    await expect(dataPanel).toBeVisible()
    await expect(
      dataPanel.getByRole('heading', { name: /Import & export|Import & Export/ })
    ).toBeVisible()

    const stamp = Date.now()
    const eventUid = `e2e-import-${stamp}`
    const eventSummary = `E2E Imported Event ${stamp}`
    const newCalendarName = `E2E Import ${stamp}`
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E//Import//EN',
      'X-WR-CALNAME:E2E Source',
      'BEGIN:VEVENT',
      `UID:${eventUid}`,
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260718T090000Z',
      'DTEND:20260718T100000Z',
      `SUMMARY:${eventSummary}`,
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:guest@example.com',
      'X-E2E-PROP:fidelity-check',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    // ── Calendar import into a NEW calendar ──────────────────────────────
    await page.locator('input[accept*=".ics"]').setInputFiles({
      name: 'e2e-import.ics',
      mimeType: 'text/calendar',
      buffer: Buffer.from(ics)
    })
    const importDialog = page.locator('[role="dialog"]', {
      has: page.locator('#import-dialog-title')
    })
    await expect(importDialog).toBeVisible()
    // Name prefilled from X-WR-CALNAME; switch to "new calendar" with a unique name
    await expect(importDialog.locator('input[type="text"]')).toHaveValue('E2E Source')
    await importDialog.locator('input[type="radio"][value="new"]').check()
    await importDialog.locator('input[type="text"]').fill(newCalendarName)

    const importPut = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.request().method() === 'PUT' &&
          resp.url().includes(`/caldav/`) &&
          resp.url().includes(eventUid)
      ),
      importDialog
        .locator('button', { hasText: /Import/ })
        .last()
        .click()
    ]).then(([resp]) => resp)
    expect(importPut.status()).toBeGreaterThanOrEqual(200)
    expect(importPut.status()).toBeLessThan(300)
    await expect(importDialog).toBeHidden()

    // Server-side fidelity: unmodeled properties survived the import verbatim
    const stored = await davFetchFromPage(page, importPut.url())
    expect(stored.status).toBe(200)
    expect(stored.text).toContain(`SUMMARY:${eventSummary}`)
    expect(stored.text).toContain('X-E2E-PROP:fidelity-check')
    expect(stored.text).toContain('ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:guest@example.com')
    expect(stored.text).not.toContain('X-WR-CALNAME')

    // ── Export: one merged VCALENDAR containing the imported event ───────
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.settings-page button', { hasText: /Export \.ics/ }).click()
    ]).then(([d]) => d)
    expect(download.suggestedFilename()).toMatch(/\.ics$/)
    const exported = await streamToString(download)
    expect(exported.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(exported.match(/END:VCALENDAR/g)).toHaveLength(1)
    expect(exported).toContain(`SUMMARY:${eventSummary}`)
    expect(exported).toContain('X-E2E-PROP:fidelity-check')
    expect(exported).toContain(`X-WR-CALNAME:${newCalendarName}`)

    // ── Contacts import into the EXISTING address book ───────────────────
    const contactUid = `e2e-import-c-${stamp}`
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `UID:${contactUid}`,
      `FN:E2E Import ${stamp}`,
      'N:Import;E2E;;;',
      `EMAIL:e2e-import-${stamp}@example.com`,
      'X-E2E-PROP:fidelity-check',
      'END:VCARD'
    ].join('\r\n')

    await page.locator('input[accept*=".vcf"]').setInputFiles({
      name: 'e2e-import.vcf',
      mimeType: 'text/vcard',
      buffer: Buffer.from(vcf)
    })
    await expect(importDialog).toBeVisible()
    const contactPut = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.request().method() === 'PUT' &&
          resp.url().includes('/carddav/') &&
          resp.url().includes(contactUid)
      ),
      importDialog
        .locator('button', { hasText: /Import/ })
        .last()
        .click()
    ]).then(([resp]) => resp)
    expect(contactPut.status()).toBeGreaterThanOrEqual(200)
    expect(contactPut.status()).toBeLessThan(300)
    await expect(importDialog).toBeHidden()

    const storedContact = await davFetchFromPage(page, contactPut.url())
    expect(storedContact.status).toBe(200)
    expect(storedContact.text).toContain('X-E2E-PROP:fidelity-check')

    // ── Cleanup: imported contact, then the whole e2e calendar ───────────
    const contactDelete = await davFetchFromPage(page, contactPut.url(), 'DELETE')
    expect(contactDelete.status).toBeGreaterThanOrEqual(200)
    expect(contactDelete.status).toBeLessThan(300)
    const calendarUrl = importPut.url().replace(/[^/]+$/, '')
    const calendarDelete = await davFetchFromPage(page, calendarUrl, 'DELETE')
    expect(calendarDelete.status).toBeGreaterThanOrEqual(200)
    expect(calendarDelete.status).toBeLessThan(300)
  })

  test('tasks: create, complete, delete', async ({ page }) => {
    await login(page)

    await page.goto('/planner/tasks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.tasks-page')).toBeVisible()
    await expect(page.locator('.tasks-page')).toContainText(labels.tasks)

    const stamp = Date.now()
    const taskTitle = `E2E Task ${stamp}`

    // ── Create through the quick-add input (Enter submits) ────────────────
    const taskPut = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url().includes('/caldav/')
      ),
      (async () => {
        await page.locator('#quick-add-input').fill(taskTitle)
        await page.locator('#quick-add-input').press('Enter')
      })()
    ]).then(([resp]) => resp)
    expect(taskPut.status()).toBeGreaterThanOrEqual(200)
    expect(taskPut.status()).toBeLessThan(300)

    const createdTask = await davFetchFromPage(page, taskPut.url())
    expect(createdTask.status).toBe(200)
    expect(createdTask.text).toContain('BEGIN:VTODO')
    expect(createdTask.text).toContain(`SUMMARY:${taskTitle}`)
    await expect(page.locator('.task-row', { hasText: taskTitle })).toBeVisible()

    // ── Complete through the checkbox (patches STATUS/COMPLETED/% ) ───────
    const completePut = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'PUT' && resp.url() === taskPut.url()
      ),
      page.locator('.task-row', { hasText: taskTitle }).locator('.task-checkbox').check()
    ]).then(([resp]) => resp)
    expect(completePut.status()).toBeGreaterThanOrEqual(200)
    expect(completePut.status()).toBeLessThan(300)

    const completedTask = await davFetchFromPage(page, taskPut.url())
    expect(completedTask.text).toContain('STATUS:COMPLETED')
    expect(completedTask.text).toContain('PERCENT-COMPLETE:100')
    expect(completedTask.text).toMatch(/COMPLETED:\d{8}T\d{6}Z/)
    // The default "Open" filter hides it again.
    await expect(page.locator('.task-row', { hasText: taskTitle })).toHaveCount(0)

    // ── Delete from the "Completed" filter with the confirm dialog ────────
    await page.locator('.filter-chip', { hasText: labels.completedFilter }).click()
    const completedRow = page.locator('.task-row', { hasText: taskTitle })
    await expect(completedRow).toBeVisible()

    const taskDelete = await Promise.all([
      page.waitForResponse(
        (resp) => resp.request().method() === 'DELETE' && resp.url() === taskPut.url()
      ),
      confirmDelete(page, completedRow.locator('.task-delete'))
    ]).then(([resp]) => resp)
    expect(taskDelete.status()).toBeGreaterThanOrEqual(200)
    expect(taskDelete.status()).toBeLessThan(300)
    await expect(page.locator('.task-row', { hasText: taskTitle })).toHaveCount(0)
  })

  test('opens Settings from the gear button and redirects the old Tools route', async ({
    page
  }) => {
    await login(page)

    // The ⚙ button sits in the page-title row of every app view.
    await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
    const gear = page.locator('.calendar-page .page-title-row a[aria-label="Settings"]')
    await expect(gear).toBeVisible()
    await gear.click()

    await expect(page).toHaveURL(/\/planner\/settings(\?|#|$)/)
    await expect(page.locator('.settings-page')).toBeVisible()
    // The tab bar has one tab per section; the gear of the Calendar page opens
    // the Calendar tab (handed over in memory — the URL stays plain), and only
    // that panel is rendered.
    expect(new URL(page.url()).hash).toBe('')
    expect(new URL(page.url()).search).toBe('')
    for (const id of ['general', 'calendar', 'contacts', 'tasks', 'data', 'devices', 'about']) {
      await expect(page.locator(`[role="tab"][data-section="${id}"]`)).toBeAttached()
    }
    await expect(page.locator('[role="tab"][data-section="calendar"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.locator('[role="tabpanel"][data-tab="calendar"]')).toBeVisible()
    await expect(page.locator('[role="tabpanel"][data-tab="general"]')).toHaveCount(0)

    // The sidebar is always there on Settings and leads out of the app to the Files
    // app; the way back into Planner is the app drawer, not a Back button.
    const back = page
      .getByRole('link', { name: /^(Back to OpenCloud|Zurück zu OpenCloud)$/ })
      .or(page.getByRole('button', { name: /^(Back to OpenCloud|Zurück zu OpenCloud)$/ }))
    await expect(back).toBeVisible()
    await back.click()
    await expect(page).toHaveURL(/\/files\/spaces\/personal/)

    // The legacy Tools route redirects to the plain Settings path, Data tab open.
    await page.goto('/planner/manage', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/planner\/settings(\?|#|$)/)
    await expect(page.locator('[role="tab"][data-section="data"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.locator('[role="tabpanel"][data-tab="data"]')).toBeVisible()
  })
})

async function confirmDelete(page: Page, trigger: Locator) {
  await trigger.click()
  const dialog = page.locator('[role="dialog"]').last()
  await expect(dialog).toContainText(labels.delete)
  await dialog.locator('button', { hasText: labels.delete }).last().click()
}

async function streamToString(download: {
  createReadStream: () => Promise<NodeJS.ReadableStream>
}): Promise<string> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function davFetchFromPage(page: Page, url: string, method = 'GET') {
  return page.evaluate(
    async ({ method, url }) => {
      // The host's OIDC user (localStorage) — independent of the module-federation runtime.
      const token = (() => {
        try {
          const k = Object.keys(localStorage).find((key) => key.startsWith('oc_oAuth.user:'))
          return k ? String(JSON.parse(localStorage.getItem(k) || '{}').access_token || '') : ''
        } catch {
          return ''
        }
      })()
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
      if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`

      const response = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store'
      })

      return {
        status: response.status,
        text: await response.text()
      }
    },
    { method, url }
  )
}
