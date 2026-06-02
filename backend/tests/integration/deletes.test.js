'use strict'

const request = require('supertest')
const app = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token
let adminId

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'adminpass123' })
  token = res.body.data.token
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
  adminId = me.body.data.id
})

beforeEach(async () => {
  await truncateTestTables()
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function createSupplier() {
  const res = await request(app)
    .post('/api/suppliers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test Supplier', source: 'Direct' })
  return res.body.data
}

async function createLead(extra = {}) {
  const res = await request(app)
    .post('/api/leads')
    .set('Authorization', `Bearer ${token}`)
    .send({ supplier_name: 'Test Lead', source: 'Email', ...extra })
  return res.body.data
}

async function createQuote(extra = {}) {
  const res = await request(app)
    .post('/api/quotations')
    .set('Authorization', `Bearer ${token}`)
    .send({ items: [{ description: 'Item A', qty: 10, unit_price: 5.00 }], ...extra })
  return res.body.data
}

async function createInvoice(extra = {}) {
  const supplier = await createSupplier()
  const res = await request(app)
    .post('/api/invoices')
    .set('Authorization', `Bearer ${token}`)
    .send({ supplier_id: supplier.id, subtotal: 50, total: 50, ...extra })
  return res.body.data
}

async function createOrder(supplier_id) {
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      order_type: 'apparel',
      supplier_id,
      items: [{ item: 'T-Shirt', color: 'Black', size: 'M', qty: 10, unit_price: 5.00 }],
    })
  return res.body.data
}

async function createPO(extra = {}) {
  const res = await request(app)
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      vendor_name: 'Test Vendor',
      items: [{ item_name: 'Blank T-Shirt', qty_ordered: 10, unit_price: 3.00 }],
      ...extra,
    })
  return res.body.data
}

// ── LEAD DELETE ───────────────────────────────────────────────────────────────

