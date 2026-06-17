import { Page, Route, expect } from '@playwright/test'

export const CREDS = {
  email:    process.env.TEST_EMAIL    || '',
  password: process.env.TEST_PASSWORD || '',
}

/**
 * Log in via the login form.
 * Waits until the URL leaves /login (SPA redirect to /dashboard).
 */
export async function login(page: Page) {
  if (!CREDS.email || !CREDS.password) {
    throw new Error(
      'TEST_EMAIL and TEST_PASSWORD must be set in e2e/.env\n' +
      'Copy e2e/.env.example → e2e/.env and fill in your credentials.'
    )
  }

  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 })

  await page.fill('input[type="email"]',    CREDS.email)
  await page.fill('input[type="password"]', CREDS.password)
  await page.click('button[type="submit"]')

  // Wait until we leave the /login page (React Router SPA nav to /dashboard)
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 15_000 }
  )
}

/**
 * Navigate to a URL and wait until protected content is visible.
 *
 * Problem: Playwright headless Chromium does NOT send the httpOnly
 * "decoinks_rt" cookie with the app's POST /api/auth/refresh XHR,
 * even though the cookie is in the browser context. To work around
 * this, we intercept /api/auth/refresh at the Playwright level and
 * inject the cookie header manually before the request hits the server.
 */
export async function gotoAndWait(page: Page, url: string) {
  // Grab the refresh-token cookie that was stored during login()
  const cookies = await page.context().cookies()
  const rt = cookies.find(c => c.name === 'decoinks_rt')

  // Intercept /api/auth/refresh and inject the cookie that Chromium omits
  let handler: ((route: Route) => Promise<void>) | null = null
  if (rt) {
    handler = async (route: Route) => {
      const existingCookie = route.request().headers()['cookie'] || ''
      const injected = existingCookie
        ? `${existingCookie}; decoinks_rt=${rt.value}`
        : `decoinks_rt=${rt.value}`
      await route.continue({ headers: { ...route.request().headers(), cookie: injected } })
    }
    await page.route('**/api/auth/refresh', handler)
  }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    // Wait for real content to appear (past the "Loading…" spinner = 10 chars)
    // AND confirm we're not stuck on the login page
    await page.waitForFunction(
      () =>
        (document.body.textContent?.trim().length ?? 0) > 15 &&
        !window.location.pathname.startsWith('/login'),
      { timeout: 20_000 }
    )
  } finally {
    if (handler) await page.unroute('**/api/auth/refresh', handler)
  }
}

/** Wait for a toast notification containing `text` */
export async function expectToast(page: Page, text: string) {
  await expect(
    page.locator(`text=${text}`).first()
  ).toBeVisible({ timeout: 10_000 })
}
