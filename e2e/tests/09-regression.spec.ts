import { test, expect, type Page } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

// Regression cover for things that have actually broken in production before.
// Every test here is read-only: no record is created, edited or deleted. The
// draft test writes to localStorage only, and clears it afterwards.
//
// Note: the app keeps its access token in memory, not in a cookie, so a bare
// fetch() from the page context is unauthenticated. These tests therefore read
// the app's own API responses instead of issuing their own requests.

/** Rows from the list request the app makes when `path` is opened. */
async function rowsFromListCall(page: Page, path: string, apiPath: string) {
  const response = page.waitForResponse(
    r => r.url().includes(apiPath) && r.request().method() === 'GET' && r.ok(),
    { timeout: 30_000 },
  )
  await gotoAndWait(page, path)
  const body = await (await response).json()
  return body?.data?.rows ?? body?.data ?? []
}

test.describe('Regressions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('invoice preview shows the bank transfer details', async ({ page }) => {
    const rows = await rowsFromListCall(page, '/invoices', '/api/invoices')
    expect(rows.length, 'no invoices returned by the API').toBeGreaterThan(0)

    await gotoAndWait(page, `/invoices/${rows[0].id}/print`)

    // The payer cannot send money without these, so they must always render.
    for (const value of ['Bank of America', 'Decoinks LLC', '325207480603', '121000358']) {
      await expect(page.getByText(value, { exact: false }).first()).toBeVisible()
    }
  })

  test('payments list renders its KPIs and table', async ({ page }) => {
    await gotoAndWait(page, '/payments')

    await expect(page.getByText('Total Received', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Payment ID', { exact: false }).first()).toBeVisible()
  })

  test('a form draft survives a page reload', async ({ page }) => {
    await gotoAndWait(page, '/purchase-orders/new')

    const marker = `E2E-DRAFT-${Date.now()}`
    await page.locator('textarea').first().fill(marker)

    // The draft is flushed on unload, so a reload must bring the value back.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      m => Array.from(document.querySelectorAll('textarea')).some(t => (t as HTMLTextAreaElement).value.includes(m)),
      marker,
      { timeout: 20_000 },
    )

    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter(k => k.startsWith('decoinks:draft:'))
        .forEach(k => localStorage.removeItem(k)),
    )
  })

  test('sales orders list newest first', async ({ page }) => {
    const rows = await rowsFromListCall(page, '/orders', '/api/orders')
    const dates = rows.map((r: Record<string, string>) => r.order_date).filter(Boolean)

    expect(dates.length, 'no order dates returned').toBeGreaterThan(1)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  test('purchase orders list newest first', async ({ page }) => {
    const rows = await rowsFromListCall(page, '/purchase-orders', '/api/purchase-orders')
    const dates = rows.map((r: Record<string, string>) => r.order_date).filter(Boolean)

    expect(dates.length, 'no PO dates returned').toBeGreaterThan(1)
    expect(dates).toEqual([...dates].sort().reverse())
  })
})
