import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

test.describe('Customers', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('customers list page loads without error', async ({ page }) => {
    await gotoAndWait(page, '/customers')
    const failed = await page.locator('text=Failed to load').first().isVisible().catch(() => false)
    expect(failed).toBe(false)
  })

  test('customer detail page loads without "Failed to load customer"', async ({ page }) => {
    await gotoAndWait(page, '/customers')

    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    if (count === 0) {
      test.skip()
      return
    }

    await rows.first().click()
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    await expect(
      page.locator('text=Failed to load customer')
    ).not.toBeVisible({ timeout: 10_000 })
  })

})
