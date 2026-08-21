#!/usr/bin/env node
/**
 * Data fix — link the UPS shipments that matched a known customer (by exact
 * destination ZIP) to that customer, and fill the full ship-to street address.
 *
 * The shipments carried only destination city/state/zip from Shippo tracking
 * (UPS hides the street). For the rows whose destination ZIP matches exactly
 * one customer on file, we set (on public.shipments):
 *   customer_name  -> the customer's account name (drives the Shipments list)
 *   recipient_name -> ship-to / attn contact
 *   address        -> the clean street line
 * city / state / postal_code are already correct and are left untouched.
 * (public.shipments has no customer_id column; the list view resolves the name
 *  from customer_name first, so setting that is exactly what the UI reads.)
 *
 * Only the 5 confidently-matched rows are updated. Unmatched tracking numbers
 * are deliberately left as-is (no guessing).
 *
 * Usage:
 *   node backend/scripts/link-shipments-to-customers.js            (dry-run)
 *   node backend/scripts/link-shipments-to-customers.js --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// Explicit, reviewed values — no fuzzy logic at write time.
// customer_number is a comment aid only; it is not written.
const UPDATES = [
  { tracking: '1Z2B14J80220062202', customer_name: 'Christopher Ferguson', recipient_name: 'Christopher Ferguson', address: '1205 E 93rd Street' }, // CUST-DTF-2026-019
  { tracking: '1Z2B14J80238138642', customer_name: 'Gaspar Erosa',         recipient_name: 'Gaspar Erosa',         address: '2507 Magdalena Ave' },  // CUST-DTF-JJ-2026-007
  { tracking: '1Z2B14J80315800832', customer_name: 'I Teach Korean',       recipient_name: 'Sam Yoo',              address: '17003 Jeanette Ave' },   // CUST-APP-2026-001
  { tracking: '1Z2B14J81304527649', customer_name: 'Luxe Gang',            recipient_name: 'S. Jones',             address: '908 Highland Ave' },     // CUST-APP-2026-002
  { tracking: '1Z2B14J81305827064', customer_name: 'Luxe Gang',            recipient_name: 'S. Jones',             address: '908 Highland Ave' },     // CUST-APP-2026-002
]

const sqlLit = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const rollback = ['-- Rollback for link-shipments-to-customers.js', 'BEGIN;']
    let planned = 0

    for (const u of UPDATES) {
      const { rows } = await client.query(
        `SELECT id, tracking_number, customer_name, recipient_name, address,
                ship_to_city, ship_to_state, ship_to_postal_code
           FROM shipments WHERE tracking_number = $1`,
        [u.tracking]
      )
      if (!rows.length) { console.log(`  MISS  ${u.tracking} — not in shipments, skipped`); continue }
      for (const r of rows) {
        planned++
        console.log(`  ${u.tracking}  ->  ${u.customer_name} (attn ${u.recipient_name}) | ${u.address}, ${r.ship_to_city}, ${r.ship_to_state} ${r.ship_to_postal_code}`)
        rollback.push(
          `UPDATE shipments SET customer_name=${sqlLit(r.customer_name)}, ` +
          `recipient_name=${sqlLit(r.recipient_name)}, address=${sqlLit(r.address)} ` +
          `WHERE id=${sqlLit(r.id)};`
        )
      }
    }
    rollback.push('COMMIT;')

    if (!APPLY) { console.log(`\nDRY RUN — ${planned} row(s) would update. Re-run with --apply.`); return }

    const outDir = path.join(__dirname, '..', '..', 'exports')
    fs.mkdirSync(outDir, { recursive: true })
    const rbPath = path.join(outDir, 'rollback-link-shipments.sql')
    fs.writeFileSync(rbPath, rollback.join('\n') + '\n')
    console.log(`\nRollback written: ${rbPath}`)

    await client.query('BEGIN')
    let updated = 0
    for (const u of UPDATES) {
      const res = await client.query(
        `UPDATE shipments
            SET customer_name = $2, recipient_name = $3, address = $4, updated_at = NOW()
          WHERE tracking_number = $1`,
        [u.tracking, u.customer_name, u.recipient_name, u.address]
      )
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
