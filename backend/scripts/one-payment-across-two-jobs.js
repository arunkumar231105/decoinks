#!/usr/bin/env node
'use strict'

/**
 * Brooke Wylie's $480 covers both of her $240 jobs.
 *
 * payments.order_id can name one order only — uq_payments_one_per_order — which
 * is right for the ordinary case and useless for this one. payment_allocations
 * is the table for money split across jobs: the first order takes order_id and
 * every share, including that first one, is written as an allocation. That
 * "including the first one" matters — recalc_invoice_paid stops counting a
 * payment through its own invoice the moment it has any allocation, so a half
 * written as an allocation and a half left implicit would lose the implicit half.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const PAYMENT = 'PAY-2026-0140'
const ORDERS  = ['ORD-2026-0140', 'ORD-2026-0141']
const NOTE    = 'One Stripe payment covering both jobs, split by order total'

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pay } = await client.query(
      `SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number = $1`, [PAYMENT])
    if (!pay[0]) throw new Error(`${PAYMENT} not found`)

    const { rows: orders } = await client.query(
      `SELECT o.id, o.order_number, o.total, i.id AS invoice_id, i.invoice_number
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE o.order_number = ANY($1) AND o.deleted_at IS NULL
        ORDER BY o.order_number`, [ORDERS])
    if (orders.length !== ORDERS.length) throw new Error('One of the orders is missing')

    const share = orders.reduce((sum, o) => sum + Number(o.total), 0)
    console.log(`${PAYMENT}  $${pay[0].amount}`)
    for (const o of orders) console.log(`   ${o.order_number}  $${o.total}  (${o.invoice_number})`)
    console.log(`   allocating $${share.toFixed(2)} of $${pay[0].amount}`)

    if (Math.abs(share - Number(pay[0].amount)) > 0.01) {
      throw new Error(`The order totals come to ${share.toFixed(2)}, not ${pay[0].amount} — not splitting a payment that does not add up`)
    }

    if (APPLY) {
      // The first order takes order_id, the same convention orders.service
      // already follows when a payment is reused on a second job.
      await client.query(
        `UPDATE payments
            SET order_id   = COALESCE(order_id, $2),
                invoice_id = COALESCE(invoice_id, $3),
                updated_at = NOW()
          WHERE id = $1`,
        [pay[0].id, orders[0].id, orders[0].invoice_id])

      for (const o of orders) {
        await client.query(
          `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
          [pay[0].id, o.id, o.invoice_id, o.total, NOTE])
      }
      await client.query('COMMIT')
      console.log('\nWritten.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nNothing written. Re-run with --apply.')
      return
    }

    const { rows: after } = await pool.query(
      `SELECT o.order_number, a.allocated_amount, i.invoice_number, i.amount_paid, i.balance_due, i.status
         FROM payment_allocations a
         JOIN orders o ON o.id = a.order_id
         LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE a.payment_id = $1 ORDER BY o.order_number`, [pay[0].id])
    console.log('\nAfter:')
    for (const r of after) {
      console.log(`   ${r.order_number}  allocated $${r.allocated_amount}  ` +
                  `${r.invoice_number} paid $${r.amount_paid}, due $${r.balance_due}, ${r.status}`)
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
