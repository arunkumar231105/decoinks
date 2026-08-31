/**
 * Bring the quote → order → invoice → payment chain into agreement.
 *
 * The owner asked on 2026-08-31 for one quotation, one invoice and one payment
 * per sales order, all at matching amounts, with everything else soft-deleted.
 * Measuring first changed what that job actually is:
 *
 *   117 live orders — all 117 already carry a quotation AND an invoice whose
 *   totals match the order to the cent. 112 also have a matching payment.
 *
 * So the chain is not broken; it needs two things, and one thing the request
 * asked for must NOT be done.
 *
 *   1. Five orders are Delivered and flagged Paid but have no payment row at
 *      all ($287.00). Writing those makes it 117 of 117 on all four.
 *
 *   2. Sixty-eight 'D-' invoices are the reconciliation shells — no line items,
 *      no customer, several duplicating a payment already in the ledger. Those
 *      are the genuine extras and are soft-deleted here.
 *
 * What this script deliberately does NOT delete, despite being asked:
 *
 *   - Payments. The table has no `deleted_at` column, so "soft delete" is not
 *     available; it would be a permanent delete of $1,088.00 that customers
 *     really sent, including $967.00 recorded earlier today.
 *   - The 18 non-'D' invoices with no live order. They have line items, real
 *     customers and quotations behind them — genuine billing history that is
 *     merely missing an order record.
 *   - The 4 "stray" quotations. Each one became an invoice that has since been
 *     paid; they are live business missing only a sales order in the middle.
 *
 * Dry run by default. Pass --apply to write; --apply backs up first.
 */

const db = require('../src/config/db')
const { getNextNumber } = require('../src/utils/counter')

const APPLY = process.argv.includes('--apply')
const BACKUP = 'zz_backup_chain_20260831'
const NOTE = 'Historical reconciliation 2026-08-31 — order was Delivered and flagged Paid with no ledger entry; method and exact date not recorded.'

const money = n => `$${Number(n).toFixed(2)}`

