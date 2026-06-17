import { test, expect, Page } from '@playwright/test'
import { login } from './helpers'

test.describe('Invoice', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('invoice list page loads without error', async ({ page }) => {
    await page.goto('/invoices')
    await expect(page.locator('text=Failed to load')).not.toBeVisible({ timeout: 8_000 })
    await expect(page.locator('table, [class*="invoice"], h1').first()).toBeVisible({ timeout: 8_000 })
  })

  test('new invoice form opens with all 3 tabs (Apparel, Gangsheet, DTF)', async ({ page }) => {
    await page.goto('/invoices/new')
    await expect(page.locator('text=Apparel')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('text=Gangsheet')).toBeVisible()
    await expect(page.locator('text=DTF')).toBeVisible()
  })

  test('gangsheet tab shows correct columns', async ({ page }) => {
    await page.goto('/invoices/new')
    await page.click('text=Gangsheet')
    await expect(page.locator('text=/size/i').first()).toBeVisible()
  })

  test('gangsheet size dropdown has Custom option', async ({ page }) => {
    await page.goto('/invoices/new')
    await page.click('text=Gangsheet')

    // Click "Add Row" to get a gangsheet row
    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    // The size select should appear
    const sizeSelect = page.locator('select').first()
    await expect(sizeSelect).toBeVisible()
    const options = await sizeSelect.locator('option').allTextContents()
    expect(options).toContain('Custom...')
  })

  test('create gangsheet invoice and verify preview', async ({ page }) => {
    await page.goto('/invoices/new')

    // Fill customer
    const customerInput = page.locator('input[placeholder*="customer" i], input[placeholder*="search" i]').first()
    await customerInput.fill('Test Customer')
    await page.keyboard.press('Escape') // close any dropdown

    // Switch to Gangsheet
    await page.click('text=Gangsheet')

    // Add a row
    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    // Fill price per sheet
    const priceInputs = page.locator('input[type="number"]')
    const count = await priceInputs.count()
    if (count > 0) {
      await priceInputs.last().fill('50')
    }

    // Click Preview — opens new tab
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click('button:has-text("Preview"), button:has-text("preview")'),
    ])

    await newPage.waitForLoadState('networkidle')

    // ── KEY CHECKS ON PREVIEW PAGE ──

    // 1. Should show INVOICE title
    await expect(newPage.locator('text=INVOICE')).toBeVisible({ timeout: 10_000 })

    // 2. Should NOT show "$0.00" as TOTAL DUE when amount > 0
    const totalDue = await newPage.locator('.tr-total, [class*="total"]').last().textContent()
    expect(totalDue).not.toContain('$0.00')

    // 3. Should show gangsheet columns (not apparel DTF Transfers label)
    await expect(newPage.locator('text=Gangsheet Size')).toBeVisible()
    await expect(newPage.locator('text=DTF Transfers')).not.toBeVisible()

    // 4. Screenshot for visual review
    await newPage.screenshot({ path: 'screenshots/gangsheet-invoice-preview.png', fullPage: true })
  })

  test('invoice preview total amount in words is not zero', async ({ page }) => {
    // Go to an existing invoice list and open the first one
    await page.goto('/invoices')
    await page.waitForSelector('table tbody tr, [class*="invoice-row"]', { timeout: 8_000 }).catch(() => {})

    const rows = page.locator('table tbody tr')
    const rowCount = await rows.count()
    if (rowCount === 0) {
      test.skip(true, 'No invoices exist to test')
      return
    }

    // Click first invoice's preview/print link
    const firstRow = rows.first()
    await firstRow.click()
    await page.waitForTimeout(500)

    // Look for a preview/print button
    const previewBtn = page.locator('a[href*="/print"], button:has-text("Preview"), button:has-text("Print")').first()
    if (await previewBtn.isVisible()) {
      const [previewPage] = await Promise.all([
        page.context().waitForEvent('page'),
        previewBtn.click(),
      ])
      await previewPage.waitForLoadState('networkidle')

      // "and 00/100" means zero — that's a bug
      const wordAmount = await previewPage.locator('[class*="word"], [class*="pay-word"]').first().textContent().catch(() => '')
      expect(wordAmount).not.toContain('and 00/100')

      await previewPage.screenshot({ path: 'screenshots/invoice-preview-amount-words.png', fullPage: true })
    }
  })

})
