#!/usr/bin/env node
'use strict'

/**
 * Two sales orders have no purchase order behind them, so nothing has been
 * placed with a factory for work the shop has already taken money for.
 *
 * The vendor is not guessed. Apparel has gone to DIGI on every one of the 42
 * purchase orders raised since 30 June; TSI Apparel last saw an apparel job on
 * 11 June. DTF goes to TSI Transfers, all 93 of them. The figures are the sales
 * order's own — that is the rule the other 154 purchase orders already follow.
 *
 * They are raised as Draft, because that is what they are: nobody has sent them
 * to the factory yet. The order's process status will read "PO Issued" and move
 * on as the purchase order does.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

// order_type -> the factory it goes to, and what the purchase order is called.
const VENDOR = {
  apparel: { name: 'DIGI',          po_type: 'apparel' },
  dtf:     { name: 'TSI Transfers', po_type: 'gangsheet' },
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: waiting } = await client.query(`
      SELECT o.id, o.order_number, o.order_date, o.order_type::text AS order_type,
             o.subtotal, o.shipping_charges, o.total, o.customer_id, o.shipping_address,
             COALESCE(c.name, i.customer_name) AS customer
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN invoices  i ON i.id = o.invoice_id
       WHERE o.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM purchase_orders po
                          WHERE po.order_id = o.id AND po.deleted_at IS NULL)
       ORDER BY o.order_date, o.order_number`)

    console.log(`Sales orders with no purchase order: ${waiting.length}\n`)

    for (const o of waiting) {
      const vendor = VENDOR[o.order_type]
      if (!vendor) {
        console.log(`  ${o.order_number}  order type "${o.order_type}" has no factory rule — skipped`)
        continue
      }

      const { rows: sup } = await client.query(
        `SELECT id FROM suppliers WHERE name = $1 AND deleted_at IS NULL LIMIT 1`, [vendor.name])
      if (!sup[0]) throw new Error(`Supplier "${vendor.name}" not found`)

      const { rows: n } = await client.query(
        `SELECT COALESCE(MAX(NULLIF(split_part(po_number, '-', 3), '')::INT), 0) + 1 AS n
           FROM purchase_orders WHERE po_number LIKE 'PO-2026-%'`)
      const number = `PO-2026-${String(n[0].n).padStart(4, '0')}`

      console.log(`  ${o.order_number}  ${o.customer ?? '?'}  ${o.order_type}  $${Number(o.total).toFixed(2)}`)
      console.log(`      -> ${number}  ${vendor.name}  (${vendor.po_type})  ` +
                  `goods $${Number(o.subtotal).toFixed(2)} + shipping $${Number(o.shipping_charges ?? 0).toFixed(2)}  Draft`)

      if (!APPLY) continue

      await client.query(
        `INSERT INTO purchase_orders
           (po_number, order_id, supplier_id, customer_id, vendor_name, po_type, status,
            order_date, subtotal, shipping_charge, total, currency, shipping_address, notes,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Draft'::po_status,$7::date,$8,$9,$10,'USD',$11,$12,NOW(),NOW())`,
        [number, o.id, sup[0].id, o.customer_id, vendor.name, vendor.po_type,
         o.order_date, o.subtotal, o.shipping_charges ?? 0, o.total, o.shipping_address ?? null,
         `Raised for ${o.order_number}, which had no purchase order behind it.`])
    }

    if (APPLY) { await client.query('COMMIT'); console.log(`\nWritten: ${waiting.length} purchase order(s).`) }
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