describe('DELETE /api/leads/:id', () => {
  test('permanently deletes a lead with no linked quotation', async () => {
    const lead = await createLead()
    expect(lead.id).toBeDefined()

    const del = await request(app)
      .delete(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)
    expect(del.body.success).toBe(true)

    const { rows } = await pool.query(`SELECT id FROM leads WHERE id = $1`, [lead.id])
    expect(rows).toHaveLength(0)
  })

  test('returns 409 when lead has a linked quotation', async () => {
    const lead = await createLead()
    // Link a quotation to the lead
    await pool.query(`UPDATE quotations SET lead_id = $1 WHERE id = (SELECT id FROM quotations LIMIT 1)`, [lead.id])
    // Create a real quotation linked to this lead
    await pool.query(
      `INSERT INTO quotations (quote_number, lead_id, subtotal, total, created_by)
       VALUES ('QT-TEST-0001', $1, 50, 50, $2)`,
      [lead.id, adminId]
    )

    const del = await request(app)
      .delete(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(409)
    expect(del.body.success).toBe(false)
    expect(del.body.message).toMatch(/quotation/)

    // Lead still exists
    const { rows } = await pool.query(`SELECT id FROM leads WHERE id = $1`, [lead.id])
    expect(rows).toHaveLength(1)
  })

  test('returns 404 for non-existent lead', async () => {
    const res = await request(app)
      .delete('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

// ── QUOTATION DELETE ──────────────────────────────────────────────────────────

describe('DELETE /api/quotations/:id', () => {
  test('permanently deletes a quotation and its items', async () => {
    const quote = await createQuote()
    expect(quote.id).toBeDefined()
    const quoteId = quote.id

    const del = await request(app)
      .delete(`/api/quotations/${quoteId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const { rows: q } = await pool.query(`SELECT id FROM quotations WHERE id = $1`, [quoteId])
    expect(q).toHaveLength(0)
    const { rows: items } = await pool.query(`SELECT id FROM quotation_items WHERE quotation_id = $1`, [quoteId])
    expect(items).toHaveLength(0)
  })

  test('returns 409 when quotation has a linked invoice', async () => {
    const quote = await createQuote()
    // Link invoice to quote
    await pool.query(
      `INSERT INTO invoices (invoice_number, quote_id, subtotal, total, created_by)
       VALUES ('INV-TEST-0001', $1, 50, 50, $2)`,
      [quote.id, adminId]
    )

    const del = await request(app)
      .delete(`/api/quotations/${quote.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(409)
    expect(del.body.message).toMatch(/invoice|order/)
  })

  test('idempotency — deleting twice returns 404 on second attempt', async () => {
    const quote = await createQuote()
    const del1 = await request(app).delete(`/api/quotations/${quote.id}`).set('Authorization', `Bearer ${token}`)
    expect(del1.status).toBe(200)
    const del2 = await request(app).delete(`/api/quotations/${quote.id}`).set('Authorization', `Bearer ${token}`)
    expect(del2.status).toBe(404)
  })
})

// ── INVOICE DELETE ────────────────────────────────────────────────────────────

describe('DELETE /api/invoices/:id', () => {
  test('permanently deletes a standalone invoice', async () => {
    const inv = await createInvoice()
    expect(inv.id).toBeDefined()

    const del = await request(app)
      .delete(`/api/invoices/${inv.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const { rows } = await pool.query(`SELECT id FROM invoices WHERE id = $1`, [inv.id])
    expect(rows).toHaveLength(0)
  })

  test('returns 409 when an order references the invoice', async () => {
    const inv = await createInvoice()
    const supplier = await createSupplier()
    // Create an order linked to this invoice
    await pool.query(
      `INSERT INTO orders (order_number, supplier_id, order_type, invoice_id, created_by)
       VALUES ('ORD-TEST-0001', $1, 'apparel', $2, $3)`,
      [supplier.id, inv.id, adminId]
    )

    const del = await request(app)
      .delete(`/api/invoices/${inv.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(409)
    expect(del.body.message).toMatch(/order/)
  })
})

// ── ORDER DELETE ──────────────────────────────────────────────────────────────

describe('DELETE /api/orders/:id', () => {
  test('permanently deletes an order and its items', async () => {
    const supplier = await createSupplier()
    const order = await createOrder(supplier.id)
    expect(order.id).toBeDefined()

    const del = await request(app)
      .delete(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const { rows } = await pool.query(`SELECT id FROM orders WHERE id = $1`, [order.id])
    expect(rows).toHaveLength(0)
    const { rows: items } = await pool.query(`SELECT id FROM order_items_apparel WHERE order_id = $1`, [order.id])
    expect(items).toHaveLength(0)
  })

  test('returns 409 when a purchase order is linked to the order', async () => {
    const supplier = await createSupplier()
    const order = await createOrder(supplier.id)
    // Link a PO to this order
    await pool.query(
      `INSERT INTO purchase_orders (po_number, order_id, vendor_name, grand_total, created_by)
       VALUES ('PO-TEST-0001', $1, 'Vendor', 30, $2)`,
      [order.id, adminId]
    )

    const del = await request(app)
      .delete(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(409)
    expect(del.body.message).toMatch(/purchase order/)
  })
})

// ── PURCHASE ORDER DELETE ─────────────────────────────────────────────────────

describe('DELETE /api/purchase-orders/:id', () => {
  test('permanently deletes a PO and its child rows', async () => {
    const po = await createPO()
    expect(po.id).toBeDefined()

    const del = await request(app)
      .delete(`/api/purchase-orders/${po.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const { rows } = await pool.query(`SELECT id FROM purchase_orders WHERE id = $1`, [po.id])
    expect(rows).toHaveLength(0)
    const { rows: items } = await pool.query(`SELECT id FROM purchase_order_items WHERE po_id = $1`, [po.id])
    expect(items).toHaveLength(0)
  })

  test('idempotency — deleting twice returns 404 on second attempt', async () => {
    const po = await createPO()
    const del1 = await request(app).delete(`/api/purchase-orders/${po.id}`).set('Authorization', `Bearer ${token}`)
    expect(del1.status).toBe(200)
    const del2 = await request(app).delete(`/api/purchase-orders/${po.id}`).set('Authorization', `Bearer ${token}`)
    expect(del2.status).toBe(404)
  })
})
