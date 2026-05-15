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
        customer_name: 'Test Lead Customer',
        source:        'Email',
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('lead_number')
    expect(res.body.data.lead_number).toMatch(/^LEAD-\d{4}-\d{4}$/)

    leadId = res.body.data.id
  })
})

describe('PATCH /api/leads/:id/move', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'Move Test Lead', source: 'WhatsApp' })
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
