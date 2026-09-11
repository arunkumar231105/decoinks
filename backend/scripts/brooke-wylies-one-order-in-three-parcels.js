#!/usr/bin/env node
'use strict'

/**
 * Brooke Wylie's 1 September job is one sales order, not three.
 *
 * The book carried ORD-2026-0127, ORD-2026-0129 and ORD-2026-0131, each $250 on
 * the same day, because the DIGI store recorded three orders within 22 minutes
 * and each came in as its own row. The owner's word: it is one order of $250,
 * and the shipment went out split into three parcels.
 *
 * So the earliest number keeps the job. All 100 shirts and all three parcels
 * move onto it, and the order stays at $250 — the lines are repriced across
 * that total rather than dropped, so what was actually made and posted is still
 * written down.
 *
 * WHAT THIS LEAVES BEHIND, on purpose: the other two $250 payments. They are
 * real rows against real DIGI store references, and deleting money is not
 * something to do on the way past — they are reported at the end and left for
 * the owner. The two orders and their invoices are soft-deleted with their
 * numbers parked, so renumbering can close the gap afterwards.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const KEEP = 'ORD-2026-0127'
const DROP = ['ORD-2026-0129', 'ORD-2026-0131']
const TOTAL = 250

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: all } = await client.query(
      `SELECT o.id, o.order_number, o.total, o.invoice_id, i.invoice_number,
              (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel a WHERE a.order_id = o.id) AS qty,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels,
              (SELECT p.payment_number FROM payments p WHERE p.order_id = o.id LIMIT 1) AS payment
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE o.order_number = ANY($1) AND o.deleted_at IS NULL
        ORDER BY o.order_number`, [[KEEP, ...DROP]])

    if (all.length !== 1 + DROP.length) throw new Error('one of the three orders is missing')
    const keep = all.find(o => o.order_number === KEEP)
    const drop = all.filter(o => o.order_number !== KEEP)

    const totalQty = all.reduce((s, o) => s + Number(o.qty), 0)
    const unit = Number((TOTAL / totalQty).toFixed(4))

    console.log('Keeping:')
    console.log(`   ${keep.order_number}  ${keep.invoice_number}  ${keep.qty} shirts  ${keep.parcels} parcel(s)  payment ${keep.payment ?? '—'}`)
    console.log('Folding in:')
    for (const d of drop) {
      console.log(`   ${d.order_number}  ${d.invoice_number}  ${d.qty} shirts  ${d.parcels} parcel(s)  payment ${d.payment ?? '—'}`)
    }
    console.log(`\n   -> ${keep.order_number}: ${totalQty} shirts, $${TOTAL.toFixed(2)} (lines repriced to $${unit} each)`)

    if (!APPLY) {
      await client.query('ROLLBACK')
      console.log('\nNothing written. Re-run with --apply.')
      return
    }

    for (const d of drop) {
      // The shirts and the parcels belong to the job, so they follow it.
      await client.query(
        `UPDATE order_items_apparel SET order_id = $2 WHERE order_id = $1`, [d.id, keep.id])
      await client.query(
        `UPDATE shipments SET order_id = $2, updated_at = NOW()
          WHERE order_id = $1 AND deleted_at IS NULL`, [d.id, keep.id])
      // The payment is released rather than moved: one order takes one payment,
      // and the surviving order already has its own.
      await client.query(
        `UPDATE payments SET order_id = NULL, updated_at = NOW() WHERE order_id = $1`, [d.id])

      // Numbers are parked so renumbering can reuse them. The unique indexes
      // cover soft-deleted rows too, so a number left on a dead row blocks it.
      await client.query(
        `UPDATE orders SET deleted_at = NOW(), order_number = 'D-' || order_number,
                           notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW()
          WHERE id = $1`,
        [d.id, `Folded into ${keep.order_number} — one job the DIGI store recorded three times.`])
      if (d.invoice_id) {
        await client.query(
          `UPDATE invoices SET deleted_at = NOW(), invoice_number = 'D-' || invoice_number,
                               updated_at = NOW() WHERE id = $1`, [d.invoice_id])
      }
    }

    const { rows: lines } = await client.query(
      `SELECT id, qty FROM order_items_apparel WHERE order_id = $1 ORDER BY sort_order, id`, [keep.id])
    for (const l of lines) {
      await client.query(
        // $2 is read as numeric(12,4) by unit_price and as ROUND's numeric
        // argument, and Postgres will not settle on one type for it unless it
        // is told — "inconsistent types deduced for parameter $2".
        `UPDATE order_items_apparel
            SET unit_price = $2::numeric, amount = ROUND($2::numeric * qty, 2)
          WHERE id = $1`,
        [l.id, unit])
    }
    // The last line carries whatever the rounding left over, so the lines add up
    // to the order rather than to a cent either side of it.
    const { rows: sum } = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM order_items_apparel WHERE order_id = $1`, [keep.id])
    const drift = Number((TOTAL - Number(sum[0].s)).toFixed(2))
    if (drift !== 0 && lines.length) {
      await client.query(
        `UPDATE order_items_apparel SET amount = amount + $2 WHERE id = $1`,
        [lines[lines.length - 1].id, drift])
    }

    await client.query(
      `UPDATE orders SET subtotal = $2::numeric, total = $2::numeric, updated_at = NOW() WHERE id = $1`, [keep.id, TOTAL])
    if (keep.invoice_id) {
      await client.query(
        `UPDATE invoices SET subtotal = $2::numeric, total = $2::numeric, updated_at = NOW() WHERE id = $1`,
        [keep.invoice_id, TOTAL])
    }

    await client.query('COMMIT')
    console.log('\nWritten.')

    const { rows: after } = await pool.query(
      `SELECT o.order_number, o.total, i.invoice_number, i.total AS invoice_total,
              (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel a WHERE a.order_id = o.id) AS qty,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels,
              (SELECT p.payment_number || ' $' || p.amount FROM payments p WHERE p.order_id = o.id LIMIT 1) AS payment
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`, [keep.id])
    const r = after[0]
    console.log(`\n   ${r.order_number}  $${r.total}  ${r.qty} shirts  ${r.parcels} parcels  ${r.invoice_number} $${r.invoice_total}  ${r.payment}`)

    const { rows: loose } = await pool.query(
      `SELECT p.payment_number, p.amount, left(p.notes, 46) AS notes
         FROM payments p JOIN customers c ON c.id = p.customer_id
        WHERE c.name ILIKE '%brooke%wylie%' AND p.order_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM payment_allocations a
                           WHERE a.payment_id = p.id AND a.order_id IS NOT NULL)
        ORDER BY p.payment_number`)
    console.log('\nLeft with no order — your call, nothing was deleted:')
    for (const l of loose) console.log(`   ${l.payment_number}  $${l.amount}  ${l.notes ?? ''}`)

    console.log('\nOrder and invoice numbering now has gaps — run:')
    console.log('   node scripts/renumber-documents-by-date.js --only=orders --apply')
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
