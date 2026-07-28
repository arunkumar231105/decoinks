'use strict'

// Verifies the fix: creating an order from an invoice sets the circular
// back-link invoices.order_id, which is what the UI guard relies on to stop
// offering "Convert to Order" again (the source of duplicate orders).

const { pool } = require('../../src/config/db')
const orders   = require('../../src/modules/orders/orders.service')

let userId

async function reset() {
  await pool.query(`
    TRUNCATE TABLE
      payments, invoice_items, invoices,
      order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
      activity_logs, users
    RESTART IDENTITY CASCADE`)
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password, role)
     VALUES (uuid_generate_v4(), 'Backlink Tester', 'bl@test.com', 'x', 'Admin')
     RETURNING id`)
  userId = rows[0].id
}

async function seedInvoice(number) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (invoice_number, status, subtotal, discount_amt, tax_amt, total, amount_paid, balance_due, customer_name, order_type)
     VALUES ($1, 'Draft', 100, 0, 0, 100, 0, 100, 'Test Customer', 'apparel')
     RETURNING id`, [number])
  const invId = rows[0].id
  await pool.query(
    `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, colors, sizes)
     VALUES ($1, 'Item', 1, 100, 100, 'Black', 'M')`, [invId])
  return invId
}

const invoiceOrderId = async (invId) =>
  (await pool.query(`SELECT order_id FROM invoices WHERE id = $1`, [invId])).rows[0].order_id

beforeAll(reset)

test('creating an order from an invoice sets invoices.order_id back-link', async () => {
  const invId = await seedInvoice('INV-BL-0001')
  expect(await invoiceOrderId(invId)).toBeNull()   // not linked yet

  const order = await orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })

  expect(order.invoice_id).toBe(invId)
  expect(await invoiceOrderId(invId)).toBe(order.id)   // back-link now set → UI guard activates
})

test('back-link is idempotent — a second order never overwrites the first link', async () => {
  const invId = await seedInvoice('INV-BL-0002')
  const first  = await orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })
  const second = await orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })

  // The invoice stays linked to the FIRST order; the second create cannot steal
  // or overwrite the link (AND order_id IS NULL), so no data is lost.
  expect(await invoiceOrderId(invId)).toBe(first.id)
  expect(second.id).not.toBe(first.id)
})
