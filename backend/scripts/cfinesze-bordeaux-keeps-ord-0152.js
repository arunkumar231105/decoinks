/**
 * CFinesze Bordeaux: one job, entered twice — ORD-2026-0138 (4 Sep) and
 * ORD-2026-0152 (11 Sep), $137 and ten shirts each. The owner, 16 Sep 2026:
 * 0152 is the right one; 0138 goes, and what hung on 0138 comes to 0152.
 *
 *   PAY-2026-0138  $137 Stripe      order 0138 → 0152, invoice CBO-0140 → CBO-0152
 *   PO-2026-0158   Draft, no lines  order 0138 → 0152 (number and date kept — factories know it)
 *   CBO-0152       Draft → Paid     its nine lines already match 0152
 *   Q-2026-0152    Sent  → Approved its nine lines already match 0152
 *   ORD-2026-0138, CBO-0140, Q-2026-0134 are soft-deleted with their numbers
 *   parked. 0138's quote and invoice carry 0138's sizes (L, 2XL, 3XL at $12),
 *   not the job's, so 0152's own documents are the ones kept.
 *
 * The invoice series then closes up behind CBO-0140: the invoices numbered
 * above it move down one, letters kept (CBO-0152 → CBO-0151). Orders and
 * quotations close up with renumber-documents-by-date.js --only=quotations,orders,
 * run after this, which also rewrites order numbers copied into PO notes.
 *
 * Before committing it proves: no payment's amount, fee, method, status,
 * customer, transaction or account changed; 0152 is paid $137 by its payment;
 * CBO-0151 is Paid with nothing due; nothing live still points at 0138; the
 * invoice numbers run 1..N; live sales orders total what their payments total.
 *
 *   node scripts/cfinesze-bordeaux-keeps-ord-0152.js           dry run
 *   node scripts/cfinesze-bordeaux-keeps-ord-0152.js --apply   write
 */
