'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  A tracking number the factory hands in becomes a parcel the shop can see.
//
//  It used to land on the purchase order and stop there, so a job the factory
//  had already posted showed no shipment at all — nothing in the Shipments
//  list, no courier status, and the ten-minute tracking sync never looked at it
//  because that sync only follows shipment rows.
//
//  The parcel goes on the PO's sales order, not on the PO. The factories here
//  post straight to the customer, so this is the customer's parcel arriving
//  through the factory's hands — and chk_shipments_target_xor would refuse a
//  row that named both anyway.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../src/config/db')
const portal = require('../../src/modules/supplier-portal/portal.service')

let supplierId
let n = 0

async function reset() {
  await pool.query(`
    TRUNCATE TABLE shipments, portal_po_visibility, purchase_orders,
      order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
      customers, suppliers
    RESTART IDENTITY CASCADE`)
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name) VALUES ('TSI Transfers') RETURNING id`)
  supplierId = rows[0].id
}

// A customer, their order, and a purchase order the factory can see.
async function job(customerName = 'Test Buyer') {
  const { rows: c } = await pool.query(
    `INSERT INTO customers (customer_number, name, city, state, zip)
     VALUES ($1, $2, 'Griffin', 'GA', '30224') RETURNING id`,
    [`CUST-T-${++n}`, customerName])
  const { rows: o } = await pool.query(
    `INSERT INTO orders (order_number, customer_id, order_type, order_date, total, status, shipping_address)
     VALUES ($1, $2, 'dtf', CURRENT_DATE, 100, 'Confirmed', '412 South Collins Street, Griffin, GA 30224')
     RETURNING id, order_number`,
    [`ORD-T-${String(++n).padStart(4, '0')}`, c[0].id])
  const { rows: po } = await pool.query(
    `INSERT INTO purchase_orders (po_number, order_id, supplier_id, order_date, status)
     VALUES ($1, $2, $3, CURRENT_DATE, 'Sent') RETURNING id, po_number`,
    [`PO-T-${String(++n).padStart(4, '0')}`, o[0].id, supplierId])
  await pool.query(
    `INSERT INTO portal_po_visibility (po_id, supplier_id, is_visible) VALUES ($1, $2, TRUE)`,
    [po[0].id, supplierId])
  return { customerId: c[0].id, orderId: o[0].id, poId: po[0].id, orderNumber: o[0].order_number }
}

const parcelsFor = async orderId =>
  (await pool.query(
    `SELECT * FROM shipments WHERE order_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [orderId])).rows

beforeEach(reset)
afterAll(() => pool.end())

describe('the factory hands in a tracking number', () => {
  test('it appears as a shipment on the sales order, ready for the courier sync', async () => {
    const j = await job('Joseph Giles')

    await portal.addTracking(supplierId, j.poId, {
      tracking_number: '1Z2B14J80231351138', carrier: 'UPS', tracking_notes: 'posted today',
    })

    const parcels = await parcelsFor(j.orderId)
    expect(parcels).toHaveLength(1)
    expect(parcels[0].tracking_number).toBe('1Z2B14J80231351138')
    expect(parcels[0].carrier).toBe('UPS')
    expect(parcels[0].customer_name).toBe('Joseph Giles')
    expect(parcels[0].ship_source).toBe('Supplier')
    // The address travels with it, so the Shipments list is not full of blanks.
    expect(parcels[0].ship_to_city).toBe('Griffin')
    // Named the order, not the purchase order: chk_shipments_target_xor allows
    // one or the other, and the customer's parcel belongs to the order.
    expect(parcels[0].po_id).toBeNull()

    // And the number is still on the purchase order, where the factory put it.
    const { rows: po } = await pool.query(
      `SELECT tracking_number, tracking_notes FROM purchase_orders WHERE id = $1`, [j.poId])
    expect(po[0].tracking_number).toBe('1Z2B14J80231351138')
    expect(po[0].tracking_notes).toBe('posted today')
  })

  test('handing the same number in twice does not make a second parcel', async () => {
    const j = await job()
    await portal.addTracking(supplierId, j.poId, { tracking_number: '1Z999', carrier: 'UPS' })
    await portal.addTracking(supplierId, j.poId, { tracking_number: '1Z999', carrier: 'UPS' })
    expect(await parcelsFor(j.orderId)).toHaveLength(1)
  })

  test('a parcel the courier sync already pulled in is joined, not copied', async () => {
    // The label pull often reaches Shippo before the factory gets round to the
    // portal, and lands a parcel with no order on it.
    const j = await job('Loose Parcel Buyer')
    await pool.query(
      `INSERT INTO shipments (shipment_number, recipient_name, tracking_number, carrier, ship_date)
       VALUES ('SHP-T-LOOSE', 'Loose Parcel Buyer', '1ZLOOSE', 'UPS', CURRENT_DATE)`)

    await portal.addTracking(supplierId, j.poId, { tracking_number: '1ZLOOSE', carrier: 'UPS' })

    const parcels = await parcelsFor(j.orderId)
    expect(parcels).toHaveLength(1)
    expect(parcels[0].shipment_number).toBe('SHP-T-LOOSE')
  })

  test('a number already on another order is left exactly where it is', async () => {
    const a = await job('First Buyer')
    const b = await job('Second Buyer')
    await portal.addTracking(supplierId, a.poId, { tracking_number: '1ZSHARED', carrier: 'UPS' })
    await portal.addTracking(supplierId, b.poId, { tracking_number: '1ZSHARED', carrier: 'UPS' })

    expect(await parcelsFor(a.orderId)).toHaveLength(1)
    expect(await parcelsFor(b.orderId)).toHaveLength(0)
  })

  test('a purchase order with no sales order behind it records nothing, and does not fail', async () => {
    const { rows: po } = await pool.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, order_date, status)
       VALUES ('PO-T-ORPHAN', $1, CURRENT_DATE, 'Sent') RETURNING id`, [supplierId])
    await pool.query(
      `INSERT INTO portal_po_visibility (po_id, supplier_id, is_visible) VALUES ($1, $2, TRUE)`,
      [po[0].id, supplierId])

    const saved = await portal.addTracking(supplierId, po[0].id, { tracking_number: '1ZNOORDER' })
    expect(saved.tracking_number).toBe('1ZNOORDER')
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM shipments`)
    expect(rows[0].n).toBe(0)
  })

  test('a factory that cannot see the purchase order is refused', async () => {
    const j = await job()
    const { rows: other } = await pool.query(
      `INSERT INTO suppliers (name) VALUES ('DIGI') RETURNING id`)
    await expect(
      portal.addTracking(other[0].id, j.poId, { tracking_number: '1ZNOPE' })
    ).rejects.toThrow(/not found or access denied/)
    expect(await parcelsFor(j.orderId)).toHaveLength(0)
  })
})
