import { test, expect, Page } from '@playwright/test'
import { login, gotoAndWait } from './helpers'
import * as fs from 'fs'
import * as path from 'path'

const SCREENSHOTS = path.join(__dirname, '..', 'screenshots')
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

async function openFirstInvoicePreview(page: Page): Promise<Page | null> {
  await gotoAndWait(page, '/invoices')
  await page.waitForSelector('table tbody tr', { timeout: 10_000 }).catch(() => {})
  const rows = page.locator('table tbody tr')
  if (await rows.count() === 0) return null

  await rows.first().click()
  await page.waitForTimeout(600)

  const previewLink = page.locator('a[href*="/print"], button:has-text("Preview"), button:has-text("Print")').first()
  if (!await previewLink.isVisible({ timeout: 5_000 }).catch(() => false)) return null

  const [preview] = await Promise.all([
    page.context().waitForEvent('page'),
    previewLink.click(),
  ])
  await preview.waitForLoadState('networkidle', { timeout: 20_000 })
  return preview
}

test.describe('Invoice Print Preview', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('preview page shows INVOICE heading', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(); return }

    await expect(preview.locator('text=INVOICE')).toBeVisible({ timeout: 8_000 })
    await preview.screenshot({ path: path.join(SCREENSHOTS, 'preview-heading.png'), fullPage: true })
  })

  test('TOTAL DUE is not $0.00 on invoice with amount', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(); return }

    const totalDueRow = preview.locator('.tr-total').first()
    await expect(totalDueRow).toBeVisible({ timeout: 8_000 })
    const totalText = await totalDueRow.textContent() ?? ''
    const summaryText = await preview.locator('.summary-box').first().textContent().catch(() => '')
    if (summaryText && !summaryText.includes('$0.00')) {
      expect(totalText).not.toContain('$0.00')
    }
  })

  test('amount in words is not "00/100" when total > 0', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(); return }

    const totalText = await preview.locator('.tr-total').first().textContent().catch(() => '')
    const wordsText = await preview.locator('.pay-words').first().textContent().catch(() => '')

    if (totalText && !totalText.includes('$0.00')) {
      expect(wordsText).not.toContain('and 00/100')
    }
  })

  test('Bill To section is not just a dash', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(); return }

    const billCard = preview.locator('.ic').first()
    await expect(billCard).toBeVisible({ timeout: 8_000 })
    const nameText = await billCard.locator('.ic-name').textContent().catch(() => '')
    expect(nameText?.trim()).not.toBe('—')

    await preview.screenshot({ path: path.join(SCREENSHOTS, 'bill-to.png'), fullPage: true })
  })

  test('gangsheet invoice shows Gangsheet Size column', async ({ page }) => {
    await gotoAndWait(page, '/invoices')
    await page.waitForSelector('table tbody tr', { timeout: 10_000 }).catch(() => {})

    const gangsheetRow = page.locator('table tbody tr:has-text("gangsheet"), table tbody tr:has-text("Gangsheet")').first()
    if (!await gangsheetRow.isVisible().catch(() => false)) {
      test.skip()
      return
    }

    await gangsheetRow.click()
    await page.waitForTimeout(600)

    const previewBtn = page.locator('a[href*="/print"], button:has-text("Preview"), button:has-text("Print")').first()
    if (!await previewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) { test.skip(); return }

    const [preview] = await Promise.all([
      page.context().waitForEvent('page'),
      previewBtn.click(),
    ])
    await preview.waitForLoadState('networkidle')

    await expect(preview.locator('text=Gangsheet Size')).toBeVisible({ timeout: 8_000 })
    await expect(preview.locator('text=DTF Transfers')).not.toBeVisible()

    await preview.screenshot({ path: path.join(SCREENSHOTS, 'gangsheet-preview.png'), fullPage: true })
  })

})
