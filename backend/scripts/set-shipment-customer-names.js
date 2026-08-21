#!/usr/bin/env node
/**
 * Data fix — set the customer name on the 3 UPS shipments the owner identified
 * by tracking ID (from an external UPS sheet). Only the name is known, so only
 * customer_name + recipient_name are set; city/state/zip and address are left
 * untouched (no street address was provided).
 *
 * The 3 "red / invalid" tracking IDs from the sheet are intentionally excluded.
 *
 * Usage:
 *   node backend/scripts/set-shipment-customer-names.js            (dry-run)
 *   node backend/scripts/set-shipment-customer-names.js --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const UPDATES = [
  { tracking: '1Z2B14J81324360880', name: 'Lashanniya Saick' }, // Cincinnati, OH 45251
  { tracking: '1Z2B14J80207937104', name: 'Tina Grant' },       // Cordele, GA 31015
  { tracking: '1Z2B14J80304559213', name: 'Jaculyn Sam' },      // Long Beach, CA 90804
]

const sqlLit = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const rollback = ['-- Rollback for set-shipment-customer-names.js', 'BEGIN;']
    let planned = 0
    for (const u of UPDATES) {
      const { rows } = await client.query(
        `SELECT id, tracking_number, customer_name, recipient_name,
                ship_to_city, ship_to_state, ship_to_postal_code
           FROM shipments WHERE tracking_number = $1`, [u.tracking])
      if (!rows.length) { console.log(`  MISS  ${u.tracking} — not in shipments`); continue }
      for (const r of rows) {
        planned++
        console.log(`  ${u.tracking}  ->  ${u.name}  | ${r.ship_to_city}, ${r.ship_to_state} ${r.ship_to_postal_code}`)
        rollback.push(
          `UPDATE shipments SET customer_name=${sqlLit(r.customer_name)}, ` +
          `recipient_name=${sqlLit(r.recipient_name)} WHERE id=${sqlLit(r.id)};`)
      }
    }
    rollback.push('COMMIT;')

    if (!APPLY) { console.log(`\nDRY RUN — ${planned} row(s) would update. Re-run with --apply.`); return }

    const outDir = path.join(__dirname, '..', '..', 'exports')
    fs.mkdirSync(outDir, { recursive: true })
    const rbPath = path.join(outDir, 'rollback-set-shipment-names.sql')
    fs.writeFileSync(rbPath, rollback.join('\n') + '\n')
    console.log(`\nRollback written: ${rbPath}`)

    await client.query('BEGIN')
    let updated = 0
    for (const u of UPDATES) {
      const res = await client.query(
        `UPDATE shipments SET customer_name = $2, recipient_name = $2, updated_at = NOW()
          WHERE tracking_number = $1`, [u.tracking, u.name])
      updated += res.rowCount
    }
    await client.query('COMMIT')
    console.log(`Updated ${updated} shipment row(s).`)
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* no tx */ }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
