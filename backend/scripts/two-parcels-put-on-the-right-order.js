#!/usr/bin/env node
'use strict'

/**
 * Two parcels the book had wrong, both confirmed against the shop's own chat.
 *
 * 1. Joseph Giles — ORD-2026-0109 has no parcel at all, but the chat on 23 Aug
 *    says "it has been shipped by USPS tracking id # 9234690371836103185223".
 *    The parcel was never recorded, so it is created and attached.
 *
 * 2. Samuel Ngwamukie — SHP-2026-0155 sits on ORD-2026-0123, which already has
 *    its own parcel: the chat on 29 Aug names 1Z24C3140222040156 for that order,
 *    which is SHP-2026-0139. SHP-2026-0155 went out on 3 September, the same day
 *    ORD-2026-0136 was raised, and that order has nothing. It is moved.
 *
 * Nothing here is guessed. Both are moved on a tracking number the shop itself
 * sent the customer.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // ── 1. Joseph Giles: the parcel that was never written down ────────────
    const TRACKING = '9234690371836103185223'
    const { rows: dupe } = await client.query(
      `SELECT shipment_number FROM shipments WHERE tracking_number = $1`, [TRACKING])
    if (dupe[0]) {
      console.log(`1. Joseph Giles — ${TRACKING} is already ${dupe[0].shipment_number}, nothing to create`)
    } else {
      const { rows: ord } = await client.query(
        `SELECT o.id, o.order_number, o.shipping_address, c.name, c.city, c.state, c.zip
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.order_number = 'ORD-2026-0109' AND o.deleted_at IS NULL`)
      if (!ord[0]) throw new Error('ORD-2026-0109 not found')
      const o = ord[0]

      const { rows: n } = await client.query(
        `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number,'-',3),'')::INT),0)+1 AS n
           FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`)
      const number = `SHP-2026-${String(n[0].n).padStart(4, '0')}`

      console.log(`1. Joseph Giles — creating ${number}`)
      console.log(`      ${TRACKING}  USPS  23 Aug  ->  ${o.order_number}`)
      console.log(`      ${o.shipping_address}`)

      if (APPLY) {
        await client.query(
          `INSERT INTO shipments (shipment_number, order_id, recipient_name, customer_name,
                                  carrier, tracking_number, status, ship_date, address,
                                  ship_to_city, ship_to_state, ship_to_postal_code,
                                  ship_source, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$3,'USPS',$4,'In Transit'::shipment_status,'2026-08-23',$5,$6,$7,$8,
                   'Decoinks Fulfillment',
                   'Recorded from the chat of 23 Aug, where this tracking number was sent to the customer.',
                   NOW(), NOW())`,
          [number, o.id, o.name, TRACKING, o.shipping_address, o.city, o.state, o.zip])
      }
    }

    // ── 2. Samuel Ngwamukie: a parcel on the wrong order ───────────────────
    const { rows: move } = await client.query(
      `SELECT s.id, s.shipment_number, s.tracking_number, s.ship_date,
              cur.order_number AS currently_on,
              (SELECT count(*) FROM shipments s2
                WHERE s2.order_id = cur.id AND s2.deleted_at IS NULL) AS parcels_on_current
         FROM shipments s
         LEFT JOIN orders cur ON cur.id = s.order_id
        WHERE s.shipment_number = 'SHP-2026-0155'`)
    const { rows: target } = await client.query(
      `SELECT id, order_number, order_date FROM orders
        WHERE order_number = 'ORD-2026-0136' AND deleted_at IS NULL`)

    if (!move[0] || !target[0]) throw new Error('SHP-2026-0155 or ORD-2026-0136 not found')

    if (move[0].currently_on === target[0].order_number) {
      console.log(`\n2. Samuel Ngwamukie — SHP-2026-0155 is already on ${target[0].order_number}`)
    } else {
      console.log(`\n2. Samuel Ngwamukie — moving ${move[0].shipment_number}`)
      console.log(`      ${move[0].tracking_number}  shipped ${String(move[0].ship_date).slice(0, 10)}`)
      console.log(`      from ${move[0].currently_on} (which keeps ${Number(move[0].parcels_on_current) - 1} parcel of its own)`)
      console.log(`      to   ${target[0].order_number} (raised ${String(target[0].order_date).slice(0, 10)}, had none)`)

      if (Number(move[0].parcels_on_current) < 2) {
        throw new Error(`${move[0].currently_on} would be left with no parcel — refusing to move it`)
      }
      if (APPLY) {
        await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW() WHERE id = $1`,
          [move[0].id, target[0].id])
      }
    }

    if (APPLY) { await client.query('COMMIT'); console.log('\nWritten.') }
    else { await client.query('ROLLBACK'); console.log('\nNothing written. Re-run with --apply.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
