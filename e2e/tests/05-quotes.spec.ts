import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

test.describe('Quotations', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('quotes list page loads', async ({ page }) => {
    await gotoAndWait(page, '/quotes')
    const failed = await page.locator('text=Failed to load').first().isVisible().catch(() => false)
    expect(failed).toBe(false)
  })

  test('new quotation form shows 3 order type tabs', async ({ page }) => {
    await gotoAndWait(page, '/quotes/new')
    // Tab cards in NewQuotationPage (.nq-tab-card elements):
    //   apparel   → "Custom Printed Apparel"
    //   dtf       → "DTF Transfers"
    //   gangsheet → "Gangsheet"
    await expect(page.locator('.nq-tab-card').first()).toBeVisible({ timeout: 10_000 })
    const body = await page.locator('body').textContent()
    expect(body).toContain('Gangsheet')
    expect(body).toContain('DTF')
    expect(body).toContain('Apparel')
  })

  test('gangsheet tab: add row shows Gangsheet Size column', async ({ page }) => {
    await gotoAndWait(page, '/quotes/new')
    await page.locator('.nq-tab-card').filter({ hasText: 'Gangsheet' }).first().click()
    await page.waitForTimeout(300)

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    await expect(page.locator('text=Gangsheet Size').first()).toBeVisible({ timeout: 8_000 })
  })

  test('gangsheet custom size: selecting Custom shows text input', async ({ page }) => {
    await gotoAndWait(page, '/quotes/new')
    await page.locator('.nq-tab-card').filter({ hasText: 'Gangsheet' }).first().click()
    await page.waitForTimeout(300)

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    const sizeSelect = page.locator('select.nq-table-select, select').first()
    await expect(sizeSelect).toBeVisible({ timeout: 8_000 })
    await sizeSelect.selectOption({ label: 'Custom...' })

    const customInput = page.locator('input[placeholder*="e.g"], input[placeholder*="custom" i]').first()
    await expect(customInput).toBeVisible({ timeout: 5_000 })
    await customInput.fill('36" x 72"')
    await expect(customInput).toHaveValue('36" x 72"')
  })

})
