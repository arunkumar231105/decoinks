'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  A parcel joins its sales order by itself.
//
//  A label is bought the day after the order as often as the same day, and the
//  courier's record arrives on its own schedule, so matching once at the moment
//  a shipment row is created left parcels loose for good. The attach pass runs
//  over every unattached parcel on each courier cycle instead.
//
//  These tests hold the shape of that matching, and above all what it refuses:
//  a parcel on the wrong job puts someone else's tracking number in front of a
//  customer, which is worse than a parcel on no job at all.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../src/config/db')
const { attachLooseShipments } = require('../../src/modules/shipments/attach.service')

let n = 0

async function reset() {
  await pool.query(`
    TRUNCATE TABLE shipments, purchase_orders,
      order_items_apparel, order_items_dtf, order_items_gangsheet, orders,
      invoices, customers, users
    RESTART IDENTITY CASCADE`)
}

async function customer(name) {
  const { rows } = await pool.query(
    `INSERT INTO customers (customer_number, name) VALUES ($1, $2) RETURNING id`,
    [`CUST-T-${++n}`, name])
  return rows[0].id
}

async function order(customerId, orderDate, total = 100) {
  const { rows } = await pool.query(
    `INSERT INTO orders (order_number, customer_id, order_type, order_date, total, status)
     VALUES ($1, $2, 'dtf', $3::date, $4, 'Confirmed') RETURNING id, order_number`,
    [`ORD-T-${String(++n).padStart(4, '0')}`, customerId, orderDate, total])
  return rows[0]
}

async function parcel(recipient, shipDate, tracking = null) {
  const { rows } = await pool.query(
    `INSERT INTO shipments (shipment_number, recipient_name, ship_date, tracking_number, carrier)
     VALUES ($1, $2, $3::date, $4, 'UPS') RETURNING id, shipment_number`,
    [`SHP-T-${String(++n).padStart(4, '0')}`, recipient, shipDate, tracking])
  return rows[0]
}

const orderIdOf = async id =>
  (await pool.query(`SELECT order_id FROM shipments WHERE id = $1`, [id])).rows[0].order_id

beforeEach(reset)
afterAll(() => pool.end())

describe('attaching a loose parcel to its sales order', () => {
  test('a parcel posted just after the order joins it', async () => {
    const c = await customer('Robert Farrar')
    const o = await order(c, '2026-07-31')
    const s = await parcel('Robert Farrar', '2026-08-01', '1Z24C3140200019819')

    const { attached } = await attachLooseShipments({ apply: true })
    expect(attached).toHaveLength(1)
    expect(attached[0].order_number).toBe(o.order_number)
    expect(await orderIdOf(s.id)).toBe(o.id)
  })

  test('the name is matched past accents and punctuation', async () => {
    const c = await customer('Alhelí A.R.')
    const o = await order(c, '2026-09-02')
    const s = await parcel('Alheli AR', '2026-09-03')

    await attachLooseShipments({ apply: true })
    expect(await orderIdOf(s.id)).toBe(o.id)
  })

  test('a parcel posted three weeks BEFORE the order is left alone', async () => {
    // Jac Jean's only order was raised twenty days after this parcel went out.
    // A date cannot make that the same job, so the pass must not decide it is.
    const c = await customer('Jac Jean')
    await order(c, '2026-06-05')
    const s = await parcel('Jac Jean', '2026-05-16', '1Z2B14J80235381107')

    const { attached, skipped } = await attachLooseShipments({ apply: true })
    expect(attached).toHaveLength(0)
    expect(skipped).toHaveLength(1)
    expect(await orderIdOf(s.id)).toBeNull()
  })

  test('two orders equally close to the parcel is a question for a person', async () => {
    const c = await customer('Brooke Wylie')
    await order(c, '2026-09-04', 240)
    await order(c, '2026-09-04', 240)
    const s = await parcel('Brooke Wylie', '2026-09-05')

    const { attached, skipped } = await attachLooseShipments({ apply: true })
    expect(attached).toHaveLength(0)
    expect(skipped[0].why).toMatch(/equally well/)
    expect(await orderIdOf(s.id)).toBeNull()
  })

  test('an order still waiting for a parcel is preferred over one already shipped', async () => {
    const c = await customer('Tina Grant')
    const shipped = await order(c, '2026-05-18')
    const waiting = await order(c, '2026-05-19')
    await pool.query(
      `INSERT INTO shipments (shipment_number, order_id, recipient_name, ship_date)
       VALUES ('SHP-T-EXIST', $1, 'Tina Grant', '2026-05-18')`, [shipped.id])

    const s = await parcel('Tina Grant', '2026-05-20')
    await attachLooseShipments({ apply: true })
    expect(await orderIdOf(s.id)).toBe(waiting.id)
  })

  test('a parcel for someone with no order stays loose, and says why', async () => {
    const s = await parcel('Victor Spates', '2026-09-07', '1ZB8F618YW98298400')

    const { attached, skipped } = await attachLooseShipments({ apply: true })
    expect(attached).toHaveLength(0)
    expect(skipped[0].why).toMatch(/no order for "Victor Spates"/)
    expect(await orderIdOf(s.id)).toBeNull()
  })

  test('a parcel with no recipient cannot be matched at all', async () => {
    const s = await parcel(null, '2026-05-20', '9370120845500000089290')
    const { skipped } = await attachLooseShipments({ apply: true })
    expect(skipped[0].why).toMatch(/no recipient name/)
    expect(await orderIdOf(s.id)).toBeNull()
  })

  test('a dry run reports the match without writing it', async () => {
    const c = await customer('Michaelene Brown')
    await order(c, '2026-09-07')
    const s = await parcel('Michaelene Brown', '2026-09-08')

    const { attached } = await attachLooseShipments({ apply: false })
    expect(attached).toHaveLength(1)
    expect(await orderIdOf(s.id)).toBeNull()
  })

  test('the purchase orders behind the job are reported, never written onto the parcel', async () => {
    // chk_shipments_target_xor allows a shipment to name an order or a purchase
    // order, never both: a PO parcel is the factory sending goods to the shop,
    // an order parcel is the shop sending them to the customer. The PO screen
    // reads its tracking through the order instead.
    const c = await customer('Coach Armando')
    const o = await order(c, '2026-09-07')
    await pool.query(
      `INSERT INTO purchase_orders (po_number, order_id, order_date, status)
       VALUES ('PO-T-0001', $1, '2026-09-07', 'Sent')`, [o.id])
    const s = await parcel('Coach Armando', '2026-09-08')

    const { attached } = await attachLooseShipments({ apply: true })
    expect(attached[0].po_numbers).toEqual(['PO-T-0001'])

    const { rows } = await pool.query(
      `SELECT order_id, po_id FROM shipments WHERE id = $1`, [s.id])
    expect(rows[0].order_id).toBe(o.id)
    expect(rows[0].po_id).toBeNull()
  })

  test('running twice changes nothing the second time', async () => {
    const c = await customer('Ricardo Malia')
    await order(c, '2026-09-01')
    await parcel('Ricardo Malia', '2026-09-02')

    const first = await attachLooseShipments({ apply: true })
    const second = await attachLooseShipments({ apply: true })
    expect(first.attached).toHaveLength(1)
    expect(second.attached).toHaveLength(0)
  })
})
