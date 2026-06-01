'use strict'

const request  = require('supertest')
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

    orderId = res.body.data.id
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
})
