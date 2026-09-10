#!/usr/bin/env node
'use strict'

/**
 * The last $39.99 between order value and payments, settled on the owner's word.
 *
 *   Ricardo Malia  PAY-2026-0125  $40, 29 August — no order, no invoice. The
 *                  owner says it should not be there, so it goes (copied to
 *                  zz_deleted_payments_backup first).
 *
 *   Walby Vellon   ORD-2026-0019 is $93. The payment reads $92.99 because the
 *                  processor fee took the cent, so it is recorded gross: $93
 *                  with a $5.80 fee. What reached the bank, $87.20, is unchanged.
 *                  Its invoice WVE-0019 said $103: every line carried the
 *                  order's old $93 as its amount and shipping went on top. The
 *                  lines now match the order's own — $83 of transfers plus $10
 *                  shipping, which is $93.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v).toFixed(2))

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // 1. Ricardo's $40
    const { rows: [r] } = await client.query(
      `SELECT p.id, p.payment_number, p.amount, p.fee_amount, p.order_id, p.invoice_id, c.name,
              (SELECT COUNT(*)::int FROM payment_allocations a WHERE a.payment_id = p.id) AS allocs
         FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.payment_number = 'PAY-2026-0125'`)
    if (!r) throw new Error('PAY-2026-0125 not found')
    if (money(r.amount) !== 40 || r.name !== 'Ricardo Malia' || r.order_id || r.invoice_id || r.allocs ||
        Number(r.fee_amount) !== 0) {
      throw new Error(`PAY-2026-0125 is not the loose $40 of Ricardo Malia (${r.amount}, ${r.name}) — refusing`)
    }
    console.log(`1. ${r.payment_number}  $${r.amount}  ${r.name}  — removed`)

    // 2. Walby's order, payment and invoice
    const { rows: [w] } = await client.query(
      `SELECT o.id, o.order_number, o.total, o.subtotal, o.shipping_charges, o.invoice_id,
              i.invoice_number, i.subtotal AS inv_subtotal, i.shipping_charges AS inv_shipping, i.total AS inv_total,
              p.id AS pay_id, p.payment_number, p.amount, p.fee_amount
         FROM orders o
         JOIN invoices i ON i.id = o.invoice_id
         JOIN payments p ON p.order_id = o.id
        WHERE o.order_number = 'ORD-2026-0019' AND o.deleted_at IS NULL`)
    if (!w) throw new Error('ORD-2026-0019 with its invoice and payment not found')
    if (money(w.total) !== 93 || money(w.subtotal) !== 83 || money(w.shipping_charges) !== 10) {
      throw new Error(`ORD-2026-0019 is ${w.subtotal} + ${w.shipping_charges} = ${w.total}, not 83 + 10 = 93 — refusing`)
    }
    if (money(w.amount) !== 92.99 || money(w.fee_amount) !== 5.79) {
      throw new Error(`${w.payment_number} is ${w.amount} with fee ${w.fee_amount}, not 92.99 / 5.79 — refusing`)
    }
    if (money(w.inv_total) !== 103) throw new Error(`${w.invoice_number} is ${w.inv_total}, not 103 — refusing`)

    const { rows: lines } = await client.query(
      `SELECT sort_order, qty, unit_price, amount FROM order_items_dtf WHERE order_id = $1 ORDER BY sort_order`, [w.id])
    const linesSum = money(lines.reduce((s, l) => s + Number(l.amount), 0))
    if (linesSum !== 83) throw new Error(`order lines add to ${linesSum}, not 83`)

    console.log(`2. ${w.payment_number}  $${w.amount} fee $${w.fee_amount}  ->  $93.00 fee $5.80 (net stays $87.20)`)
    console.log(`   ${w.invoice_number}  $${w.inv_subtotal} + $${w.inv_shipping} = $${w.inv_total}  ->  $83.00 + $10.00 = $93.00`)
    for (const l of lines) console.log(`      line ${l.sort_order}: ${l.qty} x ${l.unit_price} = ${l.amount}`)

    // The invoice comes right first, so the payment trigger settles it against $93.
    for (const l of lines) {
      await client.query(
        `UPDATE invoice_items SET qty = $3, unit_price = $4::numeric, amount = $5::numeric
          WHERE invoice_id = $1 AND sort_order = $2`, [w.invoice_id, l.sort_order, l.qty, l.unit_price, l.amount])
      await client.query(
        `UPDATE invoice_items_dtf SET quantity = $3, unit_rate = $4::numeric, line_amount = $5::numeric
          WHERE invoice_id = $1 AND sort_order = $2`, [w.invoice_id, l.sort_order, l.qty, l.unit_price, l.amount])
    }
    await client.query(
      `UPDATE invoices SET subtotal = 83, shipping_charges = 10, total = 93, updated_at = NOW() WHERE id = $1`,
      [w.invoice_id])

    await client.query(
      `UPDATE payments
          SET amount = 93.00, fee_amount = 5.80,
              notes = COALESCE(notes || ' | ', '') || 'Order is $93; the processor fee took the cent',
              updated_at = NOW()
        WHERE id = $1`, [w.pay_id])

    await client.query(
      `UPDATE invoices SET status = 'Paid', updated_at = NOW() WHERE id = $1 AND balance_due = 0`, [w.invoice_id])
    await client.query(
      `UPDATE orders SET amount_paid = 93, payment_status = 'Paid', updated_at = NOW() WHERE id = $1`, [w.id])

    // Ricardo's row goes last, after its copy is safe.
    await client.query(
      `INSERT INTO zz_deleted_payments_backup
         (id, invoice_id, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
          payment_date, payment_number, customer_id, order_id, customer_name, status, updated_at,
          received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
          sender_account_last4, sender_reference, fee_amount, net_amount, transaction_id, deleted_at_backup)
       SELECT id, invoice_id, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
              payment_date, payment_number, customer_id, order_id, customer_name, status, updated_at,
              received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
              sender_account_last4, sender_reference, fee_amount, net_amount, transaction_id, NOW()
         FROM payments WHERE id = $1`, [r.id])
    await client.query(`DELETE FROM payments WHERE id = $1`, [r.id])

    const { rows: [after] } = await client.query(
      `SELECT i.invoice_number, i.total, i.amount_paid, i.balance_due, i.status,
              p.payment_number, p.amount, p.fee_amount, p.net_amount
         FROM invoices i JOIN payments p ON p.id = $2 WHERE i.id = $1`, [w.invoice_id, w.pay_id])
    console.log(`\n   ${after.invoice_number}  $${after.total}  paid $${after.amount_paid}  due $${after.balance_due}  ${after.status}`)
    console.log(`   ${after.payment_number}  $${after.amount}  fee $${after.fee_amount}  net $${after.net_amount}`)

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
