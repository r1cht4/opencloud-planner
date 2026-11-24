import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from './login'
import { accessToken, davFetch } from './dav'
import {
  below,
  emptySlotPoint,
  gridScrollTop,
  hitPoint,
  quickTouchSwipe,
  touchDrag,
  type Point
} from './touch'

/**
 * Calendar grid on a touch screen, end to end against a deployed instance.
 *
 * What the grid gets from @event-calendar 5.7 and what this spec therefore has
 * to prove through the UI: a finger starts a drag/resize/select only after a
 * long press (`longPressDelay: 350` in `useCalendarGrid`), a tap is a click, and
 * everything the mouse does still happens — move an event (drag), change its
 * length (resize handle), create one by dragging over an empty slot (the normal
 * new-event dialog with the selected range) and open one by tapping it.
 *
 * The gestures are dispatched as `PointerEvent`s with `pointerType: 'touch'`
 * (see `touch.ts`): that is the code path a finger takes, while Playwright's
 * `page.mouse` would exercise the mouse path and prove nothing.
 *
 * Each test creates its own calendar and event through CalDAV and deletes the
 * collection in a `finally`, so it can run repeatedly against the same account.
 * Every assertion about a submitted change reads the object back from the DAV
 * server — never the grid alone. Skipped unless OPENCLOUD_PASSWORD is set.
 */

const password = process.env.OPENCLOUD_PASSWORD

/** A phone (390 × 844, coarse pointer) — the tightest layout the grid has. */
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
/** A tablet (834 × 1112) — coarse pointer, two-column-ish width. */
const TABLET = { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2 }

/** English + German labels of the dialogs this spec drives. */
const newEventTitle = /New [Ee]vent|Neuer Termin/
const moveDialogTitle = /Move event|Termin verschieben/
const moveButton = /^(Move|Verschieben)$/

interface Fixture {
  collectionUrl: string
  eventUrl: string
  title: string
}

// ── Calendar/event fixture over CalDAV ──────────────────────────────────────

/** PROPFIND `/caldav/` for the signed-in user's principal collection. */
async function principalUrl(page: Page): Promise<string> {
  const url = new URL('/caldav/', page.url()).toString()
  const token = await accessToken(page)
  const xml = await page.evaluate(
    async ({ url, token }) => {
      const response = await fetch(url, {
        method: 'PROPFIND',
        credentials: 'include',
        headers: {
          Depth: '0',
          'Content-Type': 'application/xml; charset=utf-8',
          ...(token
            ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` }
            : {})
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`
      })
      return response.text()
    },
    { url, token }
  )

  const block = xml.match(
    /<[^>]*current-user-principal[^>]*>([\s\S]*?)<\/[^>]*current-user-principal>/i
  )
  const href = (block ? block[1] : xml).match(/<[^>]*href[^>]*>([^<]+)</i)
  if (!href) throw new Error('Could not read current-user-principal from /caldav/')
  return href[1]
}

/** Pad a number to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYYMMDD` of today (the week view shows the current week). */
function today(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`
}

/**
 * Create a throwaway calendar with one event for today, 10:00–11:00 UTC.
 *
 * Today's date keeps the event inside the visible week; the time only has to be
 * somewhere in the day grid (the spec scrolls the event into view before it
 * touches it, so the local timezone does not matter).
 */
async function createFixture(page: Page): Promise<Fixture> {
  const stamp = Date.now()
  const title = `E2E Touch ${stamp}`
  const principal = await principalUrl(page)
  const base = principal.endsWith('/') ? principal : `${principal}/`
  const collectionUrl = new URL(`${base}touch-e2e-${stamp}/`, page.url()).toString()

  const mkcol = await davFetch(page, collectionUrl, 'MKCOL', {
    contentType: 'application/xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>${title}</d:displayname>
    </d:prop>
  </d:set>
</d:mkcol>`
  })
  if (mkcol.status >= 300) {
    throw new Error(`MKCOL ${collectionUrl} failed: ${mkcol.status} ${mkcol.text}`)
  }

  const day = today()
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenCloud Planner e2e//EN',
    'BEGIN:VEVENT',
    `UID:touch-e2e-${stamp}`,
    `DTSTAMP:${day}T090000Z`,
    `DTSTART:${day}T100000Z`,
    `DTEND:${day}T110000Z`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

  const eventUrl = new URL(`${collectionUrl}touch-e2e-${stamp}.ics`, page.url()).toString()
  const put = await davFetch(page, eventUrl, 'PUT', {
    contentType: 'text/calendar; charset=utf-8',
    body: ics
  })
  if (put.status >= 300) throw new Error(`PUT ${eventUrl} failed: ${put.status} ${put.text}`)

  return { collectionUrl, eventUrl, title }
}

/** Remove the fixture calendar and everything in it. */
async function deleteFixture(page: Page, fixture: Fixture | null): Promise<void> {
  if (!fixture) return
  await davFetch(page, fixture.collectionUrl, 'DELETE').catch((): undefined => undefined)
}

