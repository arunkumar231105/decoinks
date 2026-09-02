'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token

const post = (body) => request(app)
  .post('/api/customers').set('Authorization', `Bearer ${token}`).send(body)

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
  await pool.query(`DELETE FROM customers WHERE name ILIKE '%dup test%' OR email = 'dup@test.com'`)
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
  await pool.end()
})

describe('a customer cannot be entered twice', () => {
  test('the same name is refused, and the refusal says who is already on file', async () => {
    const first = await post({ name: 'Dup Test Buyer' })
    expect(first.status).toBe(201)

    const again = await post({ name: 'Dup Test Buyer' })
    expect(again.status).toBe(409)
    expect(again.body.message).toMatch(first.body.data.customer_number)
    expect(again.body.message).toMatch(/already on file/i)
  })

  test('case, spacing, punctuation and accents do not make it a new person', async () => {
    await post({ name: 'Dup Test Buyer' })
    for (const written of ['dup test buyer', 'DUP  TEST   BUYER', 'Dup-Test-Buyer', 'Dúp Tést Buyer']) {
      const res = await post({ name: written })
      expect(res.status).toBe(409)
    }
  })

  test('two real people of the same name are allowed, but only on purpose', async () => {
    await post({ name: 'Dup Test Buyer' })
    const deliberate = await post({ name: 'Dup Test Buyer', allow_duplicate_name: true })
    expect(deliberate.status).toBe(201)
  })

  test('a different name is not blocked', async () => {
    await post({ name: 'Dup Test Buyer' })
    const other = await post({ name: 'Dup Test Buyers Brother' })
    expect(other.status).toBe(201)
  })

  test('the same e-mail is refused even under another name', async () => {
    const first = await post({ name: 'Dup Test One', email: 'dup@test.com' })
    expect(first.status).toBe(201)
    const second = await post({ name: 'Dup Test Two', email: 'DUP@test.com' })
    expect(second.status).toBe(409)
    expect(second.body.message).toMatch(/e-mail/i)
  })

  test('renaming onto a name already held is refused', async () => {
    const a = await post({ name: 'Dup Test Alpha' })
    await post({ name: 'Dup Test Beta' })
    const rename = await request(app)
      .put(`/api/customers/${a.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup Test Beta' })
    expect(rename.status).toBe(409)
  })

  test('saving a customer without changing their name still works', async () => {
    const a = await post({ name: 'Dup Test Gamma' })
    const save = await request(app)
      .put(`/api/customers/${a.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup Test Gamma', city: 'Dallas' })
    expect(save.status).toBe(200)
  })
})
