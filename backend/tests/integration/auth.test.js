'use strict'

const request = require('supertest')
const app     = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
  await pool.end()
})

describe('POST /api/auth/login', () => {
  test('returns 200 and a JWT token on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'adminpass123' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('token')
    expect(typeof res.body.data.token).toBe('string')

    token = res.body.data.token
  })

  test('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'wrongpassword' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })
})

describe('GET /api/auth/me', () => {
  beforeAll(async () => {
    if (!token) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@test.com', password: 'adminpass123' })
      token = res.body.data.token
    }
  })

  test('returns 200 and user profile with a valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('email', 'admin@test.com')
  })

  test('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })
})
