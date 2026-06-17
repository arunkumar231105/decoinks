import { test, expect } from '@playwright/test'
import { login, gotoAndWait } from './helpers'

test.describe('Lead Board', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('leads list page (/leads) loads without error', async ({ page }) => {
    await gotoAndWait(page, '/leads')
    const failed = await page.locator('text=Failed to load').first().isVisible().catch(() => false)
    expect(failed).toBe(false)
  })

  test('leads kanban board (/leads/board) loads without error', async ({ page }) => {
    await gotoAndWait(page, '/leads/board')
    const failed = await page.locator('text=Failed to load').first().isVisible().catch(() => false)
    expect(failed).toBe(false)
  })

  test('no [object Object] displayed on leads page', async ({ page }) => {
    await gotoAndWait(page, '/leads')
    const body = await page.locator('body').textContent()
    expect(body).not.toContain('[object Object]')
  })

})
