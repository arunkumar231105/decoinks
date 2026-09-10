#!/usr/bin/env node
'use strict'

/**
 * One sales order, one payment — on the owner's word.
 *
 * Jody Roy's $780 job (ORD-2026-0126) and Brooke Wylie's $750 job
 * (ORD-2026-0127) were each ordered on the DIGI store as three orders, and so
 * were paid in three charges: 3 x $260 and 3 x $250. The orders were already
 * folded into one each; now the payments are too. The payment already holding
 * the order keeps its number and takes the whole amount; the other two are
 * removed (copied to zz_deleted_payments_backup first). All three DIGI store
 * references stay in the surviving payment's notes.
 *
 * Afterwards every sales order has exactly one payment.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v).toFixed(2))

const JOBS = [
  { order: 'ORD-2026-0126', who: 'Jody Roy', total: 780, each: 260 },
  { order: 'ORD-2026-0127', who: 'Brooke Wylie', total: 750, each: 250 },
]

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    for (const job of JOBS) {
      const { rows: [o] } = await client.query(
        `SELECT id, order_number, total, invoice_id, customer_id FROM orders
          WHERE order_number = $1 AND deleted_at IS NULL`, [job.order])
      if (!o || money(o.total) !== job.total) throw new Error(`${job.order}: not found at $${job.total}`)

      const { rows: pays } = await client.query(
        `SELECT p.* FROM payments p
          WHERE p.order_id = $1 OR p.id IN (SELECT payment_id FROM payment_allocations WHERE order_id = $1)
          ORDER BY (p.order_id = $1) DESC NULLS LAST, p.payment_number`, [o.id])
      const sum = money(pays.reduce((s, p) => s + Number(p.amount), 0))
      if (pays.length !== 3 || sum !== job.total || pays.some(p => money(p.amount) !== job.each)) {
        throw new Error(`${job.order}: expected 3 x $${job.each}, found ${pays.map(p => p.amount).join(' + ')}`)
      }
      if (pays.some(p => p.customer_id !== o.customer_id || p.transaction_id || Number(p.fee_amount))) {
        throw new Error(`${job.order}: a payment belongs to someone else or carries a Stripe id or fee — refusing`)
      }
      const { rows: [refs] } = await client.query(
        `SELECT (SELECT COUNT(*) FROM payment_links WHERE payment_id = ANY($1))::int
              + (SELECT COUNT(*) FROM refunds WHERE payment_id = ANY($1))::int AS n`, [pays.map(p => p.id)])
      if (refs.n) throw new Error(`${job.order}: a payment link or refund points at these payments — refusing`)

      const [keep, ...drop] = pays
      const digi = pays.map(p => (p.notes || '').match(/ORD-\d{12}/)?.[0]).filter(Boolean)
      console.log(`${job.who}  ${o.order_number}  $${job.total}`)
      console.log(`   ${pays.map(p => `${p.payment_number} $${p.amount}`).join(' + ')}  ->  ${keep.payment_number} $${job.total}`)

      await client.query(`DELETE FROM payment_allocations WHERE payment_id = ANY($1)`, [pays.map(p => p.id)])
      for (const d of drop) {
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
             FROM payments WHERE id = $1`, [d.id])
        await client.query(`DELETE FROM payments WHERE id = $1`, [d.id])
      }
      await client.query(
        `UPDATE payments
            SET amount = $2::numeric, order_id = $3, invoice_id = $4,
                notes = $5::text, updated_at = NOW()
          WHERE id = $1`,
        [keep.id, job.total, o.id, o.invoice_id,
         `DIGI store orders ${digi.join(', ')} — one job, paid in three charges of $${job.each}, booked as one payment`])
    }

    // ── Proof ─────────────────────────────────────────────────────────────
    const { rows: [c] } = await client.query(
      `SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL)::int AS so,
              (SELECT COUNT(*) FROM payments)::int AS pay,
              to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS so_total,
              to_char((SELECT SUM(amount) FROM payments), 'FM999,999.00') AS pay_total,
              (SELECT COUNT(*) FROM orders o WHERE o.deleted_at IS NULL AND (
                 SELECT COUNT(DISTINCT p.id) FROM payments p
                  WHERE p.order_id = o.id OR p.id IN (SELECT payment_id FROM payment_allocations WHERE order_id = o.id)) <> 1)::int AS so_not_one_payment,
              (SELECT COUNT(*) FROM payments p WHERE p.order_id IS NULL AND NOT EXISTS (
                 SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id AND a.order_id IS NOT NULL))::int AS pay_without_so,
              (SELECT COUNT(*) FROM orders o WHERE o.deleted_at IS NULL AND abs(o.total - COALESCE((
                 SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0)) > 0.001)::int AS so_amount_off,
              (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL AND amount_paid > total + 0.01)::int AS overpaid`)
    console.log(`\n   SOs ${c.so}   payments ${c.pay}   SO total $${c.so_total}   payments $${c.pay_total}`)
    console.log(`   SO without exactly one payment ${c.so_not_one_payment}   payment without SO ${c.pay_without_so}` +
                `   SO amount ≠ its payment ${c.so_amount_off}   overpaid invoices ${c.overpaid}`)

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
