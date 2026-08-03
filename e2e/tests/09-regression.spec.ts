import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

// Regression cover for things that have actually broken in production before.
// Every test here is read-only: no record is created, edited or deleted. The
// draft test writes to localStorage only, and clears it afterwards.

test.describe('Regressions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('invoice preview shows the bank transfer details', async ({ page }) => {
    await gotoAndWait(page, '/invoices')

    // Open the first invoice's print view straight from the API, so the test
    // does not depend on where the row sits in the table.
    const id = await page.evaluate(async () => {
      const res = await fetch('/api/invoices?page=1&limit=1', { credentials: 'include' })
      const body = await res.json()
      const rows = body?.data?.rows ?? body?.data ?? []
      return rows[0]?.id ?? null
    })
    test.skip(!id, 'no invoices in this environment')

    await gotoAndWait(page, `/invoices/${id}/print`)

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
    const notes = page.locator('textarea').first()
    await notes.fill(marker)

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

  test('sales orders and purchase orders list newest first', async ({ page }) => {
    for (const path of ['/orders', '/purchase-orders']) {
      const dates = await page.evaluate(async p => {
        const api = p === '/orders' ? '/api/orders' : '/api/purchase-orders'
        const res = await fetch(`${api}?page=1&limit=5`, { credentials: 'include' })
        const body = await res.json()
        const rows = body?.data?.rows ?? body?.data ?? []
        return rows.map((r: Record<string, string>) => r.order_date).filter(Boolean)
      }, path)

      const sorted = [...dates].sort().reverse()
      expect(dates, `${path} is not newest-first`).toEqual(sorted)
    }
  })
})
