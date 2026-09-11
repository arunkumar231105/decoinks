#!/usr/bin/env node
'use strict'

/**
 * ORD-2026-0073 (Robert Farrar) was dated 31 July, the day the money came in,
 * but the job began on 27 July: that is the date of its invoice RFA-0069 and of
 * its purchase order PO-2026-0078. Dated by the payment, the order sat four
 * days after the PO raised for it — a PO before its own order.
 *
 * The order takes the invoice's date. Renumbering the orders by date
 * afterwards puts it in its place (renumber-documents-by-date.js --only=orders).
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
    const { rows: [o] } = await client.query(`
      SELECT o.id, o.order_number, o.order_date::text AS order_date, i.invoice_number, i.issue_date::text AS issue_date,
             (SELECT string_agg(po.po_number || ' ' || po.order_date::text, ', ') FROM purchase_orders po
               WHERE po.order_id = o.id AND po.deleted_at IS NULL) AS pos,
             (SELECT MIN(po.order_date)::text FROM purchase_orders po WHERE po.order_id = o.id AND po.deleted_at IS NULL) AS first_po
        FROM orders o JOIN invoices i ON i.id = o.invoice_id
       WHERE o.order_number = 'ORD-2026-0073' AND o.deleted_at IS NULL`)
    if (!o || o.order_date !== '2026-07-31' || o.issue_date !== '2026-07-27' || o.first_po !== '2026-07-27') {
      throw new Error(`ORD-2026-0073 is not as expected: ${JSON.stringify(o)}`)
    }
    console.log(`  ${o.order_number}  ${o.order_date} -> ${o.issue_date}   (invoice ${o.invoice_number} ${o.issue_date}; PO ${o.pos})`)
    await client.query(`UPDATE orders SET order_date = $2::date, updated_at = NOW() WHERE id = $1`, [o.id, o.issue_date])

    const { rows: [c] } = await client.query(`
      SELECT COUNT(*)::int AS n FROM purchase_orders po JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL AND po.order_date < o.order_date`)
    console.log(`\n   POs dated before their order: ${c.n}`)
    if (c.n) throw new Error('a PO is still dated before its order — rolled back')

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
