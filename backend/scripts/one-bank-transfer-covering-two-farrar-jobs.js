#!/usr/bin/env node
'use strict'

/**
 * Robert Farrar's $338 is one payment for two jobs, recorded as two payments
 * that never happened.
 *
 * The chat of 2 September sets it out in the shop's own words:
 *
 *     "Previous 29 pcs and now 75 pcs"
 *     "104 total designs."
 *     "Total designs amount: $286   One shipping: $26   Second shipping: $26"
 *     "Total amount: $338"
 *     — customer: "Just paid. Thanks so much!"
 *
 * One payment. Two parcels, hence two shipping charges. And the two sales
 * orders raised that day come to exactly that:
 *
 *     ORD-2026-0134   $79.75 + $26 = $105.75
 *     ORD-2026-0135  $206.25 + $26 = $232.25
 *                     ------   ---   -------
 *                     $286     $52   $338
 *
 * PAY-2026-0121 is the money: it carries a $10.11 processor fee, which is a
 * thing only a real payment has. The other two carry the notes of the two code
 * paths that used to invent payment rows — "Payment recorded from sales order"
 * and "Full payment recorded when invoice was created" — no fee, no transaction
 * id, and between them they add up to the one payment they were split out of.
 *
 * So the real payment is spread across both jobs through payment_allocations,
 * and the two invented rows are removed. Every share is written as an
 * allocation, the first included: recalc_invoice_paid stops counting a payment
 * through its own invoice as soon as it has any allocation, so a share left
 * implicit would be lost.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const REAL = 'PAY-2026-0121'
const INVENTED = ['PAY-2026-0134', 'PAY-2026-0135']
const JOBS = ['ORD-2026-0134', 'ORD-2026-0135']
const NOTE = 'One bank transfer covering both jobs — designs $286, two shipments at $26'

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: real } = await client.query(
      `SELECT id, payment_number, amount, fee_amount, order_id FROM payments WHERE payment_number = $1`, [REAL])
    if (!real[0]) throw new Error(`${REAL} not found`)

    const { rows: fake } = await client.query(
      `SELECT p.id, p.payment_number, p.amount, p.notes, o.order_number
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.payment_number = ANY($1) ORDER BY p.payment_number`, [INVENTED])

    const { rows: jobs } = await client.query(
      `SELECT o.id, o.order_number, o.subtotal, o.shipping_charges, o.total, o.invoice_id
         FROM orders o WHERE o.order_number = ANY($1) AND o.deleted_at IS NULL
        ORDER BY o.order_number`, [JOBS])

    console.log(`The money:  ${real[0].payment_number}  $${real[0].amount}  (fee $${real[0].fee_amount})`)
    console.log(`The jobs:`)
    for (const j of jobs) {
      console.log(`   ${j.order_number}  $${Number(j.subtotal).toFixed(2)} + $${Number(j.shipping_charges).toFixed(2)} = $${Number(j.total).toFixed(2)}`)
    }
    console.log(`Invented rows to remove:`)
    for (const f of fake) {
      console.log(`   ${f.payment_number}  $${f.amount}  on ${f.order_number ?? '—'}  — "${f.notes}"`)
    }

    const jobTotal = jobs.reduce((s, j) => s + Number(j.total), 0)
    const fakeTotal = fake.reduce((s, f) => s + Number(f.amount), 0)
    console.log(`\n   jobs $${jobTotal.toFixed(2)}   invented $${fakeTotal.toFixed(2)}   real $${Number(real[0].amount).toFixed(2)}`)

    if (jobs.length !== JOBS.length) throw new Error('one of the orders is missing')
    if (fake.length !== INVENTED.length) throw new Error('one of the invented payments is missing')
    if (Math.abs(jobTotal - Number(real[0].amount)) > 0.01) {
      throw new Error(`the two jobs come to ${jobTotal.toFixed(2)}, not ${real[0].amount} — refusing to split a payment that does not add up`)
    }
    if (Math.abs(fakeTotal - Number(real[0].amount)) > 0.01) {
      throw new Error(`the two rows being removed come to ${fakeTotal.toFixed(2)}, not ${real[0].amount} — they are not a split of this payment`)
    }

    if (!APPLY) {
      await client.query('ROLLBACK')
      console.log('\nNothing written. Re-run with --apply.')
      return
    }

    // The invented rows go first: they hold order_id on both jobs, and
    // uq_payments_one_per_order would refuse the real one a place otherwise.
    for (const f of fake) {
      await client.query(`DELETE FROM payments WHERE id = $1`, [f.id])
    }

    await client.query(
      `UPDATE payments SET order_id = $2, invoice_id = COALESCE(invoice_id, $3), updated_at = NOW()
        WHERE id = $1`, [real[0].id, jobs[0].id, jobs[0].invoice_id])

    for (const j of jobs) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        [real[0].id, j.id, j.invoice_id, j.total, NOTE])
    }

    await client.query('COMMIT')
    console.log('\nWritten.')

    const { rows: after } = await pool.query(
      `SELECT o.order_number, a.allocated_amount, i.invoice_number, i.amount_paid, i.balance_due, i.status
         FROM payment_allocations a
         JOIN orders o ON o.id = a.order_id
         LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE a.payment_id = $1 ORDER BY o.order_number`, [real[0].id])
    console.log('\nAfter:')
    for (const r of after) {
      console.log(`   ${r.order_number}  allocated $${r.allocated_amount}  ` +
                  `${r.invoice_number} paid $${r.amount_paid}, due $${r.balance_due}, ${r.status}`)
    }
    console.log('\nPayment numbering now has two holes — run:')
    console.log('   node scripts/renumber-documents-by-date.js --only=payments --apply')
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
