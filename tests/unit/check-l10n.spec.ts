/**
 * scripts/check-l10n.mjs — the gettext workflow check.
 *
 * The PO parser, the in-memory compiler, the placeholder rule and the
 * end-to-end `checkL10n()` are covered against fixtures written to a temp
 * directory (the function must fail for missing/empty translations and for
 * a stale compiled catalog) and against the real `l10n/` tree.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LANGUAGES,
  checkL10n,
  formatReport,
  compilePoToMessages,
  deepEqual,
  hasValidPlaceholders,
  parsePoFile
} from '../../scripts/check-l10n.mjs'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

const POT = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Calendar"
msgstr ""

msgid "%{count} event imported"
msgid_plural "%{count} events imported"
msgstr[0] ""
msgstr[1] ""
`

function poFile(lang: string, { empty = false, missing = false, duplicate = false } = {}): string {
  const body = [
    'msgid ""',
    'msgstr ""',
    `"Language: ${lang}\\n"`,
    `"Plural-Forms: nplurals=2; plural=(n != 1);\\n"`,
    '',
    'msgid "Calendar"',
    `msgstr "${lang === 'de' ? 'Kalender' : 'Calendario'}"`,
    '',
    'msgid "%{count} event imported"',
    'msgid_plural "%{count} events imported"',
    `msgstr[0] "${lang === 'de' ? '%{count} Termin importiert' : '%{count} evento importado'}"`,
    `msgstr[1] "${lang === 'de' ? '%{count} Termine importiert' : '%{count} eventos importados'}"`,
    ''
  ]
  let source = body.join('\n')
  if (empty) {
    source = source.replace('msgid "Calendar"\nmsgstr "Kalender"', 'msgid "Calendar"\nmsgstr ""')
  }
  if (duplicate) {
    source += `\nmsgid "Calendar"\nmsgstr "${lang === 'de' ? 'Kalender' : 'Calendario'}"\n`
  }
  if (missing) {
    source = source.replace('msgid "%{count} event imported"', 'msgid "%{count} event unused"')
  }
  return source
}

/** Minimal `l10n/` tree in a temp directory, with a consistent compiled catalog. */
function writeL10nTree(
  root: string,
  poOptions: Record<string, { empty?: boolean; missing?: boolean; duplicate?: boolean }>
) {
  mkdirSync(join(root, 'l10n/locale'), { recursive: true })
  writeFileSync(join(root, 'l10n/template.pot'), POT)
  const messages: Record<string, Record<string, string | string[]>> = {}
  for (const lang of LANGUAGES) {
    const source = poFile(lang, poOptions[lang] ?? {})
    messages[lang] = compilePoToMessages(parsePoFile(source).entries)
    mkdirSync(join(root, 'l10n/locale', lang), { recursive: true })
    writeFileSync(join(root, 'l10n/locale', lang, 'app.po'), source)
  }
  writeFileSync(join(root, 'l10n/translations.json'), JSON.stringify(messages))
}

describe('parsePoFile', () => {
  it('parses headers, entries and plural forms', () => {
    const { headers, entries } = parsePoFile(poFile('de'))
    expect(headers.Language).toBe('de')
    expect(headers['Plural-Forms']).toBe('nplurals=2; plural=(n != 1);')
    const simple = entries.find((entry) => entry.msgid === 'Calendar')
    expect(simple?.msgstr).toEqual(['Kalender'])
    const plural = entries.find((entry) => entry.msgid === '%{count} event imported')
    expect(plural?.msgid_plural).toBe('%{count} events imported')
    expect(plural?.msgstr).toHaveLength(2)
  })

  it('joins continuation lines before resolving escapes', () => {
    const source = [
      'msgid "line one\\n"',
      '"line two"', // continuation of the msgid
      'msgstr "Zeile eins\\n"',
      '"Zeile zwei"',
      ''
    ].join('\n')
    const { entries } = parsePoFile(source)
    expect(entries[0].msgid).toBe('line one\nline two')
    expect(entries[0].msgstr).toEqual(['Zeile eins\nZeile zwei'])
  })

  it('resolves escaped quotes, tabs and msgctxt keys', () => {
    const source = [
      'msgctxt "noun"',
      'msgid "Post"',
      'msgstr "Beitrag"',
      '',
      'msgid "with \\"quotes\\" and\\ttab"',
      'msgstr "mit \\"Anführungszeichen\\" und\\tTab"',
      ''
    ].join('\n')
    const { entries } = parsePoFile(source)
    expect(entries[0]).toMatchObject({ msgctxt: 'noun', msgid: 'Post', msgstr: ['Beitrag'] })
    expect(entries[1].msgid).toBe('with "quotes" and\ttab')
    expect(entries[1].msgstr).toEqual(['mit "Anführungszeichen" und\tTab'])
  })

  it('flags fuzzy and obsolete entries', () => {
    const source = [
      '#, fuzzy',
      'msgid "Needs review"',
      'msgstr "Ungeprüft"',
      '',
      '#~ msgid "Removed from source"',
      '#~ msgstr "Nicht mehr benutzt"',
      ''
    ].join('\n')
    const { entries } = parsePoFile(source)
    expect(entries[0]).toMatchObject({ msgid: 'Needs review', fuzzy: true })
    expect(entries[1]).toMatchObject({ msgid: 'Removed from source', obsolete: true })
  })
})

