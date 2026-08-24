#!/usr/bin/env node
/**
 * Settle the invoices whose only outstanding amount is the shipping.
 *
 * Eighteen invoices show a balance. Sixteen of them owe an amount equal, to the
 * cent, to their own shipping charge — $15.00 against $15.00, $26.00 against
 * $26.00, $45.00 against $45.00. That is not sixteen customers who each paid
 * for the goods and refused the postage; it is the import writing the goods
 * figure into amount_paid and never adding the shipping on top. The same
 * mistake was already found and corrected on the DIGI apparel orders, where the
 * sheet proved that what the customer paid included the shipping.
 *
 * So those sixteen are settled: amount received becomes the total, nothing due,
 * status Paid.
 *
 * TWO ARE NOT TOUCHED, because their gap is not the shipping and the pattern
 * that justifies the other sixteen says nothing about them:
 *
 *   INV/RFA  Robert Farrar, $609.25, of which $71.50 came in. The gap is
 *            $537.75 against a $75.00 shipping charge. A real balance.
 *   BMO      Blanca Moz, $66.00, a draft raised the same day with nothing
 *            received. Marking a draft paid would be inventing a payment.
 *
 * NO PAYMENT RECEIPTS ARE CREATED — the shipping was paid alongside the goods,
 * on a day and by a means no record here knows. Same line as the fourteen
 * invoices, the eleven orders and the six DIGI orders before them.
 *
 * Usage:
 *   node backend/scripts/settle-invoices-missing-their-shipping.js            (dry-run)
 *   node backend/scripts/settle-invoices-missing-their-shipping.js --apply
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

const MATCHES_SHIPPING = `
  ROUND(i.balance_due, 2) = ROUND(COALESCE(i.shipping_charges, 0), 2)
  AND COALESCE(i.shipping_charges, 0) > 0`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows: all } = await client.query(`
      SELECT i.id, i.invoice_number, i.status::text AS status, i.total, i.amount_paid,
             i.balance_due, COALESCE(i.shipping_charges, 0) AS shipping,
             COALESCE(NULLIF(TRIM(i.customer_name), ''), c.name) AS customer,
             (${MATCHES_SHIPPING}) AS gap_is_the_shipping
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.deleted_at IS NULL AND ROUND(i.balance_due, 2) <> 0
       ORDER BY i.balance_due DESC`)

    const settle = all.filter(r => r.gap_is_the_shipping)
    const leave = all.filter(r => !r.gap_is_the_shipping)

    console.log(`Invoices showing a balance: ${all.length}\n`)
    console.log(`Settling — the gap is exactly the shipping: ${settle.length}`)
    for (const r of settle) {
      console.log(`  ${r.invoice_number.padEnd(12)} ${(r.customer || '—').padEnd(22)} ` +
        `${money(r.total)} total, ${money(r.amount_paid)} received, ${money(r.balance_due)} due = shipping ${money(r.shipping)}`)
    }
    console.log(`\n  ${money(settle.reduce((s, r) => s + Number(r.balance_due), 0))} moves from owed to received.`)

    if (leave.length) {
      console.log(`\nLeft alone — the gap is not the shipping: ${leave.length}`)
      for (const r of leave) {
        console.log(`  ${r.invoice_number.padEnd(12)} ${(r.customer || '—').padEnd(22)} ` +
          `${money(r.total)} total, ${money(r.amount_paid)} received, ${money(r.balance_due)} due, shipping ${money(r.shipping)}  [${r.status}]`)
      }
    }

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!settle.length) { console.log('\nNothing to settle.'); return }

    // Six invoices already show more received than they are worth — the
    // misattributed payments found earlier, none of them this script's doing.
    // The check below asks whether that number grew, not whether it is zero.
    const { rows: [before] } = await client.query(`
      SELECT COALESCE(SUM(total), 0) AS value,
             count(*) FILTER (WHERE status = 'Paid' AND ROUND(amount_paid, 2) <> ROUND(total, 2))::int AS ledger_off
        FROM invoices WHERE deleted_at IS NULL`)

    await client.query('BEGIN')
    const { rowCount } = await client.query(`
      UPDATE invoices i
         SET amount_paid = i.total, balance_due = 0, status = 'Paid'::invoice_status,
             paid_at = COALESCE(i.paid_at, NOW()), updated_at = NOW()
       WHERE i.deleted_at IS NULL AND ROUND(i.balance_due, 2) <> 0 AND ${MATCHES_SHIPPING}`)

    const { rows: [after] } = await client.query(`
      SELECT count(*)::int AS live,
             count(*) FILTER (WHERE ROUND(balance_due, 2) <> 0)::int AS still_owing,
             count(*) FILTER (WHERE status = 'Partially Paid')::int AS partially_paid,
             count(*) FILTER (WHERE status = 'Paid' AND ROUND(amount_paid, 2) <> ROUND(total, 2))::int AS paid_but_ledger_disagrees,
             COALESCE(SUM(balance_due), 0) AS outstanding,
             COALESCE(SUM(total), 0) AS value
        FROM invoices WHERE deleted_at IS NULL`)

    if (cents(after.value) !== cents(before.value) || after.paid_but_ledger_disagrees > before.ledger_off) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — invoice value ${money(before.value)} → ${money(after.value)}, ` +
        `paid invoices whose ledger disagrees ${before.ledger_off} → ${after.paid_but_ledger_disagrees}.`)
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nSettled ${rowCount} invoice(s).`)
    console.log(`  invoices still showing a balance: ${after.still_owing} (${money(after.outstanding)})` +
      `${after.still_owing === leave.length ? ' — the ones named above' : '   ← unexpected'}`)
    console.log(`  still marked Partially Paid: ${after.partially_paid}`)
    console.log(`  paid invoices whose ledger disagrees: ${after.paid_but_ledger_disagrees}` +
      ` (was ${before.ledger_off} — the misattributed payments, untouched here)   ✓`)
    console.log(`  total value of every invoice: ${money(after.value)} (unchanged — only how it is recorded)`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
