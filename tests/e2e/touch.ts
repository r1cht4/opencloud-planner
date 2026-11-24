import { type Locator, type Page } from '@playwright/test'

/**
 * Shared touch helpers for the deployed e2e specs.
 *
 * The gestures go through Chromium's **touch input pipeline** (CDP
 * `Input.dispatchTouchEvent`), not through synthetic `PointerEvent`s: a real
 * finger produces `touchstart`/`touchmove`/`touchend` *and* the derived
 * `pointerdown`/`pointermove`/`pointerup` (with `pointerType: 'touch'`), and the
 * browser decides between scrolling and the page's gesture exactly as it does on
 * a phone. That matters here: @event-calendar only `preventDefault()`s
 * `touchmove` once the long press started interacting, so `pointercancel` and
 * native scrolling are part of the behaviour under test — a hand-dispatched
 * `PointerEvent` would skip both.
 *
 * `page.mouse` would take the mouse path (5 px threshold, no long press), and
 * `page.touchscreen` only offers `tap()`, hence the CDP client. Chromium only —
 * the project runs Chromium (playwright.config.ts).
 */

export interface Point {
  x: number
  y: number
}

export interface TouchDragOptions {
  /** How long the finger rests on the target before it moves (ms). */
  holdMs?: number
  /** Number of `touchMove` steps between down and up. */
  steps?: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One CDP touch session for a page (Chromium's input pipeline). */
async function withTouchClient<T>(page: Page, run: (send: SendTouch) => Promise<T>): Promise<T> {
  const browserName = page.context().browser()?.browserType().name()
  if (browserName !== 'chromium') {
    throw new Error(`touch gestures need Chromium's CDP input (got ${browserName ?? 'unknown'})`)
  }

  const client = await page.context().newCDPSession(page)
  try {
    return await run(async (type, points): Promise<void> => {
      await client.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    })
  } finally {
    await client.detach().catch((): undefined => undefined)
  }
}

type TouchPoint = {
  x: number
  y: number
  id?: number
  radiusX?: number
  radiusY?: number
  force?: number
}
type SendTouch = (
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: TouchPoint[]
) => Promise<void>

/** A touch point with a finger's contact radius, so the browser treats it as a finger. */
function finger(point: Point): TouchPoint {
  return { x: point.x, y: point.y, id: 1, radiusX: 5, radiusY: 5, force: 1 }
}

/**
 * Long-press then drag with a finger: `touchStart` at `from`, hold, move in
 * `steps` increments to `to`, lift.
 *
 * Nothing happens before the hold elapses — that is the long-press delay the app
 * configures (`longPressDelay: 350`); a shorter `holdMs` reproduces a *failed*
 * gesture on purpose.
 */
export async function touchDrag(
  page: Page,
  from: Point,
  to: Point,
  { holdMs = 500, steps = 4 }: TouchDragOptions = {}
): Promise<void> {
  await withTouchClient(page, async (send) => {
    await send('touchStart', [finger(from)])
    await sleep(holdMs)

    for (let step = 1; step <= steps; step++) {
      await send('touchMove', [
        finger({
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps
        })
      ])
      await sleep(16)
    }

    await send('touchEnd', [])
    // Let the callback (dialog, selection cleanup) settle before the assertion.
    await sleep(150)
  })
}

/**
 * A quick finger swipe — no hold, so no long press: the browser scrolls the
 * container under the finger and the grid must not grab what is under it.
 *
 * A real swipe is a browser gesture; this helper therefore asserts nothing by
 * itself, the caller checks that the grid scrolled and no drag started.
 */
export async function quickTouchSwipe(
  page: Page,
  from: Point,
  distance: number,
  steps = 8
): Promise<void> {
  await withTouchClient(page, async (send) => {
    await send('touchStart', [finger(from)])
    for (let step = 1; step <= steps; step++) {
      await send('touchMove', [finger({ x: from.x, y: from.y - (distance * step) / steps })])
      await sleep(10)
    }
    await send('touchEnd', [])
    await sleep(300)
  })
}

/**
 * A point inside an element that a finger really hits.
 *
 * `document.elementFromPoint` decides: a point that is clipped away, covered by
 * a sticky toolbar or overlapped by a child the gesture must not grab (the
 * resize handle) is skipped. `avoid` is an optional selector for such children.
 */
export async function hitPoint(locator: Locator, avoid = ''): Promise<Point> {
  const point = await locator.evaluate((el, avoidSelector) => {
    const box = el.getBoundingClientRect()
    const fractions: Array<[number, number]> = [
      [0.5, 0.25],
      [0.5, 0.5],
      [0.5, 0.1],
      [0.3, 0.3],
      [0.7, 0.3],
      [0.5, 0.8],
      [0.5, 0.95]
    ]
    for (const [fx, fy] of fractions) {
      const x = box.left + box.width * fx
      const y = box.top + box.height * fy
      const hit = document.elementFromPoint(x, y)
      if (!hit) continue
      if (!(hit === el || el.contains(hit))) continue
      if (avoidSelector && hit.closest(avoidSelector)) continue
      return { x, y }
    }
    return null
  }, avoid)
  if (!point) throw new Error('no reachable point inside the element')
  return point
}

/** A point `dy` pixels below another one (same column). */
export function below(point: Point, dy: number): Point {
  return { x: point.x, y: point.y + dy }
}

/**
 * A point on an **empty timed slot** of the time grid.
 *
 * The day columns of the body are as tall as the whole day and stick out of the
 * scroll container, so a fraction of the column box is meaningless; the visible
 * body rect is what the finger can reach. All-day cells (`.ec-all-day`) and
 * anything on top of an event are excluded — a press there would select a day or
 * grab the event instead of starting a timed selection.
 */
export async function emptySlotPoint(page: Page): Promise<Point> {
  const point = await page.evaluate(() => {
    const body = document.querySelector('.ec-time-grid .ec-body')
    if (!body) return null
    const bodyBox = body.getBoundingClientRect()
    const columns = Array.from(body.querySelectorAll('.ec-day'))

    for (const fraction of [0.75, 0.6, 0.45, 0.85, 0.3]) {
      const y = bodyBox.top + bodyBox.height * fraction
      for (const column of columns) {
        const box = column.getBoundingClientRect()
        const x = box.left + box.width / 2
        if (x < bodyBox.left || x > bodyBox.right) continue
        const hit = document.elementFromPoint(x, y)
        if (!hit || !body.contains(hit)) continue
        if (!hit.closest('.ec-day')) continue
        if (hit.closest('.ec-event') || hit.closest('.ec-resizer')) continue
        return { x, y }
      }
    }
    return null
  })
  if (!point) throw new Error('no empty timed slot in the visible grid')
  return point
}

/**
 * Current scroll offset of the time grid.
 *
 * The scrolling element is the library's `.ec-main` section (`overflow: auto` in
 * its stylesheet, and the element its `scrollTime` option scrolls) — the
 * `.ec-body` rowgroup inside it is not a scroller.
 */
export async function gridScrollTop(page: Page): Promise<number> {
  return page.locator('.ec-time-grid .ec-main').evaluate((el) => (el as HTMLElement).scrollTop)
}
