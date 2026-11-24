/**
 * The Planner app icon and the tile colour the app menu paints it on.
 *
 * ## How the host renders an app-menu entry
 *
 * `packages/web-runtime/src/components/Topbar/ApplicationsMenu.vue` renders every
 * entry as
 *
 * ```html
 * <oc-button :appearance="active ? 'filled' : 'raw-inverse'" ...>
 *   <oc-application-icon :icon="n.icon || 'link'" :color-primary="n.color" />
 *   <span v-text="$gettext(n.label())" />
 * </oc-button>
 * ```
 *
 * and `OcApplicationIcon` is a 2rem box (`rounded-sm`) that
 * - with a `colorPrimary` paints that colour as the tile and renders the icon at
 *   `size-5` tinted `var(--oc-role-on-secondary)` (= `#FFFFFF`),
 * - **without** a colour makes an *image* icon fill the whole tile with no
 *   background (`fillsTile`), and a *named* icon get a hashed background.
 *
 * The built-in apps therefore ship a **named** icon plus a `color`
 * (`Mail #0478d4`, `Contacts #1d8cf8`, `Text Editor #0D856F`, …) and get a rounded
 * coloured tile with a white glyph — that tile is also what the *active* row shows.
 *
 * ## What this app ships
 *
 * Our logo is a custom Remix-style glyph, so it stays an image icon — but the file
 * is drawn **white** and the entry carries `color: PLANNER_TILE_COLOR`, which is
 * exactly the combination `OcApplicationIcon` treats like a built-in entry: same
 * rounded tile, same tile size, same white glyph, same active/hover behaviour. An
 * image icon with a coloured glyph and no tile (the first version) looked foreign
 * next to the host's apps and had no tile while active.
 *
 * `planner.svg` is imported with `?url`, so the build emits it into `dist/assets/`
 * and hands over the URL (`new URL(…, import.meta.url)`, resolved against this
 * module rather than the host's document). `build.assetsInlineLimit: 0` in
 * `vite.config.ts` keeps it a real file instead of a base64 `data:` URI. There is
 * no dark variant: the glyph is white in both themes because it always sits on the
 * tile, and the tile colour does not change with the theme.
 *
 * The in-app sidebar and the Files-sidebar entries keep their per-app name icons
 * (`calendar-2`, `contacts-book`, `task`) — only the package itself is branded with
 * this image.
 */
import plannerIcon from './assets/planner.svg?url'

/**
 * Tile colour of the app-menu entries (and `appInfo.color`).
 *
 * A calm mid-tone teal in the range the built-in apps use (`#0478d4` Mail,
 * `#0D856F` Text Editor, `#1d8cf8` Contacts) — deliberately not the pale
 * `#7DD3E8` of the first icon draft, which looked garish on the tile.
 */
export const PLANNER_TILE_COLOR = '#00677F'

/**
 * Image icon of the app (white glyph, painted on `PLANNER_TILE_COLOR`).
 *
 * A plain object, so it can be passed to `appInfo.icon` and to the app-menu entries
 * without a cast — the host's `ImageIcon` is `{ src, srcDark? }`.
 */
export const PLANNER_ICON = {
  src: plannerIcon
}