describe('compilePoToMessages', () => {
  it('flattens simple entries to strings and plurals to arrays', () => {
    const { entries } = parsePoFile(poFile('de'))
    expect(compilePoToMessages(entries)).toEqual({
      Calendar: 'Kalender',
      '%{count} event imported': ['%{count} Termin importiert', '%{count} Termine importiert']
    })
  })

  it('drops untranslated, fuzzy and obsolete entries and keys msgctxt entries', () => {
    const { entries } = parsePoFile(
      [
        'msgid "empty"',
        'msgstr ""',
        '',
        '#, fuzzy',
        'msgid "fuzzy"',
        'msgstr "Ungeprüft"',
        '',
        '#~ obsolete',
        'msgid "obsolete"',
        'msgstr "Alt"',
        '',
        'msgctxt "noun"',
        'msgid "Post"',
        'msgstr "Beitrag"',
        ''
      ].join('\n')
    )
    expect(compilePoToMessages(entries)).toEqual({ 'noun\u0004Post': 'Beitrag' })
  })
})

describe('deepEqual', () => {
  it('is key-order independent but type sensitive', () => {
    expect(deepEqual({ a: 1, b: [1, 'x'] }, { b: [1, 'x'], a: 1 })).toBe(true)
    expect(deepEqual({ a: '1' }, { a: 1 })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })
})

describe('hasValidPlaceholders', () => {
  it('accepts translations that keep the msgid placeholders', () => {
    expect(
      hasValidPlaceholders({
        msgid: '%{count} of %{total}',
        msgid_plural: null,
        msgstr: ['%{count} von %{total}'],
        msgctxt: '',
        fuzzy: false,
        obsolete: false
      })
    ).toBe(true)
  })

  it('rejects lost and unknown placeholders', () => {
    expect(
      hasValidPlaceholders({
        msgctxt: '',
        msgid: '%{count}',
        msgid_plural: null,
        msgstr: ['%{zahl}'],
        fuzzy: false,
        obsolete: false
      })
    ).toBe(false)
    expect(
      hasValidPlaceholders({
        msgctxt: '',
        msgid: 'no placeholder',
        msgid_plural: null,
        msgstr: ['%{extra}'],
        fuzzy: false,
        obsolete: false
      })
    ).toBe(true) // msgid has none → translation may add
    expect(
      hasValidPlaceholders({
        msgctxt: '',
        msgid: '%{count}',
        msgid_plural: '%{count}s',
        msgstr: ['%{count}', '%{n}'],
        fuzzy: false,
        obsolete: false
      })
    ).toBe(false)
  })
})

describe('checkL10n', () => {
  it('passes for a consistent tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-ok-'))
    tempDirs.push(root)
    writeL10nTree(root, {})
    const report = checkL10n({ rootDir: root })
    expect(report.ok).toBe(true)
    expect(report.exitCode).toBe(0)
  })

  it('fails for an empty translation', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-empty-'))
    tempDirs.push(root)
    writeL10nTree(root, { de: { empty: true } })
    const report = checkL10n({ rootDir: root })
    expect(report.ok).toBe(false)
    expect(report.empty.de).toEqual(['Calendar'])
  })

  it('fails for a msgid defined twice (msgmerge would refuse the catalog)', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-duplicate-'))
    tempDirs.push(root)
    writeL10nTree(root, { es: { duplicate: true } })
    const report = checkL10n({ rootDir: root })
    expect(report.ok).toBe(false)
    expect(report.duplicates.es).toEqual(['Calendar'])
    expect(formatReport(report)).toContain('msgid defined twice in es')
  })

  it('fails for a msgid missing from a language', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-missing-'))
    tempDirs.push(root)
    writeL10nTree(root, { fr: { missing: true } })
    const report = checkL10n({ rootDir: root })
    expect(report.ok).toBe(false)
    expect(report.missing.fr).toContain('%{count} event imported')
  })

  it('fails when translations.json is older than the .po files', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-stale-'))
    tempDirs.push(root)
    writeL10nTree(root, {})
    const report = checkL10n({ rootDir: root })
    expect(report.ok).toBe(true)
    // Re-translate one .po after compiling: the catalog must be flagged stale.
    const poPath = join(root, 'l10n/locale/de/app.po')
    writeFileSync(
      poPath,
      readFileSync(poPath, 'utf8').replace('msgstr "Kalender"', 'msgstr "Kalenner"')
    )
    const stale = checkL10n({ rootDir: root })
    expect(stale.ok).toBe(false)
    expect(stale.jsonUpToDate).toBe(false)
  })

  it('throws when the Language header does not match the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-l10n-header-'))
    tempDirs.push(root)
    writeL10nTree(root, {})
    writeFileSync(
      join(root, 'l10n/locale/fr/app.po'),
      poFile('fr').replace('"Language: fr\\n"', '"Language: de\\n"')
    )
    expect(() => checkL10n({ rootDir: root })).toThrowError(/Language/)
  })

  it('passes for the real l10n/ tree of this repository', () => {
    const report = checkL10n()
    expect(report.ok).toBe(true)
    expect(report.potEntries).toBeGreaterThan(100)
  })
})
