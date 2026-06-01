'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token
let leadId

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  token = res.body.data.token
})

beforeEach(async () => {
  await pool.query(`DELETE FROM lead_attachments`)
  await pool.query(`DELETE FROM lead_comments`)
  await pool.query(`DELETE FROM leads`)
  leadId = null
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

describe('GET /api/leads', () => {
  test('returns kanban board with a columns array', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('columns')
    expect(Array.isArray(res.body.data.columns)).toBe(true)
  })
})

describe('POST /api/leads', () => {
  test('creates a lead and returns 201 with LEAD- prefixed lead_number', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplier_name: 'Test Lead Customer',
        source:        'Email',
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('lead_number')
    expect(res.body.data.lead_number).toMatch(/^LEAD-\d{4}-\d{4}$/)

    leadId = res.body.data.id
  })
})

describe('POST /api/leads — with product interest', () => {
  test('persists contact fields and 2 product-interest rows', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplier_name:    'Acme Corp',
        source:           'WhatsApp',
        company_name:     'Acme Corporation',
        email:            'orders@acme.com',
        phone:            '+1-555-1234',
        whatsapp:         '+1-555-1234',
        country:          'USA',
        state:            'TX',
        city:             'Dallas',
        zip:              '75201',
        buyer_type:       'Wholesale',
        internal_notes:   'VIP client',
        delivery_date:    '2025-09-30',
        productInterest: [
          { product_type: 'T-Shirt', qty: 100, sizes: 'S,M,L', colors: 'Black,White', artwork_count: 2, notes: 'Front print only' },
          { product_type: 'Hoodie',  qty:  50, sizes: 'M,L,XL', colors: 'Navy',        artwork_count: 1, sort_order: 1 },
        ],
      })

    expect(res.status).toBe(201)
    const lead = res.body.data

    // contact fields
    expect(lead.company_name).toBe('Acme Corporation')
    expect(lead.email).toBe('orders@acme.com')
    expect(lead.country).toBe('USA')
    expect(lead.buyer_type).toBe('Wholesale')
    expect(lead.internal_notes).toBe('VIP client')
    expect(lead.delivery_date).toMatch(/^2025-09-30/)

    // product interest rows
    expect(Array.isArray(lead.productInterest)).toBe(true)
    expect(lead.productInterest).toHaveLength(2)

    const [pi0, pi1] = lead.productInterest
    expect(pi0.product_type).toBe('T-Shirt')
    expect(pi0.qty).toBe(100)
    expect(pi0.sizes).toBe('S,M,L')
    expect(pi0.artwork_count).toBe(2)
    expect(pi0.notes).toBe('Front print only')

    expect(pi1.product_type).toBe('Hoodie')
    expect(pi1.qty).toBe(50)
    expect(pi1.colors).toBe('Navy')
    expect(pi1.sort_order).toBe(1)
  })

  test('PUT /api/leads/:id replaces product-interest rows', async () => {
    const createRes = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplier_name: 'Update PI Test',
        source: 'Email',
        productInterest: [{ product_type: 'Cap', qty: 200 }],
      })
    const id = createRes.body.data.id

    const updateRes = await request(app)
      .put(`/api/leads/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_name: 'Updated Corp',
        productInterest: [
          { product_type: 'Polo', qty: 75, sizes: 'L,XL', artwork_count: 3 },
          { product_type: 'Vest', qty: 30 },
        ],
      })

    expect(updateRes.status).toBe(200)
    const updated = updateRes.body.data
    expect(updated.company_name).toBe('Updated Corp')
    expect(updated.productInterest).toHaveLength(2)
    expect(updated.productInterest[0].product_type).toBe('Polo')
    expect(updated.productInterest[0].artwork_count).toBe(3)
    expect(updated.productInterest[1].product_type).toBe('Vest')
  })
})

describe('PATCH /api/leads/:id/move', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplier_name: 'Move Test Lead', source: 'WhatsApp' })
    leadId = res.body.data.id
  })

  test('moves the lead to a new stage', async () => {
    const res = await request(app)
      .patch(`/api/leads/${leadId}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'quotation', position: 0 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.stage).toBe('quotation')
  })
})
