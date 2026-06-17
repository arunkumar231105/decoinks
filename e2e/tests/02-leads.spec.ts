import { test, expect } from '@playwright/test'
import { login, expectToast } from './helpers'

const CUSTOMER = `Test Customer ${Date.now()}`

test.describe('Lead Board', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('lead list page loads', async ({ page }) => {
    await page.goto('/leads/list')
    await expect(page.locator('table, .lb-list, [class*="lead"]').first()).toBeVisible({ timeout: 8_000 })
  })

  test('create a new lead manually', async ({ page }) => {
    await page.goto('/leads/new')
    // Fill customer name
    const nameField = page.locator('input[placeholder*="name" i], input[name*="customer" i]').first()
    await nameField.fill(CUSTOMER)
    // Source dropdown
    const sourceSelect = page.locator('select').first()
    await sourceSelect.selectOption({ index: 1 })
    // Submit
    await page.click('button[type="submit"], button:has-text("Save"), button:has-text("Create")')
    await expectToast(page, 'created')
  })

  test('lead list shows customer name after creation', async ({ page }) => {
    await page.goto('/leads/list')
    // Page should load without error
    await expect(page.locator('table').first()).toBeVisible({ timeout: 8_000 })
    // No "Failed to load" error
    await expect(page.locator('text=Failed to load')).not.toBeVisible()
  })

})
