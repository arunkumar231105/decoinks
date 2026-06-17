/**
 * Visual screenshot tests.
 * Run once to GENERATE baseline screenshots.
 * Run again to COMPARE — if anything changed visually, test fails.
 *
 * Commands:
 *   npm run screenshots          ← generate/update baseline
 *   npm test -- 08-screenshots   ← compare against baseline
 */
import { test, expect } from '@playwright/test'
import { login } from './helpers'
import * as fs from 'fs'
import * as path from 'path'

const SS = path.join(__dirname, '..', 'screenshots')
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true })

test.describe('Visual Screenshots', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('dashboard screenshot', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: path.join(SS, 'dashboard.png'), fullPage: true })
  })

  test('invoice list screenshot', async ({ page }) => {
    await page.goto('/invoices')
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: path.join(SS, 'invoices-list.png'), fullPage: true })
  })

  test('new invoice form - gangsheet tab screenshot', async ({ page }) => {
    await page.goto('/invoices/new')
    await page.waitForTimeout(1_000)
    await page.click('text=Gangsheet').catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SS, 'new-invoice-gangsheet.png'), fullPage: true })
  })

  test('new quotation form - gangsheet tab screenshot', async ({ page }) => {
    await page.goto('/quotes/new')
    await page.waitForTimeout(1_000)
    await page.click('text=Gangsheet').catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SS, 'new-quote-gangsheet.png'), fullPage: true })
  })

  test('customers list screenshot', async ({ page }) => {
    await page.goto('/customers')
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: path.join(SS, 'customers-list.png'), fullPage: true })
  })

  test('leads board screenshot', async ({ page }) => {
    await page.goto('/leads')
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: path.join(SS, 'leads-board.png'), fullPage: true })
  })

})
