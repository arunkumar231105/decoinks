'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateTestTables, truncateUsers } = require('./helpers')

// ── Shared state ──────────────────────────────────────────────────────────────

let adminToken
let salesToken

beforeAll(async () => {
  await runMigrations()
  await truncateTestTables()
  await truncateUsers()
  await seedAdmin()

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  adminToken = loginRes.body.data.token

  // Create a Sales-role user for forbidden-action tests
  await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Sales User', email: 'sales@test.com', password: 'salespass123', role: 'Sales' })

  const salesLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'sales@test.com', password: 'salespass123' })
  salesToken = salesLogin.body.data.token
})

afterAll(async () => {
  await truncateTestTables()
  await truncateUsers()
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST 1: Full pipeline happy path
//  supplier → lead → quote → approve (auto-invoice) → pay (auto-order) → PO
// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 1: Full pipeline happy path', () => {
  let supplierId
  let leadId
  let quoteId
  let autoInvoiceId
  let autoOrderId
  let poId

  test('1a: Create supplier', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Pipeline Test Supplier', email: 'pipeline@example.com' })

    expect(res.status).toBe(201)
    supplierId = res.body.data.id
    expect(supplierId).toBeTruthy()
  })

  test('1b: Create lead', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_name: 'Pipeline Test Supplier', supplier_id: supplierId, source: 'Email' })

    expect(res.status).toBe(201)
    leadId = res.body.data.id
    expect(leadId).toBeTruthy()
  })

  test('1c: Create quotation (apparel, 2 items)', async () => {
    const res = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lead_id:     leadId,
        supplier_id: supplierId,
        order_type:  'apparel',
        items: [
          { description: 'T-Shirt (S)', qty: 50,  unit_price: 12.00 },
          { description: 'T-Shirt (M)', qty: 100, unit_price: 12.00 },
        ],
      })

    expect(res.status).toBe(201)
    quoteId = res.body.data.id
    expect(res.body.data.quote_number).toMatch(/^QT-/)
    expect(res.body.data.total).toBe(1800)
  })

  test('1d: Approve quote → auto-invoice created', async () => {
    const res = await request(app)
      .patch(`/api/quotations/${quoteId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Approved' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('Approved')
    autoInvoiceId = res.body.data.auto_invoice_id
    expect(autoInvoiceId).toBeTruthy()

    // Verify invoice exists and is in Sent status
    const invRes = await request(app)
      .get(`/api/invoices/${autoInvoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(invRes.status).toBe(200)
    expect(invRes.body.data.status).toBe('Sent')
    expect(invRes.body.data.quote_id).toBe(quoteId)
  })

  test('1e: pipeline_events has invoice_created_from_quote entry', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM pipeline_events WHERE event_type = 'invoice_created_from_quote' AND source_id = $1`,
      [quoteId]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].target_id).toBe(autoInvoiceId)
  })

  test('1f: Pay invoice → auto-order created', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${autoInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Paid' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('Paid')
    autoOrderId = res.body.data.auto_order_id
    expect(autoOrderId).toBeTruthy()

    // Verify order was created
    const ordRes = await request(app)
      .get(`/api/orders/${autoOrderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(ordRes.status).toBe(200)
    expect(ordRes.body.data.order_type).toBe('apparel')
    expect(ordRes.body.data.invoice_id).toBe(autoInvoiceId)
  })

  test('1g: pipeline_events has order_created_from_invoice entry', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM pipeline_events WHERE event_type = 'order_created_from_invoice' AND source_id = $1`,
      [autoInvoiceId]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].target_id).toBe(autoOrderId)
  })

  test('1h: Create PO linked to order', async () => {
    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierId,
        order_id:    autoOrderId,
        items: [
          { item_name: 'Blank T-Shirts S', qty_ordered: 50, unit_price: 4.00 },
          { item_name: 'Blank T-Shirts M', qty_ordered: 100, unit_price: 4.00 },
        ],
      })

    expect(res.status).toBe(201)
    poId = res.body.data.id
    expect(res.body.data.po_number).toMatch(/^PO-/)
    expect(res.body.data.grand_total).toBe(600)
    expect(res.body.data.status).toBe('Draft')
  })

  test('1i: PO status history records initial Draft entry', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM po_status_history WHERE po_id = $1 ORDER BY created_at`, [poId]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].from_status).toBeNull()
    expect(rows[0].to_status).toBe('Draft')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST 2: State machine enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 2: State machine enforcement', () => {
  let supplierId
  let quoteId
  let invoiceId

  beforeAll(async () => {
    // Create supplier + quote + invoice for these tests
    const supRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'State Machine Supplier', email: 'statemachine@example.com' })
    supplierId = supRes.body.data.id

    const qRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierId,
        order_type:  'apparel',
        items: [{ description: 'Cap', qty: 10, unit_price: 5.00 }],
      })
    quoteId = qRes.body.data.id

    // Create a standalone invoice in Draft status for transition tests
    const invRes = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, subtotal: 50 })
    invoiceId = invRes.body.data.id
  })

  test('2a: Invalid Zod enum value → 422', async () => {
    const res = await request(app)
      .patch(`/api/quotations/${quoteId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INVALID_STATUS_VALUE' })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
  })

  test('2b: Invalid state machine edge (Draft invoice → Paid) → 422', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Paid' })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/Invalid transition/i)
  })

  test('2c: Wrong role (Sales cannot pay a Sent invoice) → 403', async () => {
    // First move invoice to Sent (Admin can do this)
    await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Sent' })

    // Now Sales user tries to move Sent → Paid
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'Paid' })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/not permitted/i)
  })

  test('2d: Valid transition (Admin moves Sent invoice → Void) → 200', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Void' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('Void')
  })

  test('2e: Terminal state — cannot leave Void → 422', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Sent' })

    expect(res.status).toBe(422)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST 3: Idempotency
//  Approve quote twice → exactly 1 invoice
//  Pay invoice twice → exactly 1 order
// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 3: Idempotency', () => {
  let supplierId
  let quoteId
  let invoiceId
  let orderId

  beforeAll(async () => {
    const supRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Idempotency Supplier', email: 'idempotency@example.com' })
    supplierId = supRes.body.data.id
  })

  test('3a: Create and approve quote', async () => {
    const qRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierId,
        order_type:  'gangsheet',
        items: [{ description: 'Gang Sheet 22x24', qty: 1, unit_price: 20.00 }],
      })
    quoteId = qRes.body.data.id

    const approveRes = await request(app)
      .patch(`/api/quotations/${quoteId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Approved' })

    expect(approveRes.status).toBe(200)
    invoiceId = approveRes.body.data.auto_invoice_id
    expect(invoiceId).toBeTruthy()
  })

  test('3b: Approving the same quote again → 422 (terminal state)', async () => {
    const res = await request(app)
      .patch(`/api/quotations/${quoteId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Approved' })

    expect(res.status).toBe(422)
  })

  test('3c: Exactly 1 invoice linked to quote after duplicate approval attempt', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE quote_id = $1`, [quoteId]
    )
    expect(parseInt(rows[0].cnt, 10)).toBe(1)
  })

  test('3d: Pay invoice → auto-order created', async () => {
    // Move to Sent first (it's already Sent from auto-creation, just verify)
    const invRes = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(invRes.body.data.status).toBe('Sent')

    const payRes = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Paid' })

    expect(payRes.status).toBe(200)
    orderId = payRes.body.data.auto_order_id
    expect(orderId).toBeTruthy()
  })

  test('3e: Paying the same invoice again → 422 (terminal state)', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Paid' })

    expect(res.status).toBe(422)
  })

  test('3f: Exactly 1 order linked to invoice after duplicate payment attempt', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL`, [invoiceId]
    )
    expect(parseInt(rows[0].cnt, 10)).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST 4: Supplier portal PO isolation
//  Two suppliers each have their own PO in the portal.
//  Each portal user can only see their own PO.
// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 4: Supplier portal PO isolation', () => {
  let supplierAId, supplierBId
  let poAId, poBId
  let portalTokenA, portalTokenB

  beforeAll(async () => {
    // Create two suppliers
    const resA = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Portal Supplier Alpha', email: 'alpha@portal.com' })
    supplierAId = resA.body.data.id

    const resB = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Portal Supplier Beta', email: 'beta@portal.com' })
    supplierBId = resB.body.data.id

    // Create one PO per supplier
    const poA = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierAId,
        items: [{ item_name: 'Alpha Item', qty_ordered: 10, unit_price: 5.00 }],
      })
    poAId = poA.body.data.id

    const poB = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierBId,
        items: [{ item_name: 'Beta Item', qty_ordered: 20, unit_price: 3.00 }],
      })
    poBId = poB.body.data.id

    // Send each PO to its supplier's portal
    await request(app)
      .post(`/api/purchase-orders/${poAId}/send-to-portal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})

    await request(app)
      .post(`/api/purchase-orders/${poBId}/send-to-portal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})

    // Create portal credentials for each supplier
    await request(app)
      .post(`/api/suppliers/${supplierAId}/portal-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'portal_alpha', password: 'alphapass123' })

    await request(app)
      .post(`/api/suppliers/${supplierBId}/portal-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'portal_beta', password: 'betapass123' })

    // Login as each portal user
    const loginA = await request(app)
      .post('/api/supplier/auth/login')
      .send({ username: 'portal_alpha', password: 'alphapass123' })
    portalTokenA = loginA.body.token

    const loginB = await request(app)
      .post('/api/supplier/auth/login')
      .send({ username: 'portal_beta', password: 'betapass123' })
    portalTokenB = loginB.body.token
  })

  test('4a: Portal Alpha sees exactly 1 PO (PO-A)', async () => {
    const res = await request(app)
      .get('/api/supplier/purchase-orders')
      .set('Authorization', `Bearer ${portalTokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.purchaseOrders).toHaveLength(1)
    expect(res.body.purchaseOrders[0].id).toBe(poAId)
  })

  test('4b: Portal Beta sees exactly 1 PO (PO-B)', async () => {
    const res = await request(app)
      .get('/api/supplier/purchase-orders')
      .set('Authorization', `Bearer ${portalTokenB}`)

    expect(res.status).toBe(200)
    expect(res.body.purchaseOrders).toHaveLength(1)
    expect(res.body.purchaseOrders[0].id).toBe(poBId)
  })

  test('4c: Portal Alpha cannot access PO-B by ID → 404', async () => {
    const res = await request(app)
      .get(`/api/supplier/purchase-orders/${poBId}`)
      .set('Authorization', `Bearer ${portalTokenA}`)

    expect(res.status).toBe(404)
  })

  test('4d: Portal Beta cannot access PO-A by ID → 404', async () => {
    const res = await request(app)
      .get(`/api/supplier/purchase-orders/${poAId}`)
      .set('Authorization', `Bearer ${portalTokenB}`)

    expect(res.status).toBe(404)
  })

  test('4e: portal_po_visibility has exactly 2 rows (one per supplier)', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM portal_po_visibility WHERE po_id IN ($1, $2) ORDER BY created_at`,
      [poAId, poBId]
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.po_id === poAId).supplier_id).toBe(supplierAId)
    expect(rows.find((r) => r.po_id === poBId).supplier_id).toBe(supplierBId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST 5: Custom fields
//  Create a select field, set a valid value, verify persistence,
//  reject an invalid option value with 422.
// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 5: Custom fields', () => {
  let fieldId
  let leadId

  test('5a: Admin creates a select custom field on "lead"', async () => {
    const res = await request(app)
      .post('/api/custom-fields')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entity_type:  'lead',
        field_key:    'material_type',
        field_label:  'Material Type',
        field_type:   'select',
        options:      ['Cotton', 'Polyester', 'Blend'],
        is_required:  false,
      })

    expect(res.status).toBe(201)
    fieldId = res.body.data.id
    expect(res.body.data.field_key).toBe('material_type')
    expect(res.body.data.field_type).toBe('select')
  })

  test('5b: Create a lead', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_name: 'Custom Field Tester', source: 'Phone' })

    expect(res.status).toBe(201)
    leadId = res.body.data.id
  })

  test('5c: Set custom field value (valid option)', async () => {
    const res = await request(app)
      .patch(`/api/custom-fields/values/lead/${leadId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ material_type: 'Polyester' })

    expect(res.status).toBe(200)
    expect(res.body.data.material_type).toBe('Polyester')
  })

  test('5d: GET custom field values → value persisted', async () => {
    const res = await request(app)
      .get(`/api/custom-fields/values/lead/${leadId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.material_type).toBe('Polyester')
  })

  test('5e: Set value to option not in list → 422', async () => {
    const res = await request(app)
      .patch(`/api/custom-fields/values/lead/${leadId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ material_type: 'Nylon' })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/not a valid option/i)
  })

  test('5f: Overwrite with a different valid option → 200', async () => {
    const res = await request(app)
      .patch(`/api/custom-fields/values/lead/${leadId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ material_type: 'Cotton' })

    expect(res.status).toBe(200)
    expect(res.body.data.material_type).toBe('Cotton')
  })

  test('5g: Deactivating a custom field removes it from list but values remain in DB', async () => {
    await request(app)
      .delete(`/api/custom-fields/${fieldId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    // Active field list no longer includes this field
    const listRes = await request(app)
      .get('/api/custom-fields?entity_type=lead')
      .set('Authorization', `Bearer ${adminToken}`)
    const active = listRes.body.data.find((f) => f.id === fieldId)
    expect(active).toBeUndefined()

    // Value row still exists in DB
    const { rows } = await pool.query(
      `SELECT cfv.value FROM custom_field_values cfv
       JOIN custom_fields cf ON cf.id = cfv.field_id
       WHERE cf.id = $1 AND cfv.entity_id = $2`,
      [fieldId, leadId]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].value).toBe('Cotton')
  })
})
