#!/usr/bin/env node
/**
 * Stop showing import markers where a payment method belongs.
 *
 * orders.payment_method is a customer-facing field — it appears on the order
 * screen, the print-out and the CSV export — but the import scripts filled it
 * with their own bookkeeping. 95 orders read "Historical Import" and 28 read
 * "DIGI API". Neither is a way of paying; the first is the name of a script and
 * the second is the channel the order arrived by, which now has its own column.
 *
 * WHAT THIS DOES
 *
 *   - Where the order has a real payment in the ledger, its method is used:
 *     PayPal or Zelle, taken from the earliest payment against that order.
 *     40 orders resolve this way.
 *   - Everywhere else the field is cleared. Blank honestly says "we do not know
 *     how this was paid", which is true; leaving "Historical Import" there
 *     asserts something false and would be carried into any document printed
 *     for a customer.
 *
 * The DIGI orders are all cleared: they carry no payment at all yet, so there
 * is no method to state. `sales_channel` already records that they came from
 * DIGI, which is what "DIGI API" was really saying.
 *
 * Nothing else is touched — no amount, no status, and the payments ledger is
 * only read.
 *
 * Idempotent. One transaction, dry-run by default.
 *
 * Usage:
 *   node backend/scripts/fix-order-payment-method.js            (dry-run)
 *   node backend/scripts/fix-order-payment-method.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// Values that are bookkeeping, not a way of paying.
const NOT_A_METHOD = ['Historical Import', 'DIGI API']

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Real method from the ledger where the order actually has a payment.
    const { rows: derived } = await client.query(
      `UPDATE orders o SET payment_method = pay.method, updated_at = NOW()
         FROM (
           SELECT DISTINCT ON (p.order_id) p.order_id, p.payment_method AS method
             FROM payments p
            WHERE p.order_id IS NOT NULL AND NULLIF(BTRIM(p.payment_method), '') IS NOT NULL
            ORDER BY p.order_id, p.payment_date
         ) pay
        WHERE o.id = pay.order_id AND o.deleted_at IS NULL
          AND (o.payment_method = ANY($1) OR o.payment_method IS NULL)
        RETURNING o.order_number, o.payment_method`,
      [NOT_A_METHOD])

    // 2. Anything still carrying an import marker has no payment to learn from.
    const { rows: cleared } = await client.query(
      `UPDATE orders SET payment_method = NULL, updated_at = NOW()
        WHERE deleted_at IS NULL AND payment_method = ANY($1)
        RETURNING order_number`, [NOT_A_METHOD])

    // 3. One spelling per method. 'paypal' and 'PayPal' are the same thing and
    // would otherwise sort and filter as two.
    const { rows: cased } = await client.query(
      `UPDATE orders SET payment_method = 'PayPal', updated_at = NOW()
        WHERE deleted_at IS NULL AND payment_method <> 'PayPal' AND lower(payment_method) = 'paypal'
        RETURNING order_number`)
    const { rows: casedZ } = await client.query(
      `UPDATE orders SET payment_method = 'Zelle', updated_at = NOW()
        WHERE deleted_at IS NULL AND payment_method <> 'Zelle' AND lower(payment_method) = 'zelle'
        RETURNING order_number`)

    const { rows: after } = await client.query(
      `SELECT COALESCE(payment_method, '(blank — unknown)') AS method, COUNT(*)::int AS n
         FROM orders WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(`  Set from a real ledger payment: ${derived.length}`)
    for (const d of derived.slice(0, 8)) console.log(`     ${d.order_number} → ${d.payment_method}`)
    if (derived.length > 8) console.log(`     …and ${derived.length - 8} more`)
    console.log(`  Cleared (no payment on record): ${cleared.length}`)
    if (cased.length + casedZ.length) console.log(`  Spelling normalised: ${cased.length + casedZ.length}`)
    console.log('\nPayment method across all orders')
    for (const a of after) console.log(`  ${a.method.padEnd(22)} ${a.n}`)

    if (APPLY) { await client.query('COMMIT'); console.log('\nCommitted.') }
    else { await client.query('ROLLBACK'); console.log('\nRolled back. Re-run with --apply to keep these changes.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
