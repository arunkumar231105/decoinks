#!/usr/bin/env node
'use strict'

/**
 * Every sales order has a purchase order behind it — on the owner's word, all
 * but Jody Roy's, entered today (the order paid by pi_3UEEXICFhJ2THmdS0C5HS9Ii).
 *
 * Same rules as the-two-orders-still-waiting-for-a-po.js: apparel goes to DIGI,
 * DTF to TSI Transfers as a gangsheet order; the figures are the sales
 * order's own; raised as Draft, because nobody has sent it to the factory yet.
 * Dated today, the day it is raised, so the PO series stays in date order.
 *
 * grand_total is written as well as total. That script left it at 0, which is
 * why PO-2026-0157 and PO-2026-0158 counted $0 in the PO Value card; those two
 * are put right here too.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const SKIP_PAID_BY = 'pi_3UEEXICFhJ2THmdS0C5HS9Ii'   // Jody Roy, 11 September

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
         AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.order_id = o.id AND po.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM po_orders x JOIN purchase_orders po ON po.id = x.po_id AND po.deleted_at IS NULL
                          WHERE x.order_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.transaction_id = $1)
       ORDER BY o.order_date, o.order_number`, [SKIP_PAID_BY])

    console.log(`Sales orders with no purchase order (Jody Roy's left out): ${waiting.length}\n`)
    const { rows: [n0] } = await client.query(
      `SELECT COALESCE(MAX(NULLIF(split_part(po_number, '-', 3), '')::INT), 0) AS n
         FROM purchase_orders WHERE po_number ~ '^PO-2026-[0-9]+$'`)
    let n = n0.n

    for (const o of waiting) {
      const vendor = VENDOR[o.order_type]
      if (!vendor) throw new Error(`${o.order_number}: order type "${o.order_type}" has no factory rule`)
      const { rows: sup } = await client.query(
        `SELECT id FROM suppliers WHERE name = $1 AND deleted_at IS NULL LIMIT 1`, [vendor.name])
      if (!sup[0]) throw new Error(`Supplier "${vendor.name}" not found`)
      const number = `PO-2026-${String(++n).padStart(4, '0')}`
      console.log(`  ${o.order_number}  ${(o.customer ?? '?').padEnd(20)} ${o.order_type.padEnd(8)} $${Number(o.total).toFixed(2).padStart(7)}` +
                  `  ->  ${number}  ${vendor.name}  Draft`)

      const { rows: [po] } = await client.query(
        `INSERT INTO purchase_orders
           (po_number, order_id, supplier_id, customer_id, vendor_name, po_type, status,
            order_date, subtotal, shipping_charge, total, grand_total, currency, shipping_address, notes,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Draft'::po_status,CURRENT_DATE,$7,$8,$9,$9,'USD',$10,$11,NOW(),NOW())
         RETURNING id`,
        [number, o.id, sup[0].id, o.customer_id, vendor.name, vendor.po_type,
         o.subtotal, o.shipping_charges ?? 0, o.total, o.shipping_address ?? null,
         `Raised for ${o.order_number}, which had no purchase order behind it.`])
      await client.query(
        `INSERT INTO po_orders (po_id, order_id, sort_order) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [po.id, o.id])
    }

    const { rowCount: fixed } = await client.query(
      `UPDATE purchase_orders SET grand_total = total, updated_at = NOW()
        WHERE deleted_at IS NULL AND COALESCE(grand_total, 0) = 0 AND total > 0`)
    console.log(`\nPOs whose grand_total was 0 put to their total: ${fixed}`)

    const { rows: [c] } = await client.query(
      `SELECT (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL)::int AS pos,
              to_char((SELECT SUM(grand_total) FROM purchase_orders WHERE deleted_at IS NULL), 'FM999,999.00') AS value,
              (SELECT string_agg(o.order_number, ', ') FROM orders o WHERE o.deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.order_id = o.id AND po.deleted_at IS NULL)) AS still_without`)
    console.log(`   POs ${c.pos}   PO value $${c.value}   SOs still without a PO: ${c.still_without ?? 'none'}`)

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
