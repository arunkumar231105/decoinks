'use strict'

// A claim is raised against a purchase order; the server fills in the sales
// order and invoice from it and decides who may move a claim past Raised.

const client = { query: jest.fn(), release: jest.fn() }
jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}))

const db = require('../../src/config/db')
const svc = require('../../src/modules/claims/claims.service')

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const OTHER    = '99999999-9999-4999-8999-999999999999'
const PO       = '22222222-2222-4222-8222-222222222222'
const ORDER    = '33333333-3333-4333-8333-333333333333'
const INVOICE  = '44444444-4444-4444-8444-444444444444'
const CLAIM    = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  jest.resetAllMocks()
  db.pool.connect.mockResolvedValue(client)
})

// Routes the transaction's queries by what they say, so the order of calls
// inside create() can change without breaking the test.
function answer(sql, params) {
  if (/FROM purchase_orders p LEFT JOIN orders o/.test(sql)) {
    return { rows: [{ id: PO, customer_id: CUSTOMER, order_id: ORDER, invoice_id: INVOICE }] }
  }
  if (/claim_number LIKE/.test(sql)) return { rows: [{ n: 'CLM-2026-0015' }] }
  if (/FROM shipments sh/.test(sql)) return { rows: [] }
  if (/INSERT INTO claims/.test(sql)) return { rows: [{ id: CLAIM }] }
  return { rows: [] }
}

describe('create()', () => {
  test('reads the sales order and invoice off the purchase order', async () => {
    client.query.mockImplementation(async (sql, params) => answer(sql, params))
    db.query.mockResolvedValue({ rows: [] })

    await svc.create({ customer_id: CUSTOMER, purchase_order_id: PO, claim_category: 'Other',
                       description: 'x', status: 'Raised' }, null)

    const insert = client.query.mock.calls.find(([sql]) => /INSERT INTO claims/.test(sql))
    const cols = insert[0].match(/\(([^)]+)\) VALUES/)[1].split(', ')
    const vals = insert[1]
    expect(vals[cols.indexOf('order_id')]).toBe(ORDER)
    expect(vals[cols.indexOf('invoice_id')]).toBe(INVOICE)
    expect(vals[cols.indexOf('purchase_order_id')]).toBe(PO)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  test('ignores an order_id sent by the form when a PO is chosen', async () => {
    client.query.mockImplementation(async (sql, params) => answer(sql, params))
    db.query.mockResolvedValue({ rows: [] })

    await svc.create({ customer_id: CUSTOMER, purchase_order_id: PO, order_id: OTHER,
                       claim_category: 'Other', description: 'x' }, null)

    const insert = client.query.mock.calls.find(([sql]) => /INSERT INTO claims/.test(sql))
    const cols = insert[0].match(/\(([^)]+)\) VALUES/)[1].split(', ')
    expect(insert[1][cols.indexOf('order_id')]).toBe(ORDER)
  })

  test('refuses a purchase order that belongs to another customer', async () => {
    client.query.mockImplementation(async (sql, params) => answer(sql, params))

    await expect(svc.create({ customer_id: OTHER, purchase_order_id: PO,
                              claim_category: 'Other', description: 'x' }, null))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/different customer/) })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  test('refuses a claim with neither a purchase order nor an order', async () => {
    client.query.mockImplementation(async (sql, params) => answer(sql, params))

    await expect(svc.create({ customer_id: CUSTOMER, claim_category: 'Other', description: 'x' }, null))
      .rejects.toMatchObject({ statusCode: 400, message: 'Choose the purchase order' })
  })
})

describe('update() status rules', () => {
  beforeEach(() => {
    db.query.mockImplementation(async (sql) =>
      /SELECT status, customer_id FROM claims/.test(sql)
        ? { rows: [{ status: 'Raised', customer_id: CUSTOMER }] }
        : { rows: [] })
    client.query.mockImplementation(async (sql, params) => answer(sql, params))
  })

  test('only an admin can move a claim past Raised', async () => {
    await expect(svc.update(CLAIM, { status: 'Closed' }, null, 'Sales'))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(svc.update(CLAIM, { status: 'Closed' }, null, 'Admin')).resolves.toBeNull()
  })

  test('editing without a status leaves the status alone', async () => {
    await svc.update(CLAIM, { description: 'more detail' }, null, 'Sales')
    const set = client.query.mock.calls.find(([sql]) => /UPDATE claims SET/.test(sql))
    expect(set[0]).not.toMatch(/status =/)
  })

  test('attachments are synced: removed ones go, new ones are added', async () => {
    const kept = '66666666-6666-4666-8666-666666666666'
    await svc.update(CLAIM, { attachments: [
      { id: kept, file_name: 'a.png', file_url: '/a.png' },
      { file_name: 'b.png', file_url: '/b.png' },
    ] }, null, 'Sales')

    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM claim_attachments/), [CLAIM, [kept]])
    const inserts = client.query.mock.calls.filter(([sql]) => /INSERT INTO claim_attachments/.test(sql))
    expect(inserts).toHaveLength(1)
    expect(inserts[0][1][1]).toBe('b.png')
  })
})

describe('review()', () => {
  test('"Need More Info" leaves the claim waiting in Need More Info', async () => {
    client.query.mockImplementation(async (sql) =>
      /SELECT 1 FROM claims/.test(sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] })
    db.query.mockResolvedValue({ rows: [] })

    await svc.review(CLAIM, { decision: 'Need More Info' }, null)

    const set = client.query.mock.calls.find(([sql]) => /UPDATE claims SET decision/.test(sql))
    expect(set[1][6]).toBe('Need More Info')
  })
})
