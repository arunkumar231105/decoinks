#!/usr/bin/env node
/**
 * Repair duplicates created by finalize-dtf-sales-orders.js on 2026-08-21.
 *
 * WHAT WENT WRONG
 *
 * When that script decided a sheet row was "missing", it looked for a sales
 * order and a purchase order — but not for an invoice. Two rows already had a
 * live invoice with no sales order attached, left behind by the earlier
 * importers. Building a fresh chain for them produced a second invoice for the
 * same job, and for one of them a second payment:
 *
 *   TSI 260720-53   INV-2026-0060 ($16)   already existed, no order attached
 *                   INV-2026-0102 ($16)   created in error
 *                   PAY-2026-0085 ($16)   created — the only ledger row for it
 *
 *   TSI 260808-77   INV-2026-0085 ($110)  already existed, no order attached
 *                                         paid by PAY-2026-0073
 *                   INV-2026-0106 ($110)  created in error
 *                   PAY-2026-0086 ($110)  created in error — a DUPLICATE of
 *                                         PAY-2026-0073, same customer, amount
 *                                         and date. $110 counted twice.
 *
 * Separately, soft-deleting ORD-2026-0084 and ORD-2026-0098 left their invoices
 * live, so two invoices pointed at orders that no longer exist.
 *
 * WHAT THIS DOES
 *
 * Keeps the ORIGINAL invoice in both cases — it is older, carries the real
 * payment history and sits in the right place in the number sequence — attaches
 * it to the sales order that was created for that row, and corrects its
 * subtotal to the sheet. The invoice created in error is soft-deleted.
 *
 * The ledger: PAY-2026-0085 is genuine (nothing else records that $16) and is
 * simply repointed to the invoice being kept. PAY-2026-0086 is deleted, because
 * it duplicates PAY-2026-0073 and was created by the faulty run minutes earlier
 * — this restores the ledger to what it was, it does not alter real history.
 * The trg_payments_sync_invoice trigger recalculates both invoices either way.
 *
 * Also corrects four apparel invoice subtotals whose orders were fixed by
 * finalize-apparel-sales-orders.js but whose invoices were not reached, using
 * the order's own figures. No total changes anywhere in this script.
 *
 * TSI 260604-21 legitimately has two invoices — the original $80 order and the
 * free $10 re-run. That is two different jobs sharing a PO number, not a
 * duplicate, and is left alone.
 *
 * Idempotent. One transaction, rolls back on any error.
 *
 * Usage:
 *   node backend/scripts/repair-duplicate-invoices-2026-08-21.js            (dry-run)
 *   node backend/scripts/repair-duplicate-invoices-2026-08-21.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// keep / drop / the order they belong to / the sheet's split
const DUPES = [
  { src: 'TSI 260720-53', keep: 'INV-2026-0060', drop: 'INV-2026-0102',
    order: 'ORD-2026-0102', product: 0.00,  ship: 16.00, total: 16.00,
    movePayment: 'PAY-2026-0085', deletePayment: null },
  { src: 'TSI 260808-77', keep: 'INV-2026-0085', drop: 'INV-2026-0106',
    order: 'ORD-2026-0106', product: 95.00, ship: 15.00, total: 110.00,
    movePayment: 'PAY-2026-0073', deletePayment: 'PAY-2026-0086' },
]

// Invoices whose sales order was soft-deleted as not-on-the-sheet.
const ORPHANED = ['INV-2026-0100', 'ROBERTFARRAR-0002']

// The same faulty run raised a second QUOTATION for the two rows above, for the
// same reason. Keep the original and drop the one created in error.
const DUPE_QUOTES = [
  { src: 'TSI 260720-53', keep: 'Q-2026-0061', drop: 'Q-2026-0103', order: 'ORD-2026-0102' },
  { src: 'TSI 260808-77', keep: 'Q-2026-0085', drop: 'Q-2026-0107', order: 'ORD-2026-0106' },
]

// Quotations left behind when their sales order was soft-deleted.
const ORPHANED_QUOTES = ['Q-2026-0101', 'QT-2026-0083']

const money = n => Number(n).toFixed(2)
const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)
const stats = { invoicesRepointed: 0, invoicesDropped: 0, paymentsMoved: 0,
                paymentsDeleted: 0, orphanInvoices: 0, apparelInvoices: 0,
                quotesRepointed: 0, quotesDropped: 0, orphanQuotes: 0 }

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const d of DUPES) {
      const { rows: [keep] } = await client.query(
        `SELECT id, total FROM invoices WHERE invoice_number = $1 AND deleted_at IS NULL`, [d.keep])
      const { rows: [drop] } = await client.query(
        `SELECT id FROM invoices WHERE invoice_number = $1 AND deleted_at IS NULL`, [d.drop])
      const { rows: [ord] } = await client.query(
        `SELECT id, invoice_id FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [d.order])
      if (!keep || !ord) { note('SKIP', `${d.src} — already repaired`); continue }

      // Release the duplicate's claim on the order before rewiring.
      if (drop) {
        await client.query(`UPDATE invoices SET order_id = NULL WHERE id = $1`, [drop.id])
      }

      await client.query(
        `UPDATE invoices SET subtotal = $1, shipping_charges = $2, total = $3,
                original_shipping_charges = $2, order_id = $4, updated_at = NOW()
          WHERE id = $5`, [d.product, d.ship, d.total, ord.id, keep.id])
      await client.query(`UPDATE orders SET invoice_id = $1, updated_at = NOW() WHERE id = $2`,
        [keep.id, ord.id])
      stats.invoicesRepointed++
      note('KEEP', `${d.src} → ${d.keep} attached to ${d.order}, split set to ` +
                   `${money(d.product)} + ${money(d.ship)} = ${money(d.total)}`)

      // Ledger. Move the genuine payment onto the invoice being kept; the
      // trigger settles amount_paid on both sides of the move.
      if (d.movePayment) {
        const { rowCount } = await client.query(
          `UPDATE payments SET invoice_id = $1, order_id = $2
            WHERE payment_number = $3 AND (invoice_id IS DISTINCT FROM $1 OR order_id IS DISTINCT FROM $2)`,
          [keep.id, ord.id, d.movePayment])
        if (rowCount) { stats.paymentsMoved++; note('LEDGER', `${d.movePayment} repointed to ${d.keep} / ${d.order}`) }
      }
      if (d.deletePayment) {
        const { rowCount } = await client.query(
          `DELETE FROM payments WHERE payment_number = $1`, [d.deletePayment])
        if (rowCount) {
          stats.paymentsDeleted++
          note('LEDGER', `${d.deletePayment} DELETED — duplicate of ${d.movePayment}, same customer, amount and date`)
        }
      }

      if (drop) {
        await client.query(
          `UPDATE invoices SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [drop.id])
        stats.invoicesDropped++
        note('DROP', `${d.drop} soft-deleted — created in error`)
      }
    }

    for (const num of ORPHANED) {
      const { rowCount } = await client.query(
        `UPDATE invoices i SET deleted_at = NOW(), updated_at = NOW()
          WHERE i.invoice_number = $1 AND i.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id AND o.deleted_at IS NULL)`,
        [num])
      if (rowCount) { stats.orphanInvoices++; note('DROP', `${num} soft-deleted — its sales order was removed`) }
    }

    // Quotations: same keep-the-original treatment as the invoices above.
    for (const d of DUPE_QUOTES) {
      const { rows: [keep] } = await client.query(
        `SELECT id FROM quotations WHERE quote_number = $1 AND deleted_at IS NULL`, [d.keep])
      const { rows: [drop] } = await client.query(
        `SELECT id FROM quotations WHERE quote_number = $1 AND deleted_at IS NULL`, [d.drop])
      const { rows: [ord] } = await client.query(
        `SELECT id, quotation_id FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [d.order])
      if (!keep || !ord || ord.quotation_id === keep.id) continue

      await client.query(`UPDATE orders SET quotation_id = $1, updated_at = NOW() WHERE id = $2`,
        [keep.id, ord.id])
      await client.query(`UPDATE invoices SET quote_id = $1, updated_at = NOW()
                           WHERE order_id = $2 AND deleted_at IS NULL`, [keep.id, ord.id])
      stats.quotesRepointed++
      note('KEEP', `${d.src} → ${d.keep} attached to ${d.order}`)

      if (drop) {
        await client.query(
          `UPDATE quotations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [drop.id])
        stats.quotesDropped++
        note('DROP', `${d.drop} soft-deleted — created in error`)
      }
    }

    for (const num of ORPHANED_QUOTES) {
      const { rowCount } = await client.query(
        `UPDATE quotations q SET deleted_at = NOW(), updated_at = NOW()
          WHERE q.quote_number = $1 AND q.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id AND o.deleted_at IS NULL)`,
        [num])
      if (rowCount) { stats.orphanQuotes++; note('DROP', `${num} soft-deleted — its sales order was removed`) }
    }

    // Apparel invoices whose orders were corrected but whose own split was not.
    const { rows: fixed } = await client.query(
      `UPDATE invoices i
          SET subtotal = o.subtotal, shipping_charges = o.shipping_charges,
              total = o.total, updated_at = NOW()
         FROM orders o
        WHERE o.id = i.order_id AND o.deleted_at IS NULL AND i.deleted_at IS NULL
          AND o.order_type = 'apparel'
          AND i.subtotal + COALESCE(i.shipping_charges,0) <> i.total
          AND o.subtotal + o.shipping_charges = o.total
          AND i.total = o.total
        RETURNING i.invoice_number, o.order_number, i.subtotal, i.shipping_charges, i.total`)
    for (const f of fixed) {
      note('MONEY', `${f.invoice_number} (${f.order_number}) → ${money(f.subtotal)} + ${money(f.shipping_charges)} = ${money(f.total)}`)
    }
    stats.apparelInvoices = fixed.length

    // ── Verify ───────────────────────────────────────────────────────────────
    const { rows: dupQ } = await client.query(
      `SELECT source_po_number, COUNT(*)::int AS n,
              string_agg(quote_number, ', ' ORDER BY created_at) AS which
         FROM quotations WHERE deleted_at IS NULL AND source_po_number IS NOT NULL
        GROUP BY 1 HAVING COUNT(*) > 1`)
    const { rows: [orphQ] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM quotations q
        WHERE q.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id AND o.deleted_at IS NULL)`)
    const { rows: dupInv } = await client.query(
      `SELECT source_po_number, COUNT(*)::int AS n,
              string_agg(invoice_number, ', ' ORDER BY created_at) AS which
         FROM invoices WHERE deleted_at IS NULL AND source_po_number IS NOT NULL
        GROUP BY 1 HAVING COUNT(*) > 1`)
    const { rows: dupPay } = await client.query(
      `SELECT customer_name, amount, payment_date, COUNT(*)::int AS n
         FROM payments GROUP BY 1,2,3 HAVING COUNT(*) > 1`)
    const { rows: [bad] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM invoices
        WHERE deleted_at IS NULL AND subtotal + COALESCE(shipping_charges,0)
              + COALESCE(rush_charges,0) + COALESCE(rush_services,0)
              - COALESCE(discount_amt,0) + COALESCE(tax_amt,0) <> total`)
    const { rows: [orph] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM invoices i
        WHERE i.deleted_at IS NULL AND i.order_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id AND o.deleted_at IS NULL)`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (nothing to repair)')
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(20)} ${v}`)
    console.log('\nResulting state')
    console.log(`  Source refs with >1 live invoice: ${dupInv.length}`)
    for (const d of dupInv) console.log(`     ${d.source_po_number}: ${d.which}`)
    console.log(`  Duplicate payments (same customer/amount/date): ${dupPay.length}`)
    console.log(`  Invoices where the money does not add up: ${bad.n}   (expected 0)`)
    console.log(`  Live invoices pointing at a deleted order: ${orph.n}   (expected 0)`)
    console.log(`  Source refs with >1 live quotation: ${dupQ.length}`)
    for (const d of dupQ) console.log(`     ${d.source_po_number}: ${d.which}`)
    console.log(`  Quotations with no live order: ${orphQ.n}   (open quotes are legitimate)`)

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
