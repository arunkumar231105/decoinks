import { test } from '@playwright/test'
import { login, gotoAndWait } from './helpers'
import * as fs from 'fs'
import * as path from 'path'

const SS = path.join(__dirname, '..', 'screenshots')
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true })

test.describe('Visual Screenshots', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('dashboard screenshot', async ({ page }) => {
    await gotoAndWait(page, '/dashboard')
    await page.screenshot({ path: path.join(SS, 'dashboard.png'), fullPage: true })
  })

  test('invoice list screenshot', async ({ page }) => {
    await gotoAndWait(page, '/invoices')
    await page.screenshot({ path: path.join(SS, 'invoices-list.png'), fullPage: true })
  })

  test('new invoice form - gangsheet tab screenshot', async ({ page }) => {
    await gotoAndWait(page, '/invoices/new')
    await page.locator('button:has-text("Gangsheet")').first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SS, 'new-invoice-gangsheet.png'), fullPage: true })
  })

  test('new quotation form - gangsheet tab screenshot', async ({ page }) => {
    await gotoAndWait(page, '/quotes/new')
    await page.locator('.nq-tab-card').filter({ hasText: 'Gangsheet' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SS, 'new-quote-gangsheet.png'), fullPage: true })
  })

  test('customers list screenshot', async ({ page }) => {
    await gotoAndWait(page, '/customers')
    await page.screenshot({ path: path.join(SS, 'customers-list.png'), fullPage: true })
  })

  test('leads list screenshot', async ({ page }) => {
    await gotoAndWait(page, '/leads')
    await page.screenshot({ path: path.join(SS, 'leads-list.png'), fullPage: true })
  })

  test('leads board screenshot', async ({ page }) => {
    await gotoAndWait(page, '/leads/board')
    await page.screenshot({ path: path.join(SS, 'leads-board.png'), fullPage: true })
  })

  test('quotes list screenshot', async ({ page }) => {
    await gotoAndWait(page, '/quotes')
    await page.screenshot({ path: path.join(SS, 'quotes-list.png'), fullPage: true })
  })

})
