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

async function seedInvoice(number, status = 'Paid') {
  const paid = status === 'Paid' ? 100 : 0
  const { rows } = await pool.query(
    `INSERT INTO invoices (invoice_number, status, subtotal, discount_amt, tax_amt, total, amount_paid, balance_due, customer_name, order_type)
     VALUES ($1, $2, 100, 0, 0, 100, $3, $4, 'Test Customer', 'apparel')
     RETURNING id`, [number, status, paid, 100 - paid])
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

// The "fully paid" gate was removed on purpose: work often goes into
// production against a deposit, long before the balance is settled. The test
// used to assert the gate, so it began failing the moment the gate went.
test('an invoice that is not yet paid can still raise its sales order', async () => {
  const invId = await seedInvoice('INV-BL-UNPAID', 'Draft')

  const order = await orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })

  expect(order.invoice_id).toBe(invId)
  expect(await invoiceOrderId(invId)).toBe(order.id)
  // What has and has not been paid is carried over, not lost.
  expect(Number(order.total)).toBe(100)
})

test('a second order cannot be created from the same paid invoice', async () => {
  const invId = await seedInvoice('INV-BL-0002')
  const first  = await orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })
  await expect(
    orders.create({ invoice_id: invId, order_type: 'apparel', created_by: userId })
  ).rejects.toMatchObject({ statusCode: 409 })

  // The invoice stays linked to the first order and no duplicate is inserted.
  expect(await invoiceOrderId(invId)).toBe(first.id)
  const { rows } = await pool.query(`SELECT id FROM orders WHERE invoice_id = $1`, [invId])
  expect(rows).toHaveLength(1)
})
