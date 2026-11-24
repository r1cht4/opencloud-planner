#!/usr/bin/env node
/**
 * Translation workflow check for the Calendar & Contacts extension.
 *
 * The strings live in the gettext catalog (`l10n/`): `l10n/template.pot` is
 * extracted from the source (`pnpm l10n:extract`), the translations for
 * de/fr/es live in `l10n/locale/<lang>/app.po`, and `l10n/translations.json`
 * is the compiled catalog the app ships (`pnpm l10n:compile`).
 *
 * This check fails (exit 1) when
 * - a msgid of `l10n/template.pot` is missing from any of `de`/`fr`/`es`,
 * - a msgid (including the plural forms `msgstr[0]`/`msgstr[1]`) has an
 *   empty translation in any language, or
 * - `l10n/translations.json` no longer matches the .po files — the catalog
 *   was changed without running `pnpm l10n:compile` (the expected JSON is
 *   re-compiled in memory with the same rules `vue-gettext-compile` applies).
 *
 * Dependency-free (a minimal PO parser is included) so it runs everywhere,
 * including environments without the GNU gettext binaries.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LANGUAGES = ['de', 'fr', 'es']
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Unescape a PO string literal body (single pass, like gettext does). */
function unescapePo(value) {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char !== '\\' || i === value.length - 1) {
      out += char
      continue
    }
    const next = value[++i]
    if (next === 'n') out += '\n'
    else if (next === 't') out += '\t'
    else out += next // \" \\ and unknown escapes are kept literally
  }
  return out
}

/**
 * Parse a PO/POT file into `{ headers, entries }`. Each entry is
 * `{ msgctxt, msgid, msgid_plural, msgstr: string[], fuzzy, obsolete }`;
 * the header (msgid "") is exposed as a `{ Language, 'Plural-Forms', … }`
 * map instead of an entry.
 */
export function parsePoFile(source) {
  const parsed = []
  let entry = null
  let fuzzy = false
  let obsolete = false
  let pendingMsgctxt = ''

  const finish = () => {
    if (entry && entry.rawMsgid !== null) {
      parsed.push({
        msgctxt: entry.msgctxt,
        msgid: unescapePo(entry.rawMsgid),
        msgid_plural: entry.rawMsgidPlural === null ? null : unescapePo(entry.rawMsgidPlural),
        msgstr: entry.rawMsgstr.map(unescapePo),
        fuzzy,
        obsolete
      })
      entry = null
      fuzzy = false
      obsolete = false
    }
  }
  for (const line of source.split('\n')) {
    if (line === '') {
      finish()
      continue
    }
    // Comments: `#, fuzzy` marks not-yet-reviewed translations, `#~` marks
    // obsolete entries (the reference msgid stays on the same line).
    // The flags are pending until the entry below carries them; `finish()`
    // resets them only together with its entry.
    let rest = line
    if (line.startsWith('#,') && line.includes('fuzzy')) fuzzy = true
    else if (line.startsWith('#~')) {
      obsolete = true
      rest = line.slice(2).trimStart()
    }
    if (rest.startsWith('#')) continue
    if (rest === '') continue

    const msgctxt = rest.match(/^msgctxt "(.*)"$/)
    if (msgctxt) {
      finish()
      pendingMsgctxt = unescapePo(msgctxt[1])
      continue
    }
    const msgid = rest.match(/^msgid "(.*)"$/)
    if (msgid) {
      finish()
      entry = { msgctxt: pendingMsgctxt, rawMsgid: msgid[1], rawMsgidPlural: null, rawMsgstr: [] }
      continue
    }
    const msgid_plural = rest.match(/^msgid_plural "(.*)"$/)
    if (msgid_plural) {
      if (entry) entry.rawMsgidPlural = msgid_plural[1]
      continue
    }
    const msgstr = rest.match(/^msgstr(?:\[(\d+)\])? "(.*)"$/)
    if (msgstr) {
      if (entry) entry.rawMsgstr.push(msgstr[2])
      continue
    }
    // Continuation line of the previous literal: the pieces concatenate
    // before the escapes are resolved.
    const continuation = rest.match(/^"(.*)"$/)
    if (continuation && entry) {
      if (entry.rawMsgidPlural !== null && !entry.rawMsgstr.length) {
        entry.rawMsgidPlural += continuation[1]
      } else if (entry.rawMsgstr.length) {
        entry.rawMsgstr[entry.rawMsgstr.length - 1] += continuation[1]
      } else {
        entry.rawMsgid += continuation[1]
      }
    }
  }
  finish()

  const headerEntry = parsed.find((e) => e.msgid === '' && e.msgstr.length)
  const headers = {}
  if (headerEntry) {
    for (const header of headerEntry.msgstr.join('').split('\n')) {
      const index = header.indexOf(':')
      if (index < 1) continue
      headers[header.slice(0, index)] = header.slice(index + 1).trim()
    }
  }
  return { headers, entries: parsed.filter((e) => e.msgid !== '') }
}

