#!/usr/bin/env node
/**
 * Re-add the shipping that the invoice total dropped.
 *
 * calcTotal() in invoices.service.js computed subtotal − discount + tax and
 * ignored shipping_charges and rush_charges, even though both were stored on the
 * row. A $125 quote therefore arrived as a $110.16 invoice, and the sales order
 * inherited that total. The code is fixed; this repairs the rows it already
 * wrote.
 *
 * Only rows carrying the exact signature are touched: shipping or rush is on the
 * invoice, and the total equals subtotal − discount + tax to the cent, meaning
 * those charges were left out. An invoice whose total already accounts for them
 * is not recomputed, so a manually adjusted figure is never overwritten.
 *
 * Voided invoices are left alone. So is any invoice with money already against
 * it — raising a settled total silently would leave a customer owing a balance
 * nobody agreed; those are listed for the owner instead.
 *
 * Any sales order created from a repaired invoice is corrected with it, since
 * the order copied the same wrong figure.
 *
 * Usage:
 *   node backend/scripts/fix-invoice-totals-missing-shipping.js            (dry-run)
 *   node backend/scripts/fix-invoice-totals-missing-shipping.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SIGNATURE = `
  i.deleted_at IS NULL
  AND i.status::text <> 'Void'
  AND (COALESCE(i.shipping_charges,0) + COALESCE(i.rush_charges,0)) > 0
  AND abs(i.total - (i.subtotal - COALESCE(i.discount_amt,0) + COALESCE(i.tax_amt,0))) < 0.01`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT i.id, i.invoice_number, i.customer_name, i.status::text AS status,
              i.subtotal, i.discount_amt, i.tax_amt, i.shipping_charges, i.rush_charges,
              i.total, i.amount_paid,
              (i.subtotal - COALESCE(i.discount_amt,0) + COALESCE(i.tax_amt,0)
               + COALESCE(i.shipping_charges,0) + COALESCE(i.rush_charges,0))::numeric(12,2) AS correct_total,
              o.id AS order_id, o.order_number, o.total AS order_total
         FROM invoices i
         LEFT JOIN orders o ON o.invoice_id = i.id AND o.deleted_at IS NULL
        WHERE ${SIGNATURE}
        ORDER BY i.issue_date`)

    const fixable = rows.filter(r => Number(r.amount_paid || 0) === 0)
    const settled = rows.filter(r => Number(r.amount_paid || 0) > 0)

    console.log(`Invoices whose total left out shipping/rush: ${rows.length}\n`)
    for (const r of fixable) {
      console.log(`  ${r.invoice_number.padEnd(20)} ${String(r.customer_name || '').padEnd(20)} ${r.status.padEnd(8)} ` +
        `$${r.total} → $${r.correct_total}   (goods $${r.subtotal} + shipping $${r.shipping_charges}` +
        `${Number(r.rush_charges) ? ` + rush $${r.rush_charges}` : ''})` +
        `${r.order_number ? `   also ${r.order_number}: $${r.order_total} → $${r.correct_total}` : ''}`)
    }
    if (settled.length) {
      console.log(`\nLeft for the owner — money already received against these, so the total is not moved silently (${settled.length}):`)
      settled.forEach(r => console.log(`  ${r.invoice_number}  paid $${r.amount_paid} of $${r.total}, should be $${r.correct_total}`))
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    let invoices = 0, orders = 0
    for (const r of fixable) {
      await client.query(
        `UPDATE invoices SET total = $2, balance_due = $2 - COALESCE(amount_paid,0), updated_at = NOW()
          WHERE id = $1`, [r.id, r.correct_total])
      invoices++
      if (r.order_id) {
        await client.query(
          `UPDATE orders SET total = $2, shipping_charges = $3, rush_services = COALESCE(rush_services, $4),
                  updated_at = NOW()
            WHERE id = $1`,
          [r.order_id, r.correct_total, r.shipping_charges || 0, r.rush_charges || 0])
        orders++
      }
    }
    await client.query('COMMIT')
    console.log(`\nCorrected ${invoices} invoice(s) and ${orders} sales order(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
