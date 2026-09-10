#!/usr/bin/env node
'use strict'

/**
 * One job, one sales order, one payment — on the owner's word.
 *
 *   Alandos Forrest  ORD-2026-0139 ($128) was paid in two Stripe charges,
 *                    PAY-2026-0141 $118 and PAY-2026-0147 $10. They become one
 *                    payment of $128; the fees add up ($3.72 + $0.59) and the
 *                    second charge's intent is kept in reference_no, where the
 *                    Stripe recorder looks before booking an intent again.
 *
 *   Brooke Wylie     one $480 payment (PAY-2026-0140) covered ORD-2026-0136
 *                    and ORD-2026-0137, $240 each. One order of $480: 60 shirts,
 *                    both POs, both parcels.
 *
 *   Robert Farrar    one $338 payment (PAY-2026-0124) covered ORD-2026-0130
 *                    and ORD-2026-0131. One order of $338: $286 of transfers and
 *                    $52 shipping for the two parcels.
 *
 * A folded job takes its quote and invoice with it: the lines of all three
 * move onto the surviving quote, invoice and order, and the folded documents
 * are soft-deleted with their numbers parked. The deleted payment is copied to
 * zz_deleted_payments_backup first.
 *
 * Nothing else is touched: leftover and duplicate quotes/invoices elsewhere
 * wait for the owner's word.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v).toFixed(2))
const park = col => `'D-' || ${col} || '-' || left(replace(id::text, '-', ''), 4)`

const FOLDS = [
  { who: 'Brooke Wylie', payment: 'PAY-2026-0140', amount: 480,
    keep: { order: 'ORD-2026-0136', invoice: 'BWY-0135', quote: 'Q-2026-0142' },
    fold: { order: 'ORD-2026-0137', invoice: 'BWY-0136', quote: 'Q-2026-0143' },
    subtotal: 450, shipping: 30 },
  { who: 'Robert Farrar', payment: 'PAY-2026-0124', amount: 338,
    keep: { order: 'ORD-2026-0130', invoice: 'RFA-0131', quote: 'Q-2026-0135' },
    fold: { order: 'ORD-2026-0131', invoice: 'RFA-0132', quote: 'Q-2026-0136' },
    subtotal: 286, shipping: 52 },
]

async function one(client, sql, params, what) {
  const { rows } = await client.query(sql, params)
  if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`)
  return rows[0]
}
const order   = (c, n) => one(c, `SELECT * FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [n], n)
const invoice = (c, n) => one(c, `SELECT * FROM invoices WHERE invoice_number = $1 AND deleted_at IS NULL`, [n], n)
const quote   = (c, n) => one(c, `SELECT * FROM quotations WHERE quote_number = $1 AND deleted_at IS NULL`, [n], n)
const payment = (c, n) => one(c, `SELECT * FROM payments WHERE payment_number = $1`, [n], n)

// Moves child rows from one parent to another, appending after the rows
// already there so sort orders do not collide.
async function moveLines(client, table, fk, from, to) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name IN ('sort_order', 'line_no')`, [table])
  const names = cols.map(c => c.column_name)
  const sets = [`${fk} = $2`]
  if (names.includes('sort_order')) {
    sets.push(`sort_order = sort_order + (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${table} WHERE ${fk} = $2)`)
  }
  if (names.includes('line_no')) {
    sets.push(`line_no = CASE WHEN line_no IS NULL THEN NULL ELSE line_no + (SELECT COALESCE(MAX(line_no), 0) FROM ${table} WHERE ${fk} = $2) END`)
  }
  const { rowCount } = await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${fk} = $1`, [from, to])
  return rowCount
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // ── Alandos Forrest: two charges, one payment ─────────────────────────
    {
      const o = await order(client, 'ORD-2026-0139')
      const inv = await invoice(client, 'AFO-0141')
      const p1 = await payment(client, 'PAY-2026-0141')
      const p2 = await payment(client, 'PAY-2026-0147')
      if (money(p1.amount) !== 118 || money(p2.amount) !== 10 || money(o.total) !== 128) {
        throw new Error(`Alandos: expected 118 + 10 = 128, found ${p1.amount} + ${p2.amount} on ${o.total}`)
      }
      if (p1.customer_id !== p2.customer_id || p1.customer_id !== o.customer_id) throw new Error('Alandos: customers differ')
      if (p1.reference_no && p1.reference_no !== p2.transaction_id) throw new Error(`Alandos: PAY-2026-0141 already has reference ${p1.reference_no}`)
      const fee = money(Number(p1.fee_amount) + Number(p2.fee_amount))
      console.log(`Alandos Forrest  ORD-2026-0139  $128`)
      console.log(`   PAY-2026-0141 $118 (fee ${p1.fee_amount}) + PAY-2026-0147 $10 (fee ${p2.fee_amount})  ->  PAY-2026-0141 $128, fee $${fee}`)

      await client.query(`DELETE FROM payment_allocations WHERE payment_id = ANY($1)`, [[p1.id, p2.id]])
      await client.query(`UPDATE payment_links SET payment_id = $2 WHERE payment_id = $1`, [p2.id, p1.id])
      await client.query(`UPDATE refunds SET payment_id = $2 WHERE payment_id = $1`, [p2.id, p1.id])
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
           FROM payments WHERE id = $1`, [p2.id])
      await client.query(`DELETE FROM payments WHERE id = $1`, [p2.id])
      await client.query(
        `UPDATE payments
            SET amount = 128, fee_amount = $2::numeric, order_id = $3, invoice_id = $4,
                reference_no = $5::text,
                notes = COALESCE(notes || ' | ', '') || $6::text,
                updated_at = NOW()
          WHERE id = $1`,
        [p1.id, fee, o.id, inv.id, p2.transaction_id,
         `Two Stripe charges for one job, booked as one: ${p1.transaction_id} $118 + ${p2.transaction_id} $10`])
      await client.query(
        `UPDATE orders SET amount_paid = 128, payment_status = 'Paid', updated_at = NOW() WHERE id = $1`, [o.id])
    }

    // ── Brooke Wylie and Robert Farrar: two orders, one job ──────────────
    for (const f of FOLDS) {
      const ko = await order(client, f.keep.order), fo = await order(client, f.fold.order)
      const ki = await invoice(client, f.keep.invoice), fi = await invoice(client, f.fold.invoice)
      const kq = await quote(client, f.keep.quote), fq = await quote(client, f.fold.quote)
      const p = await payment(client, f.payment)
      const total = money(f.subtotal + f.shipping)
      if (money(Number(ko.total) + Number(fo.total)) !== f.amount || money(p.amount) !== f.amount || total !== f.amount) {
        throw new Error(`${f.who}: ${ko.total} + ${fo.total} is not the payment's ${p.amount}`)
      }
      if (ko.invoice_id !== ki.id || fo.invoice_id !== fi.id || ko.quotation_id !== kq.id || fo.quotation_id !== fq.id) {
        throw new Error(`${f.who}: the orders, invoices and quotes are not linked the way this script expects`)
      }
      if (ko.customer_id !== fo.customer_id || p.customer_id !== ko.customer_id) throw new Error(`${f.who}: customers differ`)

      console.log(`\n${f.who}  ${f.payment} $${f.amount}`)
      console.log(`   ${fo.order_number} ${fi.invoice_number} ${fq.quote_number}  ->  ${ko.order_number} ${ki.invoice_number} ${kq.quote_number}`)
      console.log(`   = $${f.subtotal.toFixed(2)} + $${f.shipping.toFixed(2)} shipping = $${total.toFixed(2)}`)

      const moved = {}
      for (const t of ['order_items_apparel', 'order_items_dtf', 'order_items_gangsheet', 'order_item_artworks']) {
        moved[t] = await moveLines(client, t, 'order_id', fo.id, ko.id)
      }
      for (const t of ['invoice_items', 'invoice_items_apparel', 'invoice_items_dtf', 'invoice_items_gangsheet', 'invoice_item_artworks']) {
        moved[t] = await moveLines(client, t, 'invoice_id', fi.id, ki.id)
      }
      for (const t of ['quotation_items', 'quotation_items_apparel', 'quotation_items_dtf', 'quotation_items_gangsheet', 'quotation_item_artworks']) {
        moved[t] = await moveLines(client, t, 'quotation_id', fq.id, kq.id)
      }
      for (const [t, col] of [['purchase_orders', 'order_id'], ['shipments', 'order_id'], ['po_orders', 'order_id'],
                              ['shipment_orders', 'order_id'], ['artworks', 'order_id'], ['artwork_vault_assets', 'order_id'],
                              ['payment_links', 'order_id'], ['refunds', 'order_id'], ['claims', 'order_id']]) {
        const { rowCount } = await client.query(`UPDATE ${t} SET ${col} = $2 WHERE ${col} = $1`, [fo.id, ko.id])
        moved[t] = rowCount
      }
      await client.query(`UPDATE artworks SET quotation_id = $2 WHERE quotation_id = $1`, [fq.id, kq.id])
      console.log('   moved: ' + Object.entries(moved).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', '))

      // A note on a purchase order naming the folded order now names the job's.
      await client.query(
        `UPDATE purchase_orders SET notes = replace(notes, $2, $3), updated_at = NOW()
          WHERE order_id = $1 AND notes LIKE '%' || $2 || '%'`, [ko.id, fo.order_number, ko.order_number])

      // Line sums must be the new subtotal before any total is written.
      const { rows: [sums] } = await client.query(
        `SELECT (SELECT COALESCE(SUM(amount),0) FROM order_items_apparel WHERE order_id = $1)
              + (SELECT COALESCE(SUM(amount),0) FROM order_items_dtf WHERE order_id = $1) AS o,
                (SELECT COALESCE(SUM(amount),0) FROM invoice_items WHERE invoice_id = $2) AS i,
                (SELECT COALESCE(SUM(amount),0) FROM quotation_items WHERE quotation_id = $3) AS q`,
        [ko.id, ki.id, kq.id])
      for (const [k, v] of Object.entries(sums)) {
        if (money(v) !== f.subtotal) throw new Error(`${f.who}: ${k} lines add to ${v}, not ${f.subtotal}`)
      }

      await client.query(
        `UPDATE quotations SET subtotal = $2::numeric, estimated_shipping = $3::numeric, total = $4::numeric, updated_at = NOW()
          WHERE id = $1`, [kq.id, f.subtotal, f.shipping, total])
      await client.query(
        `UPDATE invoices SET subtotal = $2::numeric, shipping_charges = $3::numeric, total = $4::numeric, updated_at = NOW()
          WHERE id = $1`, [ki.id, f.subtotal, f.shipping, total])
      await client.query(
        `UPDATE orders SET subtotal = $2::numeric, shipping_charges = $3::numeric, total = $4::numeric,
                           amount_paid = $4::numeric, payment_status = 'Paid', updated_at = NOW()
          WHERE id = $1`, [ko.id, f.subtotal, f.shipping, total])

      // One payment, whole, on the job's order and invoice. The allocations
      // that split it go: recalc_invoice_paid counts a payment through its
      // invoice once it has none.
      await client.query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [p.id])
      await client.query(`UPDATE payments SET order_id = $2, invoice_id = $3, updated_at = NOW() WHERE id = $1`,
        [p.id, ko.id, ki.id])

      const note = `Folded into ${ko.order_number} — one job, one payment (${f.payment}).`
      await client.query(
        `UPDATE orders SET deleted_at = NOW(), order_number = ${park('order_number')},
                           notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW() WHERE id = $1`, [fo.id, note])
      await client.query(
        `UPDATE invoices SET deleted_at = NOW(), invoice_number = ${park('invoice_number')}, updated_at = NOW() WHERE id = $1`, [fi.id])
      await client.query(
        `UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')}, updated_at = NOW() WHERE id = $1`, [fq.id])
    }

    // ── Proof ─────────────────────────────────────────────────────────────
    const { rows: [c] } = await client.query(
      `SELECT to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS orders,
              to_char((SELECT SUM(amount) FROM payments), 'FM999,999.00') AS payments,
              (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL AND amount_paid > total + 0.01)::int AS overpaid,
              (SELECT COUNT(*) FROM orders o JOIN invoices i ON i.id = o.invoice_id
                WHERE o.deleted_at IS NULL AND i.total <> o.total)::int AS inv_ne_order,
              (SELECT COUNT(*) FROM payments p WHERE p.order_id IS NULL AND NOT EXISTS (
                  SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id AND a.order_id IS NOT NULL))::int AS pay_no_so,
              (SELECT COUNT(*) FROM orders o WHERE o.deleted_at IS NULL AND abs(o.total - (
                  COALESCE((SELECT SUM(a.allocated_amount) FROM payment_allocations a WHERE a.order_id = o.id), 0)
                + COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id
                             AND NOT EXISTS (SELECT 1 FROM payment_allocations a2 WHERE a2.payment_id = p.id)), 0))) > 0.001)::int AS so_not_paid`)
    console.log(`\n   orders $${c.orders}   payments $${c.payments}   overpaid ${c.overpaid}   invoice≠order ${c.inv_ne_order}` +
                `   payment without SO ${c.pay_no_so}   SO not paid in full ${c.so_not_paid}`)
    if (c.orders !== c.payments || c.overpaid || c.inv_ne_order || c.pay_no_so || c.so_not_paid) {
      throw new Error('the book does not balance after the merge — rolled back')
    }

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