/** The `%{name}` interpolation placeholders of a text. */
export function placeholdersOf(text) {
  const found = text.match(/%\{[^}]+\}/g) ?? []
  return [...new Set(found)].sort()
}

/**
 * Compile parsed entries into the flattened message map the vue3-gettext
 * runtime expects — the same rules `vue-gettext-compile` applies: fuzzy and
 * obsolete entries are dropped, msgids without a translation are dropped,
 * plural entries become msgstr arrays and msgctxt entries are keyed
 * `msgctxt\u0004msgid`.
 */
export function compilePoToMessages(entries) {
  const messages = {}
  for (const entry of entries) {
    if (entry.fuzzy || entry.obsolete) continue
    if (!entry.msgstr[0] || entry.msgstr[0].length === 0) continue
    const key = entry.msgctxt ? `${entry.msgctxt}\u0004${entry.msgid}` : entry.msgid
    messages[key] = entry.msgstr.length === 1 ? entry.msgstr[0] : entry.msgstr
  }
  return messages
}

/** Deep, key-order-independent comparison of two JSON value trees. */
export function deepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
}

/** True when every msgstr form carries exactly the msgid's placeholders. */
export function hasValidPlaceholders(entry) {
  const expected = placeholdersOf([entry.msgid, entry.msgid_plural].filter(Boolean).join(' '))
  if (!expected.length) return true
  return entry.msgstr.every((form) => {
    const actual = placeholdersOf(form)
    return expected.length === actual.length && expected.every((p, i) => p === actual[i])
  })
}

/**
 * Run the check against `rootDir` (the repo by default).
 * Returns the report that `formatReport` renders; `exitCode` is 1 on failure.
 */
