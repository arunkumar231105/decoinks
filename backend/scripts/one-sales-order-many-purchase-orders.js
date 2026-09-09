#!/usr/bin/env node
'use strict'

/**
 * One sales order, several purchase orders, several parcels.
 *
 * That is how these jobs actually run: the customer places one order, the shop
 * cuts a purchase order to the factory for each batch, and each batch goes out
 * as its own parcel. The DIGI store recorded each batch as a separate order, so
 * the book grew one sales order per batch instead — three rows where there is
 * one job, and the customer's order value split three ways.
 *
 *   Brooke Wylie   ORD-2026-0127   $750   100 shirts   3 POs   3 parcels
 *   Jody Roy       ORD-2026-0126   $780   100 shirts   3 POs   3 parcels
 *
 * Brooke's order was already merged; its other two purchase orders were left
 * behind on the folded rows, which is why the No of PO column read 1. They are
 * brought across. Jody Roy's is folded here in full.
 *
 * Nothing is thrown away. The line items, the purchase orders and the parcels
 * all move to the surviving order, and every payment is spread over it through
 * payment_allocations — including the one already holding order_id, because
 * recalc_invoice_paid stops counting a payment through its own invoice the
 * moment it has any allocation.
 *
 * Idempotent. Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const JOBS = [
  // Already merged; only its purchase orders were left behind.
  { keep: 'ORD-2026-0127', fold: ['D-ORD-2026-0129', 'D-ORD-2026-0131'], total: 750 },
  { keep: 'ORD-2026-0126', fold: ['ORD-2026-0129', 'ORD-2026-0130'], total: 780 },
]

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    for (const job of JOBS) {
      const { rows: keepRows } = await client.query(
        `SELECT o.id, o.order_number, o.total, o.customer_id, o.invoice_id, i.invoice_number
           FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
          WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [job.keep])
      if (!keepRows[0]) throw new Error(`${job.keep} not found`)
      const keep = keepRows[0]

      const { rows: fold } = await client.query(
        `SELECT id, order_number, invoice_id, deleted_at IS NOT NULL AS already_gone
           FROM orders WHERE order_number = ANY($1)`, [job.fold])

      console.log(`${keep.order_number}  ->  $${job.total.toFixed(2)}`)

      for (const f of fold) {
        const { rows: has } = await client.query(
          `SELECT (SELECT COUNT(*) FROM order_items_apparel a WHERE a.order_id = $1) AS items,
                  (SELECT COUNT(*) FROM purchase_orders po WHERE po.order_id = $1 AND po.deleted_at IS NULL) AS pos,
                  (SELECT COUNT(*) FROM shipments s WHERE s.order_id = $1 AND s.deleted_at IS NULL) AS parcels`,
          [f.id])
        console.log(`   from ${f.order_number}${f.already_gone ? ' (already folded)' : ''}: ` +
                    `${has[0].items} item line(s), ${has[0].pos} PO(s), ${has[0].parcels} parcel(s)`)

        if (!APPLY) continue

        await client.query(`UPDATE order_items_apparel SET order_id = $2 WHERE order_id = $1`, [f.id, keep.id])
        await client.query(
          `UPDATE purchase_orders SET order_id = $2, updated_at = NOW()
            WHERE order_id = $1 AND deleted_at IS NULL`, [f.id, keep.id])
        await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW()
            WHERE order_id = $1 AND deleted_at IS NULL`, [f.id, keep.id])
        // Released rather than moved: one order takes one payment, and every
        // payment is re-attached below as an allocation instead.
        await client.query(`UPDATE payments SET order_id = NULL, updated_at = NOW() WHERE order_id = $1`, [f.id])

        if (!f.already_gone) {
          // The number is parked because the unique indexes cover soft-deleted
          // rows too, so a number left on a dead row blocks renumbering. The
          // row's own id goes on the end: a plain "D-" prefix collides the
          // moment two customers' folded orders held the same number, which is
          // exactly what happened here — D-ORD-2026-0129 was already taken.
          await client.query(
            `UPDATE orders
                SET deleted_at = NOW(),
                    order_number = 'D-' || order_number || '-' || left(replace(id::text, '-', ''), 4),
                    notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW()
              WHERE id = $1`,
            [f.id, `Folded into ${keep.order_number} — one job the DIGI store recorded as separate orders.`])
          if (f.invoice_id) {
            await client.query(
              `UPDATE invoices
                  SET deleted_at = NOW(),
                      invoice_number = 'D-' || invoice_number || '-' || left(replace(id::text, '-', ''), 4),
                      updated_at = NOW()
                WHERE id = $1`, [f.invoice_id])
          }
        }
      }

      if (!APPLY) { console.log(); continue }

      // Reprice the lines across the order's real total.
      const { rows: lines } = await client.query(
        `SELECT id, qty FROM order_items_apparel WHERE order_id = $1 ORDER BY sort_order, id`, [keep.id])
      const qty = lines.reduce((s, l) => s + Number(l.qty), 0)
      if (qty > 0) {
        const unit = Number((job.total / qty).toFixed(4))
        for (const l of lines) {
          await client.query(
            `UPDATE order_items_apparel
                SET unit_price = $2::numeric, amount = ROUND($2::numeric * qty, 2)
              WHERE id = $1`, [l.id, unit])
        }
        const { rows: sum } = await client.query(
          `SELECT COALESCE(SUM(amount),0) AS s FROM order_items_apparel WHERE order_id = $1`, [keep.id])
        const drift = Number((job.total - Number(sum[0].s)).toFixed(2))
        if (drift !== 0) {
          await client.query(
            `UPDATE order_items_apparel SET amount = amount + $2 WHERE id = $1`,
            [lines[lines.length - 1].id, drift])
        }
      }

      await client.query(
        `UPDATE orders SET subtotal = $2::numeric, shipping_charges = 0, total = $2::numeric, updated_at = NOW()
          WHERE id = $1`, [keep.id, job.total])
      if (keep.invoice_id) {
        await client.query(
          `UPDATE invoices SET subtotal = $2::numeric, shipping_charges = 0, total = $2::numeric, updated_at = NOW()
            WHERE id = $1`, [keep.invoice_id, job.total])
      }

      // Every payment this customer has that is not already spoken for by
      // another order belongs to this job.
      const { rows: pays } = await client.query(
        `SELECT p.id, p.payment_number, p.amount
           FROM payments p
          WHERE p.customer_id = $1
            AND (p.order_id IS NULL OR p.order_id = $2)
            AND NOT EXISTS (SELECT 1 FROM payment_allocations a
                             WHERE a.payment_id = p.id AND a.order_id IS DISTINCT FROM $2)
          ORDER BY p.payment_number`, [keep.customer_id, keep.id])

      let allocated = 0
      for (const p of pays) {
        if (allocated + Number(p.amount) > job.total + 0.01) continue
        await client.query(
          `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
          [p.id, keep.id, keep.invoice_id, p.amount,
           'One job the DIGI store took as separate orders'])
        await client.query(
          `UPDATE payments SET invoice_id = COALESCE(invoice_id, $2), updated_at = NOW() WHERE id = $1`,
          [p.id, keep.invoice_id])
        allocated += Number(p.amount)
      }
      console.log(`   payments spread over it: $${allocated.toFixed(2)} of $${job.total.toFixed(2)}\n`)
    }

    if (APPLY) { await client.query('COMMIT'); console.log('Written.\n') }
    else { await client.query('ROLLBACK'); console.log('Nothing written. Re-run with --apply.'); return }

    const { rows: after } = await pool.query(
      `SELECT o.order_number, o.total, i.invoice_number, i.amount_paid, i.balance_due, i.status,
              (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel a WHERE a.order_id = o.id) AS shirts,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.order_id = o.id AND po.deleted_at IS NULL) AS pos,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels,
              (SELECT COUNT(*) FROM payment_allocations al WHERE al.order_id = o.id) AS payments
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE o.order_number = ANY($1)`, [JOBS.map(j => j.keep)])
    for (const r of after) {
      console.log(`   ${r.order_number}  $${r.total}  ${r.shirts} shirts  ${r.pos} POs  ${r.parcels} parcels  ` +
                  `${r.payments} payments`)
      console.log(`      ${r.invoice_number}  paid $${r.amount_paid}  due $${r.balance_due}  ${r.status}`)
    }
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
