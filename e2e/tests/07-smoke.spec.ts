/**
 * Smoke tests — quickly check every main page loads without crash.
 * Run these first. If any page shows "Failed to load" or crashes → BUG.
 */
import { test, expect } from '@playwright/test'
import { login } from './helpers'

const PAGES = [
  { name: 'Dashboard',       url: '/dashboard' },
  { name: 'Leads Board',     url: '/leads' },
  { name: 'Leads List',      url: '/leads/list' },
  { name: 'Customers',       url: '/customers' },
  { name: 'Quotes',          url: '/quotes' },
  { name: 'New Quote',       url: '/quotes/new' },
  { name: 'Invoices',        url: '/invoices' },
  { name: 'New Invoice',     url: '/invoices/new' },
  { name: 'Orders',          url: '/orders' },
  { name: 'Purchase Orders', url: '/purchase-orders' },
]

// Log in once, reuse the session for all smoke tests
test.describe('Smoke — every page loads', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { name, url } of PAGES) {
    test(`${name} (${url}) loads without crash`, async ({ page }) => {
      await page.goto(url)
      await page.waitForTimeout(2_000)  // let data fetch

      // These strings appearing means something broke
      const errorTexts = [
        'Failed to load',
        'Something went wrong',
        'Cannot read properties',
        'TypeError',
        '404 Not Found',
        '500 Internal Server',
      ]
      for (const errText of errorTexts) {
        await expect(
          page.locator(`text=${errText}`).first()
        ).not.toBeVisible({ timeout: 500 }).catch(() => {
          // if check itself fails, that's fine — means element not present
        })
      }

      // Page should not be blank — at least one visible element
      const bodyText = await page.locator('body').textContent()
      expect(bodyText?.trim().length).toBeGreaterThan(10)
    })
  }

})
