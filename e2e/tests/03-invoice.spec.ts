import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'
import * as path from 'path'
import * as fs from 'fs'

const SS = path.join(__dirname, '../screenshots')
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true })

test.describe('Invoice', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('invoice list page loads without error', async ({ page }) => {
    await gotoAndWait(page, '/invoices')
    const failed = await page.locator('text=Failed to load').first().isVisible().catch(() => false)
    expect(failed).toBe(false)
  })

  test('new invoice form shows 3 order type tabs', async ({ page }) => {
    await gotoAndWait(page, '/invoices/new')
    // Tab text in NewInvoicePage:
    //   apparel   → "Cusoom Printed Apparel"  (note: typo in source code)
    //   gangsheet → "DTF Gangsheet"
    //   dtf       → "DTF Transfers"
    await expect(page.locator('button:has-text("Gangsheet")').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button:has-text("DTF Transfers")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Apparel")').first()).toBeVisible()
  })

  test('clicking gangsheet tab shows Gangsheet Size column', async ({ page }) => {
    await gotoAndWait(page, '/invoices/new')
    await page.locator('button:has-text("Gangsheet")').first().click()
    await expect(page.locator('text=Gangsheet Size').first()).toBeVisible({ timeout: 8_000 })
  })

  test('gangsheet table add row shows size dropdown with Custom option', async ({ page }) => {
    await gotoAndWait(page, '/invoices/new')
    await page.locator('button:has-text("Gangsheet")').first().click()

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    const sizeSelect = page.locator('select').first()
    await expect(sizeSelect).toBeVisible({ timeout: 8_000 })
    const options = await sizeSelect.locator('option').allTextContents()
    expect(options.some(o => o.toLowerCase().includes('custom'))).toBeTruthy()
  })

})
