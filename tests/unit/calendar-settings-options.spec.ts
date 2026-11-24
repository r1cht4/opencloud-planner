// @vitest-environment happy-dom
/**
 * The `calendar.*` settings decide how the grid is configured.
 *
 * Pure option mapping (no DOM), plus the "apply live without a re-mount" rule:
 * a settings change must reach the running calendar through `setOption` and only
 * for the values that actually changed.
 */
import { describe, expect, it } from 'vitest'
import {
  applyCalendarSettingsOptions,
  buildCalendarSettingsOptions,
  defaultViewName,
  effectiveWeekStart,
  hiddenDaysFor,
  scrollTimeFrom
} from '../../src/settings/calendarViewOptions'
import { DEFAULT_SETTINGS } from '../../src/settings/schema'

const base = { ...DEFAULT_SETTINGS.calendar }

describe('calendar settings → grid options', () => {
  it('dayStart 08:00 → scrollTime 08:00:00', () => {
    expect(buildCalendarSettingsOptions({ ...base, dayStart: '08:00' }, 'de').scrollTime).toBe(
      '08:00:00'
    )
    expect(scrollTimeFrom('08:00')).toBe('08:00:00')
    // An unusable value must not break the grid.
    expect(scrollTimeFrom('25:99')).toBe('06:00:00')
    expect(scrollTimeFrom('')).toBe('06:00:00')
  })

  it('weekNumbers false → option false', () => {
    expect(buildCalendarSettingsOptions({ ...base, weekNumbers: false }, 'de').weekNumbers).toBe(
      false
    )
    expect(buildCalendarSettingsOptions({ ...base, weekNumbers: true }, 'de').weekNumbers).toBe(
      true
    )
  })

  it('showWeekends false → hiddenDays [0,6]', () => {
    expect(hiddenDaysFor(false)).toEqual([0, 6])
    expect(buildCalendarSettingsOptions({ ...base, showWeekends: false }, 'de').hiddenDays).toEqual(
      [0, 6]
    )
    // Weekends shown = nothing hidden.
    expect(hiddenDaysFor(true)).toEqual([])
  })

  it("weekStart 'locale' keeps today's rule (en → Sunday, otherwise Monday)", () => {
    expect(effectiveWeekStart('locale', 'en')).toBe(0)
    expect(effectiveWeekStart('locale', 'en-US')).toBe(0)
    expect(effectiveWeekStart('locale', 'de')).toBe(1)
    expect(effectiveWeekStart('locale', 'de-DE')).toBe(1)
    expect(effectiveWeekStart('locale', '')).toBe(1)
  })

  it("'locale' follows the format region, not the UI language (English UI, German formats)", () => {
    expect(effectiveWeekStart('locale', 'en-DE')).toBe(1)
    expect(effectiveWeekStart('locale', 'en-DE-u-hc-h23')).toBe(1)
    expect(effectiveWeekStart('locale', 'de-US')).toBe(0)
    expect(effectiveWeekStart('locale', 'en-GB')).toBe(1)
  })

  it('an explicit week start wins over the locale', () => {
    expect(effectiveWeekStart(1, 'en-US')).toBe(1)
    expect(effectiveWeekStart(0, 'de-DE')).toBe(0)
    expect(effectiveWeekStart(6, 'de-DE')).toBe(6)
    expect(buildCalendarSettingsOptions({ ...base, weekStart: 6 }, 'de').firstDay).toBe(6)
  })

  it('defaultView month mounts month view (and the other views map too)', () => {
    expect(defaultViewName('month')).toBe('dayGridMonth')
    expect(defaultViewName('week')).toBe('timeGridWeek')
    expect(defaultViewName('day')).toBe('timeGridDay')
    expect(defaultViewName('list')).toBe('listWeek')
    expect(buildCalendarSettingsOptions({ ...base, defaultView: 'month' }, 'de').view).toBe(
      'dayGridMonth'
    )
  })

  it('applies changed options to a running calendar without re-mounting', () => {
    const calls: Array<[string, unknown]> = []
    const calendar = { setOption: (name: string, value: unknown) => calls.push([name, value]) }

    const current = buildCalendarSettingsOptions(base, 'de')
    const next = buildCalendarSettingsOptions(
      { ...base, defaultView: 'month', showWeekends: false },
      'de'
    )

    applyCalendarSettingsOptions(calendar, next, current)

    // Exactly the two changed values — nothing else is touched, so the visible
    // date and an open dialog survive the update.
    expect(calls).toEqual([
      ['view', 'dayGridMonth'],
      ['hiddenDays', [0, 6]]
    ])
  })

  it('writes nothing when the settings did not change', () => {
    const calls: Array<[string, unknown]> = []
    const calendar = { setOption: (name: string, value: unknown) => calls.push([name, value]) }
    const current = buildCalendarSettingsOptions(base, 'de')

    applyCalendarSettingsOptions(calendar, buildCalendarSettingsOptions(base, 'de'), current)

    expect(calls).toEqual([])
  })
})
