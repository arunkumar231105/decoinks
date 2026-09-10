#!/usr/bin/env node
'use strict'

/**
 * Alandos Forrest paid ORD-2026-0137 ($128) in two Stripe charges, and on the
 * owner's word they stay two payments: $118 on 4 September and $10 on
 * 7 September, each with its own intent, date and fee. They were booked as one
 * $128 payment earlier today; this undoes that.
 *
 * The $10 comes back from zz_deleted_payments_backup with its own id, so its
 * payment link points at it again. One order holds only one payment through
 * order_id (uq_payments_one_per_order), so the $10 reaches the order through
 * payment_allocations, as it did before the merge. The $118 keeps order_id and
 * is counted through its invoice.
 *
 * The restored row is given a placeholder number in the series and
 * renumber-documents-by-date.js puts it in its date place afterwards.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const FIRST = 'pi_3UBjGOCFhJ2THmdS1psDkxjy'   // $118, 4 September
const SECOND = 'pi_3UD4QwCFhJ2THmdS1tcXc6xe'  // $10, 7 September
const LINK = '47188d73-f438-49fc-9410-e02f72cbdb98'

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: [p] } = await client.query(`SELECT * FROM payments WHERE transaction_id = $1`, [FIRST])
    const { rows: [b] } = await client.query(
      `SELECT * FROM zz_deleted_payments_backup WHERE transaction_id = $1 ORDER BY deleted_at_backup DESC LIMIT 1`, [SECOND])
    const { rows: [taken] } = await client.query(`SELECT 1 FROM payments WHERE id = $1 OR transaction_id = $2`, [b?.id, SECOND])
    if (!p || Number(p.amount) !== 128 || p.reference_no !== SECOND) throw new Error('the merged $128 payment is not as expected')
    if (!b || Number(b.amount) !== 10 || taken) throw new Error('the $10 payment is not in the backup, or is already back')

    const { rows: [o] } = await client.query(
      `SELECT id, order_number, invoice_id, total FROM orders WHERE id = $1 AND deleted_at IS NULL`, [p.order_id])
    if (!o || Number(o.total) !== 128 || o.invoice_id !== p.invoice_id) throw new Error('the order is not the $128 one')

    const notes = String(p.notes).split(' | ')[0]
    console.log(`${o.order_number}  $128`)
    console.log(`   ${p.payment_number} $128 fee $${p.fee_amount}  ->  $118 fee $3.72  ${FIRST}  ${String(p.payment_date).slice(0, 10)}`)
    console.log(`   restored   $10 fee $${b.fee_amount}  ${SECOND}  2026-09-07`)

    await client.query(
      `UPDATE payments SET amount = 118, fee_amount = 3.72, reference_no = NULL, notes = $2::text, updated_at = NOW()
        WHERE id = $1`, [p.id, notes])
    await client.query(
      `INSERT INTO payments
         (id, invoice_id, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
          payment_date, payment_number, customer_id, order_id, customer_name, status, updated_at,
          received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
          sender_account_last4, sender_reference, fee_amount, transaction_id)
       SELECT id, $2, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
              payment_date, 'PAY-2026-9999', customer_id, NULL, customer_name, status, NOW(),
              received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
              sender_account_last4, sender_reference, fee_amount, transaction_id
         FROM zz_deleted_payments_backup WHERE id = $1 AND transaction_id = $3`, [b.id, o.invoice_id, SECOND])
    await client.query(
      `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
       VALUES ($1, $2, $3, 10, 'Second Stripe charge for the same job')`, [b.id, o.id, o.invoice_id])
    const { rowCount: linked } = await client.query(
      `UPDATE payment_links SET payment_id = $2, updated_at = NOW() WHERE id = $1 AND payment_id = $3`, [LINK, b.id, p.id])
    if (linked !== 1) throw new Error('the $10 payment link was not where expected')

    const { rows: [c] } = await client.query(
      `SELECT i.invoice_number, i.amount_paid, i.balance_due, i.status,
              to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS so_total,
              to_char((SELECT SUM(amount) FROM payments), 'FM999,999.00') AS pay_total,
              (SELECT COUNT(*) FROM payments q WHERE q.order_id IS NULL AND NOT EXISTS (
                 SELECT 1 FROM payment_allocations a WHERE a.payment_id = q.id AND a.order_id IS NOT NULL))::int AS pay_without_so
         FROM invoices i WHERE i.id = $1`, [o.invoice_id])
    console.log(`\n   ${c.invoice_number} paid $${c.amount_paid} due $${c.balance_due} ${c.status}`)
    console.log(`   SO total $${c.so_total}   payments $${c.pay_total}   payment without SO ${c.pay_without_so}`)
    if (Number(c.amount_paid) !== 128 || c.so_total !== c.pay_total || c.pay_without_so) throw new Error('the book does not balance')

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
