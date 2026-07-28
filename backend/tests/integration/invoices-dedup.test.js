'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  Focused tests for the quote → invoice create-or-sync policy implemented in
//  invoices.service.create (advisory-locked, transactional).
//
//  Covers the five required behaviours:
//    1. First conversion            → create invoice + items (one transaction).
//    2. Repeated editable conversion→ update the SAME draft invoice, no duplicate.
//    3. Repeated locked conversion  → 409 conflict, existing invoice untouched.
//    4. Concurrent conversion       → exactly one invoice.
//    5. Item-copy failure           → rollback, no orphan / existing unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../src/config/db')
const service  = require('../../src/modules/invoices/invoices.service')

let userId

async function reset() {
  await pool.query(`
    TRUNCATE TABLE
      payments, invoice_items, invoices,
      quotation_items, quotations,
      order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
      pipeline_events, activity_logs, users
    RESTART IDENTITY CASCADE
  `)
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password, role)
     VALUES (uuid_generate_v4(), 'Dedup Tester', 'dedup@test.com', 'x', 'Admin')
     RETURNING id`
  )
  userId = rows[0].id
}

// Seed a quotation (Approved) with line items; returns the quote id.
async function seedQuote({ number, customer_name = 'Acme Co', subtotal = 100, total = 100, items = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO quotations
       (quote_number, customer_name, status, subtotal, discount_amt, tax_amt, total, order_type, currency)
     VALUES ($1,$2,'Approved',$3,0,0,$4,'dtf','USD')
     RETURNING id`,
    [number, customer_name, subtotal, total]
  )
  const quoteId = rows[0].id
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    await pool.query(
      `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [quoteId, it.description, it.qty, it.unit_price, it.amount, i]
    )
  }
  return quoteId
}

const countInvoices = async (quoteId) =>
  Number((await pool.query(`SELECT COUNT(*) FROM invoices WHERE quote_id = $1`, [quoteId])).rows[0].count)

const countItems = async (invoiceId) =>
  Number((await pool.query(`SELECT COUNT(*) FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0].count)

beforeAll(reset)

// ── 1. First conversion ───────────────────────────────────────────────────────
describe('CASE 1 — first conversion', () => {
  test('creates the invoice and copies quotation line items', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1001',
      items: [
        { description: 'Front print', qty: 10, unit_price: 5, amount: 50 },
        { description: 'Back print',  qty: 10, unit_price: 5, amount: 50 },
      ],
    })

    const inv = await service.create({ quote_id: quoteId, created_by: userId })

    expect(inv.quote_id).toBe(quoteId)
    expect(inv.status).toBe('Draft')
    expect(Number(inv.total)).toBe(100)
    expect(inv.invoice_number).toBeTruthy()
    expect(inv.internal_no).toBe(`INV-INT-${inv.invoice_number}`)
    expect(await countInvoices(quoteId)).toBe(1)
    expect(await countItems(inv.id)).toBe(2)
  })
})

// ── 2. Repeated editable conversion ───────────────────────────────────────────
describe('CASE 2 — repeated conversion of an editable draft', () => {
  test('updates the SAME invoice (id + number preserved), syncs fields, replaces items', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1002',
      customer_name: 'Original Name',
      subtotal: 100, total: 100,
      items: [{ description: 'Item A', qty: 1, unit_price: 100, amount: 100 }],
    })

    const first = await service.create({ quote_id: quoteId, created_by: userId })

    // Quotation is edited: new customer, new totals, different line items.
    await pool.query(
      `UPDATE quotations SET customer_name='Updated Name', subtotal=250, total=250 WHERE id=$1`,
      [quoteId]
    )
    await pool.query(`DELETE FROM quotation_items WHERE quotation_id=$1`, [quoteId])
    await pool.query(
      `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order)
       VALUES ($1,'New line 1',2,50,100,0), ($1,'New line 2',3,50,150,1)`,
      [quoteId]
    )

    const second = await service.create({ quote_id: quoteId, created_by: userId })

    expect(second.id).toBe(first.id)                       // same invoice preserved
    expect(second.invoice_number).toBe(first.invoice_number)
    expect(second.internal_no).toBe(first.internal_no)
    expect(second.customer_name).toBe('Updated Name')      // synced
    expect(Number(second.total)).toBe(250)                 // synced
    expect(await countInvoices(quoteId)).toBe(1)           // NO duplicate
    expect(await countItems(second.id)).toBe(2)            // items replaced (was 1, now 2)
  })
})

