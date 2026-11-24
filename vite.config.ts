import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@opencloud-eu/extension-sdk'

/**
 * The app version shown in About/Status (and copied into the diagnostics) is the
 * `package.json` version, injected at build time. Reading it here keeps a single
 * source of truth — no version literal to bump twice.
 */
const { version: appVersion } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string }

/**
 * No local patching of the module federation share map is needed any more: since
 * `@opencloud-eu/extension-sdk` 8 the federation plugin is configured with
 * `shared: { <module>: { singleton: true, import: false } }` for every host module
 * (`externalModules`: vue, vue3-gettext, @opencloud-eu/web-pkg, @opencloud-eu/web-client, …),
 * i.e. they are host-provided without a `requiredVersion` constraint — exactly what the
 * old `alignOpenCloudSharedVersions` plugin rewrote `dist/js/remoteEntry-*.mjs` to.
 */
export default defineConfig({
  name: 'web-app-planner',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  /**
   * Keep assets as real files. The app icon (`src/assets/planner*.svg`, a few
   * hundred bytes) would otherwise be inlined as a `data:` URI: the host shows
   * image icons through an `<img src>`, and a file under `dist/assets/` is
   * cacheable and needs no `data:` entry in the host's CSP. Merged deep into the
   * SDK's own `build` block, so its entry/outDir/rollup options stay in place.
   */
  build: {
    assetsInlineLimit: 0
  }
})
