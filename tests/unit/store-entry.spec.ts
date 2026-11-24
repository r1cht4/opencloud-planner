/**
 * `scripts/store-entry.mjs` — adds a released version to Planner's entry in the
 * App Store list (opencloud-eu/awesome-apps `webApps/apps.json`). The list is
 * written by hand by many authors, so the edit must insert only the new
 * version and leave every other byte alone.
 */
import { describe, expect, it } from 'vitest'
import { addStoreVersion } from '../../scripts/store-entry.mjs'

const ID = 'com.github.r1cht4.opencloud-planner'
const URL_101 = 'https://github.com/r1cht4/opencloud-planner/releases/download/v1.0.1/x-1.0.1.zip'

// Another author's entry first, formatted their way (escaped umlaut, own key order).
const LIST = `{
  "apps": [
    {
      "id": "com.github.someone.other",
      "name": "Other \\u00e4pp",
      "versions": [
        { "version": "2.0.0", "url": "https://example.com/other-2.0.0.zip" }
      ]
    },
    {
      "id": "${ID}",
      "name": "Planner",
      "versions": [
        {
          "version": "1.0.0",
          "releaseDate": "2026-11-24",
          "minOpenCloud": "9.2.0",
          "url": "https://github.com/r1cht4/opencloud-planner/releases/download/v1.0.0/x-1.0.0.zip"
        }
      ],
      "tags": ["calendar"]
    }
  ]
}
`

const NEW = { id: ID, version: '1.0.1', url: URL_101, releaseDate: '2026-12-01' }

describe('addStoreVersion', () => {
  it('puts the new version on top and keeps minOpenCloud of the newest listed one', () => {
    const { status, text } = addStoreVersion(LIST, NEW)

    expect(status).toBe('added')
    const app = JSON.parse(text).apps[1]
    expect(app.versions.map((v: { version: string }) => v.version)).toEqual(['1.0.1', '1.0.0'])
    expect(app.versions[0]).toEqual({
      version: '1.0.1',
      releaseDate: '2026-12-01',
      minOpenCloud: '9.2.0',
      url: URL_101
    })
  })

  it('inserts text only: every original line is still there, in order', () => {
    const { text } = addStoreVersion(LIST, NEW)

    const added = text.split('\n').filter((line) => !LIST.split('\n').includes(line))
    expect(added.join('\n')).toContain('"version": "1.0.1"')
    // Removing the inserted block gives back the original file byte for byte.
    const start = text.indexOf('        {\n          "version": "1.0.1"')
    const end = text.indexOf('},\n', start) + 3
    expect(text.slice(0, start) + text.slice(end)).toBe(LIST)
    // The other author's escape is untouched.
    expect(text).toContain('"Other \\u00e4pp"')
  })

  it('takes an explicit minOpenCloud', () => {
    const { text } = addStoreVersion(LIST, { ...NEW, minOpenCloud: '10.0.0' })
    expect(JSON.parse(text).apps[1].versions[0].minOpenCloud).toBe('10.0.0')
  })

  it('does nothing when the version is already listed', () => {
    expect(addStoreVersion(LIST, { ...NEW, version: '1.0.0' })).toEqual({
      status: 'exists',
      text: LIST
    })
  })

  it('does nothing while the app has no entry yet', () => {
    expect(addStoreVersion(LIST, { ...NEW, id: 'com.github.r1cht4.missing' })).toEqual({
      status: 'not-listed',
      text: LIST
    })
  })

  it('refuses a file without an apps list', () => {
    expect(() => addStoreVersion('{"other": []}', NEW)).toThrow(/apps/)
  })
})
