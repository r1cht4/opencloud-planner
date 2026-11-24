/**
 * `?open=<href>` deep links — how a reminder (or a notification click) brings the
 * user to the event/task it is about.
 *
 * The app opens items **without a full page reload**: `src/index.ts` pushes the
 * owning page with `?open=<resource URL>`, and the page jumps to the item and
 * opens its dialog. Because the URL comes from a stored ICS/vCard resource, it is
 * compared leniently: host rewrites (proxy path prefixes, a changed origin) must
 * not break the link, so the absolute URL, the path and finally the file name are
 * compared in turn.
 */

/** The `open` query value, or `null` when absent/not a non-empty string. */
export function openQueryHref(query: Record<string, unknown> | null | undefined): string | null {
  if (!query) return null
  const value = query.open
  if (typeof value === 'string') return value.trim() || null
  // A repeated parameter (`?open=a&open=b`) arrives as an array — take the first.
  if (Array.isArray(value)) {
    const first = value.find(
      (entry): entry is string => typeof entry === 'string' && entry.trim() !== ''
    )
    return first ?? null
  }
  return null
}

/** Path part of a resource URL (works for absolute and root-relative URLs). */
function resourcePath(href: string): string {
  const trimmed = href.replace(/\/+$/, '')
  try {
    return new URL(trimmed, 'http://localhost').pathname.replace(/\/+$/, '')
  } catch {
    return trimmed
  }
}

function fileName(href: string): string {
  return resourcePath(href).split('/').filter(Boolean).pop() ?? ''
}

/**
 * True when `href` (stored on the item) and `wanted` (from the query) point at the
 * same DAV resource: equal URL, equal path, or equal file name (the UID-based
 * `.ics`/`.vcf` name, which survives a changed origin).
 */
export function sameResourceHref(href: string | undefined | null, wanted: string | null): boolean {
  if (!href || !wanted) return false
  if (href === wanted) return true
  const hrefPath = resourcePath(href)
  const wantedPath = resourcePath(wanted)
  if (hrefPath === wantedPath) return true
  const hrefName = fileName(href)
  return hrefName !== '' && hrefName === fileName(wanted)
}