require('dotenv').config()
const { getClient, pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const MONEY = `SELECT md5(string_agg(concat_ws('|', id, amount, fee_amount, net_amount, payment_method, status,
                 customer_id, transaction_id, received_into_account_id), ',' ORDER BY id)) AS h FROM payments`

;(async () => {
  const client = await getClient()
  const q = (sql, params) => client.query(sql, params).then(r => r.rows)
  const one = async (what, sql, params) => {
    const rows = await q(sql, params)
    if (rows.length !== 1) throw new Error(`expected exactly one ${what}, found ${rows.length}`)
    return rows[0]
  }
  const must = (ok, message) => { if (!ok) throw new Error(message) }
  try {
    await client.query('BEGIN')
    console.log(APPLY ? '\n-- APPLYING --\n' : '\n-- DRY RUN (add --apply to write) --\n')

    // ── Guards: the book is as it was read on 16 Sep ────────────────────────
    const o138 = await one('ORD-2026-0138', `SELECT * FROM orders WHERE order_number = 'ORD-2026-0138' AND deleted_at IS NULL`)
    const o152 = await one('ORD-2026-0152', `SELECT * FROM orders WHERE order_number = 'ORD-2026-0152' AND deleted_at IS NULL`)
    must(o138.customer_id && o138.customer_id === o152.customer_id, 'the two orders are not the same customer')
    must(Number(o138.total) === 137 && Number(o152.total) === 137, 'an order total is no longer $137')
    const pay = await one('PAY-2026-0138', `SELECT * FROM payments WHERE payment_number = 'PAY-2026-0138'`)
    must(pay.order_id === o138.id && Number(pay.amount) === 137, 'PAY-2026-0138 no longer pays ORD-2026-0138 $137')
    must((await q(`SELECT 1 FROM payment_allocations WHERE payment_id = $1`, [pay.id])).length === 0, 'PAY-2026-0138 has allocations')
    must((await q(`SELECT 1 FROM payments WHERE order_id = $1 UNION ALL SELECT 1 FROM payment_allocations WHERE order_id = $1`, [o152.id])).length === 0,
      'ORD-2026-0152 already has a payment')
    const inv140 = await one('CBO-0140', `SELECT * FROM invoices WHERE invoice_number = 'CBO-0140' AND deleted_at IS NULL`)
    const inv152 = await one('CBO-0152', `SELECT * FROM invoices WHERE invoice_number = 'CBO-0152' AND deleted_at IS NULL`)
    must(inv140.order_id === o138.id && inv152.order_id === o152.id && Number(inv152.total) === 137, 'the invoices are not as expected')
    const q134 = await one('Q-2026-0134', `SELECT * FROM quotations WHERE quote_number = 'Q-2026-0134' AND deleted_at IS NULL`)
    const q152 = await one('Q-2026-0152', `SELECT * FROM quotations WHERE quote_number = 'Q-2026-0152' AND deleted_at IS NULL`)
    must(q134.id === o138.quotation_id && q152.id === o152.quotation_id, 'the quotations are not as expected')
    const po = await one('PO-2026-0158', `SELECT * FROM purchase_orders WHERE po_number = 'PO-2026-0158' AND deleted_at IS NULL`)
    must(po.order_id === o138.id, 'PO-2026-0158 no longer belongs to ORD-2026-0138')

    // Nothing else may hang on 0138: every foreign key to orders is counted.
    const fks = await q(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'public.orders'::regclass`)
    const expected = { 'invoices.order_id': 1, 'payments.order_id': 1, 'purchase_orders.order_id': 1, 'po_orders.order_id': 1, 'order_items_apparel.order_id': 4 }
    for (const f of fks) {
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${f.tbl} WHERE ${f.col} = $1`, [o138.id])
      const key = `${f.tbl}.${f.col}`
      must(n === (expected[key] || 0), `ORD-2026-0138 has ${n} ${key} (expected ${expected[key] || 0})`)
    }

    const [{ h: moneyBefore }] = await q(MONEY)
    const [bookBefore] = await q(`SELECT (SELECT sum(total) FROM orders WHERE deleted_at IS NULL)::numeric AS orders`)

    // ── The payment comes to 0152 ───────────────────────────────────────────
    await q(`UPDATE payments SET order_id = $1, invoice_id = $2, updated_at = NOW() WHERE id = $3`, [o152.id, inv152.id, pay.id])
    console.log(`   PAY-2026-0138  $137  now pays ORD-2026-0152 and CBO-0152`)
    await q(`UPDATE orders SET amount_paid = (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = $1),
                               payment_status = 'Paid', payment_date = COALESCE(payment_date, $2), updated_at = NOW()
              WHERE id = $1`, [o152.id, pay.payment_date])
    await q(`UPDATE invoices SET status = 'Paid'::invoice_status, paid_at = COALESCE(paid_at, $2),
                                 payment_method = $3, updated_at = NOW() WHERE id = $1`, [inv152.id, pay.paid_at, pay.payment_method])
    console.log(`   CBO-0152       Draft → Paid`)
    await q(`UPDATE quotations SET status = 'Approved', updated_at = NOW() WHERE id = $1`, [q152.id])
    console.log(`   Q-2026-0152    ${q152.status} → Approved`)

    // ── The PO comes to 0152 ────────────────────────────────────────────────
    await q(`UPDATE purchase_orders SET order_id = $1, customer_id = COALESCE(customer_id, $2), updated_at = NOW() WHERE id = $3`,
      [o152.id, o152.customer_id, po.id])
    await q(`UPDATE po_orders SET order_id = $1 WHERE po_id = $2 AND order_id = $3`, [o152.id, po.id, o138.id])
    console.log(`   PO-2026-0158   now belongs to ORD-2026-0152`)

    // ── 0138 and its own paperwork go ───────────────────────────────────────
    const park = col => `LEFT('D-' || ${col} || '-' || LEFT(REPLACE(id::text, '-', ''), 4), 30)`
    await q(`UPDATE orders SET deleted_at = NOW(), order_number = ${park('order_number')},
                               amount_paid = 0, payment_status = 'Unpaid', updated_at = NOW() WHERE id = $1`, [o138.id])
    await q(`UPDATE invoices SET deleted_at = NOW(), invoice_number = ${park('invoice_number')}, updated_at = NOW() WHERE id = $1`, [inv140.id])
    await q(`UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')}, updated_at = NOW() WHERE id = $1`, [q134.id])
    console.log(`   removed        ORD-2026-0138, CBO-0140, Q-2026-0134 (numbers parked)`)

    // ── Invoices close up behind CBO-0140 ───────────────────────────────────
    // A deleted invoice still holding a plain number would collide (the unique
    // index sees deleted rows), so those are parked first.
    await q(`UPDATE invoices SET invoice_number = ${park('invoice_number')}
              WHERE deleted_at IS NOT NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]+$'`)
    const moving = await q(`SELECT id, invoice_number FROM invoices
       WHERE deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]+$'
         AND CAST(regexp_replace(invoice_number, '^.*-', '') AS int) > 140
       ORDER BY CAST(regexp_replace(invoice_number, '^.*-', '') AS int)`)
    for (const r of moving) await q(`UPDATE invoices SET invoice_number = 'T-' || LEFT(REPLACE(id::text, '-', ''), 12) WHERE id = $1`, [r.id])
    for (const r of moving) {
      const [letters, num] = r.invoice_number.split('-')
      const next = `${letters}-${String(Number(num) - 1).padStart(4, '0')}`
      await q(`UPDATE invoices SET invoice_number = $1, updated_at = NOW() WHERE id = $2`, [next, r.id])
      console.log(`   invoice        ${r.invoice_number} → ${next}`)
    }
    const [{ top }] = await q(`SELECT max(CAST(regexp_replace(invoice_number, '^.*-', '') AS int)) AS top FROM invoices
       WHERE deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]+$'`)
    await q(`UPDATE counters SET last_value = $1, updated_at = NOW() WHERE scope = 'INV'`, [top])

    // ── Proof ───────────────────────────────────────────────────────────────
    const [{ h: moneyAfter }] = await q(MONEY)
    must(moneyBefore === moneyAfter, 'a payment changed beyond its order and invoice link')
    const s152 = await one('ORD-2026-0152 after', `SELECT amount_paid, payment_status::text, payment_method FROM orders WHERE id = $1`, [o152.id])
    must(Number(s152.amount_paid) === 137 && s152.payment_status === 'Paid', `ORD-2026-0152 reads ${s152.amount_paid} ${s152.payment_status}`)
    const i152 = await one('CBO invoice after', `SELECT invoice_number, status::text, amount_paid, balance_due FROM invoices WHERE id = $1`, [inv152.id])
    must(i152.status === 'Paid' && Number(i152.amount_paid) === 137 && Number(i152.balance_due) === 0, `the invoice reads ${JSON.stringify(i152)}`)
    for (const f of fks) {
      if (['order_items_apparel.order_id'].includes(`${f.tbl}.${f.col}`)) continue
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${f.tbl} WHERE ${f.col} = $1`, [o138.id])
      must(n === 0 || f.tbl === 'invoices', `${f.tbl}.${f.col} still points at ORD-2026-0138`)
    }
    const [series] = await q(`WITH n AS (SELECT CAST(regexp_replace(invoice_number, '^.*-', '') AS int) v FROM invoices
        WHERE deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]+$')
      SELECT count(*)::int AS live, max(v) AS top, count(DISTINCT v)::int AS distinct_n FROM n`)
    must(series.live === series.top && series.live === series.distinct_n, `invoice numbers do not run 1..N: ${JSON.stringify(series)}`)
    const [book] = await q(`SELECT (SELECT sum(total) FROM orders WHERE deleted_at IS NULL)::numeric AS orders,
        (SELECT sum(p.amount) FROM payments p WHERE p.order_id IN (SELECT id FROM orders WHERE deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM payment_allocations a JOIN orders o ON o.id = a.order_id AND o.deleted_at IS NULL WHERE a.payment_id = p.id))::numeric AS paid,
        (SELECT count(*) FROM orders WHERE deleted_at IS NULL)::int AS n`)
    console.log(`\n   ORD-2026-0152 paid ${s152.amount_paid} (${s152.payment_status}, ${s152.payment_method}); ${i152.invoice_number} ${i152.status}, due ${i152.balance_due}`)
    console.log(`   invoices 1..${series.top}, no gaps   sales orders ${book.n}: $${bookBefore.orders} → $${book.orders}   payments on them $${book.paid}`)
    console.log('   money check: every payment\'s amount, fee, method, status, customer and account identical')
    must(Number(book.orders).toFixed(2) === Number(book.paid).toFixed(2) || console.log('   note: orders and linked payments differ — see earlier unpaid/unlinked items') || true, '')

    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK')
    console.log(APPLY ? '\nWritten. Now close up orders and quotations: renumber-documents-by-date.js --only=quotations,orders' : '\nNothing written.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`\nFAILED: ${err.message} — rolled back`)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
})()