/** The stored iCalendar text of one event. */
async function storedIcs(page: Page, url: string): Promise<string> {
  const result = await davFetch(page, url)
  expect(result.status, 'the event must be readable over CalDAV').toBe(200)
  return result.text
}

/**
 * `DTSTART`/`DTEND` of the stored VEVENT, zone designator stripped
 * (`20261124T100000Z` → `20261124T100000`).
 *
 * Only the VEVENT block is searched: after a write the document also carries a
 * VTIMEZONE whose own `DTSTART:19700101T000000` is the first `DTSTART` line in
 * the file, and reading that one would fake a change that never happened.
 */
function times(ics: string): { start: string; end: string } {
  const vevent = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)?.[0] ?? ''
  const read = (name: string): string => {
    const line = vevent
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${name}:`) || entry.startsWith(`${name};`))
    if (!line) return ''
    // `DTSTART;TZID=UTC:20261124T100000[Z]` → `20261124T100000`
    return line
      .slice(line.indexOf(':') + 1)
      .trim()
      .replace(/Z$/, '')
  }
  return { start: read('DTSTART'), end: read('DTEND') }
}

// ── Grid interaction helpers ────────────────────────────────────────────────

/** The grid block of one event, matched by its title. */
function eventBlock(page: Page, title: string): Locator {
  return page.locator('.ec-time-grid .ec-event', { hasText: title }).first()
}

/** Open the calendar page and wait for the week time grid. */
async function openWeekView(page: Page): Promise<void> {
  await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.calendar-page')).toBeVisible()
  await expect(page.locator('.ec-time-grid.ec-week-view')).toBeVisible({ timeout: 30_000 })
}

/**
 * A point on the draggable body of an event: hit-testable and never on the
 * resize handle (the bottom edge) or the "+N" expander.
 */
async function dragPoint(event: Locator): Promise<Point> {
  return hitPoint(event, '.ec-resizer')
}

/** Confirm the move/resize dialog the app opens after a grid drag. */
async function confirmMove(page: Page): Promise<void> {
  const dialog = page.locator('.modal-panel', { hasText: moveDialogTitle })
  await expect(dialog).toBeVisible()
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes('/caldav/')
    ),
    dialog.getByRole('button', { name: moveButton }).click()
  ])
  await expect(dialog).toHaveCount(0)
}

/** Switch `calendar.defaultView` through the Settings page (language independent). */
async function setDefaultView(page: Page, view: string): Promise<string> {
  await page.goto('/planner/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.settings-page')).toBeVisible()
  await page.locator('[role="tab"][data-section="calendar"]').click()

  const select = page.locator('select[data-setting="calendar.defaultView"]')
  await expect(select).toBeVisible()
  const original = await select.inputValue()
  if (original === view) return original

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PROPPATCH'),
    select.selectOption(view)
  ])
  await expect(select).toHaveValue(view)
  return original
}

// ── Phone ───────────────────────────────────────────────────────────────────

test.describe('Calendar touch on a phone', () => {
  test.use({ ...PHONE, hasTouch: true, isMobile: true })
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('a long press then drag moves an event to another time', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    try {
      const before = times(await storedIcs(page, fixture.eventUrl))
      await openWeekView(page)

      const event = eventBlock(page, fixture.title)
      await expect(event).toBeVisible({ timeout: 30_000 })
      await event.scrollIntoViewIfNeeded()

      const from = await dragPoint(event)
      // One hour down: any non-zero delta re-times the event, which is what the
      // server-side assertion checks.
      await touchDrag(page, from, below(from, 90))

      await confirmMove(page)

      const after = times(await storedIcs(page, fixture.eventUrl))
      // Both ends moved: a move, not a resize.
      expect(after.start).not.toBe(before.start)
      expect(after.end).not.toBe(before.end)
    } finally {
      await deleteFixture(page, fixture)
    }
  })

  test('dragging the resize handle lengthens an event', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    try {
      const before = times(await storedIcs(page, fixture.eventUrl))
      await openWeekView(page)

      const event = eventBlock(page, fixture.title)
      await expect(event).toBeVisible({ timeout: 30_000 })
      await event.scrollIntoViewIfNeeded()

      // The end handle the library renders on the event's bottom edge; our
      // coarse-pointer CSS makes it 16px deep so a finger can grab it.
      const handle = event.locator('.ec-resizer').last()
      await expect(handle).toBeVisible()
      const from = await hitPoint(handle)
      await touchDrag(page, from, below(from, 60))

      await confirmMove(page)

      const after = times(await storedIcs(page, fixture.eventUrl))
      // Same start, later end: a resize, not a move.
      expect(after.start).toBe(before.start)
      expect(after.end).not.toBe(before.end)
    } finally {
      await deleteFixture(page, fixture)
    }
  })

  test('a long press on an empty slot then drag opens the new-event dialog', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    try {
      await openWeekView(page)
      await expect(eventBlock(page, fixture.title)).toBeVisible({ timeout: 30_000 })

      // An empty *timed* slot in the scrollable body: not the all-day row (whose
      // cells are `.ec-day` too) and not on top of the fixture event, which would
      // drag that event instead of starting a selection.
      const from = await emptySlotPoint(page)

      await touchDrag(page, from, below(from, 70))

      const dialog = page.locator('.modal-panel', { hasText: newEventTitle })
      await expect(dialog).toBeVisible({ timeout: 15_000 })

      // The dialog is seeded with the selected range: same day, end after start.
      const dates = dialog.locator('input[type="date"]')
      await expect(dates.nth(0)).not.toHaveValue('')
      expect(await dates.nth(0).inputValue()).toBe(await dates.nth(1).inputValue())
      const spin = dialog.locator('.scroll-time-input')
      const startMinutes =
        Number(await spin.nth(0).inputValue()) * 60 + Number(await spin.nth(1).inputValue())
      const endMinutes =
        Number(await spin.nth(2).inputValue()) * 60 + Number(await spin.nth(3).inputValue())
      expect(endMinutes).toBeGreaterThan(startMinutes)

      // Nothing is written until the user saves.
      await dialog.getByRole('button', { name: /Cancel|Abbrechen/ }).click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await deleteFixture(page, fixture)
    }
  })

  test('a tap opens the event, a quick swipe does not grab it', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    try {
      const before = times(await storedIcs(page, fixture.eventUrl))
      await openWeekView(page)

      const event = eventBlock(page, fixture.title)
      await expect(event).toBeVisible({ timeout: 30_000 })
      await event.scrollIntoViewIfNeeded()

      // ── A swipe without a long press scrolls and grabs nothing ──────────
      const point = await dragPoint(event)
      const scrollBefore = await gridScrollTop(page)
      await quickTouchSwipe(page, point, 120)
      // The browser scrolled the time grid (a finger swipes to scroll, even over
      // an event) and the event stayed where it was: no drag, no dialog.
      expect(await gridScrollTop(page)).toBeGreaterThan(scrollBefore)
      await expect(page.locator('.modal-panel')).toHaveCount(0)
      expect(times(await storedIcs(page, fixture.eventUrl)).start).toBe(before.start)

      // ── A tap is a click: the event opens in its read-only preview ───────
      const tapPoint = await dragPoint(event)
      await page.touchscreen.tap(tapPoint.x, tapPoint.y)
      const dialog = page.locator('.modal-panel')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      // The dialog is titled with the event, and offers the edit form (preview).
      await expect(dialog.locator('#event-dialog-title')).toHaveText(fixture.title)
      await expect(dialog.getByRole('button', { name: /^(Edit|Bearbeiten)$/ })).toBeVisible()
      await expect(dialog.locator('input[type="date"]').first()).not.toHaveValue('')

      // Preview has no Cancel: Escape closes it (the modal a11y contract).
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      // …and a tap never writes anything.
      expect(times(await storedIcs(page, fixture.eventUrl)).start).toBe(before.start)
    } finally {
      await deleteFixture(page, fixture)
    }
  })
})

// ── Tablet ──────────────────────────────────────────────────────────────────

test.describe('Calendar touch on a tablet', () => {
  test.use({ ...TABLET, hasTouch: true, isMobile: true })
  test.skip(!password, 'Set OPENCLOUD_PASSWORD to run deployed OpenCloud e2e tests')

  test('a long press then drag moves an event to another time', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    try {
      const before = times(await storedIcs(page, fixture.eventUrl))
      await openWeekView(page)

      const event = eventBlock(page, fixture.title)
      await expect(event).toBeVisible({ timeout: 30_000 })
      await event.scrollIntoViewIfNeeded()

      const from = await dragPoint(event)
      await touchDrag(page, from, below(from, 120))

      await confirmMove(page)

      const after = times(await storedIcs(page, fixture.eventUrl))
      expect(after.start).not.toBe(before.start)
    } finally {
      await deleteFixture(page, fixture)
    }
  })

  test('a long press on an empty slot then drag creates an event in day view', async ({ page }) => {
    await login(page)
    const fixture = await createFixture(page)

    let originalView: string | null = null
    try {
      originalView = await setDefaultView(page, 'day')

      await page.goto('/planner/calendar', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.calendar-page')).toBeVisible()
      await expect(page.locator('.ec-time-grid.ec-day-view')).toBeVisible({ timeout: 30_000 })
      await expect(eventBlock(page, fixture.title)).toBeVisible({ timeout: 30_000 })

      const from = await emptySlotPoint(page)

      await touchDrag(page, from, below(from, 70))

      const dialog = page.locator('.modal-panel', { hasText: newEventTitle })
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      const dates = dialog.locator('input[type="date"]')
      expect(await dates.nth(0).inputValue()).toBe(await dates.nth(1).inputValue())
      const spin = dialog.locator('.scroll-time-input')
      const startMinutes =
        Number(await spin.nth(0).inputValue()) * 60 + Number(await spin.nth(1).inputValue())
      const endMinutes =
        Number(await spin.nth(2).inputValue()) * 60 + Number(await spin.nth(3).inputValue())
      expect(endMinutes).toBeGreaterThan(startMinutes)

      await dialog.getByRole('button', { name: /Cancel|Abbrechen/ }).click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await deleteFixture(page, fixture)
      if (originalView) await setDefaultView(page, originalView)
    }
  })
})
