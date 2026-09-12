#!/usr/bin/env node
'use strict'

/**
 * The "test" customer and the paperwork raised while trying the new
 * Full/Partial purchase orders — on the owner's word: testing is done.
 *
 *   CUST-2026-0119  test
 *   Q-2026-0153     $110
 *   TES-0153        $110
 *   ORD-2026-0153   $110
 *   SHP-2026-0181   the parcel the test PO created
 *
 * Its nine purchase orders were already deleted. No payment was ever recorded
 * against any of it, which is why the sales order total sat $110 above the
 * payments ledger; that comes back into line here.
 *
 * Soft-deleted, so every row is still in the database and can be restored. The
 * numbers return to their series on their own: the numbering hands out the
 * lowest free number and parks a deleted row's number when it reuses it.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v || 0).toFixed(2))

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    const { rows: [customer] } = await client.query(
      `SELECT id, customer_number, name FROM customers WHERE BTRIM(name) = 'test' AND deleted_at IS NULL`)
    if (!customer) throw new Error('no live customer named "test"')

    const { rows: [counts] } = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM payments p WHERE p.customer_id = $1) AS payments,
              (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = $1 AND o.deleted_at IS NULL) AS orders,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = $1 AND o.deleted_at IS NULL) AS order_value`,
      [customer.id])
    if (counts.payments) throw new Error(`"test" has ${counts.payments} payment(s) — refusing to remove paperwork with money against it`)
    if (counts.orders > 1 || money(counts.order_value) !== 110) {
      throw new Error(`expected one $110 order for "test", found ${counts.orders} worth ${counts.order_value}`)
    }

    const removed = []
    for (const [table, column, number] of [
      ['shipments', 'shipment_number', 'SHP-2026-0181'],
      ['orders', 'order_number', 'ORD-2026-0153'],
      ['invoices', 'invoice_number', 'TES-0153'],
      ['quotations', 'quote_number', 'Q-2026-0153'],
    ]) {
      const { rows } = await client.query(
        `UPDATE ${table}
            SET ${column} = LEFT('D-' || ${column} || '-' || LEFT(REPLACE(id::text, '-', ''), 4), 60),
                deleted_at = NOW(), updated_at = NOW()
          WHERE ${column} = $1 AND deleted_at IS NULL
          RETURNING $2::text AS was`, [number, number])
      if (!rows[0]) throw new Error(`${number} not found (or already removed)`)
      removed.push(`${table.replace('_', ' ')} ${number}`)
    }
    await client.query(
      `UPDATE customers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [customer.id])
    removed.push(`customer ${customer.customer_number} "${customer.name}"`)
    for (const line of removed) console.log(`   removed  ${line}`)

    const { rows: [book] } = await client.query(
      `SELECT to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS orders,
              to_char((SELECT SUM(amount) FROM payments), 'FM999,999.00') AS payments,
              to_char((SELECT SUM(total) FROM invoices WHERE deleted_at IS NULL), 'FM999,999.00') AS invoices,
              to_char((SELECT SUM(total) FROM quotations WHERE deleted_at IS NULL), 'FM999,999.00') AS quotes,
              (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL)::int AS order_count,
              (SELECT COUNT(*) FROM payments p WHERE p.order_id IS NULL AND NOT EXISTS (
                 SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id AND a.order_id IS NOT NULL))::int AS pay_without_so`)
    console.log(`\n   orders ${book.order_count} = $${book.orders}   payments $${book.payments}` +
                `   invoices $${book.invoices}   quotes $${book.quotes}   payments with no SO ${book.pay_without_so}`)
    // The book's own balance is reported, not enforced: payments entered today
    // that have no sales order yet are a separate matter from this clean-up.
    if (book.orders !== book.payments) {
      console.log('   note: sales orders and payments differ — see the payments with no sales order above')
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
