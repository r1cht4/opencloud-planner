/**
 * colorUtils – small colour helpers shared by the calendar views.
 *
 * `normalizeColor` is the single hex-colour parser of the extension: every
 * caller that reads a user/server colour (`normalizeDavColor` in the calendar
 * service, `normalizeHexColor` in the collection manager, the DAV collection
 * discovery) wraps it instead of carrying its own regex. `parseHexColor` (and
 * `contrastTextColor` on top of it) is built on the same normalisation.
 *
 * Extracted from Calendar.vue so the logic is unit-testable and reusable by the
 * event blocks (and anything else that paints a coloured surface).
 */

/** Text colour used on light backgrounds (OpenCloud on-surface token). */
const DARK_TEXT = '#191C1D'
/** Text colour used on dark backgrounds. */
const LIGHT_TEXT = '#FFFFFF'
/** Above this perceived luminance the background counts as "light". */
const LUMINANCE_THRESHOLD = 0.6

/**
 * Fallback colour of a collection (calendar chip, event block, task group) that
 * carries no usable CalDAV colour — the OpenCloud primary, the same accent the
 * built-in apps use.
 */
export const DEFAULT_CALENDAR_COLOR = '#00677F'

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` (alpha dropped) — the shapes DAV clients write. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** RGB components of a hex colour. */
export interface RgbColor {
  r: number
  g: number
  b: number
}

/**
 * Normalise a hex colour to `#rrggbb` (lower case, alpha dropped).
 *
 * Accepts `#RGB`, `#RRGGBB` and `#RRGGBBAA`, in any case and with surrounding
 * whitespace; returns `null` for everything else (CSS keywords, `rgb()`, an
 * empty value, `#RGBA`, …). Callers that need a fallback or a different case
 * wrap this (see `normalizeDavColor` / `normalizeHexColor`).
 */
export function normalizeColor(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!HEX_COLOR.test(value)) return null
  const hex = value.slice(1)
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  // `#RRGGBBAA`: the alpha channel is not representable in our theme tokens.
  return `#${expanded.slice(0, 6)}`.toLowerCase()
}

/**
 * Parse `#RGB`, `#RRGGBB` or `#RRGGBBAA` (alpha ignored) into RGB components.
 * Returns `null` for anything that is not a hex colour, so callers can fall
 * back instead of rendering `NaN`-derived colours.
 *
 * Built on `normalizeColor`; a missing leading `#` is tolerated (legacy contract
 * of this helper), a 4-digit `#RGBA` is not.
 */
export function parseHexColor(input: string): RgbColor | null {
  if (typeof input !== 'string') return null
  const value = input.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return null
  const hex = normalizeColor(`#${value}`)
  if (!hex) return null
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  }
}

/**
 * Pick a readable text colour (near-black or white) for a hex background.
 *
 * Accepts `#RGB`, `#RRGGBB`, `#RRGGBBAA` (alpha is ignored) and tolerates a
 * missing leading `#`. Unparseable input yields white text, which is the safe
 * default on the coloured event blocks.
 */
export function contrastTextColor(background: string): string {
  const rgb = parseHexColor(background)
  if (!rgb) return LIGHT_TEXT
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance > LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT
}
