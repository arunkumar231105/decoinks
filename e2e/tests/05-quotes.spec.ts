import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('Quotations', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('quotes list page loads', async ({ page }) => {
    await page.goto('/quotes')
    await expect(page.locator('text=Failed to load')).not.toBeVisible({ timeout: 8_000 })
    await expect(page.locator('table, h1').first()).toBeVisible({ timeout: 8_000 })
  })

  test('new quotation form has all 3 tabs', async ({ page }) => {
    await page.goto('/quotes/new')
    await expect(page.locator('text=Apparel')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('text=Gangsheet')).toBeVisible()
    await expect(page.locator('text=DTF')).toBeVisible()
  })

  test('gangsheet size dropdown in quotation has Custom option', async ({ page }) => {
    await page.goto('/quotes/new')
    await page.click('text=Gangsheet')

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    const sizeSelect = page.locator('select').first()
    await expect(sizeSelect).toBeVisible({ timeout: 5_000 })

    const options = await sizeSelect.locator('option').allTextContents()
    expect(options.some(o => o.toLowerCase().includes('custom'))).toBeTruthy()
  })

  test('gangsheet custom size: selecting Custom shows text input', async ({ page }) => {
    await page.goto('/quotes/new')
    await page.click('text=Gangsheet')

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    const sizeSelect = page.locator('select').first()
    await sizeSelect.selectOption({ label: 'Custom...' })

    // A text input should appear for entering custom size
    const customInput = page.locator('input[placeholder*="e.g"], input[placeholder*="custom" i]').first()
    await expect(customInput).toBeVisible({ timeout: 3_000 })
    await customInput.fill('36" x 72"')
    await expect(customInput).toHaveValue('36" x 72"')
  })

  test('quotation total updates when items are added', async ({ page }) => {
    await page.goto('/quotes/new')
    await page.click('text=Gangsheet')

    const addBtn = page.locator('button:has-text("Add"), button:has-text("Row")').first()
    await addBtn.click()

    // Fill price per sheet
    const priceInput = page.locator('input[type="number"]').last()
    await priceInput.fill('100')

    // Total should update — look for $100 somewhere
    await expect(page.locator('text=/\\$100|100\\.00/').first()).toBeVisible({ timeout: 3_000 })
  })

})
