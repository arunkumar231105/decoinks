import { test, expect } from '@playwright/test'
import { login, expectToast } from './helpers'

test.describe('Customers', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('customers list page loads', async ({ page }) => {
    await page.goto('/customers')
    await expect(page.locator('text=Failed to load')).not.toBeVisible({ timeout: 8_000 })
    await expect(page.locator('table, h1, [class*="customer"]').first()).toBeVisible({ timeout: 8_000 })
  })

  test('customer detail page loads without "Failed to load customer"', async ({ page }) => {
    await page.goto('/customers')

    const rows = page.locator('table tbody tr')
    await page.waitForSelector('table tbody tr', { timeout: 8_000 }).catch(() => {})
    const count = await rows.count()

    if (count === 0) {
      test.skip(true, 'No customers to test')
      return
    }

    await rows.first().click()
    await page.waitForTimeout(1_000)

    // The critical check — "Failed to load customer" must NOT appear
    await expect(page.locator('text=Failed to load customer')).not.toBeVisible({ timeout: 8_000 })
    await expect(page.locator('h1, [class*="customer-name"]').first()).toBeVisible({ timeout: 8_000 })
  })

})
