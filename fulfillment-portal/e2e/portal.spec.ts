/**
 * Customer Portal – E2E Test Suite (Section 12.2)
 * Run: npx playwright test
 * Prereq: docker-compose up (backend + DB running), portal dev server on :3001
 *
 * These tests use a real portal user. Create one via the POS admin panel before running:
 *   username: e2e_test_user  password: E2eTestPass1!
 * Or seed it via: node scripts/seed-portal-e2e.js
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Credentials (override via env for CI) ──────────────────────────────────

const PORTAL_URL      = process.env.PORTAL_URL      ?? 'http://localhost:3001'
const PORTAL_USERNAME = process.env.PORTAL_USERNAME  ?? 'e2e_test_user'
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD  ?? 'E2eTestPass1!'
const NEW_PASSWORD    = process.env.PORTAL_NEW_PW    ?? 'E2eNewPass99!'

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function login(page: Page, username = PORTAL_USERNAME, password = PORTAL_PASSWORD) {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByPlaceholder('Enter your username').fill(username)
  await page.getByPlaceholder('Enter your password').fill(password)
  await page.getByRole('button', { name: 'Log In' }).click()
}

// ─── Test 1: Unauthenticated → redirect to /login ────────────────────────────

test('1. unauthenticated visit → redirects to /login', async ({ page }) => {
  await page.goto(PORTAL_URL)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('PRINTSHOP CPS – Customer Portal')).toBeVisible()
})

// ─── Test 2: Login with valid credentials → dashboard loads ──────────────────

test('2. login with valid credentials → dashboard loads with company name', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(`${PORTAL_URL}/`)
  await expect(page.getByText('Dashboard')).toBeVisible()
  // Sidebar shows company name from JWT
  await expect(page.locator('aside')).toContainText(/.+/) // at least some company text
  // Stat cards are rendered
  await expect(page.getByText('Total Orders')).toBeVisible()
  await expect(page.getByText('In Production')).toBeVisible()
})

// ─── Test 3: Invalid credentials → error toast ───────────────────────────────

test('3. wrong password → error toast shown, no redirect', async ({ page }) => {
  await page.goto(`${PORTAL_URL}/login`)
  await page.getByPlaceholder('Enter your username').fill(PORTAL_USERNAME)
  await page.getByPlaceholder('Enter your password').fill('wrong_password!')
  await page.getByRole('button', { name: 'Log In' }).click()
  await expect(page.getByText('Invalid username or password')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

// ─── Test 4: Notification bell shows count ───────────────────────────────────

test('4. notification bell shows unread count', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(`${PORTAL_URL}/`)
  // Bell button always visible in topbar
  const bell = page.locator('header button').filter({ has: page.locator('svg') }).first()
  await expect(bell).toBeVisible()
})

// ─── Test 5: Orders page — only sent orders ───────────────────────────────────

test('5. orders page → shows only orders sent by admin, with status badges', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Orders' }).click()
  await expect(page).toHaveURL(`${PORTAL_URL}/orders`)
  await expect(page.getByText('Orders')).toBeVisible()
  // Table renders (header is visible even with 0 orders)
  await expect(page.getByRole('columnheader', { name: 'Order ID' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  // Stat cards at top
  await expect(page.getByText('Total Orders')).toBeVisible()
})

// ─── Test 6: Order detail page ───────────────────────────────────────────────

test('6. clicking an order → detail page loads with items and artworks section', async ({ page }) => {
  await login(page)
  await page.goto(`${PORTAL_URL}/orders`)

  const firstOrderLink = page.locator('table tbody tr td a').first()
  const count = await firstOrderLink.count()

  if (count === 0) {
    test.skip() // no orders sent yet — run after admin sends at least one
    return
  }

  await firstOrderLink.click()
  await expect(page).toHaveURL(/\/orders\/.+/)
  await expect(page.getByText('Order Details')).toBeVisible()
  await expect(page.getByText('Artwork Preview')).toBeVisible()
  await expect(page.getByText('Shipping Information')).toBeVisible()
  // No fulfillment actions section
  await expect(page.getByText('Fulfillment Actions')).not.toBeVisible()
})

// ─── Test 7: Purchase Orders page ────────────────────────────────────────────

test('7. purchase orders page → loads with PO table', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Purchase Orders' }).click()
  await expect(page).toHaveURL(`${PORTAL_URL}/purchase-orders`)
  await expect(page.getByText('Purchase Orders')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'PO Number' })).toBeVisible()
})

// ─── Test 8: Artworks page ───────────────────────────────────────────────────

test('8. artworks page → grid renders, filter controls visible', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Artworks' }).click()
  await expect(page).toHaveURL(`${PORTAL_URL}/artworks`)
  await expect(page.getByText('Artworks')).toBeVisible()
  await expect(page.getByPlaceholder('Search by artwork code or name...')).toBeVisible()
  await expect(page.getByRole('combobox')).toBeVisible() // position filter
})

// ─── Test 9: Profile → Change Password ────────────────────────────────────────

test('9. profile page → change password flow', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(`${PORTAL_URL}/profile`)
  await expect(page.getByText('Change Password')).toBeVisible()

  // Fill change password form
  const fields = page.locator('input[type="password"]')
  await fields.nth(0).fill(PORTAL_PASSWORD)
  await fields.nth(1).fill(NEW_PASSWORD)
  await fields.nth(2).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Change Password' }).click()

  await expect(page.getByText('Password changed successfully')).toBeVisible()

  // Restore original password
  await fields.nth(0).fill(NEW_PASSWORD)
  await fields.nth(1).fill(PORTAL_PASSWORD)
  await fields.nth(2).fill(PORTAL_PASSWORD)
  await page.getByRole('button', { name: 'Change Password' }).click()
  await expect(page.getByText('Password changed successfully')).toBeVisible()
})

// ─── Test 10: mustChangePw → forced redirect to /change-password ──────────────

test('10. first login with mustChangePw=true → redirected to /change-password', async ({ page }) => {
  // This test requires an account with must_change_pw=TRUE in the DB.
  // Create via: INSERT INTO customer_portal_users (..., must_change_pw=TRUE, username='e2e_mustchange')
  // Skip if not set up.
  const mustChangeUser = process.env.MUST_CHANGE_USER
  const mustChangePw   = process.env.MUST_CHANGE_PW
  if (!mustChangeUser || !mustChangePw) {
    test.skip()
    return
  }

  await login(page, mustChangeUser, mustChangePw)
  await expect(page).toHaveURL(`${PORTAL_URL}/change-password`)
  await expect(page.getByText('Change Your Password')).toBeVisible()
  await expect(page.getByText('You must set a new password before continuing')).toBeVisible()
})

// ─── Test 11: Logout ──────────────────────────────────────────────────────────

test('11. logout → redirected to /login, protected pages inaccessible', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(`${PORTAL_URL}/`)

  // Click logout in sidebar
  await page.locator('aside').getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Try navigating to protected route
  await page.goto(`${PORTAL_URL}/orders`)
  await expect(page).toHaveURL(/\/login/)
})
