#!/usr/bin/env node
'use strict'

/**
 * The twelve purchase orders raised on 11 September for sales orders that had
 * none (every-sales-order-has-its-purchase-order.js) were dated the day they
 * were raised. On the owner's word a PO carries its order's date — every other
 * PO in the book already does — so each takes its sales order's date.
 * Renumbering the POs by date afterwards puts them in their place
 * (renumber-documents-by-date.js --only=purchase_orders).
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
      SELECT po.id, po.po_number, po.order_date::text AS po_date, o.order_number, o.order_date::text AS order_date
        FROM purchase_orders po JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL AND po.order_date > o.order_date
         AND po.notes LIKE 'Raised for %, which had no purchase order behind it.'
         AND po.created_at::date = DATE '2026-09-11'
       ORDER BY po.po_number`)
    if (rows.length !== 12) throw new Error(`expected the 12 POs raised on 11 September, found ${rows.length}`)
    for (const r of rows) {
      console.log(`  ${r.po_number}  ${r.po_date} -> ${r.order_date}   (${r.order_number})`)
      await client.query(`UPDATE purchase_orders SET order_date = $2::date, updated_at = NOW() WHERE id = $1`, [r.id, r.order_date])
    }
    const { rows: [c] } = await client.query(`
      SELECT COUNT(*) FILTER (WHERE po.order_date > o.order_date)::int AS after,
             COUNT(*) FILTER (WHERE po.order_date < o.order_date)::int AS before
        FROM purchase_orders po JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL`)
    console.log(`\n   POs dated after their order: ${c.after}   before: ${c.before}`)

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
