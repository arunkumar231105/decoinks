import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

const PAGES = [
  { name: 'Dashboard',       url: '/dashboard' },
  { name: 'Leads Board',     url: '/leads/board' },
  { name: 'Leads List',      url: '/leads' },
  { name: 'Customers',       url: '/customers' },
  { name: 'Quotes',          url: '/quotes' },
  { name: 'New Quote',       url: '/quotes/new' },
  { name: 'Invoices',        url: '/invoices' },
  { name: 'New Invoice',     url: '/invoices/new' },
  { name: 'Orders',          url: '/orders' },
  { name: 'Purchase Orders', url: '/purchase-orders' },
]

test.describe('Smoke — every page loads', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { name, url } of PAGES) {
    test(`${name} (${url}) loads without crash`, async ({ page }) => {
      await gotoAndWait(page, url)

      // Check for error messages
      const errorTexts = ['Failed to load', 'Something went wrong', '500 Internal Server']
      for (const errText of errorTexts) {
        const visible = await page.locator(`text=${errText}`).first().isVisible().catch(() => false)
        if (visible) throw new Error(`Page "${name}" shows error: "${errText}"`)
      }
    })
  }

})
