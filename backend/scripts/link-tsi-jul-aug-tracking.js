#!/usr/bin/env node
/**
 * Attach the owner-supplied UPS tracking to the TSI Jul–Aug 2026 batch.
 *
 * For each tracking number: create the shipment if it is new, point it at its
 * sales order, and stamp the tracking + carrier onto the order and its purchase
 * order — the same shape the earlier batches use.
 *
 * Two corrections are folded in:
 *  - "David" in the supplied list means Robert Farrar.
 *  - 1Z2B14J80227839745 and 1Z2B14J80231351138 already existed and had been
 *    attached to the 14/16-Jul orders by an earlier date-proximity guess, made
 *    before the 20-Jul orders were imported. The owner's list is authoritative,
 *    so they are moved to the 20-Jul orders and the old orders are cleared.
 *
 * TSI 63/64/65/67 shipped as one parcel: the shipment row points at PO 63's
 * order (the one carrying the combined billing) and all four orders and POs
 * carry the tracking number.
 *
 * Idempotent. Usage:
 *   node backend/scripts/link-tsi-jul-aug-tracking.js            (dry-run)
 *   node backend/scripts/link-tsi-jul-aug-tracking.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// tracking → { orders it covers, ship date, customer as supplied }
const LINKS = [
  { trk: '1Z2B14J80231351138', ship: '2026-07-20', customer: 'Robert Farrar',     orders: ['ORD-260720-53'] },
  { trk: '1Z2B14J80227839745', ship: '2026-07-20', customer: 'Victor Spates',     orders: ['ORD-260720-54'] },
  { trk: '1Z2B14J80310186131', ship: '2026-07-22', customer: 'Alex M Cabrera',    orders: ['ORD-260722-55'] },
  { trk: '1Z199GG60300002419', ship: '2026-07-22', customer: 'Leisha Rogers',     orders: ['ORD-260723-56'] },
  { trk: '1Z2B14J80310270941', ship: '2026-07-25', customer: 'Keith DuBois',      orders: ['ORD-260725-58'] },
  { trk: '1Z2B14J80203292353', ship: '2026-07-25', customer: 'Pam Guernsey',      orders: ['ORD-260727-59'] },
  { trk: '1Z2B14J80237295966', ship: '2026-07-25', customer: 'Kyle Morris',       orders: ['ORD-260727-60'] },
  { trk: '1Z2B14J80222063574', ship: '2026-07-27', customer: 'Victor Spates',     orders: ['ORD-260727-61'] },
  { trk: '1Z199GG60300390429', ship: '2026-07-27', customer: 'Bobbie Lee Hansen', orders: ['ORD-260727-62'] },
  { trk: '1Z24C3141338464023', ship: '2026-07-30', customer: 'Robert Farrar',
    orders: ['ORD-260730-63', 'ORD-260730-64', 'ORD-260730-65', 'ORD-260731-67'] },
  { trk: '1Z24C3140320024014', ship: '2026-07-31', customer: 'Vianelly Chichipa', orders: ['ORD-260731-66'] },
  { trk: '1Z24C3140306188820', ship: '2026-07-31', customer: 'Ricardo Malia',     orders: ['ORD-260801-68'] },
  { trk: '1Z24C3140320920037', ship: '2026-07-31', customer: 'Victor Spates',     orders: ['ORD-260801-69'] },
]

// Orders these two were previously (and wrongly) attached to.
const CLEAR_FROM = ['ORD-260714-50', 'ORD-260716-52']

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const plan = []
    for (const l of LINKS) {
      const { rows: [sh] } = await client.query(
        `SELECT id, tracking_number, order_id FROM shipments WHERE tracking_number = $1`, [l.trk])
      const { rows: ords } = await client.query(
        `SELECT order_number FROM orders WHERE order_number = ANY($1) AND deleted_at IS NULL`, [l.orders])
      const missing = l.orders.filter(o => !ords.some(r => r.order_number === o))
      plan.push(
        `${sh ? 'RELINK' : 'CREATE'}  ${l.trk}  ${l.customer.padEnd(18)} -> ${l.orders.join(', ')}` +
        (missing.length ? `   !! missing order(s): ${missing.join(', ')}` : ''))
    }
    console.log(plan.join('\n'))

    if (!APPLY) { console.log(`\nDRY RUN — ${LINKS.length} tracking numbers. Re-run with --apply.`); return }

    await client.query('BEGIN')

    // Detach the two mis-assigned shipments from their old orders first.
    await client.query(
      `UPDATE orders SET tracking_number = NULL, courier = NULL, updated_at = NOW()
        WHERE order_number = ANY($1)`, [CLEAR_FROM])
    await client.query(
      `UPDATE purchase_orders SET tracking_number = NULL, updated_at = NOW()
        WHERE order_id IN (SELECT id FROM orders WHERE order_number = ANY($1))`, [CLEAR_FROM])

    let created = 0, relinked = 0, ordersStamped = 0, posStamped = 0
    for (const l of LINKS) {
      // The shipment row points at the first order it covers.
      const { rows: [primary] } = await client.query(
        `SELECT id FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [l.orders[0]])
      if (!primary) { console.log(`  SKIP ${l.trk} — ${l.orders[0]} not found`); continue }

      const { rows: [existing] } = await client.query(
        `SELECT id FROM shipments WHERE tracking_number = $1`, [l.trk])

      if (existing) {
        await client.query(
          `UPDATE shipments SET order_id = $2, customer_name = $3, recipient_name = $3,
                  ship_date = $4::date, carrier = 'UPS', updated_at = NOW()
            WHERE id = $1`, [existing.id, primary.id, l.customer, l.ship])
        relinked++
      } else {
        const shipmentNumber = (await client.query(
          `SELECT 'SHP-2026-' || lpad(
                    (COALESCE(MAX(split_part(shipment_number, '-', 3)::int), 0) + 1)::text, 4, '0') AS n
             FROM shipments
            WHERE shipment_number ~ '^SHP-2026-[0-9]+$'`)).rows[0].n
        await client.query(
          `INSERT INTO shipments (shipment_number, order_id, tracking_number, carrier,
             customer_name, recipient_name, ship_date, status, ship_source)
           VALUES ($1,$2,$3,'UPS',$4,$4,$5::date,'In Transit','Decoinks Fulfillment')`,
          [shipmentNumber, primary.id, l.trk, l.customer, l.ship])
        created++
      }

      // Every order the parcel covers, and its purchase order, carries the number.
      const o = await client.query(
        `UPDATE orders SET tracking_number = $2, courier = 'UPS', updated_at = NOW()
          WHERE order_number = ANY($1) AND deleted_at IS NULL`, [l.orders, l.trk])
      ordersStamped += o.rowCount
      const p = await client.query(
        `UPDATE purchase_orders SET tracking_number = $2, carrier = 'UPS', updated_at = NOW()
          WHERE order_id IN (SELECT id FROM orders WHERE order_number = ANY($1)) AND deleted_at IS NULL`,
        [l.orders, l.trk])
      posStamped += p.rowCount
    }

    await client.query('COMMIT')
    console.log(`\nShipments created ${created}, re-linked ${relinked}; orders stamped ${ordersStamped}, POs stamped ${posStamped}.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
