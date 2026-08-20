'use strict'

const request  = require('supertest')
const { parse } = require('csv-parse/sync')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token
let supplierId
let orderId

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  token = loginRes.body.data.token

  const supRes = await request(app)
    .post('/api/suppliers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Order Test Supplier', email: 'ordertest@example.com' })
  supplierId = supRes.body.data.id
})

beforeEach(async () => {
  await pool.query(`DELETE FROM shipments WHERE order_id IN (SELECT id FROM orders WHERE supplier_id = $1)`, [supplierId])
  await pool.query(`DELETE FROM po_orders WHERE order_id IN (SELECT id FROM orders WHERE supplier_id = $1)`, [supplierId])
  await pool.query(`DELETE FROM purchase_orders WHERE order_id IN (SELECT id FROM orders WHERE supplier_id = $1)`, [supplierId])
  await pool.query(`
    DELETE FROM order_items_apparel WHERE order_id IN (
      SELECT id FROM orders WHERE supplier_id = $1
    )
  `, [supplierId])
  await pool.query(`DELETE FROM orders WHERE supplier_id = $1`, [supplierId])
  orderId = null
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

describe('POST /api/orders', () => {
  test('creates an apparel order and returns 201 with ORD- prefixed order_number', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        items: [
          { item: 'T-Shirt', qty: 10, unit_price: 15.00 },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('order_number')
    expect(res.body.data.order_number).toMatch(/^ORD-\d{4}-\d{4}$/)
    expect(res.body.data.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.body.data.due_date).toBe(res.body.data.order_date)

    orderId = res.body.data.id
  })

  test('defaults a missing due date to the supplied order date', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        order_date:  '2026-08-20',
        items: [{ item: 'T-Shirt', qty: 1, unit_price: 15.00 }],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.order_date).toBe('2026-08-20')
    expect(res.body.data.due_date).toBe('2026-08-20')
    expect(res.body.data.entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    orderId = res.body.data.id
  })

  test('rejects impossible calendar dates', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        order_date:  '2026-02-30',
        items: [{ item: 'T-Shirt', qty: 1, unit_price: 15.00 }],
      })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
  })

  test('rejects a zero-priced sales order line', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type: 'apparel',
        supplier_id: supplierId,
        items: [{ item: 'T-Shirt', qty: 1, unit_price: 0 }],
      })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /api/orders list date fallbacks', () => {
  test('returns nonblank entry and due dates for a historical null row', async () => {
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        order_date:  '2026-08-19',
        items: [{ item: 'T-Shirt', qty: 1, unit_price: 15.00 }],
      })
    orderId = created.body.data.id

    await pool.query(`UPDATE orders SET entry_date = NULL, due_date = NULL WHERE id = $1`, [orderId])

    const res = await request(app)
      .get(`/api/orders?search=${encodeURIComponent(created.body.data.order_number)}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.rows).toHaveLength(1)
    expect(res.body.data.rows[0].entry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.body.data.rows[0].due_date).toBe('2026-08-19')

    const exportRes = await request(app)
      .get(`/api/orders/export?search=${encodeURIComponent(created.body.data.order_number)}`)
      .set('Authorization', `Bearer ${token}`)

    expect(exportRes.status).toBe(200)
    expect(exportRes.headers['content-type']).toMatch(/text\/csv/)
    expect(exportRes.text).toContain('2026-08-19')
    expect(exportRes.text).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  test('exports canonical customer, PO, shipment, totals, status, and agent fields without Supplier', async () => {
    const { rows: customerRows } = await pool.query(
      `INSERT INTO customers
         (name, email, mobile_number, address_line1, city, state, zip, country)
       VALUES ('Canonical Customer', 'canonical@example.com', '404-555-0188',
               '123 Test Ave', 'Austin', 'TX', '78701', 'United States')
       RETURNING id`
    )
    const customerId = customerRows[0].id

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type: 'apparel',
        supplier_id: supplierId,
        customer_id: customerId,
        order_date: '2026-08-20',
        shipping_address: '123 Test Ave, Austin, TX 78701, Austin, TX 78701, United States',
        items: [{ item: 'T-Shirt', qty: 1, unit_price: 15 }],
      })
    orderId = created.body.data.id

    await pool.query(
      `UPDATE orders
       SET entry_date = NULL, due_date = NULL, contact_name = NULL,
           subtotal = 0, courier = NULL, tracking_number = NULL, assigned_to = NULL
       WHERE id = $1`,
      [orderId]
    )
    await pool.query(
      `INSERT INTO purchase_orders (po_number, status, order_id, source_po_number)
       VALUES ('PO-EXPORT-0001', 'Draft', $1, 'SRC-PO-0001')`,
      [orderId]
    )
    await pool.query(
      `INSERT INTO shipments (shipment_number, order_id, status, carrier, tracking_number)
       VALUES ('SHP-EXPORT-0001', $1, 'Delivered', 'UPS', '1Z999EXPORT0001')`,
      [orderId]
    )

    const exportRes = await request(app)
      .get(`/api/orders/export?search=${encodeURIComponent(created.body.data.order_number)}`)
      .set('Authorization', `Bearer ${token}`)

    expect(exportRes.status).toBe(200)
    const records = parse(exportRes.text, { bom: true, columns: true, skip_empty_lines: true })
    expect(records).toHaveLength(1)
    expect(Object.keys(records[0])).not.toContain('Supplier')
    expect(records[0]).toMatchObject({
      'Entry Date': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'Due Date': '2026-08-20',
      Status: 'Delivered',
      'Contact Name': 'Canonical Customer',
      'Contact Email': 'canonical@example.com',
      'Contact Phone': '404-555-0188',
      'Shipping Address': '123 Test Ave, Austin, TX 78701, United States',
      'Source PO No': 'SRC-PO-0001',
      Subtotal: '15',
      Courier: 'UPS',
      'Tracking No': '1Z999EXPORT0001',
      Agent: 'Test Admin',
    })

    await pool.query(`DELETE FROM shipments WHERE order_id = $1`, [orderId])
    await pool.query(`DELETE FROM purchase_orders WHERE order_id = $1`, [orderId])
    await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId])
    await pool.query(`DELETE FROM customers WHERE id = $1`, [customerId])
    orderId = null
  })
})

describe('GET /api/orders/:id', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        items: [{ item: 'Hoodie', qty: 5, unit_price: 30.00 }],
      })
    orderId = res.body.data.id
  })

  test('returns the order with an items array', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(orderId)
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.items.length).toBeGreaterThan(0)
  })
})

describe('PATCH /api/orders/:id/status', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplierId,
        items: [{ item: 'Cap', qty: 20, unit_price: 8.00 }],
      })
    orderId = res.body.data.id
  })

  test('updates order status and returns the new status', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Confirmed' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('Confirmed')
  })

  test('requires courier and tracking before marking an order Shipped', async () => {
    await pool.query(`UPDATE orders SET status = 'Ready to Ship', courier = NULL, tracking_number = NULL WHERE id = $1`, [orderId])

    const blocked = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Shipped' })
    expect(blocked.status).toBe(422)

    await pool.query(`UPDATE orders SET courier = 'UPS', tracking_number = '1ZSHIPREADY0001' WHERE id = $1`, [orderId])
    const shipped = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Shipped' })
    expect(shipped.status).toBe(200)
    expect(shipped.body.data.status).toBe('Shipped')
  })
})
