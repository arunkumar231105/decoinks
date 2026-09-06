/**
 * The shop takes the whole amount before the work starts.
 *
 * So an invoice here is never part-paid and never carries a balance — and yet
 * the book showed $1,057.15 outstanding across 142 invoices, including $425.15
 * sitting on invoices already marked Paid. That is not money anyone is waiting
 * for; it is arithmetic that was never finished.
 *
 * Three things are settled here:
 *   1. Every live invoice is Paid, with amount_paid equal to its total and
 *      nothing due. Partially Paid stops existing, because half a payment is
 *      not something this shop accepts.
 *   2. Each one gets its document stage, which migration 130 added: what the
 *      old status said about the document, kept, while status keeps the money.
 *   3. The due date is the invoice date. Payment is due on the day it is
 *      raised, so a later date was only ever a blank filled in by habit.
 *
 * Void invoices are left alone. A cancelled invoice is not a paid one.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')

  const before = (await query(
    `SELECT status::text AS status, count(*)::INT AS n,
            round(sum(total), 2) AS total,
            round(sum(COALESCE(balance_due, 0)), 2) AS balance,
            count(*) FILTER (WHERE due_date IS DISTINCT FROM issue_date)::INT AS due_date_alag,
            count(*) FILTER (WHERE invoice_stage IS NULL)::INT AS bina_stage
       FROM invoices WHERE deleted_at IS NULL
      GROUP BY 1 ORDER BY 2 DESC`)).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('  abhi:')
  for (const r of before)
    console.log(`    ${r.status.padEnd(16)} ${String(r.n).padStart(4)}  ` +
                `total ${money(r.total).padStart(11)}  balance ${money(r.balance).padStart(10)}  ` +
                `due-date alag ${String(r.due_date_alag).padStart(3)}  bina stage ${String(r.bina_stage).padStart(3)}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    // The document's own progress, taken from what the old status said about it.
    // A Paid or Overdue invoice reached the customer, so it was Sent.
    await query(
      `UPDATE invoices SET invoice_stage = CASE status::text
              WHEN 'Draft' THEN 'Draft'
              ELSE 'Sent' END
        WHERE invoice_stage IS NULL`)

    // Paid in full, nothing due. A Draft has not been issued yet, and a Void
    // was cancelled — neither is a payment received.
    await query(
      `UPDATE invoices
          SET status = 'Paid'::invoice_status,
              amount_paid = total,
              balance_due = 0,
              paid_at = COALESCE(paid_at, (COALESCE(issue_date, created_at::date))::timestamptz),
              updated_at = NOW()
        WHERE deleted_at IS NULL AND status::text NOT IN ('Void', 'Draft')`)

    // Due on the day it is raised.
    await query(
      `UPDATE invoices SET due_date = issue_date, updated_at = NOW()
        WHERE deleted_at IS NULL AND due_date IS DISTINCT FROM issue_date AND issue_date IS NOT NULL`)

    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT count(*)::INT AS invoices,
            count(*) FILTER (WHERE status::text = 'Paid')::INT AS paid,
            count(*) FILTER (WHERE status::text = 'Partially Paid')::INT AS part_paid,
            round(sum(COALESCE(balance_due, 0)), 2) AS balance,
            count(*) FILTER (WHERE due_date IS DISTINCT FROM issue_date)::INT AS due_date_alag,
            count(*) FILTER (WHERE invoice_stage IS NULL)::INT AS bina_stage
       FROM invoices WHERE deleted_at IS NULL`)).rows[0]
  console.log(`\n  ab: ${after.invoices} invoices — ${after.paid} paid, ${after.part_paid} partially paid, ` +
              `balance ${money(after.balance)}, due-date alag ${after.due_date_alag}, bina stage ${after.bina_stage}\n`)
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
