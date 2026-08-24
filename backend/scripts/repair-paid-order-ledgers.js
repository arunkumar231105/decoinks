#!/usr/bin/env node
/**
 * Make the ledger agree with the status on sales orders that say they are paid.
 *
 * Eleven orders carry payment_status 'Paid' and amount_paid 0.00 — $969.99 of
 * work that the order itself says was settled and the money column says was
 * never received. Every one came from the decoinks_digi_apparel_2026 import,
 * which wrote the status and left the amount alone. The orders list prints
 * PAID AMOUNT $0.00 next to an order marked Paid, which is how the shop found
 * it.
 *
 * Their payment terms say 'Due on Receipt' while the status says Paid, so the
 * terms are brought into line too: an order that has been paid reads 'Paid'.
 *
 * NO PAYMENT RECEIPTS ARE CREATED. The method is known — zelle, on all eleven —
 * but not the day the money cleared or its reference. This is the same line
 * drawn for the fourteen invoices and the six DIGI orders before them.
 *
 * Usage:
 *   node backend/scripts/repair-paid-order-ledgers.js            (dry-run)
 *   node backend/scripts/repair-paid-order-ledgers.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
// No connection string in the source. This runs against whatever DATABASE_URL
// points at, and refuses to run without one — a default here is a database
// password in a public repository, and a default pointing at production is a
// script that writes to it by accident.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess which database to use.')
  process.exit(1)
}

const money = n => `$${Number(n || 0).toFixed(2)}`
const cents = n => Math.round(Number(n || 0) * 100)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows: targets } = await client.query(`
      SELECT o.id, o.order_number, c.name AS customer, o.total, o.amount_paid,
             o.payment_terms, o.payment_method, o.status::text AS order_status
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.deleted_at IS NULL AND o.payment_status = 'Paid'
         AND ROUND(COALESCE(o.amount_paid, 0), 2) = 0 AND o.total > 0
       ORDER BY o.order_number`)

    console.log(`Marked Paid with nothing recorded as received: ${targets.length}`)
    for (const t of targets) {
      console.log(`  ${t.order_number}  ${(t.customer || '—').padEnd(26)} ${money(t.total)}` +
        `   paid ${money(t.amount_paid)} → ${money(t.total)}` +
        `   terms "${t.payment_terms}" → "Paid"   (${t.payment_method || 'no method'}, ${t.order_status})`)
    }
    const sum = targets.reduce((s, t) => s + Number(t.total), 0)
    console.log(`\n  ${money(sum)} moves from unrecorded to received.`)

    // Orders that are genuinely unpaid are none of this script's business.
    const { rows: [unpaid] } = await client.query(`
      SELECT count(*)::int AS n, COALESCE(SUM(total), 0) AS value
        FROM orders WHERE deleted_at IS NULL AND payment_status <> 'Paid'`)
    console.log(`\nOrders not marked Paid, left alone: ${unpaid.n} (${money(unpaid.value)})`)

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!targets.length) { console.log('\nNothing to repair.'); return }

    const before = (await client.query(
      `SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE deleted_at IS NULL`)).rows[0].v

    await client.query('BEGIN')
    const { rowCount } = await client.query(`
      UPDATE orders
         SET amount_paid = total,
             payment_terms = CASE WHEN payment_terms IS DISTINCT FROM 'Paid' THEN 'Paid' ELSE payment_terms END,
             updated_at = NOW()
       WHERE deleted_at IS NULL AND payment_status = 'Paid'
         AND ROUND(COALESCE(amount_paid, 0), 2) = 0 AND total > 0`)

    const { rows: [after] } = await client.query(`
      SELECT count(*) FILTER (WHERE payment_status = 'Paid' AND ROUND(COALESCE(amount_paid,0),2) = 0 AND total > 0)::int AS still_wrong,
             count(*) FILTER (WHERE payment_status = 'Paid' AND ROUND(amount_paid,2) > ROUND(total,2))::int AS overpaid,
             COALESCE(SUM(total), 0) AS value
        FROM orders WHERE deleted_at IS NULL`)

    if (after.still_wrong !== 0 || cents(after.value) !== cents(before)) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — ${after.still_wrong} still wrong, order value ${money(before)} → ${money(after.value)}`)
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nRepaired ${rowCount} order(s).`)
    console.log(`  orders marked Paid with nothing received: ${after.still_wrong}   ✓`)
    console.log(`  orders showing more received than they are worth: ${after.overpaid}` +
      (after.overpaid ? '   ← pre-existing, not caused here' : '   ✓'))
    console.log(`  total value of every order: ${money(after.value)} (unchanged — only how it is recorded)`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
