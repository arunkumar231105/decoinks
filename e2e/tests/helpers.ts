import { Page, expect } from '@playwright/test'

export const CREDS = {
  email:    process.env.TEST_EMAIL    || '',
  password: process.env.TEST_PASSWORD || '',
}

/**
 * Log in and wait for the app to fully load.
 * Uses the httpOnly refresh cookie flow — waits for /auth/refresh to complete.
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

  // Wait until we are no longer on the /login page
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 15_000 }
  )
}

/**
 * Navigate to a page and wait for:
 * 1. Network idle (auth/refresh XHR completes)
 * 2. Body has more than 15 chars (past "Loading..." spinner)
 * 3. We are NOT on the login page (auth succeeded)
 */
export async function gotoAndWait(page: Page, url: string) {
  await page.goto(url)

  // Wait for auth refresh + API calls to settle
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
    // networkidle may timeout if there's long-polling — that's fine, continue
  })

  // Make sure we didn't end up on the login page
  const currentUrl = page.url()
  if (currentUrl.includes('/login')) {
    // Try to log in again (token rotation edge case)
    await login(page)
    await page.goto(url)
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  }

  // Wait for actual content (not just loading spinner)
  await page.waitForFunction(
    () => (document.body.textContent?.trim().length ?? 0) > 15 &&
          !window.location.pathname.startsWith('/login'),
    { timeout: 15_000 }
  )
}

/** Wait for a toast notification containing `text` */
export async function expectToast(page: Page, text: string) {
  await expect(
    page.locator(`text=${text}`).first()
  ).toBeVisible({ timeout: 10_000 })
}
