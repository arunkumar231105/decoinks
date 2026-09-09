#!/usr/bin/env node
'use strict'

/**
 * Brooke Wylie's 1 September job is $750, and all three payments belong to it.
 *
 * It was folded into one order at $250, which left two $250 payments with no
 * home and took $500 off the book. The owner's word is that $750 is the right
 * figure — and it is the only one every other fact agrees with: 100 shirts went
 * out in three parcels weighing 55 lbs, three DIGI store orders were charged at
 * $250 each, and the shop's own price list puts 100+ pieces at around $7.50.
 *
 * So the order and its invoice go to $750, the lines are repriced across it,
 * and all three payments are spread over the job through payment_allocations.
 * Every share is written as an allocation, the one already holding order_id
 * included: recalc_invoice_paid stops counting a payment through its own
 * invoice the moment it has any allocation, so a share left implicit is lost.
 *
 * Idempotent. Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const ORDER = 'ORD-2026-0127'
const PAYMENTS = ['PAY-2026-0129', 'PAY-2026-0130', 'PAY-2026-0132']
const NOTE = 'One job the DIGI store took as three orders of $250'

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: ord } = await client.query(
      `SELECT o.id, o.order_number, o.total, o.invoice_id, i.invoice_number,
              (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel a WHERE a.order_id = o.id) AS qty,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [ORDER])
    if (!ord[0]) throw new Error(`${ORDER} not found`)
    const o = ord[0]

    const { rows: pays } = await client.query(
      `SELECT id, payment_number, amount, order_id FROM payments
        WHERE payment_number = ANY($1) ORDER BY payment_number`, [PAYMENTS])
    if (pays.length !== PAYMENTS.length) throw new Error('one of the payments is missing')

    const total = pays.reduce((s, p) => s + Number(p.amount), 0)
    const unit = Number((total / Number(o.qty)).toFixed(4))

    console.log(`${o.order_number}  ${o.invoice_number}  ${o.qty} shirts  ${o.parcels} parcels`)
    console.log(`   now   $${Number(o.total).toFixed(2)}`)
    for (const p of pays) console.log(`   ${p.payment_number}  $${Number(p.amount).toFixed(2)}${p.order_id ? '  (already on the order)' : ''}`)
    console.log(`   -> $${total.toFixed(2)}   lines repriced to $${unit} each`)

    // Every payment must be for this customer's job and the three must be the
    // whole of it. Repricing an order to a figure the money does not support is
    // the one thing this must never do.
    const { rows: check } = await client.query(
      `SELECT COUNT(*)::int AS wrong FROM payments p
        JOIN orders o2 ON o2.id = $2
        WHERE p.payment_number = ANY($1)
          AND (p.customer_id IS DISTINCT FROM o2.customer_id)`, [PAYMENTS, o.id])
    if (check[0].wrong > 0) throw new Error('one of these payments belongs to another customer')

    if (!APPLY) {
      await client.query('ROLLBACK')
      console.log('\nNothing written. Re-run with --apply.')
      return
    }

    const { rows: lines } = await client.query(
      `SELECT id, qty FROM order_items_apparel WHERE order_id = $1 ORDER BY sort_order, id`, [o.id])
    for (const l of lines) {
      await client.query(
        `UPDATE order_items_apparel
            SET unit_price = $2::numeric, amount = ROUND($2::numeric * qty, 2)
          WHERE id = $1`, [l.id, unit])
    }
    // The last line absorbs the rounding, so the lines add up to the order.
    const { rows: sum } = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS s FROM order_items_apparel WHERE order_id = $1`, [o.id])
    const drift = Number((total - Number(sum[0].s)).toFixed(2))
    if (drift !== 0 && lines.length) {
      await client.query(
        `UPDATE order_items_apparel SET amount = amount + $2 WHERE id = $1`,
        [lines[lines.length - 1].id, drift])
    }

    await client.query(
      `UPDATE orders SET subtotal = $2::numeric, total = $2::numeric, updated_at = NOW() WHERE id = $1`,
      [o.id, total])
    if (o.invoice_id) {
      await client.query(
        `UPDATE invoices SET subtotal = $2::numeric, total = $2::numeric, updated_at = NOW() WHERE id = $1`,
        [o.invoice_id, total])
    }

    for (const p of pays) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        [p.id, o.id, o.invoice_id, p.amount, NOTE])
      await client.query(
        `UPDATE payments SET invoice_id = COALESCE(invoice_id, $2), updated_at = NOW() WHERE id = $1`,
        [p.id, o.invoice_id])
    }

    await client.query('COMMIT')
    console.log('\nWritten.')

    const { rows: after } = await pool.query(
      `SELECT o.order_number, o.total, i.invoice_number, i.total AS inv_total,
              i.amount_paid, i.balance_due, i.status,
              (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel a WHERE a.order_id = o.id) AS qty,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels,
              (SELECT COUNT(*) FROM payment_allocations al WHERE al.order_id = o.id) AS allocations
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`, [o.id])
    const r = after[0]
    console.log(`\n   ${r.order_number}  $${r.total}  ${r.qty} shirts  ${r.parcels} parcels  ` +
                `${r.allocations} payments`)
    console.log(`   ${r.invoice_number}  $${r.inv_total}  paid $${r.amount_paid}  due $${r.balance_due}  ${r.status}`)
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