// ── 3. Repeated locked conversion ─────────────────────────────────────────────
describe('CASE 3 — repeated conversion of a locked invoice', () => {
  test('a recorded payment locks the invoice → 409, invoice untouched, no duplicate', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1003',
      customer_name: 'Payer Co',
      items: [{ description: 'Item', qty: 1, unit_price: 100, amount: 100 }],
    })
    const inv = await service.create({ quote_id: quoteId, created_by: userId })

    // Record a payment against the invoice → it is no longer safely editable.
    await pool.query(
      `INSERT INTO payments (invoice_id, amount, payment_method, recorded_by)
       VALUES ($1, 40, 'cash', $2)`,
      [inv.id, userId]
    )

    await expect(service.create({ quote_id: quoteId, created_by: userId }))
      .rejects.toMatchObject({ statusCode: 409 })

    // Existing invoice unchanged; still exactly one.
    expect(await countInvoices(quoteId)).toBe(1)
    const after = await pool.query(`SELECT customer_name FROM invoices WHERE id=$1`, [inv.id])
    expect(after.rows[0].customer_name).toBe('Payer Co')
  })

  test('a non-Draft status locks the invoice → 409 naming the existing invoice', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1004',
      items: [{ description: 'Item', qty: 1, unit_price: 100, amount: 100 }],
    })
    const inv = await service.create({ quote_id: quoteId, created_by: userId })
    await pool.query(`UPDATE invoices SET status='Sent' WHERE id=$1`, [inv.id])

    await expect(service.create({ quote_id: quoteId, created_by: userId }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(inv.invoice_number) })

    expect(await countInvoices(quoteId)).toBe(1)
  })
})

// ── 4. Concurrent conversion ──────────────────────────────────────────────────
describe('CASE 4 — concurrent conversion of the same quote', () => {
  test('two simultaneous requests yield exactly one invoice', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1005',
      items: [{ description: 'Item', qty: 1, unit_price: 100, amount: 100 }],
    })

    const results = await Promise.allSettled([
      service.create({ quote_id: quoteId, created_by: userId }),
      service.create({ quote_id: quoteId, created_by: userId }),
    ])

    // Neither request may error, and only one invoice may exist.
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected).toHaveLength(0)
    expect(await countInvoices(quoteId)).toBe(1)

    // Both requests must reference the same invoice id.
    const ids = new Set(results.map((r) => r.value.id))
    expect(ids.size).toBe(1)
  })
})

// ── 5. Item-copy failure ──────────────────────────────────────────────────────
describe('CASE 5 — item write failure rolls back', () => {
  test('CASE 1: a failing line item leaves NO orphan invoice', async () => {
    const quoteId = await seedQuote({ number: 'QT-2026-1006' })

    // amount 1e11 overflows invoice_items.amount NUMERIC(12,2) → INSERT fails.
    await expect(service.create({
      quote_id: quoteId,
      created_by: userId,
      items: [{ description: 'Overflow', qty: 1, unit_price: 1, amount: 100000000000 }],
    })).rejects.toBeDefined()

    expect(await countInvoices(quoteId)).toBe(0)   // rolled back, no orphan
  })

  test('CASE 2: a failing sync leaves the existing draft invoice unchanged', async () => {
    const quoteId = await seedQuote({
      number: 'QT-2026-1007',
      customer_name: 'Keep Me',
      items: [{ description: 'Good', qty: 1, unit_price: 100, amount: 100 }],
    })
    const first = await service.create({ quote_id: quoteId, created_by: userId })
    const originalItems = await countItems(first.id)

    await expect(service.create({
      quote_id: quoteId,
      created_by: userId,
      items: [{ description: 'Overflow', qty: 1, unit_price: 1, amount: 100000000000 }],
    })).rejects.toBeDefined()

    // Header + items untouched.
    const after = await pool.query(`SELECT customer_name FROM invoices WHERE id=$1`, [first.id])
    expect(after.rows[0].customer_name).toBe('Keep Me')
    expect(await countItems(first.id)).toBe(originalItems)
    expect(await countInvoices(quoteId)).toBe(1)
  })
})
