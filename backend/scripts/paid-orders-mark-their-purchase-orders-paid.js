#!/usr/bin/env node
'use strict'

/**
 * On the owner's word: a purchase order behind a paid sales order is paid.
 *
 * The two payment statuses are different events — the customer paying the
 * shop, and the shop paying the factory — and the owner has said the factory
 * is paid for the work the customer has paid for. So every live PO on a Paid
 * sales order that still reads Unpaid is marked Paid. Nothing else about the
 * PO changes.
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

    // Two orders read Partial although the ledger holds their whole total and
    // their invoice is Paid (ORD-2026-0095 said $45.99 of $46). They are Paid.
    const { rows: fixedOrders } = await client.query(`
      UPDATE orders o SET payment_status = 'Paid', amount_paid = o.total, updated_at = NOW()
       WHERE o.deleted_at IS NULL AND o.payment_status <> 'Paid'
         AND COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id
                        AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)), 0)
           + COALESCE((SELECT SUM(a.allocated_amount) FROM payment_allocations a WHERE a.order_id = o.id), 0) >= o.total - 0.001
      RETURNING o.order_number`)
    console.log(`Orders fully paid by the ledger but not marked Paid: ${fixedOrders.map(r => r.order_number).join(', ') || 'none'}\n`)

    const { rows } = await client.query(`
      UPDATE purchase_orders po SET payment_status = 'Paid', updated_at = NOW()
        FROM orders o
       WHERE o.id = po.order_id AND o.deleted_at IS NULL AND o.payment_status = 'Paid'
         AND po.deleted_at IS NULL AND COALESCE(po.payment_status, 'Unpaid') <> 'Paid'
      RETURNING po.po_number, o.order_number, po.vendor_name, po.status::text AS status`)
    const byVendor = {}
    for (const r of rows) byVendor[r.vendor_name] = (byVendor[r.vendor_name] || 0) + 1
    console.log(`POs on paid orders marked Paid: ${rows.length}  (${Object.entries(byVendor).map(([v, n]) => `${v} ${n}`).join(', ')})`)
    console.log(`orders: ${[...new Set(rows.map(r => r.order_number))].sort().join(', ')}`)

    const { rows: [c] } = await client.query(`
      SELECT COUNT(*)::int AS left FROM purchase_orders po JOIN orders o ON o.id = po.order_id AND o.deleted_at IS NULL
       WHERE po.deleted_at IS NULL AND o.payment_status = 'Paid' AND COALESCE(po.payment_status, 'Unpaid') <> 'Paid'`)
    console.log(`\n   paid orders with an unpaid PO: ${c.left}`)

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
