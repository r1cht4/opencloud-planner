/**
 * Compiled gettext catalog (`l10n/translations.json`) — parity checks: the
 * shipped catalog must carry the seeded German/French/Spanish translations, at
 * least one plural entry per language and every msgid of `l10n/template.pot`
 * in every language.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LANGUAGES, parsePoFile } from '../../scripts/check-l10n.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
import translations from '../../l10n/translations.json'

const catalog = translations as Record<string, Record<string, string | string[]>>

describe('compiled translations (l10n/translations.json)', () => {
  it('keeps the brand name out of the catalog (never translated)', () => {
    // "Planner" is the product name: the same string in every language, so no
    // catalog may contain a translation for it.
    for (const lang of LANGUAGES) {
      expect(catalog[lang].Planner, lang).toBeUndefined()
    }
  })

  it('has a language block per shipped locale', () => {
    for (const lang of LANGUAGES) {
      expect(Object.keys(catalog[lang]).length).toBeGreaterThan(100)
    }
  })

  it('has a plural entry per language', () => {
    for (const lang of LANGUAGES) {
      const entry = catalog[lang]['%{count} event deleted']
      expect(Array.isArray(entry)).toBe(true)
      expect(entry).toHaveLength(2)
      for (const form of entry as string[]) {
        expect(form).toContain('%{count}')
      }
    }
  })

  it('translates every msgid of l10n/template.pot in every language', () => {
    const pot = parsePoFile(readFileSync(join(root, 'l10n/template.pot'), 'utf8'))
    expect(pot.entries.length).toBeGreaterThan(100)
    for (const lang of LANGUAGES) {
      const language = catalog[lang]
      const missing = pot.entries.filter((entry) => {
        const value = language[entry.msgid]
        if (Array.isArray(value)) return value.some((form) => !form)
        return !value
      })
      expect(
        missing.map((entry) => entry.msgid),
        `${lang}: template msgid missing from the compiled catalog`
      ).toEqual([])
    }
  })
})
