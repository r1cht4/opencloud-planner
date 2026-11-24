#!/usr/bin/env node
/**
 * Add a released version to Planner's entry in the OpenCloud Web App Store list
 * (`webApps/apps.json` in opencloud-eu/awesome-apps).
 *
 *   node scripts/store-entry.mjs <apps.json> --id <app id> --version <x.y.z> \
 *     --url <zip url> --date <YYYY-MM-DD> [--min-opencloud <x.y.z>]
 *
 * The store expects `versions` newest first, so the new version goes on top.
 * The file is edited as text, not re-serialised: the list is maintained by
 * hand by many authors, and rewriting it would reformat every other entry.
 * Only the new version object is inserted; the result is parsed again and
 * checked before it is written.
 *
 * `minOpenCloud` defaults to the value of the newest listed version.
 *
 * Prints one status line and exits 0 for:
 * - `status=added`       the version was inserted and the file written,
 * - `status=exists`      the version is already listed (nothing to do),
 * - `status=not-listed`  the app has no entry yet (the first entry is added by
 *                        hand, with its cover and screenshots).
 * Exits 1 on bad arguments or a file it cannot edit safely.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Insert `version` at the top of the app's `versions` list.
 * Returns `{ status, text }`; `text` is the new file content when `status` is
 * `added`, otherwise the unchanged input.
 */
export function addStoreVersion(text, { id, version, url, releaseDate, minOpenCloud }) {
  const doc = JSON.parse(text)
  const apps = Array.isArray(doc?.apps) ? doc.apps : null
  if (!apps) throw new Error('no "apps" list in the file')
  const app = apps.find((entry) => entry?.id === id)
  if (!app) return { status: 'not-listed', text }
  if (!Array.isArray(app.versions)) throw new Error(`app ${id} has no "versions" list`)
  if (app.versions.some((entry) => entry?.version === version)) return { status: 'exists', text }

  const entry = { version, releaseDate }
  const min = minOpenCloud || app.versions[0]?.minOpenCloud
  if (min) entry.minOpenCloud = min
  entry.url = url

  // Locate `"versions": [` of this app: after its id, before the next app's id.
  const idAt = text.indexOf(`"id": ${JSON.stringify(id)}`)
  if (idAt < 0) throw new Error(`cannot find the id line of ${id}`)
  const nextIdAt = text.indexOf('"id": "', idAt + 1)
  const listAt = text.indexOf('"versions": [', idAt)
  if (listAt < 0 || (nextIdAt >= 0 && listAt > nextIdAt)) {
    throw new Error(`cannot find the "versions" list of ${id}`)
  }
  const insertAt = text.indexOf('\n', listAt) + 1
  const indent = /^[ \t]*/.exec(text.slice(insertAt))[0]
  const block = JSON.stringify(entry, null, 2)
    .split('\n')
    .map((line) => indent + line)
    .join('\n')
  const next = `${text.slice(0, insertAt)}${block},\n${text.slice(insertAt)}`

  // The edit must change exactly one thing: the new version on top of this app.
  const check = JSON.parse(next)
  const changed = check.apps.find((candidate) => candidate?.id === id)
  if (JSON.stringify(changed.versions[0]) !== JSON.stringify(entry)) {
    throw new Error('the inserted version did not land on top of the list')
  }
  changed.versions.shift()
  if (JSON.stringify(check) !== JSON.stringify(doc)) {
    throw new Error('the edit changed more than the new version')
  }
  return { status: 'added', text: next }
}

function parseArgs(argv) {
  const [file, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    const value = rest[i + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`bad argument: ${key}`)
    options[key.slice(2)] = value
  }
  for (const key of ['id', 'version', 'url', 'date']) {
    if (!options[key]) throw new Error(`missing --${key}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD')
  if (!/^https:\/\//.test(options.url)) throw new Error('--url must be an https URL')
  if (!file) throw new Error('missing <apps.json>')
  return { file, options }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const { file, options } = parseArgs(argv)
    const { status, text } = addStoreVersion(readFileSync(file, 'utf8'), {
      id: options.id,
      version: options.version,
      url: options.url,
      releaseDate: options.date,
      minOpenCloud: options['min-opencloud']
    })
    if (status === 'added') writeFileSync(file, text)
    console.log(`status=${status}`)
    return 0
  } catch (error) {
    console.error(`store-entry: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return 1
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
