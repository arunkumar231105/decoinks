/**
 * Close out invoices whose money was collected offline but never recorded.
 *
 * The owner confirmed on 2026-08-31 that every outstanding customer invoice had
 * in fact been paid — by Zelle, PayPal, cash and the rest — and that only the
 * bookkeeping was behind. This writes that down properly: a payment row for
 * each, then the status.
 *
 * Three decisions worth knowing about:
 *
 * 1. The amount comes from the ledger, not from `balance_due`. Several drafts
 *    carry an `amount_paid` that no payment row backs, so the cached balance is
 *    not trustworthy; `total - SUM(payments)` is.
 *
 * 2. Payments are dated to the invoice, not to today. Stamping 57 payments with
 *    today's date would move roughly $3,900 of historical revenue into this
 *    month and quietly corrupt every dashboard figure and monthly report.
 *
 * 3. `order_id` is left null where the order already carries a payment.
 *    `uq_payments_one_per_order` allows one payment per sales order and would
 *    reject the insert; the invoice link is what matters here anyway.
 *
 * Dry run by default, as every script in this directory is. Pass --apply to
 * write. --apply first copies every row it will touch into a restore table.
 */

const db = require('../src/config/db')
const { getNextNumber } = require('../src/utils/counter')

const APPLY = process.argv.includes('--apply')
const METHOD = 'other'
const NOTE = 'Historical reconciliation 2026-08-31 — collected offline before online payments existed; original method and date not recorded.'
const BACKUP = 'zz_backup_reconcile_20260831'

const money = n => `$${Number(n).toFixed(2)}`

async function main() {
  const { rows } = await db.query(`
    SELECT i.id, i.invoice_number, i.status, i.total, i.amount_paid, i.balance_due,
           i.issue_date, i.created_at, i.order_id, i.customer_id, i.customer_name,
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS ledger_paid,
           EXISTS (SELECT 1 FROM payments p WHERE p.order_id = i.order_id AND i.order_id IS NOT NULL) AS order_settled
      FROM invoices i
     WHERE i.supplier_id IS NULL
       AND i.status NOT IN ('Paid', 'Void')
       -- The 'D-' rows are not invoices anyone issued. They were generated from
       -- payments during a 2026-08 reconciliation: 29 point at soft-deleted
       -- 'D-' order shells, 28 have no line items, 40 have no customer at all,
       -- and several duplicate a payment that is already in the ledger. The
       -- owner has twice refused to restore that family of records because it
       -- invents revenue with no job behind it. Writing payments against them
       -- here would do exactly that, and by a larger amount.
       AND i.invoice_number NOT LIKE 'D-%'
       -- A zero-total invoice was never money. Marking it "paid" says something
       -- untrue about it and there is nothing to record.
       AND i.total > 0
     ORDER BY i.issue_date NULLS LAST, i.invoice_number`)

  const plan = rows.map(r => {
    const outstanding = +(Number(r.total) - Number(r.ledger_paid)).toFixed(2)
    return {
      ...r,
      outstanding,
      action: outstanding > 0 ? 'payment + mark Paid' : 'mark Paid only (nothing outstanding)',
      linkOrder: Boolean(r.order_id) && !r.order_settled,
    }
  })

  const withPayment = plan.filter(p => p.outstanding > 0)
  const statusOnly = plan.filter(p => p.outstanding <= 0)
  const sum = withPayment.reduce((t, p) => t + p.outstanding, 0)
  const staleCached = plan.filter(p => Math.abs(Number(p.balance_due) - p.outstanding) > 0.01)

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n${'='.repeat(64)}`)
  console.log(`Invoices to close out       : ${plan.length}`)
  console.log(`  payment recorded + Paid   : ${withPayment.length}   ${money(sum)}`)
  console.log(`  Paid only (zero balance)  : ${statusOnly.length}`)
  console.log(`Order link skipped (already settled): ${withPayment.filter(p => p.order_id && !p.linkOrder).length}`)
  console.log(`Cached balance_due was wrong on     : ${staleCached.length}  ← amount taken from the ledger instead`)

  console.log('\nFirst 12 rows:')
  console.table(plan.slice(0, 12).map(p => ({
    invoice: p.invoice_number,
    status: p.status,
    customer: (p.customer_name || '').slice(0, 22),
    total: money(p.total),
    cached_balance: money(p.balance_due),
    will_record: p.outstanding > 0 ? money(p.outstanding) : '—',
    dated: String(p.issue_date || p.created_at).slice(0, 10),
  })))

  if (!APPLY) {
    console.log('\nRun again with --apply to write these changes.')
    return
  }

  /* ── Backup before touching anything ──────────────────────────────────── */
  await db.query(`DROP TABLE IF EXISTS ${BACKUP}`)
  await db.query(`
    CREATE TABLE ${BACKUP} AS
    SELECT id, invoice_number, status, amount_paid, balance_due, paid_at, updated_at, NOW() AS backed_up_at
      FROM invoices WHERE id = ANY($1::uuid[])`, [plan.map(p => p.id)])
  const { rows: bk } = await db.query(`SELECT count(*) FROM ${BACKUP}`)
  console.log(`\nBacked up ${bk[0].count} invoice rows into ${BACKUP}`)

  let payments = 0
  let statuses = 0
  const failures = []

  for (const p of plan) {
    const client = await db.getClient()
    try {
      await client.query('BEGIN')

      if (p.outstanding > 0) {
        const number = await getNextNumber('PAY', 'payments', 'payment_number')
        const when = p.issue_date || String(p.created_at).slice(0, 10)
        await client.query(
          `INSERT INTO payments
             (payment_number, payment_date, paid_at, amount, payment_method, status,
              invoice_id, order_id, customer_id, customer_name, reference_no, notes)
           VALUES ($1, $2::date, $2::date, $3, $4, 'Completed',
                   $5, $6, $7, $8, $9, $10)`,
          [number, when, p.outstanding, METHOD,
           p.id, p.linkOrder ? p.order_id : null, p.customer_id, p.customer_name,
           p.invoice_number, NOTE])
        payments++
      }

      await client.query(
        `UPDATE invoices
            SET status = 'Paid'::invoice_status,
                paid_at = COALESCE(paid_at, COALESCE(issue_date::timestamptz, created_at)),
                updated_at = NOW()
          WHERE id = $1`, [p.id])
      statuses++

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      failures.push({ invoice: p.invoice_number, error: err.message })
    } finally {
      client.release()
    }
  }

  console.log(`\nPayments written : ${payments}`)
  console.log(`Invoices marked  : ${statuses}`)
  if (failures.length) {
    console.log(`\nFailed on ${failures.length}:`)
    console.table(failures)
  }

  /* ── Verify ───────────────────────────────────────────────────────────── */
  const { rows: after } = await db.query(`
    SELECT status, count(*) AS n, sum(balance_due)::numeric(12,2) AS owed
      FROM invoices WHERE supplier_id IS NULL GROUP BY 1 ORDER BY 1`)
  console.log('\nCustomer invoices now:')
  console.table(after)

  const { rows: mismatch } = await db.query(`
    SELECT count(*) AS still_wrong FROM invoices i
     WHERE i.supplier_id IS NULL AND i.status = 'Paid' AND i.balance_due > 0.01`)
  console.log(`Invoices marked Paid that still show a balance: ${mismatch[0].still_wrong}`)
  console.log(`\nTo undo: the previous status/amounts are in ${BACKUP}.`)
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1 })
  .finally(() => process.exit(process.exitCode ?? 0))
