import { type Page } from '@playwright/test'

/**
 * Shared deployed-e2e sign-in helper.
 *
 * The old helper slept a fixed 3 s and then 8 s and *assumed* it had left the
 * sign-in page. On a loaded instance that guess was wrong often enough for the
 * whole test to run against the login form. This one is event-driven:
 *
 *  1. wait until the SPA has decided what to show (sign-in form or app shell);
 *  2. if the form is there, submit it and wait for the URL to leave `/signin/`;
 *  3. wait for the authenticated app shell (top bar / app switcher / an app view).
 */

const username = process.env.OPENCLOUD_USERNAME ?? 'admin'
const password = process.env.OPENCLOUD_PASSWORD ?? ''

/** Path segment the host uses for its sign-in page. */
const SIGN_IN_PATH = '/signin/'

/** Login form fields (present only while signed out). */
const LOGIN_USERNAME_FIELD = '#oc-login-username'
const LOGIN_PASSWORD_FIELD = '#oc-login-password'

/**
 * Landmarks of the authenticated shell. Deliberately broad and generic, so a host
 * redesign does not silently turn the wait into a timeout: the top bar / app
 * switcher when available, any app container otherwise.
 */
const SHELL_SELECTORS = [
  '#oc-topbar',
  '.oc-topbar',
  '#app-switcher-button',
  '[data-testid="app-switcher"]',
  '#web-content',
  '.oc-app-container',
  'nav',
  'header',
  'main'
]

interface ShellProbe {
  signInPath: string
  loginField: string
  selectors: string[]
}

const probe: ShellProbe = {
  signInPath: SIGN_IN_PATH,
  loginField: LOGIN_USERNAME_FIELD,
  selectors: SHELL_SELECTORS
}

/** True (in the browser) once the SPA shows either the sign-in form or the shell. */
function spaDecided({ signInPath, loginField, selectors }: ShellProbe): boolean {
  return (
    window.location.pathname.includes(signInPath) ||
    document.querySelector(loginField) !== null ||
    selectors.some((selector) => document.querySelector(selector) !== null)
  )
}

/** True (in the browser) once the *authenticated* shell is rendered. */
function shellReady({ signInPath, loginField, selectors }: ShellProbe): boolean {
  if (window.location.pathname.includes(signInPath)) return false
  if (document.querySelector(loginField) !== null) return false
  return selectors.some((selector) => document.querySelector(selector) !== null)
}

/** Resolve once the authenticated app shell is on screen (no fixed sleeps). */
async function waitForAppShell(page: Page): Promise<void> {
  await page.waitForFunction(spaDecided, probe, { timeout: 60_000 })
  await page.waitForFunction(shellReady, probe, { timeout: 60_000 })
}

/**
 * Sign in on a fresh page. Signature kept for the existing specs.
 *
 * An already-authenticated session resolves as soon as the shell is there; a real
 * sign-in waits for the URL to leave `/signin/` before waiting for the shell, so a
 * slow instance can no longer start the test on the login form.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const signInForm = page.locator(LOGIN_USERNAME_FIELD)
  await page.waitForFunction(spaDecided, probe, { timeout: 60_000 })

  if (page.url().includes(SIGN_IN_PATH) || (await signInForm.count()) > 0) {
    await signInForm.fill(username)
    await page.locator(LOGIN_PASSWORD_FIELD).fill(password)
    await Promise.all([
      page.waitForURL((url) => !url.toString().includes(SIGN_IN_PATH), { timeout: 60_000 }),
      page.locator('button[type="submit"]').click()
    ])
  }

  await waitForAppShell(page)
}
