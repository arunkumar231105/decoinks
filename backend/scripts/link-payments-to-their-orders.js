#!/usr/bin/env node
'use strict'

/**
 * Put each payment on the sales order it paid for.
 *
 * Money and paperwork arrive in either order here — often the payment link
 * settles days before anyone raises the job — so a payment can sit against a
 * customer with nothing joining it to the work it bought. This joins the ones
 * that are certain and names the ones that are not.
 *
 * Two rules, both conservative:
 *   1. The payment is already on the order's invoice. Nothing is being guessed:
 *      the invoice and the order are the same job.
 *   2. Same customer, exactly the order's total, and exactly one order it could
 *      be. An amount that matches two orders is left alone — Brooke Wylie's two
 *      $240 jobs and one $480 payment are precisely the case a script must not
 *      decide.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. The payment is on the order's invoice.
    const { rows: viaInvoice } = await client.query(`
      SELECT p.id AS payment_id, p.payment_number, p.amount,
             o.id AS order_id, o.order_number, o.total, i.invoice_number
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        JOIN orders   o ON o.invoice_id = i.id AND o.deleted_at IS NULL
       WHERE p.order_id IS NULL
         -- One payment per order is a database rule (uq_payments_one_per_order).
         -- An order that already has one is settled; a second payment claiming
         -- the same job is a duplicate, and saying so is more use than failing.
         AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = o.id)
       ORDER BY p.payment_number`)

    console.log(`1. Payment already on the order's invoice: ${viaInvoice.length}`)
    for (const r of viaInvoice) {
      console.log(`   ${r.payment_number} $${r.amount} → ${r.order_number} (via ${r.invoice_number}, order total $${r.total})`)
    }

    // 2. Same customer, exact amount, one candidate.
    const { rows: viaAmount } = await client.query(`
      SELECT p.id AS payment_id, p.payment_number, p.amount, p.payment_date,
             o.id AS order_id, o.order_number, o.total
        FROM payments p
        JOIN LATERAL (
          SELECT o.id, o.order_number, o.total
            FROM orders o
           WHERE o.deleted_at IS NULL
             AND o.customer_id = p.customer_id
             AND o.total = p.amount
             AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = o.id)
        ) o ON TRUE
       WHERE p.order_id IS NULL
         AND p.customer_id IS NOT NULL
         AND (SELECT COUNT(*) FROM orders o2
               WHERE o2.deleted_at IS NULL AND o2.customer_id = p.customer_id
                 AND o2.total = p.amount
                 AND NOT EXISTS (SELECT 1 FROM payments p3 WHERE p3.order_id = o2.id)) = 1
         AND (SELECT COUNT(*) FROM payments p4
               WHERE p4.id <> p.id AND p4.order_id IS NULL
                 AND p4.customer_id = p.customer_id AND p4.amount = p.amount) = 0
       ORDER BY p.payment_number`)

    const already = new Set(viaInvoice.map(r => r.payment_id))
    const amountOnly = viaAmount.filter(r => !already.has(r.payment_id))

    console.log(`\n2. Same customer, exactly the order's total, one candidate each way: ${amountOnly.length}`)
    for (const r of amountOnly) {
      console.log(`   ${r.payment_number} $${r.amount} (${r.payment_date}) → ${r.order_number} $${r.total}`)
    }

    const { rows: dupes } = await client.query(`
      SELECT p.payment_number, p.amount, o.order_number, i.invoice_number,
             held.payment_number AS order_already_has, held.transaction_id
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        JOIN orders   o ON o.invoice_id = i.id AND o.deleted_at IS NULL
        JOIN payments held ON held.order_id = o.id
       WHERE p.order_id IS NULL
       ORDER BY p.payment_number`)

    if (dupes.length) {
      console.log(`\n   Refused — the order already has its payment, so this is a second claim on the same job:`)
      for (const d of dupes) {
        console.log(`   ${d.payment_number} $${d.amount} wants ${d.order_number}, which already holds ` +
                    `${d.order_already_has}${d.transaction_id ? ` (txn ${d.transaction_id})` : ''}`)
      }
    }

    // What is left, so the owner can see it rather than wonder.
    const { rows: left } = await client.query(`
      SELECT o.order_number, COALESCE(c.name, i.customer_name) AS customer, o.total, o.order_date,
             (SELECT string_agg(p.payment_number || ' $' || p.amount, ', ' ORDER BY p.payment_number)
                FROM payments p WHERE p.customer_id = o.customer_id AND p.order_id IS NULL) AS unattached_for_customer
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN invoices  i ON i.id = o.invoice_id
       WHERE o.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = o.invoice_id)
       ORDER BY o.order_number`)

    if (!APPLY) {
      await client.query('ROLLBACK')
    } else {
      for (const r of [...viaInvoice, ...amountOnly]) {
        await client.query(
          `UPDATE payments SET order_id = $2, updated_at = NOW() WHERE id = $1 AND order_id IS NULL`,
          [r.payment_id, r.order_id])
      }
      await client.query('COMMIT')
    }

    const { rows: after } = await pool.query(`
      SELECT COUNT(*)::int AS n FROM orders o
       WHERE o.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)`)

    console.log(`\n3. Orders still with no payment of their own: ${after[0].n}`)
    for (const r of left) {
      console.log(`   ${r.order_number}  ${String(r.customer ?? '?').padEnd(20)} $${r.total}  ${r.order_date}`)
      console.log(`      loose payments for this customer: ${r.unattached_for_customer ?? 'none'}`)
    }

    console.log(APPLY
      ? `\nWritten: ${viaInvoice.length + amountOnly.length} payment(s) joined to their order.`
      : '\nNothing written. Re-run with --apply.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
