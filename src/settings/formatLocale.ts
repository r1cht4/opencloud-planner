/**
 * The locale used to format dates and times.
 *
 * Texts follow the OpenCloud language, but date order and the 12/24-hour clock
 * are a regional choice: someone reading the UI in English may still expect
 * `24/11/2026, 14:05`. So the format locale is built from
 *   - the language of the OpenCloud UI (`en`, `de`, …),
 *   - a region: the `general.formatRegion` setting, or (on `'auto'`) the region
 *     of the browser's own format locale (`DE` from `de-DE`, …),
 *   - an hour cycle when `general.timeFormat` forces one.
 * `en` + `DE` gives `en-DE`: English month/day names, day-first dates, 24 h.
 *
 * Pure functions plus one composable; no DAV.
 */

import { computed, type ComputedRef } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { GeneralSettings } from './schema'
import { useSettings } from './settingsStore'

export type TimeFormat = 'auto' | '24h' | '12h'

/** Regions offered in the settings (any valid ISO 3166 code is accepted from admin config). */
export const FORMAT_REGIONS = [
  'DE',
  'AT',
  'CH',
  'GB',
  'IE',
  'US',
  'CA',
  'AU',
  'FR',
  'BE',
  'NL',
  'ES',
  'IT'
] as const

/** True for a two-letter region code (`DE`) or a UN M.49 area (`419`) — same rule as the schema validator. */
function isRegionCode(value: unknown): value is string {
  return typeof value === 'string' && /^([A-Z]{2}|\d{3})$/.test(value)
}

/** `de_DE` / `pt-BR` / `` → `de` / `pt` / `en`. */
export function languageOf(uiLanguage: unknown): string {
  // `current` is a plain string on the vue3-gettext instance; tolerate a ref too.
  const raw =
    typeof uiLanguage === 'string'
      ? uiLanguage
      : typeof (uiLanguage as { value?: unknown } | null)?.value === 'string'
        ? (uiLanguage as { value: string }).value
        : ''
  const lang = raw.split(/[_-]/)[0].toLowerCase()
  return /^[a-z]{2,3}$/.test(lang) ? lang : 'en'
}

/** Region subtag of a BCP 47 tag, if any. */
export function regionOf(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined
  try {
    return new Intl.Locale(tag.replace(/_/g, '-')).region
  } catch {
    return undefined
  }
}

/**
 * Region of the browser's format locale. The Intl default locale comes first:
 * that is where a browser's "regional format" setting shows up (Firefox:
 * "Use your operating system settings … to format dates"). The page language
 * list (`navigator.languages`) is the fallback.
 */
export function browserFormatRegion(): string | undefined {
  const candidates: (string | undefined)[] = []
  try {
    candidates.push(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    // no Intl default — fall through to navigator
  }
  if (typeof navigator !== 'undefined') {
    candidates.push(...(navigator.languages ?? []), navigator.language)
  }
  for (const tag of candidates) {
    const region = regionOf(tag)
    if (region) return region
  }
  return undefined
}

/** Hour cycle forced by `timeFormat`, or `undefined` for the region's own. */
function hourCycleFor(timeFormat: TimeFormat): 'h23' | 'h12' | undefined {
  if (timeFormat === '24h') return 'h23'
  if (timeFormat === '12h') return 'h12'
  return undefined
}

/**
 * Build the format locale. Always returns a tag `Intl` accepts; anything
 * invalid falls back to the bare UI language.
 */
export function buildFormatLocale(
  uiLanguage: unknown,
  region: string | undefined,
  timeFormat: TimeFormat
): string {
  const lang = languageOf(uiLanguage)
  const hourCycle = hourCycleFor(timeFormat)
  try {
    const tag = new Intl.Locale(lang, {
      ...(region && isRegionCode(region) ? { region } : {}),
      ...(hourCycle ? { hourCycle } : {})
    }).toString()
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 ? tag : lang
  } catch {
    return lang
  }
}

/** Format locale for the given UI language and `general.*` settings. */
export function formatLocaleFor(
  uiLanguage: unknown,
  general: Pick<GeneralSettings, 'formatRegion' | 'timeFormat'>,
  detectRegion: () => string | undefined = browserFormatRegion
): string {
  const region = general.formatRegion === 'auto' ? detectRegion() : general.formatRegion
  return buildFormatLocale(uiLanguage, region, general.timeFormat)
}

/**
 * Setup-time composable: the format locale, reactive to language and settings.
 * Reads `current` through the gettext instance (destructuring it would freeze
 * the language at setup).
 */
export function useFormatLocale(): ComputedRef<string> {
  const gettext = useGettext()
  const { settings } = useSettings()
  return computed(() => formatLocaleFor(gettext.current, settings.value.general))
}

/** Localised region name for the settings select (`DE` → `Germany`). */
export function regionLabel(region: string, uiLanguage: unknown): string {
  try {
    const names = new Intl.DisplayNames([languageOf(uiLanguage)], { type: 'region' })
    return names.of(region) || region
  } catch {
    return region
  }
}

/** `'HH:MM'` (24 h wall-clock) → the locale's clock (`14:05` / `2:05 PM`); unparsable input is returned as-is. */
export function formatClock(hhmm: string, locale: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!match) return hhmm
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
    )
  } catch {
    return hhmm
  }
}

/** Sample of the resulting format, e.g. `24/11/2026, 14:05`. */
export function formatSample(locale: string, at: Date = new Date(2026, 10, 24, 14, 5)): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(at)
  } catch {
    return ''
  }
}
