#!/usr/bin/env node
'use strict'

/**
 * A delivered sales order closes its purchase orders — on the owner's word.
 *
 * The courier sync moves a sales order to Delivered when its parcel lands, but
 * nothing moved the PO behind it: dozens of delivered orders still had POs
 * reading Draft, Sent, In Production or Shipped. Each such PO is Closed, with a
 * line in po_status_history saying why. scripts/sync-shipment-tracking.js now
 * does the same on every cycle, so it does not drift again.
 *
 * Cancelled POs are left alone.
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
    const { rows } = await client.query(`
      SELECT po.id, po.po_number, po.status::text AS status, o.order_number
        FROM purchase_orders po
        JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL AND o.status = 'Delivered'
         AND po.status NOT IN ('Closed', 'Cancelled')
       ORDER BY po.po_number`)
    const tally = {}
    for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1
    console.log(`POs on delivered orders that are not Closed: ${rows.length}`)
    for (const [s, n] of Object.entries(tally)) console.log(`   ${String(n).padStart(3)}  ${s} -> Closed`)

    for (const r of rows) {
      await client.query(`UPDATE purchase_orders SET status = 'Closed', updated_at = NOW() WHERE id = $1`, [r.id])
      await client.query(
        `INSERT INTO po_status_history (po_id, from_status, to_status, changed_by, comment)
         VALUES ($1, $2, 'Closed', NULL, $3)`,
        [r.id, r.status, `${r.order_number} was delivered`])
    }

    const { rows: [c] } = await client.query(`
      SELECT COUNT(*)::int AS open FROM purchase_orders po JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL AND o.status = 'Delivered' AND po.status NOT IN ('Closed', 'Cancelled')`)
    console.log(`\n   still open on a delivered order: ${c.open}`)

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
