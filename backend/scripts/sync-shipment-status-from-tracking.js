#!/usr/bin/env node
/**
 * Data fix — bring shipments.status back in line with the carrier (Shippo).
 *
 * A shipment carries two statuses:
 *   - shipments.status          the internal enum, set by staff / at creation
 *   - shipments.tracking_status the live carrier status, written by the Shippo refresh
 *
 * The Shippo refresh only ever wrote tracking_status, so the internal enum kept
 * whatever it had at creation time. The Shipments screen hides that because it
 * shows COALESCE(tracking_status, status), but the Orders list reads the raw
 * shipments.status — so 16 orders the carrier had already DELIVERED were still
 * being shown to staff as "In Transit".
 *
 * This reconciles the internal enum with the carrier status. Nothing is invented:
 * the carrier status must already be stored on the row.
 *
 * Rules (deliberately narrow):
 *  - DELIVERED  → 'Delivered'      (delivered_date is already on the row)
 *  - TRANSIT    → 'In Transit'
 *  - PRE_TRANSIT→ 'Label Created'  (carrier has not received the package yet)
 *  - FAILURE/RETURNED → 'Exception'
 *  - UNKNOWN / empty tracking_status → left completely alone
 *  - A shipment already marked 'Delivered' internally is never moved back to a
 *    lesser state — delivery is terminal, and it may have been confirmed by a
 *    human when the carrier feed was silent.
 *
 * Usage:
 *   node backend/scripts/sync-shipment-status-from-tracking.js            (dry-run)
 *   node backend/scripts/sync-shipment-status-from-tracking.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// Shippo tracking status → shipments.status enum. Anything not listed here is
// treated as "no opinion" and the row is skipped.
const MAP = {
  DELIVERED:   'Delivered',
  TRANSIT:     'In Transit',
  PRE_TRANSIT: 'Label Created',
  FAILURE:     'Exception',
  RETURNED:    'Exception',
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT s.id, s.shipment_number, s.tracking_number, s.status::text AS internal,
              s.tracking_status, s.delivered_date, s.customer_name,
              o.order_number
         FROM shipments s
         LEFT JOIN orders o ON o.id = s.order_id
        WHERE s.deleted_at IS NULL
          AND NULLIF(s.tracking_status, '') IS NOT NULL
        ORDER BY s.ship_date NULLS LAST`
    )

    const changes = []
    const skipped = []
    for (const r of rows) {
      const target = MAP[String(r.tracking_status).toUpperCase()]
      if (!target) { skipped.push([r, `carrier status ${r.tracking_status} has no mapping`]); continue }
      if (target === r.internal) continue                                   // already in sync
      if (r.internal === 'Delivered') { skipped.push([r, 'already Delivered internally — never downgraded']); continue }
      changes.push({ ...r, target })
    }

    console.log(`Shipments with a carrier status: ${rows.length}`)
    console.log(`Out of sync, will be corrected: ${changes.length}\n`)
    for (const c of changes) {
      console.log(`  ${c.shipment_number.padEnd(14)} ${String(c.order_number || '—').padEnd(14)} ` +
        `${String(c.customer_name || '').padEnd(20)} ${c.internal} → ${c.target}   ` +
        `(carrier ${c.tracking_status}${c.delivered_date ? `, delivered ${String(c.delivered_date).slice(0, 10)}` : ''})`)
    }

    if (skipped.length) {
      console.log(`\nLeft untouched (${skipped.length}):`)
      for (const [r, why] of skipped) {
        console.log(`  ${r.shipment_number.padEnd(14)} ${r.internal.padEnd(14)} ${why}`)
      }
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    let updated = 0
    for (const c of changes) {
      const { rowCount } = await client.query(
        `UPDATE shipments SET status = $1::shipment_status, updated_at = NOW()
          WHERE id = $2 AND deleted_at IS NULL`,
        [c.target, c.id]
      )
      updated += rowCount
    }
    await client.query('COMMIT')
    console.log(`\nUpdated ${updated} shipment(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
