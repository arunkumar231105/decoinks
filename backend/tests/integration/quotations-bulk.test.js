'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

let token

// ── fixture CSVs ──────────────────────────────────────────────────────────────

// 3 rows: 2 valid, 1 with bad qty
const CSV_3ROWS = [
  'customer_name,company_name,email,phone,product,qty,unit_price,sizes,status',
  'Alice Smith,Acme Corp,alice@acme.com,+1-555-1111,T-Shirt,50,6.00,"S,M,L",Draft',
  'Bob Jones,Beta Inc,bob@beta.com,,Hoodie,25,12.00,,Draft',
  'Bad Row,Evil Co,bad@evil.com,,Cap,NOT_A_NUMBER,5.00,,Draft',
].join('\n')

// CSV with absent columns → should create quotes with NULLs
const CSV_MINIMAL = [
  'customer_name,product,qty,unit_price',
  'Minimal Customer,Polo Shirt,10,8.00',
].join('\n')

// ─────────────────────────────────────────────────────────────────────────────

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

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

beforeEach(async () => {
  await truncateTestTables()
})

// ── helpers ───────────────────────────────────────────────────────────────────

function uploadCsv(csvString, preview = false) {
  const buf = Buffer.from(csvString, 'utf8')
  let req = request(app)
    .post('/api/quotations/bulk-upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buf, { filename: 'test.csv', contentType: 'text/csv' })
  if (preview) req = req.query({ preview: 'true' })
  return req
}

// ── PREVIEW tests ─────────────────────────────────────────────────────────────

describe('POST /api/quotations/bulk-upload?preview=true', () => {
  test('returns preview with 3 total rows, 1 error', async () => {
    const res = await uploadCsv(CSV_3ROWS, true)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.totalRows).toBe(3)
    expect(d.validRows).toBe(2)
    expect(d.skippedRows).toBe(1)
    // Row 3 has the bad qty
    const badRow = d.rows.find((r) => r.errors.length > 0)
    expect(badRow).toBeDefined()
    expect(badRow.rowNumber).toBe(4)
    expect(badRow.errors[0]).toMatch(/qty/)
  })

  test('preview does NOT insert any quotations', async () => {
    await uploadCsv(CSV_3ROWS, true)
    const { rows } = await pool.query(`SELECT COUNT(*) FROM quotations`)
    expect(parseInt(rows[0].count, 10)).toBe(0)
  })

  test('returns detected headers', async () => {
    const res = await uploadCsv(CSV_3ROWS, true)
    expect(res.body.data.headersDetected).toContain('customer_name')
    expect(res.body.data.headersDetected).toContain('product')
  })

  test('handles missing file with 400', async () => {
    const res = await request(app)
      .post('/api/quotations/bulk-upload?preview=true')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

// ── REAL IMPORT tests ─────────────────────────────────────────────────────────

describe('POST /api/quotations/bulk-upload (real import)', () => {
  test('creates 2 quotations, skips 1 bad row', async () => {
    const res = await uploadCsv(CSV_3ROWS)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.created).toBe(2)
    expect(d.skipped).toBe(1)
    expect(d.skippedRows).toHaveLength(1)
    expect(d.skippedRows[0].rowNumber).toBe(4)
  })

  test('created quotes have correct QT-YYYY-NNNN numbers', async () => {
    const res = await uploadCsv(CSV_3ROWS)
    const { rows } = await pool.query(
      `SELECT quote_number FROM quotations ORDER BY created_at`
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.quote_number).toMatch(/^QT-\d{4}-\d{4}$/)
    }
  })

  test('created quotes have correct customer_name and totals', async () => {
    await uploadCsv(CSV_3ROWS)
    const { rows } = await pool.query(
      `SELECT customer_name, total FROM quotations ORDER BY created_at`
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].customer_name).toBe('Alice Smith')
    expect(parseFloat(rows[0].total)).toBeCloseTo(50 * 6.00, 1)
    expect(rows[1].customer_name).toBe('Bob Jones')
    expect(parseFloat(rows[1].total)).toBeCloseTo(25 * 12.00, 1)
  })

  test('creates 2 quotation_items rows', async () => {
    await uploadCsv(CSV_3ROWS)
    const { rows } = await pool.query(`SELECT * FROM quotation_items`)
    expect(rows).toHaveLength(2)
    const tshirt = rows.find(r => r.description === 'T-Shirt')
    expect(tshirt).toBeDefined()
    expect(parseInt(tshirt.qty, 10)).toBe(50)
    expect(parseFloat(tshirt.unit_price)).toBeCloseTo(6.00, 2)
  })

  test('absent columns stay NULL — minimal CSV', async () => {
    const res = await uploadCsv(CSV_MINIMAL)
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(1)
    const { rows } = await pool.query(`SELECT * FROM quotations LIMIT 1`)
    expect(rows[0].company_name).toBeNull()
    expect(rows[0].billing_email).toBeNull()
    expect(rows[0].shipping_country).toBeNull()
  })

  test('created_by is set to current user', async () => {
    await uploadCsv(CSV_MINIMAL)
    const { rows: users } = await pool.query(
      `SELECT id FROM users WHERE email='admin@test.com'`
    )
    const { rows: quotes } = await pool.query(`SELECT created_by FROM quotations LIMIT 1`)
    expect(quotes[0].created_by).toBe(users[0].id)
  })
})

// ── CSV TEMPLATE ──────────────────────────────────────────────────────────────

describe('GET /api/quotations/csv-template', () => {
  test('returns a CSV file with correct headers', async () => {
    const res = await request(app)
      .get('/api/quotations/csv-template')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const lines = res.text.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)  // header + example row
    expect(lines[0]).toContain('customer_name')
    expect(lines[0]).toContain('product')
  })
})
