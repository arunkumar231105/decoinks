/**
 * Four orders for Robert Farrar were one job entered four times — three of them
 * by the sheet reconcile import. The owner gave the true figures:
 * 31 July 2026, qty 60, subtotal $459.25, shipping $75.00, total $534.25.
 *
 * ORD-2026-0080 survives, not because of its number (everything is renumbered
 * afterwards) but because it alone carries the shipment and the one real
 * payment. The other three are soft-deleted with their invoices and POs, so
 * nothing is destroyed and any of it can be brought back.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const KEEP = 'ORD-2026-0080'
const DROP = ['ORD-2026-0087', 'ORD-2026-0088', 'ORD-2026-0091']
const TRUE_DATE = '2026-07-31'
const TRUE_QTY = 60
const TRUE_SUBTOTAL = 459.25
const TRUE_SHIPPING = 75.00
const TRUE_TOTAL = 534.25

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  const keep = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.subtotal, o.shipping_charges, o.total,
            o.invoice_id, i.invoice_number, i.total AS inv_total, i.amount_paid
       FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [KEEP])).rows[0]
  if (!keep) throw new Error(`${KEEP} nahi mila`)

  console.log(`RAKHA JAYEGA  ${keep.order_number}`)
  console.log(`  date      ${String(keep.order_date).slice(0, 10)}  ->  ${TRUE_DATE}`)
  console.log(`  qty       65  ->  ${TRUE_QTY}`)
  console.log(`  subtotal  ${money(keep.subtotal)}  ->  ${money(TRUE_SUBTOTAL)}`)
  console.log(`  shipping  ${money(keep.shipping_charges)}  ->  ${money(TRUE_SHIPPING)}`)
  console.log(`  total     ${money(keep.total)}  ->  ${money(TRUE_TOTAL)}`)
  console.log(`  invoice   ${keep.invoice_number}  ${money(keep.inv_total)} -> ${money(TRUE_TOTAL)}`)
  console.log(`            paid ${money(keep.amount_paid)} (asli payment) -> balance ${money(TRUE_TOTAL - keep.amount_paid)}`)

  console.log(`\nHATAYE JAYENGE (soft delete — wapas laye ja sakte hain)`)
  const drops = []
  for (const number of DROP) {
    const { rows } = await query(
      `SELECT o.id, o.order_number, o.total, o.invoice_id, i.invoice_number, i.total AS inv_total,
              i.amount_paid,
              (SELECT count(*) FROM payments pm WHERE pm.order_id = o.id OR pm.invoice_id = o.invoice_id)::INT AS real_payments
         FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
        WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [number])
    if (!rows.length) { console.log(`  ${number}  pehle se nahi hai — chhora`); continue }
    const r = rows[0]
    const pos = (await query(
      `SELECT po_number FROM purchase_orders WHERE order_id = $1 AND deleted_at IS NULL`, [r.id])).rows
    console.log(`  ${r.order_number}  ${money(r.total)}   invoice ${r.invoice_number} ${money(r.inv_total)} (paid ${money(r.amount_paid)}, asli payments: ${r.real_payments})   PO ${pos.map(p => p.po_number).join(', ') || '—'}`)
    drops.push({ ...r, pos })
  }

  const lostRevenue = drops.reduce((s, d) => s + Number(d.total), 0)
  const lostPaid = drops.reduce((s, d) => s + Number(d.amount_paid || 0), 0)
  const realPayments = drops.reduce((s, d) => s + d.real_payments, 0)
  console.log(`\n  revenue jo hatega     ${money(lostRevenue)}`)
  console.log(`  "paid" jo hatega      ${money(lostPaid)}  (in mein asli payment records: ${realPayments})`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    await query(
      `UPDATE orders SET order_date = $2, subtotal = $3, shipping_charges = $4, total = $5, updated_at = NOW()
         WHERE id = $1`, [keep.id, TRUE_DATE, TRUE_SUBTOTAL, TRUE_SHIPPING, TRUE_TOTAL])
    // Worked out here, not in SQL: qty is an integer column and the same
    // parameter cannot also stand in as the numeric divisor.
    const unitPrice = +(TRUE_SUBTOTAL / TRUE_QTY).toFixed(4)
    await query(
      `UPDATE order_items_dtf SET qty = $2, amount = $3, unit_price = $4
         WHERE order_id = $1`, [keep.id, TRUE_QTY, TRUE_SUBTOTAL, unitPrice])
    if (keep.invoice_id) {
      await query(
        `UPDATE invoices SET subtotal = $2, shipping_charges = $3, total = $4, updated_at = NOW()
           WHERE id = $1`, [keep.invoice_id, TRUE_SUBTOTAL, TRUE_SHIPPING, TRUE_TOTAL])
    }
    for (const d of drops) {
      await query(`UPDATE purchase_orders SET deleted_at = NOW() WHERE order_id = $1 AND deleted_at IS NULL`, [d.id])
      if (d.invoice_id) await query(`UPDATE invoices SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [d.invoice_id])
      await query(`UPDATE orders SET deleted_at = NOW() WHERE id = $1`, [d.id])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT o.order_number, o.order_date, o.subtotal, o.shipping_charges, o.total,
            i.invoice_number, i.total AS inv_total, i.amount_paid, i.balance_due
       FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`, [keep.id])).rows[0]
  console.log(`\nHO GAYA. ${after.order_number}  ${String(after.order_date).slice(0, 10)}  subtotal ${money(after.subtotal)} + shipping ${money(after.shipping_charges)} = ${money(after.total)}`)
  console.log(`  invoice ${after.invoice_number}  ${money(after.inv_total)}  paid ${money(after.amount_paid)}  balance ${money(after.balance_due)}`)
  console.log(`  ${drops.length} orders, ${drops.filter(d => d.invoice_id).length} invoices, ${drops.reduce((s, d) => s + d.pos.length, 0)} POs soft-delete hue\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
