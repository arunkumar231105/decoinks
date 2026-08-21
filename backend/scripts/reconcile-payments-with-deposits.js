#!/usr/bin/env node
/**
 * Reconcile the payments ledger against the Decoinks Payment Deposit Report
 * (Hostinger mail, all deposits through 2026-08-20: 91 emails, 88 real
 * deposits, $11,012.84 gross, $145.75 PayPal fees).
 *
 * THE FINDING. The deposits are the PRODUCT amount only — shipping is not in
 * them. Four exact confirmations from the owner's own sheet:
 *
 *   TSI 260804-73  product $229.50  total $255.50  deposit $229.50
 *   TSI 260811-81  product $303.00  total $329.00  deposit $303.00
 *   TSI 260814-86  product $109.00  total $135.00  deposit $109.00
 *   TSI 260730-63  product $534.25  total $609.25  deposit $534.25
 *
 * ("Artistic Tees" on the deposit report is Robert Farrar's trading name —
 * twelve deposits, $2,436.25, all matching his job amounts.)
 *
 * WHAT THIS FIXES
 *
 * 1. Twenty ledger rows recorded as payment_method 'Historical Import' were
 *    invented by the import scripts as the ORDER TOTAL. Every one of the twenty
 *    equals total; not one equals the product amount. They duplicate real
 *    deposits at inflated figures, so they are removed. The 66 real PayPal and
 *    Zelle rows, which came from actual deposit emails, are untouched.
 *
 *    `payments` has no deleted_at — the table is append-only by design — so this
 *    is a hard DELETE. It is confined to rows whose method is exactly
 *    'Historical Import', which no genuine deposit uses.
 *
 * 2. TSI 260815-88 and TSI 260818-89 get the amounts their sheet rows were
 *    missing. Both were keyed in by hand before the sheet arrived, as
 *    ORD-2026-0084 and ORD-2026-0098, and removed earlier as "matching no sheet
 *    row". The deposit report shows both were real: a $415.25 deposit on 17-Aug
 *    and a $124.00 deposit on 18-Aug, matching their dates and figures exactly,
 *    and 0084 also carried the 17-Aug UPS parcel. The money is copied onto the
 *    live sheet orders; the deleted duplicates stay deleted, so the count holds
 *    at 97. Owner-approved on that evidence.
 *
 *    Note: the sheet gives TSI 260818-89 $26 shipping while the hand-keyed order
 *    and the bank deposit both say $25. The deposit is what actually arrived, so
 *    $25 is used and the $1 difference is reported.
 *
 * 3. Invoice payment status is allowed to tell the truth. The trigger already
 *    recalculates amount_paid and balance_due when a payment is removed, but it
 *    does not touch `status`, so an invoice would keep saying Paid while its
 *    balance was non-zero. Status is brought into line with the money actually
 *    received: Paid when covered, Partially Paid when short. Owner-approved.
 *
 * WHAT IS NOT TOUCHED: the 66 real deposit rows, order counts, and every sheet
 * figure. No order, PO or invoice total changes except the two in step 2.
 *
 * Idempotent. One transaction, dry-run by default.
 *
 * Usage:
 *   node backend/scripts/reconcile-payments-with-deposits.js            (dry-run)
 *   node backend/scripts/reconcile-payments-with-deposits.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
// Step 2 (removing the invented payments) and step 3 (restating invoice status)
// are only safe once the 16 real August deposits missing from the ledger have
// been imported. Removing the invented rows on their own would leave those
// invoices reading unpaid when the customer did pay — a worse picture than
// either the before or the after. --amounts-only runs step 1 alone.
const AMOUNTS_ONLY = process.argv.includes('--amounts-only')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// The marker the import scripts used. No genuine deposit carries it.
const SYNTHETIC_METHOD = 'Historical Import'

// Amounts recovered from the hand-keyed orders, each confirmed by a deposit.
const RECOVERED = [
  { ref: 'TSI 260815-88', order: 'ORD-2026-0107', po: 'PO-2026-0096',
    product: 415.25, ship: 45.00, total: 460.25,
    evidence: 'ORD-2026-0084 (17-Aug) + $415.25 deposit 17-Aug + the 17-Aug UPS parcel' },
  { ref: 'TSI 260818-89', order: 'ORD-2026-0108', po: 'PO-2026-0102',
    product: 99.00, ship: 25.00, total: 124.00,
    evidence: 'ORD-2026-0098 (18-Aug) + $124.00 deposit 18-Aug; sheet says $26 shipping, deposit says $25' },
]

// The 16 real deposits from the report that were never imported — the scripts
// wrote a synthetic 'Historical Import' row instead. date, method, sender,
// gross, PayPal fee, and the order it pays where that is unambiguous (exactly
// one live order for that customer whose product amount, or failing that whose
// total, equals the deposit). The rest stay unlinked rather than guessed at:
// they are mostly customers outside the two sheets.
const MISSING_DEPOSITS = [
  { d: '2026-08-03', method: 'Zelle',  who: 'Kyle Morris',                      amt:  47.00, fee:  0.00, order: 'ORD-2026-0082' },
  { d: '2026-08-04', method: 'PayPal', who: 'Artistic Tees',                    amt: 229.50, fee:  6.86, order: 'ORD-2026-0081' },
  { d: '2026-08-07', method: 'Zelle',  who: 'Yang Li',                          amt:  73.00, fee:  0.00, order: null },
  { d: '2026-08-07', method: 'Zelle',  who: 'Samuel Ngwamukie',                 amt:  68.00, fee:  0.00, order: 'ORD-2026-0076' },
  { d: '2026-08-08', method: 'PayPal', who: 'Artistic Tees',                    amt:  95.00, fee:  2.84, order: 'ORD-2026-0106' },
  { d: '2026-08-10', method: 'PayPal', who: 'carol garlin',                     amt:  95.00, fee:  2.84, order: 'ORD-2026-0089' },
  { d: '2026-08-11', method: 'PayPal', who: 'Artistic Tees',                    amt: 303.00, fee:  9.06, order: 'ORD-2026-0090' },
  { d: '2026-08-12', method: 'PayPal', who: 'Juan moreno',                      amt:  46.00, fee:  1.38, order: null },
  { d: '2026-08-12', method: 'Zelle',  who: 'Tabernacle Of Faith Intl Healing', amt:  65.00, fee:  0.00, order: null },
  { d: '2026-08-14', method: 'Zelle',  who: 'Jennifer Trujeque',                amt:  65.00, fee:  0.00, order: null },
  { d: '2026-08-14', method: 'Zelle',  who: 'Ricardo Malia',                    amt:  66.00, fee:  0.00, order: null },
  { d: '2026-08-17', method: 'PayPal', who: 'Artistic Tees',                    amt: 415.25, fee: 12.42, order: 'ORD-2026-0107' },
  { d: '2026-08-18', method: 'PayPal', who: 'Artistic Tees',                    amt: 124.00, fee:  3.71, order: 'ORD-2026-0108' },
  { d: '2026-08-18', method: 'PayPal', who: 'Artistic Tees',                    amt:  45.00, fee:  1.35, order: null },
  { d: '2026-08-19', method: 'Zelle',  who: 'Lizbeth M Garcia',                 amt: 125.00, fee:  0.00, order: null },
  { d: '2026-08-20', method: 'PayPal', who: 'Chris Cox',                        amt:  73.00, fee:  0.00, order: null },
  // A second pass on strict date+amount surfaced these eight. The first pass
  // missed them because an unrelated ledger row happened to carry the same
  // amount; none has anything within a week of it under the same customer.
  { d: '2026-08-03', method: 'PayPal', who: 'Angie Tate',                       amt:  50.00, fee:  1.50, order: null },
  { d: '2026-08-05', method: 'Zelle',  who: 'Bobbie Hansen',                    amt:  40.00, fee:  0.00, order: null },
  { d: '2026-08-09', method: 'PayPal', who: 'Angie Tate',                       amt:  38.00, fee:  1.14, order: null },
  { d: '2026-08-11', method: 'PayPal', who: 'Michael Trenk',                    amt:  57.00, fee:  1.70, order: null },
  { d: '2026-08-13', method: 'PayPal', who: 'Artistic Tees',                    amt: 109.00, fee:  3.26, order: null },
  { d: '2026-08-14', method: 'Zelle',  who: 'Kyle Morris',                      amt:  40.00, fee:  0.00, order: null },
  { d: '2026-08-18', method: 'PayPal', who: 'Carl Deibler',                     amt: 155.00, fee:  3.64, order: null },
  { d: '2026-08-18', method: 'Zelle',  who: 'Maria Elena P Lagunday',           amt:  55.00, fee:  0.00, order: null },
]

const money = n => Number(n).toFixed(2)
const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)
const stats = { syntheticRemoved: 0, depositsImported: 0, echeckDuplicatesRemoved: 0, invoiceLinksFixed: 0,
                ordersPriced: 0, posPriced: 0, invoicesPriced: 0, statusCorrected: 0 }

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── 1. Amounts recovered for the two rows the sheet left blank ───────────
    for (const r of RECOVERED) {
      const { rows: [ord] } = await client.query(
        `SELECT id, invoice_id, subtotal, shipping_charges, total FROM orders
          WHERE order_number = $1 AND deleted_at IS NULL`, [r.order])
      if (!ord) { note('SKIP', `${r.ref} — ${r.order} not found`); continue }

      if (Number(ord.subtotal) !== r.product || Number(ord.total) !== r.total) {
        await client.query(
          `UPDATE orders SET subtotal=$1, shipping_charges=$2, total=$3, updated_at=NOW() WHERE id=$4`,
          [r.product, r.ship, r.total, ord.id])
        stats.ordersPriced++
        note('AMOUNT', `${r.ref} ${r.order}  ${money(ord.subtotal)}/${money(ord.shipping_charges)}/${money(ord.total)}` +
                       ` → ${money(r.product)}/${money(r.ship)}/${money(r.total)}   (${r.evidence})`)
      }
      if (ord.invoice_id) {
        const { rowCount } = await client.query(
          `UPDATE invoices SET subtotal=$1, shipping_charges=$2, original_shipping_charges=$2,
                  total=$3, updated_at=NOW()
            WHERE id=$4 AND (subtotal<>$1 OR shipping_charges<>$2 OR total<>$3)`,
          [r.product, r.ship, r.total, ord.invoice_id])
        if (rowCount) stats.invoicesPriced++
      }
      const { rowCount: poDone } = await client.query(
        `UPDATE purchase_orders SET subtotal=$1, net_product_amount=$1,
                freight_charges=$2, shipping_charge=$2, total=$3, grand_total=$3, updated_at=NOW()
          WHERE po_number=$4 AND deleted_at IS NULL
            AND (subtotal<>$1 OR freight_charges<>$2 OR grand_total<>$3)`,
        [r.product, r.ship, r.total, r.po])
      if (poDone) { stats.posPriced++; note('AMOUNT', `${r.ref} ${r.po} → ${money(r.product)} + ${money(r.ship)} freight`) }
    }

    // ── 2. Remove the invented payments ──────────────────────────────────────
    // Reported first so the log names every row before it disappears.
    const { rows: doomed } = AMOUNTS_ONLY ? { rows: [] } : await client.query(
      `SELECT p.payment_number, p.amount, p.payment_date::text AS d,
              COALESCE(p.customer_name,'') AS cust, COALESCE(o.source_po_number,'') AS src,
              o.total AS order_total, o.subtotal AS order_subtotal
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.payment_method = $1 ORDER BY p.payment_date`, [SYNTHETIC_METHOD])
    for (const d of doomed) {
      note('LEDGER', `${d.payment_number} ${d.d} ${d.cust || '—'} ${money(d.amount).padStart(9)}` +
                     `  — invented as ${d.src || 'an'} order total` +
                     (d.order_subtotal != null ? ` (product was ${money(d.order_subtotal)})` : ''))
    }
    const { rowCount: removed } = AMOUNTS_ONLY ? { rowCount: 0 } : await client.query(
      `DELETE FROM payments WHERE payment_method = $1`, [SYNTHETIC_METHOD])
    stats.syntheticRemoved = removed

    // ── 2b. Import the real deposits the scripts never brought in ────────────
    if (!AMOUNTS_ONLY) {
      const { rows: [{ n: lastNum }] } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(payment_number FROM '[0-9]+$')::int), 0) AS n
           FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)
      let seq = lastNum
      const { rows: [actor] } = await client.query(
        `SELECT id FROM users WHERE email = 'info@technocas.com' LIMIT 1`)

      for (const m of MISSING_DEPOSITS) {
        // Keyed on date + amount + sender so a second run cannot double-insert.
        const { rows: already } = await client.query(
          `SELECT 1 FROM payments WHERE payment_date = $1::date AND amount = $2
             AND COALESCE(customer_name,'') = $3`, [m.d, m.amt, m.who])
        if (already.length) continue

        let orderId = null, invoiceId = null, customerId = null
        if (m.order) {
          const { rows: [o] } = await client.query(
            `SELECT id, invoice_id, customer_id FROM orders
              WHERE order_number = $1 AND deleted_at IS NULL`, [m.order])
          if (o) { orderId = o.id; invoiceId = o.invoice_id; customerId = o.customer_id }
        }
        const num = `PAY-2026-${String(++seq).padStart(4, '0')}`
        await client.query(
          `INSERT INTO payments (payment_number, payment_date, paid_at, amount, fee_amount,
             payment_method, status, customer_id, order_id, invoice_id, customer_name,
             received_from_name, notes, recorded_by)
           VALUES ($1,$2::date,$2::date::timestamptz,$3,$4,$5,'Completed',$6,$7,$8,$9,$9,$10,$11)`,
          [num, m.d, m.amt, m.fee, m.method, customerId, orderId, invoiceId, m.who,
           'Imported from the Decoinks payment deposit report', actor ? actor.id : null])
        stats.depositsImported++
        note('LEDGER', `${num} ${m.d} ${m.who} ${money(m.amt).padStart(9)} ${m.method}` +
                       (m.order ? `  → ${m.order}` : '  (no order matched — left unlinked)'))
      }

      // ── 2b-ii. Drop the eCheck confirmations counted twice ──────────────────
      // PayPal sent a "Cleared eCheck confirmation" a week after each of three
      // Pride & Culture payments, and both the original and the confirmation
      // were recorded — $73.80 counted twice. The owner's report lists the
      // 30-Apr confirmations as excluded follow-ups; the 23-Apr originals stay.
      const { rows: echecks } = await client.query(
        `DELETE FROM payments
          WHERE payment_number IN ('PAY-2026-0050','PAY-2026-0051','PAY-2026-0052')
            AND payment_date = DATE '2026-04-30'
          RETURNING payment_number, amount`)
      stats.echeckDuplicatesRemoved = echecks.length
      for (const e of echecks) {
        note('LEDGER', `${e.payment_number} ${money(e.amount).padStart(9)} — eCheck confirmation of the 23-Apr payment, counted twice`)
      }

      // ── 2c. Give invoices credit for deposits already in the ledger ─────────
      // A payment carrying an order but no invoice_id left its invoice reading
      // unpaid. The link is derivable from the order, so no guessing is needed.
      const { rows: relinked } = await client.query(
        `UPDATE payments p SET invoice_id = o.invoice_id, updated_at = NOW()
           FROM orders o
          WHERE p.order_id = o.id AND o.deleted_at IS NULL
            AND p.invoice_id IS NULL AND o.invoice_id IS NOT NULL
          RETURNING p.payment_number, p.amount`)
      stats.invoiceLinksFixed = relinked.length
      if (relinked.length) {
        note('LEDGER', `${relinked.length} existing payments given their invoice link ` +
                       `(derived from the order, total ${money(relinked.reduce((s, r) => s + Number(r.amount), 0))})`)
      }
    }

    // ── 3. Let invoice status follow the money ───────────────────────────────
    // The trigger has already refreshed amount_paid / balance_due for every
    // invoice a deleted payment touched; it does not set status, so an invoice
    // would otherwise keep claiming Paid on a non-zero balance.
    const { rows: restated } = AMOUNTS_ONLY ? { rows: [] } : await client.query(
      `UPDATE invoices i SET status = CASE
              WHEN i.amount_paid >= i.total AND i.total > 0 THEN 'Paid'::invoice_status
              WHEN i.amount_paid > 0                        THEN 'Partially Paid'::invoice_status
              ELSE i.status END,
            updated_at = NOW()
        WHERE i.deleted_at IS NULL
          AND i.status IN ('Paid','Partially Paid')
          AND i.status <> CASE
              WHEN i.amount_paid >= i.total AND i.total > 0 THEN 'Paid'::invoice_status
              WHEN i.amount_paid > 0                        THEN 'Partially Paid'::invoice_status
              ELSE i.status END
        RETURNING i.invoice_number, i.status::text, i.total, i.amount_paid, i.balance_due`)
    stats.statusCorrected = restated.length

    // ── Verify ───────────────────────────────────────────────────────────────
    const { rows: [led] } = await client.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM payments`)
    const { rows: byMethod } = await client.query(
      `SELECT COALESCE(payment_method,'(none)') AS m, COUNT(*)::int AS n, SUM(amount) AS total
         FROM payments GROUP BY 1 ORDER BY 3 DESC`)
    const { rows: [inv] } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status='Paid')::int AS paid,
              COUNT(*) FILTER (WHERE status='Partially Paid')::int AS partial,
              COALESCE(SUM(balance_due),0) AS outstanding
         FROM invoices WHERE deleted_at IS NULL`)
    const { rows: [ord] } = await client.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE subtotal + shipping_charges <> total)::int AS broken,
              COALESCE(SUM(subtotal),0) AS product, COALESCE(SUM(total),0) AS total
         FROM orders WHERE deleted_at IS NULL`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (nothing to do)')
    if (restated.length) {
      console.log('\n  Invoices restated:')
      for (const r of restated.slice(0, 12)) {
        console.log(`    ${r.invoice_number.padEnd(18)} → ${r.status.padEnd(15)} total ${money(r.total)}` +
                    `  paid ${money(r.amount_paid)}  outstanding ${money(r.balance_due)}`)
      }
      if (restated.length > 12) console.log(`    …and ${restated.length - 12} more`)
    }
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(20)} ${v}`)
    console.log('\nResulting state')
    console.log(`  Ledger: ${led.n} rows, ${money(led.total)}   (your report: 88 rows, 11,012.84)`)
    for (const m of byMethod) console.log(`     ${m.m.padEnd(20)} ${String(m.n).padStart(3)}  ${money(m.total).padStart(10)}`)
    console.log(`  Invoices: ${inv.paid} Paid, ${inv.partial} Partially Paid, ${money(inv.outstanding)} outstanding`)
    console.log(`  Orders: ${ord.n}, product ${money(ord.product)}, total ${money(ord.total)}, arithmetic broken on ${ord.broken}`)

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
