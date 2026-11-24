/**
 * colorUtils – `normalizeColor` is the single hex-colour parser (every DAV
 * colour path wraps it); `contrastTextColor` picks a readable text colour for a
 * coloured surface (calendar event blocks use the per-calendar CalDAV colour).
 * Both must tolerate the hex shapes DAV clients produce (`#RGB`, `#RRGGBB`,
 * `#RRGGBBAA`) and never emit a `NaN`-derived colour.
 */
import { describe, expect, it } from 'vitest'

import { contrastTextColor, normalizeColor, parseHexColor } from '../../src/composables/colorUtils'

describe('normalizeColor', () => {
  it('normalises every accepted shape to lower-case #rrggbb', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc')
    expect(normalizeColor('#ABC')).toBe('#aabbcc')
    expect(normalizeColor('#00677F')).toBe('#00677f')
    expect(normalizeColor('#00677f')).toBe('#00677f')
    expect(normalizeColor('#00677F80')).toBe('#00677f')
    expect(normalizeColor('#00677f80')).toBe('#00677f')
    expect(normalizeColor('#FFF')).toBe('#ffffff')
    expect(normalizeColor('#000000')).toBe('#000000')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeColor('  #00677F  ')).toBe('#00677f')
    expect(normalizeColor('\t#abc\n')).toBe('#aabbcc')
  })

  it('returns null for everything that is not a hex colour', () => {
    for (const bad of [
      '',
      '   ',
      '#',
      '#12',
      '#1234',
      '#12345',
      '#1234567',
      '#123456789',
      'red',
      'rebeccapurple',
      'rgb(0,0,0)',
      'var(--oc-role-primary)',
      '#GGGGGG',
      // A missing leading '#' is rejected here (parseHexColor tolerates it).
      '00677F'
    ]) {
      expect(normalizeColor(bad), bad).toBeNull()
    }
  })

  it('accepts null/undefined without throwing', () => {
    expect(normalizeColor(null)).toBeNull()
    expect(normalizeColor(undefined)).toBeNull()
  })

  it('is the parser behind parseHexColor (same accepted shapes, minus #RGBA)', () => {
    for (const value of ['#abc', '#00677F', '#00677f80']) {
      expect(parseHexColor(value), value).not.toBeNull()
      expect(normalizeColor(value), value).not.toBeNull()
    }
    // parseHexColor additionally tolerates a missing '#'.
    expect(parseHexColor('00677F')).toEqual({ r: 0, g: 0x67, b: 0x7f })
    expect(normalizeColor('00677F')).toBeNull()
  })
})

describe('parseHexColor', () => {
  it('parses #RRGGBB', () => {
    expect(parseHexColor('#00677F')).toEqual({ r: 0, g: 0x67, b: 0x7f })
  })

  it('expands #RGB shorthand', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
    expect(parseHexColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('ignores the alpha channel of #RRGGBBAA', () => {
    expect(parseHexColor('#00677F80')).toEqual({ r: 0, g: 0x67, b: 0x7f })
    expect(parseHexColor('#abc0')).toBeNull()
  })

  it('tolerates a missing leading #', () => {
    expect(parseHexColor('00677F')).toEqual({ r: 0, g: 0x67, b: 0x7f })
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', 'red', '#12', '#12345', '#1234567', 'rgb(0,0,0)', '#GGGGGG']) {
      expect(parseHexColor(bad), bad).toBeNull()
    }
  })
})

describe('contrastTextColor', () => {
  it('picks dark text on light backgrounds', () => {
    expect(contrastTextColor('#FFFFFF')).toBe('#191C1D')
    expect(contrastTextColor('#fff')).toBe('#191C1D')
  })

  it('picks white text on dark backgrounds', () => {
    expect(contrastTextColor('#000000')).toBe('#FFFFFF')
    // OpenCloud primary blue is dark enough for white text.
    expect(contrastTextColor('#00677F')).toBe('#FFFFFF')
  })

  it('ignores alpha when deciding', () => {
    expect(contrastTextColor('#FFFFFF00')).toBe('#191C1D')
    expect(contrastTextColor('#000000FF')).toBe('#FFFFFF')
  })

  it('falls back to white text for unparseable input', () => {
    for (const bad of ['', 'nope', '#12', 'var(--oc-role-primary)', '#12345']) {
      expect(contrastTextColor(bad), bad).toBe('#FFFFFF')
    }
  })
})
