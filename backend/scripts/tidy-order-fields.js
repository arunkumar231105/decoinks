#!/usr/bin/env node
/**
 * Fill in and settle the order fields the shop reviews the export on.
 *
 * Six things, each from something already in the database rather than invented:
 *
 *  Channel is not here. The shop wants it read as TSI DTF Transfer, TSI DTF
 *  Apparel or DIGI DTF Apparel, but that is the channel and the order type said
 *  together — both already stored. It is derived in the list and the export
 *  instead of written a third time, so the two halves cannot drift apart, and
 *  the existing channel filter keeps working.
 *
 *  TERMS     Advance on every order. The shop's rule: the sales order is only
 *            raised once the money is in.
 *
 *  METHOD    Sixty-four orders have none. Fifty-five of them have one on their
 *            invoice, and that is where it comes from — not a default. The nine
 *            with nothing behind them are listed and left empty rather than
 *            filled with a guess. The spelling is also settled: PayPal and
 *            paypal, Zelle and zelle were four values for two methods, and the
 *            form's own list is lower case.
 *
 *  PAID      Same rule as the terms. One order is held back: it carries a real
 *            balance the shop said it was chasing, and writing it off here
 *            would contradict that. Named in the output.
 *
 *  AGENT     Technocas on every order.
 *
 *  TRACKING  Ten orders have no tracking number of their own. Where their
 *            purchase order has one it is copied across; the courier column is
 *            derived from the number's shape, so filling one fills both. No
 *            number is invented for an order that has none anywhere.
 *
 * Usage:
 *   node backend/scripts/tidy-order-fields.js            (dry-run)
 *   node backend/scripts/tidy-order-fields.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

// The order the shop said it is chasing; its money is real.
const HELD_BACK = 'ORD-2026-0118'

// What the form's own dropdown offers, so a filled value is selectable.
const METHOD = `CASE lower(btrim(m))
    WHEN 'paypal' THEN 'paypal'
    WHEN 'zelle' THEN 'zelle'
    WHEN 'cashapp' THEN 'cashapp' WHEN 'cash app' THEN 'cashapp'
    WHEN 'cash' THEN 'cash'
    WHEN 'bank transfer' THEN 'bank_transfer' WHEN 'bank_transfer' THEN 'bank_transfer'
    ELSE 'other' END`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const one = async (sql, p) => (await client.query(sql, p)).rows[0]

  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const before = await one(`
      SELECT count(*)::int AS live,
             count(*) FILTER (WHERE payment_terms IS DISTINCT FROM 'Advance')::int AS terms_to_set,
             count(*) FILTER (WHERE COALESCE(NULLIF(btrim(payment_method),''),'') = '')::int AS method_missing,
             count(*) FILTER (WHERE payment_method IS NOT NULL AND payment_method <> lower(payment_method))::int AS method_mixed_case,
             count(*) FILTER (WHERE payment_status <> 'Paid')::int AS not_paid,
             count(*) FILTER (WHERE assigned_to IS NULL)::int AS no_agent,
             count(*) FILTER (WHERE COALESCE(NULLIF(btrim(tracking_number),''),'') = '')::int AS no_tracking,
             -- One order was already marked Paid for less than its total before
             -- this ran. The check at the end asks whether that number grew,
             -- not whether it is zero: a condition this script did not create
             -- is not a reason to refuse the work it was asked to do.
             count(*) FILTER (WHERE payment_status = 'Paid' AND ROUND(COALESCE(amount_paid,0),2) < ROUND(total,2))::int AS paid_but_short
        FROM orders WHERE deleted_at IS NULL`)

    console.log(`${before.live} live orders\n`)
    console.log(`  payment terms to set         ${before.terms_to_set}`)
    console.log(`  payment method missing       ${before.method_missing}`)
    console.log(`  payment method mixed case    ${before.method_mixed_case}`)
    console.log(`  not yet marked Paid          ${before.not_paid}`)
    console.log(`  no agent                     ${before.no_agent}`)
    console.log(`  no tracking number           ${before.no_tracking}`)

    // ── What each source can actually supply ────────────────────────────
    const method = await one(`
      SELECT count(*)::int AS missing,
             count(*) FILTER (WHERE NULLIF(btrim(i.payment_method),'') IS NOT NULL)::int AS from_invoice
        FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
       WHERE o.deleted_at IS NULL AND COALESCE(NULLIF(btrim(o.payment_method),''),'') = ''`)
    console.log(`\n  Payment method: ${method.from_invoice} of ${method.missing} can be read off the invoice; ` +
      `${method.missing - method.from_invoice} have no source and stay empty.`)

    const track = await one(`
      SELECT count(*)::int AS missing,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM purchase_orders p
                WHERE p.order_id = o.id AND p.deleted_at IS NULL
                  AND NULLIF(btrim(p.tracking_number),'') IS NOT NULL))::int AS from_po
        FROM orders o
       WHERE o.deleted_at IS NULL AND COALESCE(NULLIF(btrim(o.tracking_number),''),'') = ''`)
    console.log(`  Tracking: ${track.from_po} of ${track.missing} can be copied from the purchase order; ` +
      `${track.missing - track.from_po} have none anywhere and stay empty.`)

    const { rows: held } = await client.query(`
      SELECT o.order_number, c.name AS customer, o.total, o.amount_paid
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.deleted_at IS NULL AND o.payment_status <> 'Paid' AND o.order_number = $1`, [HELD_BACK])
    if (held.length) {
      console.log(`\n  Held back from Paid: ${held[0].order_number} — ${held[0].customer}, ` +
        `$${Number(held[0].total).toFixed(2)} with $${Number(held[0].amount_paid).toFixed(2)} received.`)
      console.log('      The shop named this one as owed. Everything else is marked Paid.')
    }

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }

    const { rows: [agent] } = await client.query(
      `SELECT id, name FROM users WHERE is_active AND lower(name) = 'technocas' LIMIT 1`)
    if (!agent) throw new Error('No active user named Technocas to assign the orders to')

    await client.query('BEGIN')

    const n = {}
    n.terms = (await client.query(`
      UPDATE orders SET payment_terms = 'Advance', updated_at = NOW()
       WHERE deleted_at IS NULL AND payment_terms IS DISTINCT FROM 'Advance'`)).rowCount

    n.methodFilled = (await client.query(`
      UPDATE orders o SET payment_method = i.payment_method, updated_at = NOW()
        FROM invoices i
       WHERE i.id = o.invoice_id AND o.deleted_at IS NULL
         AND COALESCE(NULLIF(btrim(o.payment_method),''),'') = ''
         AND NULLIF(btrim(i.payment_method),'') IS NOT NULL`)).rowCount

    n.methodTidied = (await client.query(`
      UPDATE orders SET payment_method = (SELECT ${METHOD} FROM (SELECT payment_method AS m) t), updated_at = NOW()
       WHERE deleted_at IS NULL AND NULLIF(btrim(payment_method),'') IS NOT NULL
         AND payment_method IS DISTINCT FROM (SELECT ${METHOD} FROM (SELECT payment_method AS m) t)`)).rowCount

    n.paid = (await client.query(`
      UPDATE orders SET payment_status = 'Paid', amount_paid = GREATEST(COALESCE(amount_paid,0), total),
             updated_at = NOW()
       WHERE deleted_at IS NULL AND payment_status <> 'Paid' AND order_number <> $1`, [HELD_BACK])).rowCount

    n.agent = (await client.query(
      `UPDATE orders SET assigned_to = $1, updated_at = NOW() WHERE deleted_at IS NULL AND assigned_to IS DISTINCT FROM $1`,
      [agent.id])).rowCount

    n.tracking = (await client.query(`
      UPDATE orders o SET tracking_number = p.tracking_number, updated_at = NOW()
        FROM purchase_orders p
       WHERE p.order_id = o.id AND p.deleted_at IS NULL AND o.deleted_at IS NULL
         AND COALESCE(NULLIF(btrim(o.tracking_number),''),'') = ''
         AND NULLIF(btrim(p.tracking_number),'') IS NOT NULL`)).rowCount

    // ── Proof ───────────────────────────────────────────────────────────
    const after = await one(`
      SELECT count(*)::int AS live,
             count(*) FILTER (WHERE payment_terms IS DISTINCT FROM 'Advance')::int AS terms_not_advance,
             count(*) FILTER (WHERE payment_status <> 'Paid')::int AS not_paid,
             count(*) FILTER (WHERE assigned_to IS NULL)::int AS no_agent,
             count(*) FILTER (WHERE payment_method IS NOT NULL AND payment_method <> lower(payment_method))::int AS mixed_case,
             count(*) FILTER (WHERE COALESCE(NULLIF(btrim(payment_method),''),'') = '')::int AS method_missing,
             count(*) FILTER (WHERE COALESCE(NULLIF(btrim(tracking_number),''),'') = '')::int AS no_tracking,
             count(*) FILTER (WHERE payment_status = 'Paid' AND ROUND(COALESCE(amount_paid,0),2) < ROUND(total,2))::int AS paid_but_short,
             COALESCE(SUM(total),0) AS value
        FROM orders WHERE deleted_at IS NULL`)

    const problems = []
    if (after.live !== before.live) problems.push(`orders ${before.live} → ${after.live}`)
    if (after.terms_not_advance) problems.push(`${after.terms_not_advance} order(s) not on Advance terms`)
    if (after.not_paid > 1) problems.push(`${after.not_paid} order(s) still not Paid, expected 1`)
    if (after.no_agent) problems.push(`${after.no_agent} order(s) with no agent`)
    if (after.mixed_case) problems.push(`${after.mixed_case} payment method(s) still mixed case`)
    if (after.paid_but_short > before.paid_but_short) {
      problems.push(`orders marked Paid for less than their total ${before.paid_but_short} → ${after.paid_but_short}`)
    }

    if (problems.length) {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written:')
      problems.forEach(p => console.log(`  ✗ ${p}`))
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nDone.`)
    console.log(`  payment terms set to Advance ${n.terms}`)
    console.log(`  payment method filled        ${n.methodFilled} from the invoice`)
    console.log(`  payment method tidied        ${n.methodTidied} spellings settled`)
    console.log(`  marked Paid                  ${n.paid}`)
    console.log(`  agent set to ${agent.name.padEnd(16)} ${n.agent}`)
    console.log(`  tracking copied from the PO  ${n.tracking}`)
    console.log(`\n  still without a payment method: ${after.method_missing}  (no source anywhere)`)
    console.log(`  still without a tracking number: ${after.no_tracking}  (none anywhere)`)
    console.log(`  still not Paid: ${after.not_paid}  (${HELD_BACK}, held back)`)
    console.log(`  marked Paid for less than their total: ${after.paid_but_short}` +
      ` (was ${before.paid_but_short} — pre-existing, untouched here)`)
    console.log(`  total value of every order: $${Number(after.value).toFixed(2)} (unchanged)`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
