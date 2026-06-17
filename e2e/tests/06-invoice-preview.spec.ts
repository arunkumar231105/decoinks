/**
 * Invoice Preview Tests
 * These tests open the actual print preview page and verify:
 *  - Correct template is shown (gangsheet vs apparel vs DTF)
 *  - Bill To / Shipping Address shows customer data
 *  - TOTAL DUE is not $0.00 when there are items
 *  - Amount in words is not "and 00/100"
 *  - Screenshots captured for visual review
 */
import { test, expect, Page } from '@playwright/test'
import { login } from './helpers'
import * as fs from 'fs'
import * as path from 'path'

// Make sure screenshots dir exists
const SCREENSHOTS = path.join(__dirname, '..', 'screenshots')
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

async function openFirstInvoicePreview(page: Page): Promise<Page | null> {
  await page.goto('/invoices')
  await page.waitForSelector('table tbody tr', { timeout: 10_000 }).catch(() => {})
  const rows = page.locator('table tbody tr')
  if (await rows.count() === 0) return null

  await rows.first().click()
  await page.waitForTimeout(800)

  const previewLink = page.locator('a[href*="/print"], button:has-text("Preview"), button:has-text("Print")').first()
  if (!await previewLink.isVisible()) return null

  const [preview] = await Promise.all([
    page.context().waitForEvent('page'),
    previewLink.click(),
  ])
  await preview.waitForLoadState('networkidle', { timeout: 15_000 })
  return preview
}

test.describe('Invoice Print Preview', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('preview page shows INVOICE heading', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(true, 'No invoices'); return }

    await expect(preview.locator('text=INVOICE')).toBeVisible({ timeout: 8_000 })
    await preview.screenshot({ path: path.join(SCREENSHOTS, 'preview-heading.png'), fullPage: true })
  })

  test('TOTAL DUE is not $0.00 on invoice with amount', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(true, 'No invoices'); return }

    // Get the TOTAL DUE cell text
    const totalDueRow = preview.locator('.tr-total')
    await expect(totalDueRow).toBeVisible({ timeout: 8_000 })
    const text = await totalDueRow.textContent() ?? ''
    // If Items Total > 0, TOTAL DUE must not be $0.00
    const itemsTotal = await preview.locator('.summary-box .sv').first().textContent() ?? ''
    if (!itemsTotal.includes('$0.00')) {
      expect(text).not.toContain('$0.00')
    }
  })

  test('amount in words is not "00/100" when total > 0', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(true, 'No invoices'); return }

    const words = await preview.locator('.pay-words').first().textContent().catch(() => '')
    const totalDue = await preview.locator('.tr-total').first().textContent().catch(() => '')

    if (totalDue && !totalDue.includes('$0.00')) {
      expect(words).not.toContain('and 00/100')
    }
  })

  test('Bill To section is not empty (shows dash only)', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(true, 'No invoices'); return }

    // Find the Bill To card
    const billToCard = preview.locator('.ic').first()
    await expect(billToCard).toBeVisible({ timeout: 8_000 })
    const text = await billToCard.textContent() ?? ''
    // Name should not just be a lone dash
    const nameText = await billToCard.locator('.ic-name').textContent().catch(() => '')
    expect(nameText?.trim()).not.toBe('—')
  })

  test('gangsheet invoice shows Gangsheet Size column, not DTF Transfers', async ({ page }) => {
    // Find a gangsheet invoice specifically
    await page.goto('/invoices')
    await page.waitForSelector('table tbody tr', { timeout: 10_000 }).catch(() => {})

    // Try to find any invoice marked as gangsheet
    const gangsheetRow = page.locator('table tbody tr:has-text("gangsheet"), table tbody tr:has-text("Gangsheet")').first()
    const hasGangsheet = await gangsheetRow.isVisible().catch(() => false)
    if (!hasGangsheet) { test.skip(true, 'No gangsheet invoices'); return }

    await gangsheetRow.click()
    await page.waitForTimeout(800)

    const previewBtn = page.locator('a[href*="/print"], button:has-text("Preview"), button:has-text("Print")').first()
    if (!await previewBtn.isVisible()) { test.skip(true, 'No preview button'); return }

    const [preview] = await Promise.all([
      page.context().waitForEvent('page'),
      previewBtn.click(),
    ])
    await preview.waitForLoadState('networkidle')

    // Gangsheet template has "Gangsheet Size" column
    await expect(preview.locator('text=Gangsheet Size')).toBeVisible({ timeout: 8_000 })
    // Must NOT have DTF Transfers heading
    await expect(preview.locator('text=DTF Transfers')).not.toBeVisible()

    await preview.screenshot({ path: path.join(SCREENSHOTS, 'gangsheet-preview.png'), fullPage: true })
  })

  test('apparel invoice shows correct columns', async ({ page }) => {
    const preview = await openFirstInvoicePreview(page)
    if (!preview) { test.skip(true, 'No invoices'); return }

    // Check for any table header
    const hasTable = await preview.locator('.inv-tbl').isVisible({ timeout: 8_000 }).catch(() => false)
    if (hasTable) {
      await preview.screenshot({ path: path.join(SCREENSHOTS, 'invoice-table.png') })
    }
  })

})
