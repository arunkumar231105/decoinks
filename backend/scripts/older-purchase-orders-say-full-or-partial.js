#!/usr/bin/env node
'use strict'

/**
 * The purchase orders raised before Full/Partial existed say which they are.
 *
 * A purchase order is the only one on its sales order → it bought the whole
 * job, so it reads Full. Where a sales order was bought in more than one
 * purchase order, each of those reads Partial. A purchase order covering more
 * than one order (a gangsheet run) counts as partial if any of its orders is
 * shared with another PO.
 *
 * Only the label is written: these purchase orders carry no line references, so
 * their pieces are not counted — that starts with the ones raised from now on.
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
      WITH covered AS (
        SELECT p.id AS po_id, o.id AS order_id
          FROM purchase_orders p
          JOIN orders o ON o.deleted_at IS NULL
           AND (o.id = p.order_id OR EXISTS (SELECT 1 FROM po_orders x WHERE x.po_id = p.id AND x.order_id = o.id))
         WHERE p.deleted_at IS NULL
      ),
      per_order AS (
        SELECT order_id, COUNT(DISTINCT po_id)::int AS pos FROM covered GROUP BY order_id
      )
      UPDATE purchase_orders p
         SET po_scope = CASE WHEN EXISTS (
                               SELECT 1 FROM covered c JOIN per_order po ON po.order_id = c.order_id
                                WHERE c.po_id = p.id AND po.pos > 1)
                             THEN 'partial' ELSE 'full' END,
             updated_at = NOW()
       WHERE p.deleted_at IS NULL AND p.po_scope IS NULL
      RETURNING p.po_number, p.po_scope, (SELECT order_number FROM orders o WHERE o.id = p.order_id) AS order_number`)

    const partial = rows.filter(r => r.po_scope === 'partial')
    console.log(`   Full    ${rows.filter(r => r.po_scope === 'full').length}`)
    console.log(`   Partial ${partial.length}${partial.length ? ':' : ''}`)
    for (const r of partial) console.log(`      ${r.po_number}  ${r.order_number ?? '—'}`)

    const { rows: [left] } = await client.query(
      `SELECT COUNT(*)::int AS blank FROM purchase_orders WHERE deleted_at IS NULL AND po_scope IS NULL`)
    console.log(`\n   still without a label: ${left.blank}`)

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
