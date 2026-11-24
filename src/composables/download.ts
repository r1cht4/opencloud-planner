/**
 * download.ts – browser download helper.
 *
 * `URL.revokeObjectURL` must NOT run synchronously after the click: Safari and
 * older Firefox can abort the in-flight download when the object URL is revoked
 * in the same task. The revoke therefore happens in a `setTimeout`, after the
 * browser has started the download.
 *
 * (`tools/backup.ts` keeps its own copy for the backup card; this is the shared
 * variant for the components that download CSV exports.)
 */

/** Revoke delay — long enough for the click to hand the URL to the browser. */
const REVOKE_DELAY_MS = 1000

/** Trigger a browser download of `blob` as `fileName` (deferred URL revoke). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
