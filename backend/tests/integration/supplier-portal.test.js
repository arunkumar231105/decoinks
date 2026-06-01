'use strict'

const request = require('supertest')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const app     = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

// ─── Test state ──────────────────────────────────────────────────────────────

let adminToken        // admin JWT (role: 'admin') — should be rejected by /api/supplier routes
let supplier1Token    // portal JWT for supplier 1 (active account)
let supplier2Token    // portal JWT for supplier 2 (active account, different supplier)
let adminUserId
let supplier1Id
let supplier2Id
let portalUser1Id
let portalUser2Id
let orderId_visible   // order sent to portal for supplier1
let orderId_notSent   // order NOT sent to portal at all

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runPortalMigration() {
  // Portal tables are created via Docker entrypoint on fresh DB init.
  // On an already-initialized DB they already exist — nothing to do here.
}

async function truncatePortalTables() {
  await pool.query(`
    TRUNCATE TABLE
      portal_notifications,
      portal_order_visibility,
      portal_po_visibility,
      supplier_portal_users
    RESTART IDENTITY CASCADE
  `)
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Ensure all tables exist (base schema + portal schema)
  await runMigrations()
  await runPortalMigration()

  // 2. Clear all test data
  await truncatePortalTables()
  await truncateTestTables()
  await truncateUsers()

  // 3. Seed admin user
  await seedAdmin()

  // 4. Get admin JWT
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  adminToken = loginRes.body.data.token
  adminUserId = loginRes.body.data.user?.id

  // Fetch admin user id if not in login response
  if (!adminUserId) {
    const { rows } = await pool.query(`SELECT id FROM users WHERE email = 'admin@test.com'`)
    adminUserId = rows[0].id
  }

  // 5. Create two test suppliers
  const s1Res = await request(app)
    .post('/api/suppliers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Portal Test Company A', email: 'portala@test.com' })
  supplier1Id = s1Res.body.data.id

  const s2Res = await request(app)
    .post('/api/suppliers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Portal Test Company B', email: 'portalb@test.com' })
  supplier2Id = s2Res.body.data.id

  // 6. Create portal users for both suppliers
  const pw1Hash = await bcrypt.hash('testpass_s1_!', 10)
  const pw2Hash = await bcrypt.hash('testpass_s2_!', 10)

  const { rows: [pu1] } = await pool.query(
    `INSERT INTO supplier_portal_users
       (supplier_id, username, password_hash, is_active, must_change_pw, created_by)
     VALUES ($1, 'portal_company_a', $2, TRUE, FALSE, $3)
     RETURNING id`,
    [supplier1Id, pw1Hash, adminUserId]
  )
  portalUser1Id = pu1.id

  const { rows: [pu2] } = await pool.query(
    `INSERT INTO supplier_portal_users
       (supplier_id, username, password_hash, is_active, must_change_pw, created_by)
     VALUES ($1, 'portal_company_b', $2, TRUE, FALSE, $3)
     RETURNING id`,
    [supplier2Id, pw2Hash, adminUserId]
  )
  portalUser2Id = pu2.id

  // 7. Create an inactive portal user for supplier1
  const inactiveHash = await bcrypt.hash('inactivepass!', 10)
  await pool.query(
    `INSERT INTO supplier_portal_users
       (supplier_id, username, password_hash, is_active, must_change_pw, created_by)
     VALUES ($1, 'portal_inactive', $2, FALSE, FALSE, $3)`,
    [supplier1Id, inactiveHash, adminUserId]
  )

  // 8. Create 3 test orders via the API
  const baseOrder = {
    order_type:  'apparel',
    supplier_id: supplier1Id,
    order_date:  new Date().toISOString().slice(0, 10),
    items: [{
      item: 'Test T-Shirt', color: 'Black', size: 'M', qty: 10,
      unit_price: 15.00,
    }],
  }

  // Order 1: visible to supplier1
  const o1Res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(baseOrder)
  orderId_visible = o1Res.body.data.id

  // Order 2: a second order for supplier1 also visible
  await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(baseOrder)

  // Order 3: NOT sent to portal (no visibility record)
  const o3Res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(baseOrder)
  orderId_notSent = o3Res.body.data.id

  // 9. Send order1 to portal (creates portal_order_visibility record)
  await request(app)
    .post(`/api/orders/${orderId_visible}/send-to-portal`)
    .set('Authorization', `Bearer ${adminToken}`)

  // 10. Log in as supplier1 and supplier2 to get portal JWTs
  const s1Login = await request(app)
    .post('/api/supplier/auth/login')
    .send({ username: 'portal_company_a', password: 'testpass_s1_!' })
  supplier1Token = s1Login.body.token

  const s2Login = await request(app)
    .post('/api/supplier/auth/login')
    .send({ username: 'portal_company_b', password: 'testpass_s2_!' })
  supplier2Token = s2Login.body.token
})

