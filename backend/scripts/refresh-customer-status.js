/**
 * Keep `customers.status` honest about who is still buying.
 *
 * A customer is Active while they have ordered recently, and Inactive once they
 * have not. "Recently" is `settings.customer_inactive_after_days`, 60 by
 * default — two months. Thirty was measured first and would have marked 47 of
 * 84 customers inactive, more than half the book; a print shop's customers
 * routinely go six weeks between jobs, so that reads as churn where there is
 * none.
 *
 * Only ever moves a customer between 'active' and 'inactive'. 'blocked' and
 * 'archived' are decisions somebody made on purpose and this must not overrule
 * them — nor should a nightly job quietly un-block a customer.
 *
 * A customer with no orders at all is measured from when they were created, so
 * one added this week stays Active while one added last year without ever
 * ordering does not.
 *
 * Dry run by default. Pass --apply to write.
 */

const db = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const DEFAULT_DAYS = 60
const MANAGED = ['active', 'inactive']

async function windowDays() {
  const { rows } = await db.query(
    `SELECT value FROM settings WHERE key = 'customer_inactive_after_days'`)
  const n = Number(rows[0]?.value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_DAYS
}

/**
 * The last thing that counts as the customer being alive.
 *
 * A sales order is the measure the owner asked for. Payments count too: money
 * arriving before the paperwork is the shop's habit now, and a customer who
 * paid last week is plainly not inactive merely because the invoice has not
 * been written yet.
 *
 * `created_at` is used ONLY for a customer who has never ordered or paid, as a
 * grace period for someone just added. It deliberately does not extend the life
 * of a customer who has traded: every one of the 84 customer records was
 * created within the last sixty days — the whole book was entered into this
 * system at once — so `created_at` says when the record was typed, not when the
 * relationship began. Folding it into the measure made every customer look
 * active and the rule did nothing at all.
 */
const ACTIVITY = `
  SELECT c.id,
         c.name,
         c.status,
         (SELECT MAX(o.order_date)::timestamptz FROM orders o
           WHERE o.customer_id = c.id AND o.deleted_at IS NULL)          AS last_order,
         (SELECT MAX(COALESCE(p.payment_date::timestamptz, p.paid_at)) FROM payments p
           WHERE p.customer_id = c.id)                                    AS last_payment,
         c.created_at
    FROM customers c
   WHERE c.deleted_at IS NULL
     AND lower(COALESCE(c.status, 'active')) = ANY($1::text[])`

async function main() {
  const days = await windowDays()
  const { rows } = await db.query(ACTIVITY, [MANAGED])

  const cutoff = new Date(Date.now() - days * 86400_000)
  const plan = rows.map(r => {
    const traded = [r.last_order, r.last_payment].filter(Boolean).map(d => new Date(d))
    // Traded before: judged on when they last did. Never traded: judged on how
    // long they have been on the books without doing so.
    const measuredFrom = traded.length
      ? new Date(Math.max(...traded.map(d => d.getTime())))
      : new Date(r.created_at)
    const should = measuredFrom >= cutoff ? 'active' : 'inactive'
    return {
      ...r,
      basis: traded.length ? 'last order/payment' : 'never ordered — since added',
      last_activity: measuredFrom,
      should,
      changes: should !== String(r.status || '').toLowerCase(),
    }
  })

  const toActive = plan.filter(p => p.changes && p.should === 'active')
  const toInactive = plan.filter(p => p.changes && p.should === 'inactive')

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`  inactive after            : ${days} days without an order or payment`)
  console.log(`  customers considered      : ${plan.length}   (blocked/archived untouched)`)
  console.log(`  becoming Inactive         : ${toInactive.length}`)
  console.log(`  becoming Active again     : ${toActive.length}`)
  console.log(`  already correct           : ${plan.length - toInactive.length - toActive.length}`)

  if (toInactive.length) {
    console.log('\n  first few going Inactive:')
    console.table(toInactive.slice(0, 8).map(p => ({
      customer: String(p.name).slice(0, 24),
      was: p.status,
      last_activity: p.last_activity.toISOString().slice(0, 10),
      basis: p.basis,
    })))
  }

  if (!APPLY) {
    console.log('\nRun again with --apply to write these changes.')
    return
  }

  for (const [status, group] of [['inactive', toInactive], ['active', toActive]]) {
    if (!group.length) continue
    const { rowCount } = await db.query(
      `UPDATE customers SET status = $2, updated_at = NOW()
        WHERE id = ANY($1::uuid[]) AND lower(COALESCE(status,'active')) = ANY($3::text[])`,
      [group.map(g => g.id), status, MANAGED])
    console.log(`  set ${rowCount} customer(s) to ${status}`)
  }

  const { rows: after } = await db.query(
    `SELECT status, count(*)::int AS n FROM customers WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`)
  console.log('')
  console.table(after)
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1 })
  .finally(() => process.exit(process.exitCode ?? 0))
