'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token
let supplierId

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  token = loginRes.body.data.token

  // Create a supplier used across all tests
  const supRes = await request(app)
    .post('/api/suppliers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Pipeline Supplier', email: 'pipeline@test.com' })
  supplierId = supRes.body.data.id
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

// ── Helper: create a draft quotation with order_type ────────────────────────
async function createQuote(orderType = 'apparel') {
  const res = await request(app)
    .post('/api/quotations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      supplier_id: supplierId,
      order_type:  orderType,
      items: [{ description: 'T-Shirt', qty: 10, unit_price: 15 }],
    })
  expect(res.status).toBe(201)
  return res.body.data
}

// ── Helper: approve a quotation ─────────────────────────────────────────────
async function approveQuote(quoteId) {
  const res = await request(app)
    .patch(`/api/quotations/${quoteId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'Approved' })
  expect(res.status).toBe(200)
  return res.body.data
}

// ── Helper: mark invoice as Paid ────────────────────────────────────────────
async function payInvoice(invoiceId) {
  const res = await request(app)
    .patch(`/api/invoices/${invoiceId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'Paid' })
  expect(res.status).toBe(200)
  return res.body.data
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Pipeline: quote_approved → auto-invoice', () => {
  test('approving a quote creates an invoice linked via quote_id', async () => {
    const quote = await createQuote('apparel')

    const result = await approveQuote(quote.id)

    // Response should include the auto-created invoice id
    expect(result.auto_invoice_id).toBeTruthy()

    // Invoice should exist in DB with correct linkage and totals
    const { rows } = await pool.query(
      `SELECT * FROM invoices WHERE id = $1`, [result.auto_invoice_id]
    )
    expect(rows).toHaveLength(1)
    const inv = rows[0]
    expect(inv.quote_id).toBe(quote.id)
    expect(inv.supplier_id).toBe(supplierId)
    expect(+inv.total).toBeCloseTo(+quote.total, 2)
    expect(inv.status).toBe('Sent')
  })

  test('idempotency: re-approving an Approved quote returns 422 (state machine guard)', async () => {
    const quote = await createQuote('gangsheet')
    await approveQuote(quote.id)

    // Re-approve should be blocked by state machine (Approved is terminal)
    const res = await request(app)
      .patch(`/api/quotations/${quote.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Approved' })
    expect(res.status).toBe(422)

    // Exactly one invoice should exist
    const { rows } = await pool.query(
      `SELECT id FROM invoices WHERE quote_id = $1`, [quote.id]
    )
    expect(rows).toHaveLength(1)
  })

  test('pipeline_events row logged on quote approval', async () => {
    const quote = await createQuote('dtf')
    await approveQuote(quote.id)

    const { rows } = await pool.query(
      `SELECT * FROM pipeline_events WHERE source_id = $1 AND event_type = 'quote_approved'`,
      [quote.id]
    )
    expect(rows).toHaveLength(1)
  })
})

describe('Pipeline: invoice_paid → auto-order', () => {
  test('marking invoice Paid creates an order linked via invoice_id', async () => {
    const quote = await createQuote('apparel')
    const approved = await approveQuote(quote.id)
    const invoiceId = approved.auto_invoice_id

    const result = await payInvoice(invoiceId)

    // Small delay for best-effort post-commit path in recordPayment (not needed here since updateStatus is transactional)
    expect(result.auto_order_id).toBeTruthy()

    const { rows } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL`, [result.auto_order_id]
    )
    expect(rows).toHaveLength(1)
    const ord = rows[0]
    expect(ord.invoice_id).toBe(invoiceId)
    expect(ord.supplier_id).toBe(supplierId)
    expect(ord.order_type).toBe('apparel')
    expect(+ord.total).toBeCloseTo(+quote.total, 2)
    expect(ord.status).toBe('Draft')
  })

  test('idempotency: re-paying a Paid invoice returns 422 (state machine guard)', async () => {
    const quote = await createQuote('gangsheet')
    const approved = await approveQuote(quote.id)
    const invoiceId = approved.auto_invoice_id

    await payInvoice(invoiceId)

    // Paid is terminal — re-paying blocked by state machine
    const res2 = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Paid' })
    expect(res2.status).toBe(422)

    const { rows } = await pool.query(
      `SELECT id FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL`, [invoiceId]
    )
    expect(rows).toHaveLength(1)  // still only one order
  })

  test('pipeline_events row logged on invoice paid', async () => {
    const quote = await createQuote('dtf')
    const approved = await approveQuote(quote.id)
    await payInvoice(approved.auto_invoice_id)

    const { rows } = await pool.query(
      `SELECT * FROM pipeline_events WHERE source_id = $1 AND event_type = 'invoice_paid'`,
      [approved.auto_invoice_id]
    )
    expect(rows).toHaveLength(1)
  })

  test('no auto-order when invoice has no linked quote (no order_type)', async () => {
    // Create invoice directly without a quote
    const invRes = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplier_id: supplierId,
        subtotal: 100, discount_amt: 0, tax_amt: 0,
        issue_date: new Date().toISOString().split('T')[0],
      })
    expect(invRes.status).toBe(201)
    const invoiceId = invRes.body.data.id

    // Direct invoices start as Draft; must go Draft → Sent first
    const sentRes = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Sent' })
    expect(sentRes.status).toBe(200)

    const result = await payInvoice(invoiceId)

    // auto_order_id should be null since no order_type is derivable
    expect(result.auto_order_id).toBeNull()
  })
})

describe('Pipeline: full end-to-end Lead → Quote → Invoice → Order', () => {
  test('complete pipeline produces linked records across all four stages', async () => {
    const quote = await createQuote('apparel')
    expect(quote.status).toBe('Draft')

    // 1. Approve quote → invoice auto-created
    const approvedQuote = await approveQuote(quote.id)
    expect(approvedQuote.status).toBe('Approved')
    const invoiceId = approvedQuote.auto_invoice_id
    expect(invoiceId).toBeTruthy()

    // 2. Pay invoice → order auto-created
    const paidInvoice = await payInvoice(invoiceId)
    expect(paidInvoice.status).toBe('Paid')
    const orderId = paidInvoice.auto_order_id
    expect(orderId).toBeTruthy()

    // 3. Verify chain integrity
    const { rows: invRows } = await pool.query(`SELECT * FROM invoices WHERE id=$1`, [invoiceId])
    expect(invRows[0].quote_id).toBe(quote.id)

    const { rows: ordRows } = await pool.query(`SELECT * FROM orders WHERE id=$1`, [orderId])
    expect(ordRows[0].invoice_id).toBe(invoiceId)

    // 4. Verify pipeline_events chain
    const { rows: events } = await pool.query(
      `SELECT event_type FROM pipeline_events WHERE source_id IN ($1,$2) OR target_id IN ($1,$2)
       ORDER BY triggered_at`,
      [quote.id, invoiceId]
    )
    const eventTypes = events.map(e => e.event_type)
    expect(eventTypes).toContain('invoice_created_from_quote')
    expect(eventTypes).toContain('quote_approved')
    expect(eventTypes).toContain('order_created_from_invoice')
    expect(eventTypes).toContain('invoice_paid')
  })
})