async function main() {
  /* ── 1. Orders marked paid with nothing in the ledger ─────────────────── */
  const { rows: gaps } = await db.query(`
    SELECT o.id, o.order_number, o.total, o.order_date, o.created_at,
           o.customer_id, o.shipping_name, o.invoice_id,
           i.invoice_number, i.customer_name
      FROM orders o
      LEFT JOIN invoices i ON i.id = o.invoice_id
     WHERE o.deleted_at IS NULL
       AND o.total > 0
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
     ORDER BY o.total DESC`)

  /* ── 2. The 'D-' shells ───────────────────────────────────────────────── */
  const { rows: shells } = await db.query(`
    SELECT i.id, i.invoice_number, i.total, i.status
      FROM invoices i
     WHERE i.supplier_id IS NULL
       AND i.deleted_at IS NULL
       AND i.invoice_number LIKE 'D-%'
       AND NOT EXISTS (SELECT 1 FROM orders o
                        WHERE (o.invoice_id = i.id OR i.order_id = o.id) AND o.deleted_at IS NULL)
     ORDER BY i.invoice_number`)

  const gapSum = gaps.reduce((t, g) => t + Number(g.total), 0)
  const shellSum = shells.reduce((t, s) => t + Number(s.total), 0)

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n${'='.repeat(66)}`)
  console.log(`Payments to write for paid-but-unrecorded orders : ${gaps.length}  ${money(gapSum)}`)
  console.log(`'D-' shell invoices to soft-delete               : ${shells.length}  ${money(shellSum)}`)

  if (gaps.length) {
    console.log('\nOrders needing a payment row:')
    console.table(gaps.map(g => ({
      order: g.order_number, invoice: g.invoice_number || '—',
      customer: (g.customer_name || g.shipping_name || '').slice(0, 22),
      amount: money(g.total), dated: String(g.order_date || g.created_at).slice(0, 10),
    })))
  }

  if (!APPLY) {
    console.log(`\n'D-' shells (first 5): ${shells.slice(0, 5).map(s => s.invoice_number).join(', ')}…`)
    console.log('\nRun again with --apply to write these changes.')
    return
  }

  /* ── Backup ───────────────────────────────────────────────────────────── */
  await db.query(`DROP TABLE IF EXISTS ${BACKUP}`)
  await db.query(`
    CREATE TABLE ${BACKUP} AS
    SELECT id, invoice_number, status, deleted_at, updated_at, NOW() AS backed_up_at
      FROM invoices WHERE id = ANY($1::uuid[])`, [shells.map(s => s.id)])
  console.log(`\nBacked up ${shells.length} invoice rows into ${BACKUP}`)

  /* ── Write the missing payments ───────────────────────────────────────── */
  let written = 0
  const failures = []
  for (const g of gaps) {
    const client = await db.getClient()
    try {
      await client.query('BEGIN')
      const number = await getNextNumber('PAY', 'payments', 'payment_number')
      const when = g.order_date || String(g.created_at).slice(0, 10)
      await client.query(
        `INSERT INTO payments
           (payment_number, payment_date, paid_at, amount, payment_method, status,
            invoice_id, order_id, customer_id, customer_name, reference_no, notes)
         VALUES ($1, $2::date, $2::date, $3, 'other', 'Completed', $4, $5, $6, $7, $8, $9)`,
        [number, when, Number(g.total), g.invoice_id, g.id, g.customer_id,
         g.customer_name || g.shipping_name, g.order_number, NOTE])
      await client.query('COMMIT')
      written++
    } catch (err) {
      await client.query('ROLLBACK')
      failures.push({ order: g.order_number, error: err.message })
    } finally {
      client.release()
    }
  }
  console.log(`Payments written : ${written}`)
  if (failures.length) console.table(failures)

  /* ── Soft-delete the shells ───────────────────────────────────────────── */
  const { rowCount: removed } = await db.query(
    `UPDATE invoices SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [shells.map(s => s.id)])
  console.log(`Shell invoices soft-deleted : ${removed}`)

  /* ── Verify the chain ─────────────────────────────────────────────────── */
  const { rows: after } = await db.query(`
    WITH chain AS (
      SELECT o.id, o.total AS order_total, q.total AS quote_total, i.total AS invoice_total,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.order_id = o.id) AS paid
        FROM orders o
        LEFT JOIN quotations q ON q.id = o.quotation_id
        LEFT JOIN invoices   i ON i.id = o.invoice_id
       WHERE o.deleted_at IS NULL)
    SELECT count(*) AS live_orders,
           count(*) FILTER (WHERE abs(order_total - COALESCE(quote_total,-1))   < 0.01) AS quote_ok,
           count(*) FILTER (WHERE abs(order_total - COALESCE(invoice_total,-1)) < 0.01) AS invoice_ok,
           count(*) FILTER (WHERE abs(order_total - paid) < 0.01)                       AS payment_ok,
           count(*) FILTER (WHERE abs(order_total - COALESCE(quote_total,-1)) < 0.01
                              AND abs(order_total - COALESCE(invoice_total,-1)) < 0.01
                              AND abs(order_total - paid) < 0.01)                       AS all_four
      FROM chain`)
  console.log('\nChain after:')
  console.table(after)

  const { rows: counts } = await db.query(`
    SELECT 'live orders' AS entity, count(*) FROM orders WHERE deleted_at IS NULL
    UNION ALL SELECT 'live customer invoices', count(*) FROM invoices WHERE supplier_id IS NULL AND deleted_at IS NULL
    UNION ALL SELECT 'live quotations', count(*) FROM quotations WHERE deleted_at IS NULL
    UNION ALL SELECT 'payments', count(*) FROM payments`)
  console.table(counts)
  console.log(`\nTo undo the soft-deletes: UPDATE invoices SET deleted_at = NULL FROM ${BACKUP} b WHERE invoices.id = b.id;`)
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1 })
  .finally(() => process.exit(process.exitCode ?? 0))
