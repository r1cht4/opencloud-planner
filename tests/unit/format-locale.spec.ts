/**
 * Regression: an English OpenCloud UI showed 12 h / month-first formats for a
 * user whose browser formats dates the German way. The format locale is now
 * UI language + format region (+ forced clock), see src/settings/formatLocale.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  buildFormatLocale,
  formatClock,
  formatLocaleFor,
  languageOf,
  regionOf
} from '../../src/settings/formatLocale'
import { isValidSettingValue, resolveSettings } from '../../src/settings/schema'

const at = new Date(2026, 10, 24, 14, 5)
const time = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at)
const date = (locale: string) =>
  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(at)

describe('format locale', () => {
  it('English UI + German region → English names, day-first dates, 24 h', () => {
    const locale = formatLocaleFor('en', { formatRegion: 'DE', timeFormat: 'auto' })
    expect(locale).toBe('en-DE')
    expect(time(locale)).toBe('14:05')
    expect(date(locale)).toBe('24/11/2026')
    expect(at.toLocaleDateString(locale, { month: 'long' })).toBe('November')
  })

  it("'auto' takes the region of the browser format locale", () => {
    const locale = formatLocaleFor('en', { formatRegion: 'auto', timeFormat: 'auto' }, () => 'DE')
    expect(locale).toBe('en-DE')
    expect(
      formatLocaleFor('de_DE', { formatRegion: 'auto', timeFormat: 'auto' }, () => undefined)
    ).toBe('de')
  })

  it('the clock setting overrides the region', () => {
    expect(time(buildFormatLocale('en', 'US', '24h'))).toBe('14:05')
    expect(time(buildFormatLocale('de', 'DE', '12h'))).toMatch(/2:05\s?PM/i)
    expect(time(buildFormatLocale('en', 'US', 'auto'))).toMatch(/2:05\s?PM/)
  })

  it('invalid input falls back to the bare UI language', () => {
    expect(buildFormatLocale('en', 'not a region', 'auto')).toBe('en')
    expect(buildFormatLocale('', undefined, 'auto')).toBe('en')
    expect(languageOf('pt_BR')).toBe('pt')
    expect(regionOf('de-DE')).toBe('DE')
    expect(regionOf('en')).toBeUndefined()
  })

  it('formatClock renders HH:MM in the locale clock', () => {
    expect(formatClock('14:05', 'en-DE')).toBe('14:05')
    expect(formatClock('14:05', 'en-US')).toMatch(/02:05\s?PM/)
    expect(formatClock('garbage', 'en-US')).toBe('garbage')
  })

  it('schema accepts only valid region/clock values', () => {
    expect(isValidSettingValue('general.formatRegion', 'auto')).toBe(true)
    expect(isValidSettingValue('general.formatRegion', 'DE')).toBe(true)
    expect(isValidSettingValue('general.formatRegion', 'de')).toBe(false)
    expect(isValidSettingValue('general.timeFormat', '24h')).toBe(true)
    expect(isValidSettingValue('general.timeFormat', '25h')).toBe(false)
    const resolved = resolveSettings(
      { version: 1, general: { formatRegion: 'xx', timeFormat: '24h' } },
      {}
    )
    expect(resolved.general.formatRegion).toBe('auto')
    expect(resolved.general.timeFormat).toBe('24h')
  })
})
