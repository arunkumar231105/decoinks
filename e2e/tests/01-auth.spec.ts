import { test, expect } from '@playwright/test'
import { login, CREDS } from './helpers'

test.describe('Authentication', () => {

  test('login with valid credentials', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/dashboard/)
  })

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', CREDS.email)
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    // Should stay on login page or show error
    await expect(page.locator('text=/invalid|incorrect|wrong|error/i').first()).toBeVisible({ timeout: 6_000 })
  })

  test('protected route redirects to login when not logged in', async ({ page }) => {
    await page.goto('/invoices')
    await expect(page).toHaveURL(/login/)
  })

})
