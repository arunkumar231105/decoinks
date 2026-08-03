import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

// Every screen reachable from the sidebar, plus the create forms. These are
// read-only visits: nothing is filled in or saved, so running the suite cannot
// change business data.
const PAGES = [
  { name: 'Dashboard',        url: '/dashboard' },
  { name: 'Leads List',       url: '/leads' },
  { name: 'Leads Board',      url: '/leads/board' },
  { name: 'Artwork Vault',    url: '/artwork-library' },
  { name: 'Customers',        url: '/customers' },
  { name: 'New Customer',     url: '/customers/new' },
  { name: 'Quotes',           url: '/quotes' },
  { name: 'New Quote',        url: '/quotes/new' },
  { name: 'Invoices',         url: '/invoices' },
  { name: 'New Invoice',      url: '/invoices/new' },
  { name: 'Orders',           url: '/orders' },
  { name: 'New Order',        url: '/orders/new' },
  { name: 'Payments',         url: '/payments' },
  { name: 'New Payment',      url: '/payments/new' },
  { name: 'Purchase Orders',  url: '/purchase-orders' },
  { name: 'New PO',           url: '/purchase-orders/new' },
  { name: 'Shipments',        url: '/shipments' },
  { name: 'Suppliers',        url: '/suppliers' },
  { name: 'Products',         url: '/products' },
  { name: 'Users & Roles',    url: '/settings/users' },
  { name: 'Settings',         url: '/settings/general' },
]

// Text that only ever appears when something has actually gone wrong. The first
// two are the ErrorBoundary, which is what a stale chunk or a render crash
// surfaces as — exactly the failure this suite exists to catch.
const FAILURE_TEXT = [
  'Something went wrong',
  'An unexpected error occurred',
  'Failed to fetch dynamically imported module',
  'Unable to load',
  '500 Internal Server',
]

test.describe('Smoke — every page loads', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { name, url } of PAGES) {
    test(`${name} (${url}) loads without crashing`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('pageerror', err => consoleErrors.push(err.message))

      await gotoAndWait(page, url)

      for (const text of FAILURE_TEXT) {
        await expect(
          page.getByText(text, { exact: false }).first(),
          `"${name}" shows "${text}"`,
        ).toHaveCount(0)
      }

      // An uncaught exception means the page rendered but is broken.
      expect(consoleErrors, `"${name}" threw: ${consoleErrors[0] ?? ''}`).toHaveLength(0)
    })
  }
})