export function checkL10n({ rootDir = DEFAULT_ROOT } = {}) {
  const l10nDir = join(rootDir, 'l10n')
  const potFile = join(l10nDir, 'template.pot')
  const jsonFile = join(l10nDir, 'translations.json')
  if (!existsSync(potFile)) throw new Error(`template not found: ${potFile}`)
  if (!existsSync(jsonFile)) throw new Error(`compiled catalog not found: ${jsonFile}`)

  const pot = parsePoFile(readFileSync(potFile, 'utf8'))
  const json = JSON.parse(readFileSync(jsonFile, 'utf8'))

  const missing = {}
  const empty = {}
  const placeholders = {}
  const duplicates = {}
  let jsonUpToDate = true

  for (const lang of LANGUAGES) {
    missing[lang] = []
    empty[lang] = []
    placeholders[lang] = []
    duplicates[lang] = []
    const poFile = join(l10nDir, 'locale', lang, 'app.po')
    if (!existsSync(poFile)) throw new Error(`catalog not found: ${poFile}`)
    const { entries, headers } = parsePoFile(readFileSync(poFile, 'utf8'))
    if (headers.Language !== lang) {
      throw new Error(`l10n/locale/${lang}/app.po: "Language: ${lang}" header missing`)
    }

    // msgmerge refuses a catalog with a msgid defined twice, so `l10n:extract`
    // would fail on the next run: catch it here.
    const seen = new Set()
    for (const e of entries) {
      if (e.obsolete || !e.msgid) continue
      const key = `${e.msgctxt}\u0004${e.msgid}`
      if (seen.has(key)) duplicates[lang].push(e.msgid)
      seen.add(key)
    }

    const byMsgid = new Map(entries.map((e) => [`${e.msgctxt}\u0004${e.msgid}`, e]))
    for (const potEntry of pot.entries) {
      const key = `${potEntry.msgctxt}\u0004${potEntry.msgid}`
      const entry = byMsgid.get(key)
      if (!entry || entry.obsolete || entry.fuzzy) {
        missing[lang].push(potEntry.msgid)
        continue
      }
      const forms = potEntry.msgid_plural ? entry.msgstr : entry.msgstr.slice(0, 1)
      if (forms.length < (potEntry.msgid_plural ? 2 : 1) || forms.some((form) => !form)) {
        empty[lang].push(potEntry.msgid)
      }
      if (!hasValidPlaceholders(entry)) placeholders[lang].push(potEntry.msgid)
    }

    // The shipped catalog must match the .po content (order-independent).
    const expected = compilePoToMessages(entries)
    if (!json[lang] || !deepEqual(json[lang], expected)) jsonUpToDate = false
  }

  const ok =
    LANGUAGES.every(
      (lang) =>
        missing[lang].length === 0 &&
        empty[lang].length === 0 &&
        placeholders[lang].length === 0 &&
        duplicates[lang].length === 0
    ) && jsonUpToDate

  return {
    ok,
    exitCode: ok ? 0 : 1,
    potEntries: pot.entries.length,
    missing,
    empty,
    placeholders,
    duplicates,
    jsonUpToDate
  }
}

export function formatReport(report) {
  const lines = [
    `l10n check: ${report.potEntries} msgid(s) in l10n/template.pot must be translated in ${LANGUAGES.join(', ')}`
  ]

  let missingCount = 0
  for (const lang of LANGUAGES) {
    const list = report.missing[lang]
    missingCount += list.length
    if (!list.length) continue
    lines.push(`  missing in ${lang} (${list.length}):`)
    for (const msgid of list) lines.push(`    - ${JSON.stringify(msgid)}`)
  }

  let emptyCount = 0
  for (const lang of LANGUAGES) {
    const list = report.empty[lang]
    emptyCount += list.length
    if (!list.length) continue
    lines.push(`  empty translation in ${lang} (${list.length}):`)
    for (const msgid of list) lines.push(`    - ${JSON.stringify(msgid)}`)
  }

  for (const lang of LANGUAGES) {
    const list = report.placeholders[lang]
    if (!list.length) continue
    lines.push(`  broken %{…} placeholder in ${lang} (${list.length}):`)
    for (const msgid of list) lines.push(`    - ${JSON.stringify(msgid)}`)
  }

  for (const lang of LANGUAGES) {
    const list = report.duplicates[lang]
    if (!list.length) continue
    lines.push(`  msgid defined twice in ${lang} (${list.length}):`)
    for (const msgid of list) lines.push(`    - ${JSON.stringify(msgid)}`)
  }

  if (!report.jsonUpToDate) {
    lines.push('  l10n/translations.json does not match the .po files')
    lines.push('    → run `pnpm l10n:compile` and commit the result')
  }

  if (report.ok)
    lines.push(`OK: l10n/template.pot, the .po files and translations.json are in sync`)
  else
    lines.push(
      `FAIL: ${missingCount} missing and ${emptyCount} empty translation(s)${report.jsonUpToDate ? '' : ', stale compiled catalog'}`
    )
  return lines.join('\n')
}

export function main() {
  let report
  try {
    report = checkL10n()
  } catch (error) {
    console.error(`check-l10n: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return 1
  }
  const output = formatReport(report)
  if (report.ok) console.log(output)
  else console.error(output)
  process.exitCode = report.exitCode
  return report.exitCode
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
