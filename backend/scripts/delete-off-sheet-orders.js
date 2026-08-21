#!/usr/bin/env node
/**
 * Soft-delete every sales order and purchase order that is not on one of the
 * two owner-supplied sheets, leaving exactly 97 of each.
 *
 *   TSI sheet  (Apr–Aug 2026)  88 DTF transfer orders + 88 purchase orders
 *   TS-PA sheet (May–Jun 2026)  9 custom apparel orders + 9 purchase orders
 *
 * WHAT GOES. Six hand-keyed apparel orders and four apparel purchase orders,
 * $960.41 of orders in total:
 *
 *   ORD-2026-0074  Thomas Garcia           $240.00
 *   ORD-2026-0075  Mac Dumas                $87.00
 *   ORD-2026-0077  Cory Pabilando Lehmann   $73.00
 *   ORD-2026-0083  Kenny Jones             $113.00
 *   ORD-2026-0099  Thomas Garcia           $391.41
 *   ORD-2026-0100  Tim Britt                $56.00
 *   PO-2026-0074, PO-2026-0080, PO-2026-0082, PO-2026-0083
 *
 * These are real, recently keyed orders marked Paid, and the owner was told so
 * and asked for them to go anyway. None has a payments-ledger row, so no ledger
 * entry is orphaned by this.
 *
 * THE WHOLE CHAIN GOES, not just the order. Each of these orders carries a
 * quotation and an invoice; removing the order alone would leave the invoice
 * live and pointing at a deleted order — the exact defect repaired earlier
 * today by repair-duplicate-invoices-2026-08-21.js — and would keep the money
 * visible in invoice reports. Quotation, invoice, order and purchase order are
 * removed together so the chain stays consistent.
 *
 * SOFT DELETE. Every row keeps its data and sets deleted_at, so the app and all
 * counts stop seeing it but nothing is destroyed. Restoring is one UPDATE per
 * table setting deleted_at back to NULL for the listed document numbers.
 *
 * Nothing on either sheet is touched, and the payments ledger is not written to.
 *
 * Idempotent. One transaction, rolls back on any error.
 *
 * Usage:
 *   node backend/scripts/delete-off-sheet-orders.js            (dry-run, default)
 *   node backend/scripts/delete-off-sheet-orders.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// A row is on-sheet if it is DTF/gangsheet, or carries a TS-PA reference.
// coalesce() matters: `NULL LIKE 'TS-PA-%'` is NULL, not false, and would
// silently exclude every hand-keyed row from the match.
const ORDER_OFF_SHEET = `o.order_type <> 'dtf' AND COALESCE(o.source_po_number,'') NOT LIKE 'TS-PA-%'`
const PO_OFF_SHEET    = `p.po_type <> 'gangsheet' AND COALESCE(p.source_po_number,'') NOT LIKE 'TS-PA-%'`

const money = n => Number(n).toFixed(2)
const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Refuse to run if any target carries a payments-ledger row. Deleting the
    // order would strand it, and the ledger is not this script's to touch.
    //
    // A payment can reach an order EITHER through payments.order_id OR through
    // payments.invoice_id alone — checking only order_id let $296 of real
    // payments (PAY-2026-0083 and one unnumbered PayPal row) end up pointing at
    // hidden invoices on the 2026-08-21 run. Both links are checked here.
    const { rows: withPayments } = await client.query(
      `SELECT o.order_number, COUNT(pay.id)::int AS n, SUM(pay.amount) AS total
         FROM orders o
         JOIN payments pay ON pay.order_id = o.id OR pay.invoice_id = o.invoice_id
        WHERE o.deleted_at IS NULL AND ${ORDER_OFF_SHEET}
        GROUP BY 1`)
    if (withPayments.length) {
      for (const w of withPayments) {
        console.error(`  ${w.order_number} has ${w.n} payment(s) totalling ${money(w.total)}`)
      }
      throw new Error('Off-sheet orders carry payments-ledger rows — stopping rather than stranding them')
    }

    const { rows: targets } = await client.query(
      `SELECT o.id, o.order_number, o.shipping_name, o.total,
              o.invoice_id, o.quotation_id,
              i.invoice_number, q.quote_number
         FROM orders o
         LEFT JOIN invoices i   ON i.id = o.invoice_id   AND i.deleted_at IS NULL
         LEFT JOIN quotations q ON q.id = o.quotation_id AND q.deleted_at IS NULL
        WHERE o.deleted_at IS NULL AND ${ORDER_OFF_SHEET}
        ORDER BY o.order_number`)

    let removedValue = 0
    for (const t of targets) {
      // Invoice first, so nothing is ever left pointing at a deleted order.
      if (t.invoice_id) {
        await client.query(
          `UPDATE invoices SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL`, [t.invoice_id])
      }
      if (t.quotation_id) {
        await client.query(
          `UPDATE quotations SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL`, [t.quotation_id])
      }
      await client.query(
        `UPDATE orders SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [t.id])
      removedValue += Number(t.total)
      note('DELETE', `${t.order_number}  ${t.shipping_name} ${money(t.total).padStart(9)}` +
                     `   chain: ${t.quote_number || '—'} → ${t.invoice_number || '—'} → ${t.order_number}`)
    }

    const { rows: pos } = await client.query(
      `UPDATE purchase_orders p SET deleted_at = NOW(), updated_at = NOW()
        WHERE p.deleted_at IS NULL AND ${PO_OFF_SHEET}
        RETURNING p.po_number, p.vendor_name, p.grand_total`)
    for (const p of pos) {
      note('DELETE', `${p.po_number}  ${p.vendor_name || '—'} ${money(p.grand_total).padStart(9)}`)
    }

    // ── Verify ───────────────────────────────────────────────────────────────
    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE order_type = 'dtf')::int AS dtf,
              COUNT(*) FILTER (WHERE COALESCE(source_po_number,'') LIKE 'TS-PA-%')::int AS apparel
         FROM orders WHERE deleted_at IS NULL`)
    const { rows: [p] } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE po_type = 'gangsheet')::int AS dtf,
              COUNT(*) FILTER (WHERE COALESCE(source_po_number,'') LIKE 'TS-PA-%')::int AS apparel
         FROM purchase_orders WHERE deleted_at IS NULL`)
    const { rows: [orph] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM invoices i
        WHERE i.deleted_at IS NULL AND i.order_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id AND o.deleted_at IS NULL)`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (nothing off-sheet — already clean)')
    if (targets.length) console.log(`\n  Order value removed: ${money(removedValue)}`)
    console.log('\nResulting state')
    console.log(`  Sales orders     ${c.total}   = ${c.dtf} DTF + ${c.apparel} apparel   (target 97)`)
    console.log(`  Purchase orders  ${p.total}   = ${p.dtf} DTF + ${p.apparel} apparel   (target 97)`)
    console.log(`  Live invoices pointing at a deleted order: ${orph.n}   (expected 0)`)

    const ok = c.total === 97 && p.total === 97 && orph.n === 0
    if (!ok) throw new Error(`Expected 97 orders and 97 POs with no orphan invoices, got ${c.total}/${p.total}/${orph.n}`)

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
