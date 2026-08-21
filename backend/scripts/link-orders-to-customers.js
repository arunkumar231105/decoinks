#!/usr/bin/env node
/**
 * Data fix — set the missing customer_id on sales orders that clearly belong
 * to an existing customer (exact, unambiguous name match) but were imported
 * without the link.
 *
 * Only these 5 orders are touched. Each shipping_name matched exactly ONE
 * customer, so the mapping is unambiguous. No other columns change.
 *
 * Usage:
 *   node backend/scripts/link-orders-to-customers.js            (dry-run)
 *   node backend/scripts/link-orders-to-customers.js --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// order_number -> customer_id (verified: each name matches exactly one customer)
const LINKS = [
  { order: 'ORD-2026-0013', customer_id: '56c7b437-4258-b961-48b4-626ed52161b6', who: 'Alex M Cabrera' },
  { order: 'ORD-2026-0014', customer_id: '56c7b437-4258-b961-48b4-626ed52161b6', who: 'Alex M Cabrera' },
  { order: 'ORD-2026-0012', customer_id: '3388da48-af64-6741-8778-718aacf040f8', who: 'Darrel DeBree' },
  { order: 'ORD-2026-0015', customer_id: 'bce4e924-e8f6-394f-6b72-052f8524d246', who: 'Pam Guernsey' },
  { order: 'ORD-2026-0022', customer_id: 'bce4e924-e8f6-394f-6b72-052f8524d246', who: 'Pam Guernsey' },
]

const sqlLit = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const rollback = ['-- Rollback for link-orders-to-customers.js', 'BEGIN;']
    let planned = 0
    for (const l of LINKS) {
      const { rows } = await client.query(
        `SELECT id, order_number, customer_id, shipping_name FROM orders
          WHERE order_number = $1 AND deleted_at IS NULL`, [l.order])
      if (!rows.length) { console.log(`  MISS  ${l.order} — not found`); continue }
      const r = rows[0]
      // Safety: only fill when currently NULL, and never overwrite a different link.
      if (r.customer_id && r.customer_id !== l.customer_id) {
        console.log(`  SKIP  ${l.order} — already linked to a different customer (${r.customer_id})`); continue
      }
      planned++
      console.log(`  ${l.order}  ->  ${l.who}  (was: ${r.customer_id ?? 'NULL'})`)
      rollback.push(`UPDATE orders SET customer_id=${sqlLit(r.customer_id)} WHERE id=${sqlLit(r.id)};`)
    }
    rollback.push('COMMIT;')

    if (!APPLY) { console.log(`\nDRY RUN — ${planned} order(s) would link. Re-run with --apply.`); return }

    const outDir = path.join(__dirname, '..', '..', 'exports')
    fs.mkdirSync(outDir, { recursive: true })
    const rbPath = path.join(outDir, 'rollback-link-orders.sql')
    fs.writeFileSync(rbPath, rollback.join('\n') + '\n')
    console.log(`\nRollback written: ${rbPath}`)

    await client.query('BEGIN')
    let updated = 0
    for (const l of LINKS) {
      const res = await client.query(
        `UPDATE orders SET customer_id = $2, updated_at = NOW()
          WHERE order_number = $1 AND deleted_at IS NULL AND customer_id IS NULL`,
        [l.order, l.customer_id]
      )
      updated += res.rowCount
    }
    await client.query('COMMIT')
    console.log(`Linked ${updated} order(s).`)
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* no tx */ }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
