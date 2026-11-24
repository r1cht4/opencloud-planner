/**
 * Toolchain guard (extension SDK 8).
 *
 * The host modules (`vue`, `vue3-gettext`, `@opencloud-eu/web-pkg`,
 * `@opencloud-eu/web-client`) must stay **host-provided**: the SDK's vite config passes its
 * `externalModules` list to `@module-federation/vite` as
 * `shared: { <module>: { singleton: true, import: false } }`, which is what the removed
 * `alignOpenCloudSharedVersions` plugin used to patch into the bundle by hand. If an SDK
 * upgrade ever dropped one of these modules, the extension would bundle its own copy of
 * `vue`/`web-pkg` (two Vue instances at runtime), so this spec pins the contract: the
 * local config keeps no patcher, and the built share map (`dist/js/localSharedImportMap-*`,
 * committed like the rest of `dist/`) still marks every host module `import: false`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOST_MODULES = ['vue', 'vue3-gettext', '@opencloud-eu/web-pkg', '@opencloud-eu/web-client']

// `import.meta.url` is not a `file:` URL under the happy-dom environment, so read the files
// relative to the project root vitest runs in.
const root = process.cwd()
const viteConfigSource = readFileSync(join(root, 'vite.config.ts'), 'utf8')

/** The built share map, with the minifier's backticks turned into quotes for matching. */
function readShareMap(): string | null {
  const jsDir = join(root, 'dist', 'js')
  let entries: string[]
  try {
    entries = readdirSync(jsDir)
  } catch {
    return null
  }
  const name = entries.find((entry) => entry.startsWith('localSharedImportMap-'))
  return name ? readFileSync(join(jsDir, name), 'utf8').replace(/`/g, '"') : null
}

const shareMap = readShareMap()

describe('extension SDK share configuration', () => {
  it('no longer patches the federation share map locally', () => {
    expect(viteConfigSource).not.toMatch(/(function|const)\s+alignOpenCloudSharedVersions/)
    expect(viteConfigSource).not.toContain('generateBundle')
    // The only thing the local config adds on top of the SDK defaults is the app version.
    expect(viteConfigSource).toContain('__APP_VERSION__')
  })

  describe.skipIf(shareMap === null)('built share map', () => {
    it.each(HOST_MODULES)('marks %s as host-provided (import: false)', (moduleName) => {
      const name = moduleName.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      // `"<name>":{name:"<name>",…,shareConfig:{singleton:!0,requiredVersion:"*",import:!1}}`
      // (`name:"<name>"` after the key; the minifier leaves identifier-like keys unquoted,
      // e.g. `vue:{name:"vue",…}`.)
      expect(shareMap).toMatch(
        new RegExp(`(?:^|[",{])"?${name}"?:\\{name:"[^"]+".*?requiredVersion:"\\*",import:!1\\}\\}`)
      )
      expect(shareMap).toContain(`Shared module '${moduleName}' must be provided by host`)
    })

    it('does not share vue-router (the host router comes from web-pkg)', () => {
      expect(shareMap).not.toMatch(/"vue-router":\{name:"vue-router"/)
    })
  })
})
