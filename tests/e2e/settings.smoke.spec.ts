import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './login'

/**
 * Settings page smoke test against a deployed OpenCloud + Radicale.
 *
 * Covers what the v2 settings work introduced, all of it through the UI:
 *
 *  1. the ⚙ button in **every** app header opens `/planner/settings` —
 *     a plain URL, no `?from=`, no `#<tab>` — with that app's tab selected;
 *  2. "Back to OpenCloud" sits at the top of the in-app sidebar on **every** Planner
 *     page (Calendar, Contacts, Tasks and Settings) and leads to the Files app;
 *  3. the tab bar shows one section at a time, the URL never names the tab and
 *     the arrow keys move through the tabs;
 *  4. the General section's "Navigation" mode gates the per-app Files-sidebar
 *     entries: in Files-sidebar mode a checked app really shows up in the Files
 *     app's left sidebar (live — the sidebar reads the setting on render), in the
 *     app-menu-only mode it does not; the per-app position select survives a
 *     reload and is not a disclosure any more (the rows are inline);
 *  4b. the General section's "App menu" mode shows one "Planner" entry or one
 *     per app, and our entry carries a coloured tile like the built-in apps;
 *  5. `/planner/manage` (the old Tools page) redirects to the plain
 *     Settings path and opens the Data tab, which shows the collections,
 *     import/export, backup and clean-up groups.
 *
 * Every change to the user's settings is restored in a `finally`, so the test can
 * run repeatedly against the same account. Skipped unless OPENCLOUD_PASSWORD is
 * set (same gate as the other deployed e2e).
 */

const password = process.env.OPENCLOUD_PASSWORD

/** English + German label of the ⚙ header button. */
const settingsLabel = /^(Settings|Einstellungen)$/

/** English + German label of the sidebar entry that leaves the app. */
const backToOpenCloudLabel = /^(Back to OpenCloud|Zurück zu OpenCloud)$/

/** Where "Back to OpenCloud" lands: the Files app's personal space. */
const openCloudHome = /\/files\/spaces\/personal/

/** English + German names of the three app entries. */
const appLabels = {
  calendar: /^\s*(Calendar|Kalender)\s*$/,
  contacts: /^\s*(Contacts|Kontakte)\s*$/,
  tasks: /^\s*(Tasks|Aufgaben)\s*$/
}

/** Headings of the groups the Data tab must show. */
const dataGroups = {
  collections: /Calendars & address books|Kalender & Adressbücher/,
  importExport: /Import & export|Import & Export/,
  backup: /Backup & restore|Sicherung & Wiederherstellung/,
  cleanUp: /Clean up|Aufräumen/
}

/** Headings of the groups the Devices tab must show. */
const deviceGroups = {
  devices: /Connect your devices|Geräte verbinden/
}

/** The three app views, with the class their root element carries. */
const apps = [
  { key: 'calendar', page: '.calendar-page' },
  { key: 'contacts', page: '.contacts-page' },
  { key: 'tasks', page: '.tasks-page' }
] as const

