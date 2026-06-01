'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token
let createdSupplierId

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
  await pool.query(`
    DELETE FROM suppliers WHERE email = 'jane@example.com'
  `)
  createdSupplierId = null
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

describe('GET /api/suppliers', () => {
  test('returns 200 with a paginated list', async () => {
    const res = await request(app)
      .get('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('rows')
    expect(Array.isArray(res.body.data.rows)).toBe(true)
    expect(res.body.data).toHaveProperty('total')
  })
})

describe('POST /api/suppliers', () => {
  test('creates a supplier and returns 201', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe', email: 'jane@example.com', phone: '555-1234' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('id')
    expect(res.body.data.name).toBe('Jane Doe')

    createdSupplierId = res.body.data.id
  })
})

describe('GET /api/suppliers/:id', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe', email: 'jane@example.com' })
    createdSupplierId = res.body.data.id
  })

  test('returns the supplier by id', async () => {
    const res = await request(app)
      .get(`/api/suppliers/${createdSupplierId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(createdSupplierId)
    expect(res.body.data.name).toBe('Jane Doe')
  })
})

describe('PUT /api/suppliers/:id', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe', email: 'jane@example.com' })
    createdSupplierId = res.body.data.id
  })

  test('updates the supplier and returns updated fields', async () => {
    const res = await request(app)
      .put(`/api/suppliers/${createdSupplierId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Updated' })

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Jane Updated')
  })
})

describe('DELETE /api/suppliers/:id', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe', email: 'jane@example.com' })
    createdSupplierId = res.body.data.id
  })

  test('soft-deletes supplier and it no longer appears in the list', async () => {
    const delRes = await request(app)
      .delete(`/api/suppliers/${createdSupplierId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(delRes.status).toBe(200)

    const listRes = await request(app)
      .get('/api/suppliers')
      .set('Authorization', `Bearer ${token}`)

    const ids = listRes.body.data.rows.map(c => c.id)
    expect(ids).not.toContain(createdSupplierId)
  })
})
