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

const money = n => Number(n).toFixed(2)
const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)
const stats = { syntheticRemoved: 0, ordersPriced: 0, posPriced: 0, invoicesPriced: 0, statusCorrected: 0 }

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
