#!/usr/bin/env node
/**
 * Data fix — bring orders.payment_status back in line with their invoice.
 *
 * The portals read orders.payment_status, so 50 delivered-and-invoiced orders
 * were showing "Unpaid" to the customer while their invoice said Paid. This
 * syncs the order to the invoice it is already linked to; it never invents a
 * payment and never touches the payments ledger.
 *
 * Rules (deliberately narrow):
 *  - invoice.status = 'Paid'  and order.payment_status <> 'Paid'
 *      → order.payment_status = 'Paid', amount_paid = order.total
 *  - Orders whose invoice is NOT Paid are left exactly as they are, including
 *    the two rows where the order claims Paid but the invoice does not — those
 *    are listed for a human to look at rather than silently flipped.
 *
 * Usage:
 *   node backend/scripts/sync-order-payment-status-from-invoice.js            (dry-run)
 *   node backend/scripts/sync-order-payment-status-from-invoice.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: toFix } = await client.query(
      `SELECT o.id, o.order_number, o.total, o.payment_status::text AS pay, o.amount_paid,
              i.invoice_number, c.name AS customer
         FROM orders o
         JOIN invoices i ON i.order_id = o.id
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.deleted_at IS NULL
          AND i.status::text = 'Paid'
          AND o.payment_status::text <> 'Paid'
        ORDER BY o.order_date DESC NULLS LAST`
    )

    const { rows: review } = await client.query(
      `SELECT o.order_number, o.payment_status::text AS pay, i.invoice_number, i.status::text AS inv
         FROM orders o JOIN invoices i ON i.order_id = o.id
        WHERE o.deleted_at IS NULL AND i.status::text <> 'Paid' AND o.payment_status::text = 'Paid'`
    )

    console.log(`Orders to mark Paid (invoice already Paid): ${toFix.length}`)
    for (const r of toFix) {
      console.log(`  ${r.order_number.padEnd(16)} ${String(r.customer || '').padEnd(22)} ` +
        `${r.pay} → Paid   total ${r.total}  (invoice ${r.invoice_number})`)
    }

    if (review.length) {
      console.log(`\nLeft untouched for review — order says Paid but its invoice does not (${review.length}):`)
      review.forEach(r => console.log(`  ${r.order_number} (order ${r.pay}) vs ${r.invoice_number} (invoice ${r.inv})`))
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    const { rowCount } = await client.query(
      `UPDATE orders o
          SET payment_status = 'Paid'::payment_status,
              amount_paid = o.total,
              updated_at = NOW()
         FROM invoices i
        WHERE i.order_id = o.id
          AND o.deleted_at IS NULL
          AND i.status::text = 'Paid'
          AND o.payment_status::text <> 'Paid'`
    )
    await client.query('COMMIT')
    console.log(`\nUpdated ${rowCount} order(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
