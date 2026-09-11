#!/usr/bin/env node
'use strict'

/**
 * Purchase orders carrying a tracking number that exists nowhere else.
 *
 * The factories here print and post straight to the customer, so a tracking
 * number handed in against a purchase order is the customer's parcel arriving
 * through the factory's hands. Of the 110 purchase orders that carry one, 107
 * carry the very number the customer's parcel already has — those are already
 * on the book and are left completely alone. The rest are parcels that were
 * sent and never recorded: no shipment row, so nothing in the Shipments list,
 * no courier status, and the tracking sync never looked at them because it only
 * follows shipment rows.
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

    // A number already on a shipment row — on this order or any other — is a
    // parcel the book knows about. Only the ones nowhere to be found are new.
    const { rows: missing } = await client.query(`
      SELECT po.id, po.po_number, po.tracking_number, po.carrier, po.order_id,
             o.order_number, o.shipping_address, o.shipping_name,
             COALESCE(c.name, o.contact_name) AS customer_name,
             c.city, c.state, c.zip, s.name AS vendor
        FROM purchase_orders po
        JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.deleted_at IS NULL
         AND NULLIF(BTRIM(po.tracking_number), '') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM shipments sh
                          WHERE sh.deleted_at IS NULL
                            AND sh.tracking_number = BTRIM(po.tracking_number))
       ORDER BY po.po_number`)

    console.log(`Purchase orders whose tracking number is on no shipment: ${missing.length}\n`)

    for (const m of missing) {
      const { rows: n } = await client.query(
        `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number, '-', 3), '')::INT), 0) + 1 AS n
           FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`)
      const number = `SHP-2026-${String(n[0].n).padStart(4, '0')}`

      console.log(`  ${m.po_number}  ${m.tracking_number}  ${m.carrier ?? '?'}  (${m.vendor ?? '?'})`)
      console.log(`      -> ${number} on ${m.order_number} for ${m.customer_name ?? '?'}`)

      if (!APPLY) continue

      await client.query(
        `INSERT INTO shipments (shipment_number, order_id, recipient_name, customer_name,
                                carrier, tracking_number, status, ship_date, address,
                                ship_to_city, ship_to_state, ship_to_postal_code,
                                ship_source, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$3,$4,$5,'Label Created'::shipment_status,CURRENT_DATE,$6,$7,$8,$9,
                 'Supplier', $10, NOW(), NOW())`,
        [number, m.order_id, m.customer_name ?? m.shipping_name ?? null, m.carrier || null,
         String(m.tracking_number).trim(), m.shipping_address ?? null,
         m.city ?? null, m.state ?? null, m.zip ?? null,
         `Recorded from ${m.po_number}, where the factory handed the tracking number in. ` +
         `The courier's own status follows on the next tracking sync.`])
    }

    if (APPLY) { await client.query('COMMIT'); console.log(`\nWritten: ${missing.length} shipment(s).`) }
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
