/**
 * Regression tests — `toCsv` must guard against spreadsheet
 * formula injection: cells starting with `=`, `@`, TAB or CR get a leading
 * `'`, and `+`/`-` only when not followed by a digit or space (phone numbers
 * stay intact).
 */
import { describe, expect, it } from 'vitest'
import { guardCsvFormula, parseCsv, toCsv } from '../../src/tools/csv'

describe('guardCsvFormula', () => {
  it('prefixes =, @, TAB and CR', () => {
    expect(guardCsvFormula('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(guardCsvFormula('@cmd')).toBe("'@cmd")
    expect(guardCsvFormula('\t=1+1')).toBe("'\t=1+1")
    expect(guardCsvFormula('\r=1+1')).toBe("'\r=1+1")
  })

  it('keeps phone numbers and numbers: +49…, -5, - 5, + 1', () => {
    expect(guardCsvFormula('+49123456789')).toBe('+49123456789')
    expect(guardCsvFormula('-5')).toBe('-5')
    expect(guardCsvFormula('- 5')).toBe('- 5')
    expect(guardCsvFormula('+ 1')).toBe('+ 1')
  })

  it('prefixes + and - when followed by a letter or nothing', () => {
    expect(guardCsvFormula('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(guardCsvFormula('-HYPERLINK("http://x")')).toBe('\'-HYPERLINK("http://x")')
    expect(guardCsvFormula('-')).toBe("'-")
  })

  it('leaves ordinary text alone', () => {
    expect(guardCsvFormula('Maria Weber')).toBe('Maria Weber')
    expect(guardCsvFormula('')).toBe('')
    expect(guardCsvFormula('1+1=2')).toBe('1+1=2')
  })
})

describe('toCsv applies the guard', () => {
  it('prefixes dangerous cells, also inside quoted cells', () => {
    const csv = toCsv([
      ['Name', 'Notes'],
      ['=cmd|" /C calc"!A0', 'plain'],
      ['+49123456', 'x,y']
    ])
    expect(csv).toContain('"\'=cmd|"" /C calc""!A0"')
    expect(csv).toContain('+49123456')
    expect(csv).toContain('"x,y"')
  })

  it('the guarded output still parses back to the prefixed value', () => {
    const rows = [['=1+1'], ['@x'], ['+49 123'], ['ok']]
    expect(parseCsv(toCsv(rows))).toEqual([["'=1+1"], ["'@x"], ['+49 123'], ['ok']])
  })
})
