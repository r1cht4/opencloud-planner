// @vitest-environment happy-dom
/**
 * Touch support of the calendar grid.
 *
 * @event-calendar/core does the pointer work itself; the app only *configures*
 * it. These tests pin down that configuration and the two touch aids:
 *
 *  - `longPressDelay` is the one option that makes a finger wait before
 *    dragging/resizing/selecting, and it is touch-only in the library (the
 *    `pointerType === 'mouse'` branch never starts that timer);
 *  - the mouse keeps its defaults, so nothing here can slow a desktop drag down;
 *  - the haptic tick is limited to coarse pointers and feature-detected;
 *  - the coarse-pointer stylesheet enlarges the resize handle and never sets
 *    `touch-action` (a swipe must keep scrolling the grid).
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TOUCH_LONG_PRESS_DELAY,
  TOUCH_VIBRATION_MS,
  isCoarsePointer,
  touchGridOptions,
  vibrateOnInteractionStart
} from '../../src/composables/calendarTouch'

function stubPointer(coarse: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: coarse && query.includes('pointer: coarse'),
        media: query,
        onchange: null,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        dispatchEvent: (): boolean => false
      }) as unknown as MediaQueryList
  )
}

const originalVibrate = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate')

/** Replace `navigator.vibrate` (`undefined` = a browser that has none, e.g. iOS). */
function stubVibrate(value: ((pattern: number | number[]) => boolean) | undefined): void {
  Object.defineProperty(Navigator.prototype, 'vibrate', {
    value,
    configurable: true,
    writable: true
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalVibrate) Object.defineProperty(Navigator.prototype, 'vibrate', originalVibrate)
  else delete (Navigator.prototype as { vibrate?: unknown }).vibrate
})

describe('calendar touch options', () => {
  it('waits ~350 ms before a finger starts dragging, resizing or selecting', () => {
    expect(TOUCH_LONG_PRESS_DELAY).toBe(350)
    expect(touchGridOptions()).toEqual({ longPressDelay: 350 })
  })

  it('leaves the per-action overrides unset so one value covers everything', () => {
    const options = touchGridOptions()

    // The library falls back to `longPressDelay` for both; setting them would
    // only duplicate the number in three places.
    expect(options).not.toHaveProperty('eventLongPressDelay')
    expect(options).not.toHaveProperty('selectLongPressDelay')
  })

  it('does not touch a single mouse option', () => {
    const options = Object.keys(touchGridOptions())

    // Mouse drags start immediately (library default 5 px); a desktop must not
    // see any difference from the touch support.
    for (const mouseOption of [
      'eventDragMinDistance',
      'selectMinDistance',
      'eventStartEditable',
      'editable',
      'selectable'
    ]) {
      expect(options).not.toContain(mouseOption)
    }
  })
})

describe('coarse-pointer detection', () => {
  it('is true on a touch screen and false with a mouse', () => {
    stubPointer(true)
    expect(isCoarsePointer()).toBe(true)

    stubPointer(false)
    expect(isCoarsePointer()).toBe(false)
  })

  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(isCoarsePointer()).toBe(false)
  })
})

describe('haptic feedback when a drag starts', () => {
  it('ticks once for 10 ms on a coarse pointer', () => {
    stubPointer(true)
    const vibrate = vi.fn(() => true)
    stubVibrate(vibrate)

    vibrateOnInteractionStart({ pointerType: 'touch' })

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(TOUCH_VIBRATION_MS)
  })

  it('stays silent for a mouse drag, even on a device that can vibrate', () => {
    stubPointer(false)
    const vibrate = vi.fn(() => true)
    stubVibrate(vibrate)

    vibrateOnInteractionStart({ pointerType: 'touch' })

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('stays silent for a mouse pointer on a hybrid device with a coarse primary', () => {
    // A touchscreen laptop reports `(pointer: coarse)` while the primary input is
    // a finger — the pointer of the interaction decides, so a mouse drag is silent.
    stubPointer(true)
    const vibrate = vi.fn(() => true)
    stubVibrate(vibrate)

    vibrateOnInteractionStart({ pointerType: 'mouse' })

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('survives browsers without navigator.vibrate (iOS Safari, desktop)', () => {
    stubPointer(true)
    stubVibrate(undefined)
    expect(typeof navigator.vibrate).toBe('undefined')

    expect(() => vibrateOnInteractionStart({ pointerType: 'touch' })).not.toThrow()
  })
})

describe('touch styles', () => {
  const css = readFileSync('src/styles/calendar-grid.css', 'utf8')

  /** The body of the `@media (pointer: coarse)` block. */
  function coarsePointerBlock(): string {
    const start = css.indexOf('@media (pointer: coarse)')
    expect(start).toBeGreaterThan(-1)
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) return css.slice(open, i + 1)
      }
    }
    throw new Error('unterminated @media (pointer: coarse) block')
  }

  it('enlarges the resize handle beyond the library 8px cap', () => {
    const block = coarsePointerBlock()

    // Vertical handle (week/day grid) and horizontal handle (month/all-day).
    expect(block).toMatch(/\.ec-time-grid \.ec-body \.ec-resizer\s*\{[^}]*max-block-size: 16px/)
    expect(block).toMatch(/\.ec-day-grid \.ec-resizer[^{]*\{[^}]*max-inline-size: 16px/)
  })

  it('never sets touch-action, which would kill swipe-to-scroll', () => {
    expect(css).not.toMatch(/touch-action\s*:/)
  })
})