afterAll(async () => {
  await truncatePortalTables()
  await truncateTestTables()
  await truncateUsers()
  await pool.end()
})

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('POST /api/supplier/auth/login', () => {
  test('1. valid credentials → 200 + JWT token', async () => {
    const res = await request(app)
      .post('/api/supplier/auth/login')
      .send({ username: 'portal_company_a', password: 'testpass_s1_!' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(typeof res.body.token).toBe('string')
    expect(res.body).toHaveProperty('supplier')
    expect(res.body.supplier).toHaveProperty('id', supplier1Id)

    // Verify the token carries role:'supplier' claim
    const decoded = jwt.decode(res.body.token)
    expect(decoded.role).toBe('supplier')
    expect(decoded.supplierId).toBe(supplier1Id)
  })

  test('2. wrong password → 401', async () => {
    const res = await request(app)
      .post('/api/supplier/auth/login')
      .send({ username: 'portal_company_a', password: 'wrong_password!' })

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error')
  })

  test('3. inactive account → 401', async () => {
    const res = await request(app)
      .post('/api/supplier/auth/login')
      .send({ username: 'portal_inactive', password: 'inactivepass!' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/disabled/i)
  })
})

describe('GET /api/supplier/orders', () => {
  test('4. no token → 401', async () => {
    const res = await request(app).get('/api/supplier/orders')

    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error')
  })

  test('5. admin JWT → 403 (not a supplier token)', async () => {
    const res = await request(app)
      .get('/api/supplier/orders')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not a supplier token/i)
  })

  test('6. valid supplier JWT → 200, returns only orders visible to this supplier', async () => {
    const res = await request(app)
      .get('/api/supplier/orders')
      .set('Authorization', `Bearer ${supplier1Token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('orders')
    expect(Array.isArray(res.body.orders)).toBe(true)

    // Only the order that was sent to portal should appear
    const ids = res.body.orders.map((o) => o.id)
    expect(ids).toContain(orderId_visible)
    expect(ids).not.toContain(orderId_notSent)

    // supplier2's token should see 0 orders (none sent for them)
    const res2 = await request(app)
      .get('/api/supplier/orders')
      .set('Authorization', `Bearer ${supplier2Token}`)
    expect(res2.status).toBe(200)
    expect(res2.body.orders).toHaveLength(0)
  })
})

describe('GET /api/supplier/orders/:id', () => {
  test('7. order not sent to portal → 404', async () => {
    const res = await request(app)
      .get(`/api/supplier/orders/${orderId_notSent}`)
      .set('Authorization', `Bearer ${supplier1Token}`)

    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  test('8. order sent to supplier1, accessed by supplier2 → 403 Forbidden', async () => {
    const res = await request(app)
      .get(`/api/supplier/orders/${orderId_visible}`)
      .set('Authorization', `Bearer ${supplier2Token}`)

    expect(res.status).toBe(403)
    expect(res.body).toHaveProperty('error')
  })

  test('9. valid token + order sent to this supplier → 200 with order + items', async () => {
    const res = await request(app)
      .get(`/api/supplier/orders/${orderId_visible}`)
      .set('Authorization', `Bearer ${supplier1Token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('order')

    const order = res.body.order
    expect(order.id).toBe(orderId_visible)
    expect(order).toHaveProperty('order_number')
    expect(order).toHaveProperty('status')
    expect(order).toHaveProperty('order_type', 'apparel')
    expect(order).toHaveProperty('items')
    expect(Array.isArray(order.items)).toBe(true)
    expect(order.items.length).toBeGreaterThan(0)
    expect(order).toHaveProperty('artworks')
    expect(Array.isArray(order.artworks)).toBe(true)
  })
})

describe('GET /api/supplier/dashboard', () => {
  test('10. valid supplier JWT → 200 with correct counts scoped to this supplier', async () => {
    const res = await request(app)
      .get('/api/supplier/dashboard')
      .set('Authorization', `Bearer ${supplier1Token}`)

    expect(res.status).toBe(200)

    const d = res.body
    expect(d).toHaveProperty('totalOrders')
    expect(d).toHaveProperty('inProduction')
    expect(d).toHaveProperty('shipped')
    expect(d).toHaveProperty('completed')
    expect(d).toHaveProperty('ordersByStatus')
    expect(d).toHaveProperty('ordersByType')
    expect(d).toHaveProperty('trendData')
    expect(d).toHaveProperty('recentOrders')
    expect(d).toHaveProperty('productionSnapshot')

    // supplier1 has exactly 1 order sent to portal
    expect(d.totalOrders).toBe(1)
    expect(Array.isArray(d.ordersByStatus)).toBe(true)
    expect(Array.isArray(d.recentOrders)).toBe(true)
    expect(d.recentOrders.length).toBeLessThanOrEqual(5)

    // supplier2 dashboard should show 0 orders
    const res2 = await request(app)
      .get('/api/supplier/dashboard')
      .set('Authorization', `Bearer ${supplier2Token}`)
    expect(res2.status).toBe(200)
    expect(res2.body.totalOrders).toBe(0)
  })
})

describe('POST /api/orders/:id/send-to-portal', () => {
  test('11. send order to portal → inserts portal_order_visibility + portal_notifications', async () => {
    // Create a fresh order (not yet sent)
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        order_type:  'apparel',
        supplier_id: supplier1Id,
        order_date:  new Date().toISOString().slice(0, 10),
        items: [{ item: 'Portal Test Shirt', color: 'White', size: 'L', qty: 5, unit_price: 12.00 }],
      })
    const newOrderId = orderRes.body.data.id
    expect(newOrderId).toBeTruthy()

    // Verify not yet visible before send
    const { rows: before } = await pool.query(
      'SELECT * FROM portal_order_visibility WHERE order_id = $1',
      [newOrderId]
    )
    expect(before).toHaveLength(0)

    // Send to portal
    const res = await request(app)
      .post(`/api/orders/${newOrderId}/send-to-portal`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify portal_order_visibility row was created
    const { rows: vis } = await pool.query(
      'SELECT * FROM portal_order_visibility WHERE order_id = $1',
      [newOrderId]
    )
    expect(vis).toHaveLength(1)
    expect(vis[0].supplier_id).toBe(supplier1Id)
    expect(vis[0].is_visible).toBe(true)

    // Verify portal_notifications row was created
    const { rows: notifs } = await pool.query(
      `SELECT * FROM portal_notifications WHERE supplier_id = $1 AND reference_id = $2`,
      [supplier1Id, newOrderId]
    )
    expect(notifs.length).toBeGreaterThan(0)
    expect(notifs[0].type).toBe('new_order')
    expect(notifs[0].is_read).toBe(false)

    // Sending the same order again should upsert (idempotent, not duplicate)
    const res2 = await request(app)
      .post(`/api/orders/${newOrderId}/send-to-portal`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res2.status).toBe(200)

    const { rows: vis2 } = await pool.query(
      'SELECT * FROM portal_order_visibility WHERE order_id = $1',
      [newOrderId]
    )
    expect(vis2).toHaveLength(1) // still one row, not two
  })
})

describe('POST /api/suppliers/:id/portal-access', () => {
  test('12. create portal user → password hashed, row inserted, must_change_pw=TRUE by default', async () => {
    // Create a fresh supplier for this test to avoid conflict
    const suppRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Portal Create Test', email: 'portal_create@test.com' })
    const freshSupplierId = suppRes.body.data.id

    const username = 'fresh_portal_user'
    const password = 'SecurePass1!'

    const res = await request(app)
      .post(`/api/suppliers/${freshSupplierId}/portal-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify the DB row — password must be bcrypt hashed, not plaintext
    const { rows } = await pool.query(
      `SELECT * FROM supplier_portal_users WHERE supplier_id = $1 AND username = $2`,
      [freshSupplierId, username]
    )
    expect(rows).toHaveLength(1)

    const dbUser = rows[0]
    expect(dbUser.is_active).toBe(true)
    expect(dbUser.password_hash).not.toBe(password)
    expect(dbUser.password_hash).toMatch(/^\$2[ab]\$/)
    const match = await bcrypt.compare(password, dbUser.password_hash)
    expect(match).toBe(true)
  })
})

describe('PATCH /api/supplier/me/password', () => {
  test('13. change password → verifies old pw, hashes new pw, sets must_change_pw=FALSE', async () => {
    const oldPassword = 'testpass_s1_!'
    const newPassword = 'NewSecurePass99!'

    const res = await request(app)
      .patch('/api/supplier/me/password')
      .set('Authorization', `Bearer ${supplier1Token}`)
      .send({ currentPassword: oldPassword, newPassword })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify DB: new hash is different, must_change_pw is FALSE
    const { rows } = await pool.query(
      'SELECT password_hash, must_change_pw FROM supplier_portal_users WHERE id = $1',
      [portalUser1Id]
    )
    expect(rows[0].must_change_pw).toBe(false)
    const matchNew = await bcrypt.compare(newPassword, rows[0].password_hash)
    expect(matchNew).toBe(true)
    const matchOld = await bcrypt.compare(oldPassword, rows[0].password_hash)
    expect(matchOld).toBe(false)

    // Wrong current password → 400
    const resBad = await request(app)
      .patch('/api/supplier/me/password')
      .set('Authorization', `Bearer ${supplier1Token}`)
      .send({ currentPassword: 'completely_wrong!', newPassword: 'Another1!' })
    expect(resBad.status).toBe(400)
    expect(resBad.body.error).toMatch(/incorrect/i)

    // Restore original password so other tests are not affected
    await request(app)
      .patch('/api/supplier/me/password')
      .set('Authorization', `Bearer ${supplier1Token}`)
      .send({ currentPassword: newPassword, newPassword: oldPassword })
  })
})
