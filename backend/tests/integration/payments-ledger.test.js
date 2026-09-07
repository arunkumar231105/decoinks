'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  The payments table is money that arrived.
//
//  Two code paths used to invent rows in it: creating an invoice with "Paid"
//  ticked, and raising a sales order against an invoice that said it was paid.
//  Between them the shop got the same money recorded twice — once by the
//  payment link that actually took it, once by the paperwork raised after.
//
//  These tests hold the rule: only a person recording a payment, or a payment
//  link settling, may write a payments row. Documents may say a job is paid;
//  they may not produce the receipt.
// ─────────────────────────────────────────────────────────────────────────────

const { pool }        = require('../../src/config/db')
const invoiceService  = require('../../src/modules/invoices/invoices.service')
const orderService    = require('../../src/modules/orders/orders.service')
const customerService = require('../../src/modules/customers/customers.service')

let userId

async function reset() {
  await pool.query(`
    TRUNCATE TABLE
      payments, invoice_items, invoices,
      quotation_items, quotations,
      order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
      customer_addresses, customer_contacts, customers,
      pipeline_events, activity_logs, users
    RESTART IDENTITY CASCADE
  `)
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password, role)
     VALUES (uuid_generate_v4(), 'Ledger Tester', 'ledger@test.com', 'x', 'Admin')
     RETURNING id`
  )
  userId = rows[0].id
}

const countPayments = async () =>
  Number((await pool.query(`SELECT COUNT(*) FROM payments`)).rows[0].count)

beforeAll(reset)
afterAll(() => pool.end())

describe('a document may say a job is paid, but may not invent the payment', () => {
  let paidInvoiceId

  test('creating an invoice with "Paid" ticked writes no payments row', async () => {
    const before = await countPayments()

    const invoice = await invoiceService.create({
      customer_name: 'Coach Armando',
      order_type: 'dtf',
      mark_paid: true,
      payment_method: 'Credit Card',
      subtotal: 132,
      items: [{ description: '10 Shirts', qty: 10, unit_price: 13.2, amount: 132 }],
    }, userId)
    paidInvoiceId = invoice.id

    expect(invoice.status).toBe('Paid')
    expect(Number(invoice.balance_due)).toBe(0)
    // The document reads Paid. The ledger stays empty until the money is
    // recorded by hand or arrives through a payment link.
    expect(await countPayments()).toBe(before)
  })

  test('a sales order raised against that invoice writes no payments row either', async () => {
    const before = await countPayments()

    await orderService.create({
      invoice_id: paidInvoiceId,
      order_type: 'dtf',
      customer_name: 'Coach Armando',
      payment_status: 'Paid',
      amount_paid: 132,
      payment_method: 'Credit Card',
      subtotal: 132,
      items: [{ description: '10 Shirts', qty: 10, unit_price: 13.2, amount: 132 }],
    }, userId)

    expect(await countPayments()).toBe(before)
  })

  test('recording a payment by hand is still the way money enters the ledger', async () => {
    // The invoice is already marked Paid by the create form, so the ledger is
    // reached through the Payments module — the path a person actually uses.
    const { rows } = await pool.query(
      `INSERT INTO payments (payment_number, invoice_id, amount, payment_method, notes, recorded_by)
       VALUES ('PAY-TEST-0001', $1, 132, 'Stripe', 'Recorded by hand', $2)
       RETURNING id`, [paidInvoiceId, userId])
    expect(rows[0].id).toBeTruthy()

    // The trigger settles the invoice's cached figures from the ledger.
    const { rows: inv } = await pool.query(
      `SELECT amount_paid, balance_due FROM invoices WHERE id = $1`, [paidInvoiceId])
    expect(Number(inv[0].amount_paid)).toBe(132)
    expect(Number(inv[0].balance_due)).toBe(0)
  })
})

describe('a customer has one company, whichever column a screen reads', () => {
  test('editing the company settles both columns, so the edit form reloads it', async () => {
    const created = await customerService.create({
      name: 'Ricardo Malia',
      first_name: 'Ricardo',
      last_name: 'Malia',
      company: 'KNIGHTS OF COLUMBUS MENIFEE COUNCIL 7846',
    }, userId)

    await customerService.update(created.id, { company_name: 'Knights of Columbus 7846' })

    const { rows } = await pool.query(
      `SELECT company, company_name FROM customers WHERE id = $1`, [created.id])
    // Divergence here is what made the Edit Customer form look like it saved
    // nothing: the write landed in one column and every screen read the other.
    expect(rows[0].company).toBe('Knights of Columbus 7846')
    expect(rows[0].company_name).toBe('Knights of Columbus 7846')
  })

  test('clearing the company clears it everywhere, not just where it was written', async () => {
    const created = await customerService.create({
      name: 'Nora Blank', first_name: 'Nora', last_name: 'Blank', company: 'Old Name Ltd',
    }, userId)

    await customerService.update(created.id, { company_name: null })

    const { rows } = await pool.query(
      `SELECT company, company_name FROM customers WHERE id = $1`, [created.id])
    expect(rows[0].company).toBeNull()
    expect(rows[0].company_name).toBeNull()
  })
})
