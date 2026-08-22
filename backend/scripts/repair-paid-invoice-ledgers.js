#!/usr/bin/env node
/**
 * Make the ledger agree with the status on invoices that say they are paid.
 *
 * Fourteen invoices carry status Paid and a paid_at date, and their own ledger
 * still shows the whole amount owed: amount_paid 0.00, balance_due equal to the
 * total. Every one of them arrived through an import — the import wrote the
 * status and the date it was paid on, and never wrote the money. $990 in all.
 *
 * The contradiction is not harmless. The print page reads the status, so the
 * customer's copy prints TOTAL DUE $0.00, while every list and report that
 * reads balance_due shows the money still outstanding. Whichever is right, the
 * two must not disagree.
 *
 * The owner's answer: the money was received. So the ledger is brought up to
 * the status the import asserted — amount_paid becomes the total, balance_due
 * becomes zero, paid_at is left exactly as the import recorded it.
 *
 * NO PAYMENT RECEIPTS ARE INVENTED. A row in the payments module is a record of
 * a transaction — its method, its reference, the day it cleared. None of that
 * is known here, and a made-up receipt is worse than a missing one. Thirty-eight
 * further invoices are settled on their own ledger with no receipt behind them;
 * they are reported and left alone, deliberately.
 *
 * Usage:
 *   node backend/scripts/repair-paid-invoice-ledgers.js            (dry-run)
 *   node backend/scripts/repair-paid-invoice-ledgers.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows: targets } = await client.query(`
      SELECT id, invoice_number, total, amount_paid, balance_due, paid_at::date AS paid_at,
             COALESCE(source_system, '(entered in the app)') AS source
        FROM invoices
       WHERE deleted_at IS NULL AND status = 'Paid' AND ROUND(balance_due, 2) <> 0
       ORDER BY invoice_number`)

    console.log(`Marked Paid, whole amount still shown as owed: ${targets.length}`)
    for (const t of targets) {
      console.log(`  ${t.invoice_number}  total ${money(t.total)}  paid ${money(t.amount_paid)} → ${money(t.total)}` +
        `   owed ${money(t.balance_due)} → $0.00   (paid on ${t.paid_at || 'no date'}, from ${t.source})`)
    }
    const sum = targets.reduce((s, t) => s + Number(t.total), 0)
    console.log(`\n  ${money(sum)} moves from owed to received.`)

    // Reported, not touched.
    const { rows: [noReceipt] } = await client.query(`
      SELECT count(*)::int AS n, COALESCE(SUM(total), 0) AS value
        FROM invoices i
       WHERE i.deleted_at IS NULL AND i.status = 'Paid' AND ROUND(i.balance_due, 2) = 0
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)`)
    console.log(`\nSettled on their own ledger but with no payment receipt: ${noReceipt.n} (${money(noReceipt.value)})`)
    console.log('  Left alone — a receipt records a real transaction and none of its details are known here.')

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }
    if (!targets.length) { console.log('\nNothing to repair.'); return }

    await client.query('BEGIN')
    const { rowCount } = await client.query(`
      UPDATE invoices
         SET amount_paid = total, balance_due = 0, updated_at = NOW()
       WHERE deleted_at IS NULL AND status = 'Paid' AND ROUND(balance_due, 2) <> 0`)

    // Prove it: no invoice now contradicts itself, and no total was altered.
    const { rows: [after] } = await client.query(`
      SELECT count(*) FILTER (WHERE status = 'Paid' AND ROUND(balance_due,2) <> 0)::int AS still_wrong,
             count(*) FILTER (WHERE ROUND(COALESCE(amount_paid,0) + COALESCE(balance_due,0) - total, 2) <> 0)::int AS ledger_off,
             SUM(total) AS value_of_every_invoice
        FROM invoices WHERE deleted_at IS NULL`)
    const { rows: [check] } = await client.query(
      `SELECT SUM(total) AS v FROM invoices WHERE deleted_at IS NULL`)

    if (after.still_wrong !== 0) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — ${after.still_wrong} invoice(s) still contradict themselves.`)
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nRepaired ${rowCount} invoice(s).`)
    console.log(`  invoices whose status and ledger still disagree: ${after.still_wrong}   ✓`)
    console.log(`  invoices where paid + owed does not equal the total: ${after.ledger_off}` +
      (after.ledger_off === 0 ? '   ✓' : '   ← pre-existing, not caused here'))
    console.log(`  total value of every invoice: ${money(check.v)} (unchanged — only how it is split)`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
