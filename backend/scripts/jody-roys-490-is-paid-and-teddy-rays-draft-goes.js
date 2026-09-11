#!/usr/bin/env node
'use strict'

/**
 * On the owner's word, 11 September:
 *
 *   Jody Roy paid $490 by Stripe (PAY-2026-0152) before the invoice was sent,
 *   so it arrived as an advance and JRO-0152 stayed Unpaid. The payment is
 *   applied to the invoice (the same call the invoice screen's "Apply a
 *   payment" makes), which makes it Paid, and the sales order is raised from
 *   the paid invoice the way Convert to Sales Order does — with the quote it
 *   came from — so quote, invoice, order and payment are one $490 job.
 *
 *   Teddy Ray Wilson Jr's $88 invoice TJR-0144 and its quote are removed: no
 *   payment, no order. Soft-deleted with their numbers parked.
 *
 *   Every quotation is Approved.
 *
 * Ricardo Malia's $58 Zelle of 11 September has no quote or invoice to raise
 * an order from, so it is left for the owner to say what it was for.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v).toFixed(2))
const park = col => `'D-' || ${col} || '-' || left(replace(id::text, '-', ''), 4)`

async function one(sql, params, what) {
  const { rows } = await pool.query(sql, params)
  if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`)
  return rows[0]
}

async function main() {
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')

  // ── Checks (read only) ───────────────────────────────────────────────────
  const pay = await one(`SELECT * FROM payments WHERE payment_number = 'PAY-2026-0152'`, [], 'PAY-2026-0152')
  const inv = await one(`SELECT * FROM invoices WHERE invoice_number = 'JRO-0152' AND deleted_at IS NULL`, [], 'JRO-0152')
  const q = await one(`SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL`, [inv.quote_id], 'Jody quote')
  if (money(pay.amount) !== 490 || money(inv.total) !== 490 || money(q.total) !== 490) throw new Error('Jody: not $490 all round')
  if (pay.invoice_id || pay.order_id || pay.customer_id !== inv.customer_id) throw new Error('Jody: the payment is already applied, or is someone else\'s')
  const { rows: existingOrder } = await pool.query(
    `SELECT order_number FROM orders WHERE deleted_at IS NULL AND (invoice_id = $1 OR quotation_id = $2)`, [inv.id, q.id])
  if (existingOrder.length) throw new Error(`Jody: ${existingOrder[0].order_number} already exists`)
  console.log(`Jody Roy  ${pay.payment_number} $${pay.amount}  ->  ${inv.invoice_number} (${inv.status}) + new sales order from ${q.quote_number}`)

  const tInv = await one(`SELECT * FROM invoices WHERE invoice_number = 'TJR-0144' AND deleted_at IS NULL`, [], 'TJR-0144')
  const tQ = await one(`SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL`, [tInv.quote_id], 'Teddy quote')
  const { rows: [tRefs] } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM payments WHERE invoice_id = $1)::int
          + (SELECT COUNT(*) FROM payment_links WHERE invoice_id = $1)::int
          + (SELECT COUNT(*) FROM orders WHERE (invoice_id = $1 OR quotation_id = $2) AND deleted_at IS NULL)::int AS n`,
    [tInv.id, tQ.id])
  if (tRefs.n || Number(tInv.amount_paid) || !/teddy/i.test(tInv.customer_name || '')) throw new Error('Teddy: the invoice has money or an order on it — refusing')
  console.log(`Teddy Ray Wilson Jr  ${tInv.invoice_number} $${tInv.total} and ${tQ.quote_number} $${tQ.total}  ->  removed`)

  const { rows: toApprove } = await pool.query(
    `SELECT quote_number, status FROM quotations WHERE deleted_at IS NULL AND status <> 'Approved' AND id <> $1 ORDER BY 1`, [tQ.id])
  console.log(`Quotations to Approved: ${toApprove.map(r => `${r.quote_number} (${r.status})`).join(', ')}`)

  if (!APPLY) { console.log('\nNothing written. Re-run with --apply.'); return }

  // ── Jody Roy ─────────────────────────────────────────────────────────────
  const recorder = require('../src/modules/stripe/stripe.recorder')
  const orders = require('../src/modules/orders/orders.service')
  const applied = await recorder.attachPaymentToInvoice(pay.id, inv.id)
  console.log(`\n   applied: ${inv.invoice_number} is ${applied.status}, balance $${applied.balance ?? 0}`)
  const order = await orders.create({
    invoice_id: inv.id, quotation_id: q.id, order_type: inv.order_type || q.order_type,
    order_date: String(inv.issue_date instanceof Date ? inv.issue_date.toISOString() : inv.issue_date).slice(0, 10),
    items: [],
  })
  await pool.query(`UPDATE payments SET order_id = $2, updated_at = NOW() WHERE id = $1 AND order_id IS NULL`, [pay.id, order.id])
  await pool.query(`UPDATE invoices SET order_id = $2, updated_at = NOW() WHERE id = $1 AND order_id IS NULL`, [inv.id, order.id])
  console.log(`   raised: ${order.order_number}`)

  // ── Teddy Ray, and every quotation Approved ──────────────────────────────
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE invoices SET deleted_at = NOW(), invoice_number = ${park('invoice_number')},
              notes = COALESCE(notes || ' | ', '') || 'Removed on the owner''s word: no payment, no order.', updated_at = NOW()
        WHERE id = $1`, [tInv.id])
    await client.query(
      `UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')},
              notes = COALESCE(notes || ' | ', '') || 'Removed on the owner''s word: no payment, no order.', updated_at = NOW()
        WHERE id = $1`, [tQ.id])
    const { rowCount } = await client.query(
      `UPDATE quotations SET status = 'Approved', updated_at = NOW() WHERE deleted_at IS NULL AND status <> 'Approved'`)
    await client.query('COMMIT')
    console.log(`   Teddy Ray removed; ${rowCount} quotation(s) Approved`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }

  // ── Proof ────────────────────────────────────────────────────────────────
  const { rows: [c] } = await pool.query(
    `SELECT to_char((SELECT SUM(total) FROM quotations WHERE deleted_at IS NULL), 'FM999,999.00') AS quotes,
            to_char((SELECT SUM(total) FROM invoices WHERE deleted_at IS NULL), 'FM999,999.00') AS invoices,
            to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS orders,
            to_char((SELECT SUM(amount) FROM payments), 'FM999,999.00') AS payments,
            to_char((SELECT SUM(balance_due) FROM invoices WHERE deleted_at IS NULL), 'FM990.00') AS balance_due,
            (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL AND status <> 'Paid')::int AS not_paid,
            (SELECT COUNT(*) FROM quotations WHERE deleted_at IS NULL AND status <> 'Approved')::int AS not_approved,
            (SELECT string_agg(p.payment_number || ' $' || p.amount, ', ') FROM payments p WHERE p.order_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id AND a.order_id IS NOT NULL)) AS pay_without_so,
            (SELECT o.order_number || ' $' || o.total || ' ' || o.payment_status || ', ' || (SELECT COUNT(*) FROM order_items_apparel a WHERE a.order_id = o.id) || ' lines'
               FROM orders o WHERE o.id = $1) AS jody`, [order.id])
  console.log(`\n   quotes $${c.quotes}   invoices $${c.invoices}   orders $${c.orders}   payments $${c.payments}`)
  console.log(`   balance due $${c.balance_due}   invoices not Paid ${c.not_paid}   quotes not Approved ${c.not_approved}`)
  console.log(`   Jody: ${c.jody}`)
  console.log(`   payments with no SO: ${c.pay_without_so ?? 'none'}`)
}

main()
  .catch(err => { console.error('\nFAILED:', err.message); process.exitCode = 1 })
  .finally(async () => { await pool.end().catch(() => {}); setTimeout(() => process.exit(process.exitCode || 0), 500) })
