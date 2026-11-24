/**
 * Resolve a *stored collection URL* setting against the collections that
 * actually exist.
 *
 * Settings reference collection **URLs**, never names (collections get renamed
 * and, once sharing lands, may not belong to the user). A URL can disappear —
 * deleted here, or deleted on another device — so every reader goes through this
 * helper: use the configured collection when it is still there, else fall back to
 * the first one instead of failing.
 */

export interface CollectionLike {
  url: string
}

/** Compare URLs ignoring a trailing slash (`/caldav/u/cal/` ≡ `/caldav/u/cal`). */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * The configured collection URL when it still exists, otherwise `''`.
 * `available[0].url` is *not* used here: callers that want a fallback ask for it
 * explicitly (`preferredCollectionUrl`).
 */
export function existingCollectionUrl(
  configured: string | undefined | null,
  available: CollectionLike[]
): string {
  if (!configured) return ''
  const wanted = normalizeUrl(configured)
  return available.find((entry) => normalizeUrl(entry.url) === wanted)?.url ?? ''
}

/**
 * Configured collection when it exists, else the first available one (or `''`
 * when there is none). This is the "preselect" rule of the event dialog, the
 * quick-add task input and the address-book selector.
 */
export function preferredCollectionUrl(
  configured: string | undefined | null,
  available: CollectionLike[]
): string {
  return existingCollectionUrl(configured, available) || available[0]?.url || ''
}
