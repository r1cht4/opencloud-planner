/**
 * `$gettext` / `$ngettext` need a literal first argument: `vue-gettext-extract`
 * only sees literals, so `$gettext(LABELS[id])` compiles, passes `l10n:check`
 * and still shows English in every language (the Settings tab labels and the
 * attendee status badges did exactly that).
 *
 * The few indexed lookups that remain are listed here with the strings they can
 * produce; those strings must be in the template, i.e. appear literally elsewhere.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePoFile } from '../../scripts/check-l10n.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Indexed lookups that are allowed, with every string they can pass. */
const ALLOWED: Record<string, string[]> = {
  // APP_META[key].label in the app menu and the sidebars.
  'src/navigation.ts': ['Calendar', 'Contacts', 'Tasks'],
  // APP_LABELS[key] in the Apps group.
  'src/components/settings/GeneralSettings.vue': ['Calendar', 'Contacts', 'Tasks']
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue|js)$/.test(name) ? [path] : []
  })
}

/** Strip block and line comments so documentation examples do not count. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('gettext calls use literal strings', () => {
  it('has no non-literal $gettext / $ngettext argument outside the allow-list', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(root, 'src'))) {
      const rel = relative(root, file)
      if (rel in ALLOWED) continue
      const text = withoutComments(readFileSync(file, 'utf8'))
      for (const match of text.matchAll(/\$n?gettext\(\s*([^'"`\s)])/g)) {
        offenders.push(`${rel}: ${text.slice(match.index, match.index + 40).split('\n')[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('finds the strings of the allowed lookups in the template', () => {
    const pot = parsePoFile(readFileSync(join(root, 'l10n/template.pot'), 'utf8'))
    const msgids = new Set(pot.entries.map((entry: { msgid: string }) => entry.msgid))
    const missing = Object.values(ALLOWED)
      .flat()
      .filter((text) => !msgids.has(text))
    expect(missing).toEqual([])
  })

  it('has the Settings tab labels and attendee statuses in the template', () => {
    const pot = parsePoFile(readFileSync(join(root, 'l10n/template.pot'), 'utf8'))
    const msgids = new Set(pot.entries.map((entry: { msgid: string }) => entry.msgid))
    const expected = [
      'General',
      'Data',
      'Devices',
      'About',
      'Accepted',
      'Declined',
      'Tentative',
      'Needs action',
      'Delegated'
    ]
    expect(expected.filter((text) => !msgids.has(text))).toEqual([])
  })
})