test.describe('Settings page', () => {
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('the gear in every app header opens that tab and Back returns to the app', async ({
    page
  }) => {
    await login(page)

    for (const app of apps) {
      await page.goto(`/planner/${app.key}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator(app.page)).toBeVisible()

      // The way out of the app is there on every page, not only on Settings.
      await expect(backToOpenCloud(page)).toBeVisible()

      // The ⚙ button is the only header link on the page-title row.
      const gear = page.locator(`${app.page} .page-title-row`).getByRole('link', {
        name: settingsLabel
      })
      await expect(gear).toBeVisible()
      await gear.click()

      await expect(page).toHaveURL(/\/planner\/settings(\?|#|$)/)
      await expect(page.locator('.settings-page')).toBeVisible()

      // The tab is handed over in memory: the address bar stays plain.
      const url = new URL(page.url())
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
      await expect(page.locator(`[role="tab"][data-section="${app.key}"]`)).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await expect(page.locator(`[role="tabpanel"][data-tab="${app.key}"]`)).toBeVisible()
      // …and the sidebar entry is on the Settings page too.
      await expect(backToOpenCloud(page)).toBeVisible()
    }
  })

  test('"Back to OpenCloud" leaves the app from every Planner page', async ({ page }) => {
    await login(page)

    // Calendar, Contacts, Tasks and Settings: the entry does not depend on the page.
    const pages = [
      { path: '/planner/calendar', marker: '.calendar-page' },
      { path: '/planner/contacts', marker: '.contacts-page' },
      { path: '/planner/tasks', marker: '.tasks-page' },
      { path: '/planner/settings', marker: '.settings-page' }
    ]

    for (const entry of pages) {
      await page.goto(entry.path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator(entry.marker)).toBeVisible()

      const back = backToOpenCloud(page)
      await expect(back).toBeVisible()
      // Never marked as the current page: it leads out of the app.
      await expect(back).not.toHaveAttribute('aria-current', /page|true/)

      await back.click()
      await expect(page).toHaveURL(openCloudHome)
      // We really left Planner: none of its views is on the page any more (the Files
      // app owns the shell from here on).
      await expect(page.locator('.calendar-page')).toHaveCount(0)
      await expect(page.locator('.settings-page')).toHaveCount(0)
    }
  })

  test('the gear on the Contacts page opens the Contacts tab without a hash or query', async ({
    page
  }) => {
    await login(page)

    await page.goto('/planner/contacts', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.contacts-page')).toBeVisible()

    await page
      .locator('.contacts-page .page-title-row')
      .getByRole('link', { name: settingsLabel })
      .click()

    await expect(page.locator('.settings-page')).toBeVisible()
    await expect(page.locator('[role="tab"][data-section="contacts"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.locator('[role="tabpanel"][data-tab="contacts"]')).toBeVisible()

    // No deep link: a tab is never written into the address any more.
    const url = new URL(page.url())
    expect(url.hash).toBe('')
    expect(url.search).toBe('')
  })

  test('the tab bar shows one section at a time and the URL never names the tab', async ({
    page
  }) => {
    await login(page)

    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()

    // A plain visit opens General (there is no hash to restore a tab from).
    await expect(page.locator('[role="tabpanel"][data-tab="general"]')).toBeVisible()

    // The bar is sticky and keeps its height. It once collapsed to its 1px border
    // (a flex child with `overflow: hidden` shrinks to zero), which clipped the
    // tabs: invisible, unclickable, while the a11y tree still listed them.
    const bar = page.locator('.settings-tabs')
    await expect(bar).toHaveCSS('position', 'sticky')
    expect((await bar.boundingBox())?.height ?? 0).toBeGreaterThan(32)

    // One panel at a time: the other sections are not rendered at all.
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(1)

    // Scrolling (whichever element really scrolls, the page or the host's content
    // area) takes the toolbar away but leaves the bar pinned at the top — that is
    // what sticky means here — at full height and still clickable. A low viewport
    // makes the General tab scroll whatever the account's settings (a short tab
    // that fits the window would keep the toolbar in view and prove nothing).
    await page.setViewportSize({ width: 1280, height: 420 })
    await page.mouse.move(640, 300)
    await page.mouse.wheel(0, 600)
    await expect(page.locator('.settings-toolbar')).not.toBeInViewport()
    await expect(bar).toBeInViewport()
    expect((await bar.boundingBox())?.height ?? 0).toBeGreaterThan(32)

    // Switching tabs (from down there) swaps the panel and leaves the URL alone.
    await page.locator('[role="tab"][data-section="contacts"]').click()
    await expect(page.locator('[role="tabpanel"][data-tab="contacts"]')).toBeVisible()
    await expect(page.locator('[role="tabpanel"][data-tab="general"]')).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe('')

    // A reload is a plain visit again: the tab is not a deep link any more.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
    await expect(page.locator('[role="tablist"]')).toBeVisible()
    await expect(page.locator('[role="tabpanel"][data-tab="general"]')).toBeVisible()

    // Arrow keys move through the tabs (roving tabindex) and select as they go.
    // Focus first and prove it landed: a keypress on a detached button goes nowhere.
    const generalTab = page.locator('[role="tab"][data-section="general"]')
    await generalTab.focus()
    await expect(generalTab).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[role="tab"][data-section="calendar"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(new URL(page.url()).hash).toBe('')
  })

  test('in Files-sidebar mode a checked app shows up in the Files sidebar', async ({ page }) => {
    await login(page)

    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()

    const mode = page.locator('select[data-setting="general.navigation"]')
    await expect(mode).toBeVisible()
    const originalMode = await mode.inputValue()

    // The per-app rows exist in Files-sidebar mode only, and they are a
    // disclosure: the "arrange" gear next to the mode select unfolds them.
    try {
      await setNavigationMode(page, 'filesSidebar')
      await expandArrangement(page, 'general.filesSidebarPosition')

      const checkbox = page.locator('input[data-setting="general.filesSidebar.tasks"]')
      await expect(checkbox).toBeVisible()
      const original = await checkbox.isChecked()

      const slot = page.locator('select[data-setting="general.filesSidebarPosition.tasks"]')
      await expect(slot).toBeVisible()
      const originalSlot = await slot.inputValue()

      try {
        // ── Turned on: the entry shows up in the Files sidebar ──────────────
        // Going visible → hidden in this order is deliberate: it proves the
        // locator matches a really rendered entry before the "gone" assertion.
        await setFilesSidebar(page, checkbox, true)
        await openFilesSidebar(page)
        await expect(filesSidebarEntry(page, 'tasks')).toBeVisible()

        // ── Turned off: the entry is gone again ────────────────────────────
        await setFilesSidebar(page, checkbox, false)
        await openFilesSidebar(page)
        await expect(filesSidebarEntry(page, 'tasks')).toBeHidden()

        // ── Moved to another slot: the entry stays and the slot is stored ──
        await setFilesSidebar(page, checkbox, true)
        await setFilesSidebarSlot(page, 'tasks', 'favorites')
        await openFilesSidebar(page)
        await expect(filesSidebarEntry(page, 'tasks')).toBeVisible()

        // The slot is a setting, not page state: it survives a re-mount (the
        // arrangement is a disclosure again after the reload).
        await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
        await expect(page.locator('.settings-page')).toBeVisible()
        await expandArrangement(page, 'general.filesSidebarPosition')
        await expect(
          page.locator('select[data-setting="general.filesSidebarPosition.tasks"]')
        ).toHaveValue('favorites')
      } finally {
        // Restore whatever the account had before (default is "shown", after Spaces).
        await setFilesSidebarSlot(page, 'tasks', originalSlot)
        await setFilesSidebar(page, checkbox, original)
      }
    } finally {
      // …and the navigation mode the account had before.
      await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
      await setNavigationMode(page, originalMode === 'filesSidebar' ? 'filesSidebar' : 'drawerOnly')
    }

    // App-menu-only: nothing of ours in the Files sidebar.
    if (originalMode !== 'filesSidebar') {
      await openFilesSidebar(page)
      await expect(filesSidebarEntry(page, 'tasks')).toBeHidden()
    }
  })

  test('the app menu shows one Planner entry or one entry per app', async ({ page }) => {
    await login(page)

    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()

    const mode = page.locator('select[data-setting="general.appDrawer"]')
    await expect(mode).toBeVisible()
    const originalMode = await mode.inputValue()

    try {
      // ── single (the default): exactly one entry, the brand name ──────────
      await setAppDrawerMode(page, 'single')
      // Its placement row is a disclosure behind the "arrange" gear.
      await expandArrangement(page, 'general.appDrawerPosition')
      await expect(page.locator('select[data-setting="general.appDrawerPosition"]')).toBeVisible()
      await openAppSwitcher(page)
      const single = appDrawerEntry(page, 'menuItem')
      await expect(single).toHaveCount(1)
      await expect(single.first()).toContainText('Planner')

      // It carries the same coloured, rounded tile as the built-in apps: a
      // background colour on the icon tile and a glyph that does *not* fill it
      // (that was the old, garish look: a white-glyph SVG blown up to 32px).
      const tile = single.first().locator('.oc-application-icon')
      await expect(tile).toHaveCSS('background-color', 'rgb(0, 103, 127)')
      await expect(tile).not.toHaveClass(/overflow-hidden/)

      // ── individual: one entry per app, each with its own name and route ──
      await setAppDrawerMode(page, 'individual')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('.settings-page')).toBeVisible()
      await openAppSwitcher(page)

      const entries = appDrawerEntry(page, 'menuItem')
      await expect(entries).toHaveCount(3)
      for (const app of apps) {
        const entry = appDrawerEntry(page, `menuItem.${app.key}`)
        await expect(entry).toHaveCount(1)
        await expect(entry).toContainText(appLabels[app.key])
        await expect(entry.locator('.oc-application-icon')).toHaveCSS(
          'background-color',
          'rgb(0, 103, 127)'
        )
        await expect(entry).toHaveAttribute('href', new RegExp(`/planner/${app.key}$`))
      }
    } finally {
      await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
      await setAppDrawerMode(page, originalMode === 'individual' ? 'individual' : 'single')
    }
  })

  test('the old Tools route redirects into Settings and shows the Data groups', async ({
    page
  }) => {
    await login(page)

    await page.goto('/planner/manage', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/planner\/settings(\?|#|$)/)
    await expect(page.locator('.settings-page')).toBeVisible()

    // The redirect asks for the Data tab in memory — the URL stays plain.
    expect(new URL(page.url()).hash).toBe('')
    const data = page.locator('[role="tabpanel"][data-tab="data"]')
    await expect(data).toBeVisible()
    for (const pattern of Object.values(dataGroups)) {
      await expect(data.getByRole('heading', { name: pattern })).toBeVisible()
    }

    // The native-client instructions have their own tab.
    await page.locator('[role="tab"][data-section="devices"]').click()
    const devices = page.locator('[role="tabpanel"][data-tab="devices"]')
    await expect(devices).toBeVisible()
    await expect(devices.getByRole('heading', { name: deviceGroups.devices })).toBeVisible()
  })
})

/**
 * The "Back to OpenCloud" entry the app registers as the first in-app `navItem`.
 *
 * The host owns that markup, so both shapes are accepted: a router link or a nav
 * button whose accessible name is the label. `first()` keeps the assertions strict
 * when both match.
 */
function backToOpenCloud(page: Page): Locator {
  return page
    .getByRole('link', { name: backToOpenCloudLabel })
    .or(page.getByRole('button', { name: backToOpenCloudLabel }))
    .first()
}

/**
 * The Files-app sidebar entry of one app.
 *
 * Two shapes are accepted, because the host owns that markup: a router link to
 * the app's in-app route (`<a href="…/planner/<app>">`) or a nav item
 * whose accessible name is the app name. `first()` keeps the assertion strict
 * even when both match.
 */
function filesSidebarEntry(page: Page, app: 'calendar' | 'contacts' | 'tasks'): Locator {
  return page
    .locator(`a[href*="/planner/${app}"]`)
    .or(page.getByRole('link', { name: appLabels[app] }))
    .or(page.getByRole('button', { name: appLabels[app] }))
    .first()
}

/** Open the Files app's personal space (where the sidebar entries appear). */
async function openFilesSidebar(page: Page): Promise<void> {
  await page.goto('/files/spaces/personal', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/files\/spaces\/personal/)
}

/**
 * Set `general.navigation` and wait for the debounced settings PROPPATCH, so the
 * next page load cannot race the save.
 */
async function setNavigationMode(page: Page, mode: 'filesSidebar' | 'drawerOnly'): Promise<void> {
  const select = page.locator('select[data-setting="general.navigation"]')
  await expect(select).toBeVisible()
  if ((await select.inputValue()) === mode) return

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    select.selectOption(mode)
  ])
  await expect(select).toHaveValue(mode)
}

/**
 * Unfold the per-app placement rows of one mode row.
 *
 * They are a disclosure: the small gear next to the select (labelled "Arrange
 * apps in the Files sidebar" / "Arrange apps in the app menu") starts collapsed
 * on every mount, and the page re-mounts on every navigation — so this is
 * idempotent and keyed on `aria-expanded`.
 */
async function expandArrangement(page: Page, path: string): Promise<void> {
  if (!(await page.locator('.settings-page').isVisible())) {
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
  }

  const gear = page.locator(`[data-toggle="${path}"]`)
  await expect(gear).toBeVisible()
  if ((await gear.getAttribute('aria-expanded')) === 'true') return

  await gear.click()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Pick the Files-sidebar slot of one app and wait for the debounced settings
 * PROPPATCH. The select lives in the same row as the app's checkbox, behind the
 * "arrange" gear of the Navigation row.
 */
async function setFilesSidebarSlot(
  page: Page,
  app: 'calendar' | 'contacts' | 'tasks',
  slot: string
): Promise<void> {
  if (!(await page.locator('.settings-page').isVisible())) {
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
  }

  await expandArrangement(page, 'general.filesSidebarPosition')

  const select = page.locator(`select[data-setting="general.filesSidebarPosition.${app}"]`)
  await expect(select).toBeVisible()
  if ((await select.inputValue()) === slot) return

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    select.selectOption(slot)
  ])
  await expect(select).toHaveValue(slot)
}

/**
 * Set `general.appDrawer` and wait for the debounced settings PROPPATCH, so the
 * freshly reloaded page cannot race the save.
 */
async function setAppDrawerMode(page: Page, mode: 'single' | 'individual'): Promise<void> {
  const select = page.locator('select[data-setting="general.appDrawer"]')
  await expect(select).toBeVisible()
  if ((await select.inputValue()) === mode) return

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    select.selectOption(mode)
  ])
  await expect(select).toHaveValue(mode)
}

/** Open the host's app switcher (the drawer in the top bar). */
async function openAppSwitcher(page: Page): Promise<void> {
  const drop = page.locator('#app-switcher-dropdown')
  if (!(await drop.isVisible())) await page.locator('#_appSwitcherButton').click()
  await expect(drop).toBeVisible()
}

/**
 * Our entry (or entries) inside the app switcher.
 *
 * The host renders one `<li><button data-test-id="<extension id>">` per
 * `appMenuItem` extension next to its own apps, so the extension id is the only
 * stable handle — matching our entries by name would also catch the host's.
 */
function appDrawerEntry(page: Page, suffix = 'menuItem'): Locator {
  // Prefix match: `menuItem` finds the single entry and all three of the
  // individual ones, `menuItem.calendar` narrows it to one app.
  return page.locator(`#app-switcher-dropdown [data-test-id^="app.planner.${suffix}"]`)
}

/**
 * Flip one `general.filesSidebar.<app>` checkbox and wait for the debounced
 * settings PROPPATCH, so the next page load cannot race the save.
 */
async function setFilesSidebar(page: Page, checkbox: Locator, checked: boolean): Promise<void> {
  if (!(await page.locator('.settings-page').isVisible())) {
    await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.settings-page')).toBeVisible()
  }
  // The row sits behind the "arrange" gear of the Navigation row, which starts
  // collapsed after every mount.
  await expandArrangement(page, 'general.filesSidebarPosition')
  await expect(checkbox).toBeVisible()
  if ((await checkbox.isChecked()) === checked) return

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    checked ? checkbox.check() : checkbox.uncheck()
  ])
}
