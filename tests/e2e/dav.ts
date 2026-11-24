import { type Page } from '@playwright/test'

/**
 * Shared DAV helpers for the deployed e2e specs.
 *
 * Everything here talks to the same endpoints the extension uses, with the same
 * credentials, so an assertion cannot pass on UI state alone:
 *
 *  - `davFetch` runs a CalDAV/CardDAV request **inside the page** (the access
 *    token lives in the host's pinia store, which only the browser has);
 *  - `personalSpacePath` / `uploadPersonalFile` / `deletePersonalFile` use the
 *    Files WebDAV endpoint with `page.request`, which shares cookies with the
 *    browser context — the upload is what the Files context menu imports.
 *
 * The WebDAV path is read from the host (`useSpacesStore()` → `space.webDavPath`,
 * e.g. `spaces/<drive-id>`) instead of being guessed, because the drive id is
 * install specific. The host builds file URLs as
 * `<origin>/remote.php/dav/<webDavPath>/<name>`.
 */

export interface DavResult {
  status: number
  text: string
}

/** Bearer token the host handed to the page ('' while signed out). */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    // The host's OIDC user (localStorage) — independent of the module-federation runtime.
    return (() => {
      try {
        const k = Object.keys(localStorage).find((key) => key.startsWith('oc_oAuth.user:'))
        return k ? String(JSON.parse(localStorage.getItem(k) || '{}').access_token || '') : ''
      } catch {
        return ''
      }
    })()
  })
  return token.replace(/^Bearer\s+/i, '')
}

/**
 * One CalDAV/CardDAV request from inside the app (same auth as the extension).
 *
 * `init.body`/`init.contentType` are optional so a spec can also create a
 * collection (MKCOL) or put an object (PUT) without another helper.
 */
export async function davFetch(
  page: Page,
  url: string,
  method = 'GET',
  init: { body?: string; contentType?: string } = {}
): Promise<DavResult> {
  return page.evaluate(
    async ({ method, url, body, contentType }) => {
      // The host's OIDC user (localStorage) — independent of the module-federation runtime.
      const token = (() => {
        try {
          const k = Object.keys(localStorage).find((key) => key.startsWith('oc_oAuth.user:'))
          return k ? String(JSON.parse(localStorage.getItem(k) || '{}').access_token || '') : ''
        } catch {
          return ''
        }
      })()
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
      if (contentType) headers['Content-Type'] = contentType
      if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`

      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: 'include',
        cache: 'no-store'
      })

      return { status: response.status, text: await response.text() }
    },
    { method, url, body: init.body, contentType: init.contentType }
  )
}

/**
 * WebDAV path of the signed-in user's personal space (`spaces/<drive-id>`).
 *
 * The host only knows its spaces after the Files app (or the spaces store) has
 * loaded them, so call this after `/files/spaces/personal` was opened.
 */
export async function personalSpacePath(page: Page): Promise<string> {
  // Ask the Graph API for the personal drive (works without any host store).
  const token = await accessToken(page)
  const path = await page.evaluate(async (bearer) => {
    try {
      const resp = await fetch('/graph/v1.0/me/drives', {
        headers: { Authorization: `Bearer ${bearer}` }
      })
      const body = (await resp.json()) as { value?: { id?: string; driveType?: string }[] }
      const personal = body.value?.find((drive) => drive.driveType === 'personal')
      return personal?.id ? `spaces/${personal.id}` : ''
    } catch {
      return ''
    }
  }, token)
  const normalised = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalised)
    throw new Error('Could not resolve the personal space via /graph/v1.0/me/drives.')
  return normalised
}

/** Absolute WebDAV URL of `fileName` in the given space path. */
function personalFileUrl(page: Page, spacePath: string, fileName: string): string {
  return new URL(
    `/remote.php/dav/${spacePath}/${encodeURIComponent(fileName)}`,
    page.url()
  ).toString()
}

/** Upload a file into the personal space through WebDAV; returns its URL. */
export async function uploadPersonalFile(
  page: Page,
  spacePath: string,
  fileName: string,
  content: string,
  mimeType = 'text/calendar; charset=utf-8'
): Promise<string> {
  const url = personalFileUrl(page, spacePath, fileName)
  const token = await accessToken(page)
  const headers: Record<string, string> = { 'Content-Type': mimeType }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await page.request.put(url, { headers, data: content })
  if (!response.ok()) {
    throw new Error(
      `WebDAV upload of ${fileName} failed: ${response.status()} ${await response.text()}`
    )
  }
  return url
}

/** Delete an uploaded file again (a missing file is not an error — cleanup). */
export async function deletePersonalFile(page: Page, url: string): Promise<void> {
  const token = await accessToken(page)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await page.request.delete(url, { headers })
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`WebDAV delete of ${url} failed: ${response.status()}`)
  }
}
