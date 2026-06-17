import { Page, expect } from '@playwright/test'

export const CREDS = {
  email:    process.env.TEST_EMAIL    || '',
  password: process.env.TEST_PASSWORD || '',
}

/**
 * Log in and wait for dashboard.
 * Fills the email + password inputs and submits the form.
 */
export async function login(page: Page) {
  if (!CREDS.email || !CREDS.password) {
    throw new Error(
      'TEST_EMAIL and TEST_PASSWORD must be set in e2e/.env\n' +
      'Copy e2e/.env.example → e2e/.env and fill in your credentials.'
    )
  }

  await page.goto('/login')

  // Wait for the form to appear
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 })

  await page.fill('input[type="email"]',    CREDS.email)
  await page.fill('input[type="password"]', CREDS.password)
  await page.click('button[type="submit"]')

  // Wait for redirect away from /login (to dashboard or any other page)
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 12_000 }
  )
}

/** Wait for a toast notification containing `text` */
export async function expectToast(page: Page, text: string) {
  await expect(
    page.locator(`text=${text}`).first()
  ).toBeVisible({ timeout: 8_000 })
}
