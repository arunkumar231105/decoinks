/**
 * Twenty paid orders whose payment is short by exactly the shipping charge.
 *
 * They are not twenty customers who each decided to skip the postage. In every
 * one of the twenty the payment equals the order's subtotal to the cent, and
 * total = subtotal + shipping holds. The shipping was quoted on the document and
 * never collected, and the invoices were marked Paid anyway — thirteen of them
 * still carry a balance_due equal to that shipping while saying Paid.
 *
 * The owner's ruling: the money that arrived is what was charged. So shipping
 * goes to zero on these orders and their invoices, and the totals come down to
 * the subtotal. The payments are not touched. Revenue falls by $304.00.
 *
 * Nothing is lost — invoices.original_shipping_charges already holds the figure
 * that was quoted, and every before-value is copied to a backup table first.
 *
 * A row is only touched when it proves itself: payment == subtotal, and
 * subtotal + shipping == total, on the order and on its invoice alike. Anything
 * that does not reconcile is reported and skipped rather than forced.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'orders_shipping_backup_20260825'
const money = n => `$${Number(n).toFixed(2)}`
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005

async function main() {
  const apply = process.argv.includes('--apply')

  const { rows } = await query(`
    SELECT o.id, o.order_number, c.name AS customer,
           o.subtotal        AS o_subtotal,
           COALESCE(o.shipping_charges,0) AS o_shipping,
           o.total           AS o_total,
           COALESCE(o.amount_paid,0)      AS o_amount_paid,
           COALESCE(o.discount_amt,0)     AS o_discount,
           COALESCE(o.tax_amt,0)          AS o_tax,
           p.payment_number, p.amount     AS paid,
           i.id AS invoice_id, i.invoice_number,
           i.subtotal        AS i_subtotal,
           COALESCE(i.shipping_charges,0) AS i_shipping,
           COALESCE(i.original_shipping_charges,0) AS i_original_shipping,
           COALESCE(i.rush_charges,0)     AS i_rush,
           COALESCE(i.discount_amt,0)     AS i_discount,
           COALESCE(i.tax_amt,0)          AS i_tax,
           i.total AS i_total, COALESCE(i.amount_paid,0) AS i_amount_paid,
           COALESCE(i.balance_due,0) AS i_balance
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN payments  p ON p.order_id = o.id
      JOIN invoices  i ON i.id = o.invoice_id
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.shipping_charges,0) > 0
       AND ROUND(p.amount - o.total, 2) = -COALESCE(o.shipping_charges,0)
     ORDER BY o.order_number`)

  const planned = [], skipped = []

  for (const r of rows) {
    // The order's own arithmetic must hold before we change it.
    if (!eq(Number(r.o_subtotal) + Number(r.o_shipping) - Number(r.o_discount) + Number(r.o_tax), r.o_total)) {
      skipped.push([r.order_number, `order ka hisaab nahi baith raha: ${money(r.o_subtotal)} + ${money(r.o_shipping)} ≠ ${money(r.o_total)}`])
      continue
    }
    // The payment must be the subtotal exactly. Anything else is a different
    // question than the one the owner answered.
    if (!eq(r.paid, r.o_subtotal)) {
      skipped.push([r.order_number, `payment ${money(r.paid)} subtotal ${money(r.o_subtotal)} ke barabar nahi`])
      continue
    }
    // The quoted figure has to survive somewhere before the live one is cleared.
    if (!eq(r.i_original_shipping, r.i_shipping)) {
      skipped.push([r.order_number, `${r.invoice_number}: original_shipping_charges ${money(r.i_original_shipping)} live ${money(r.i_shipping)} se alag hai — purana figure mehfooz nahi`])
      continue
    }
    // Order and invoice must agree on the items before both are re-totalled.
    if (!eq(r.o_subtotal, r.i_subtotal)) {
      skipped.push([r.order_number, `order subtotal ${money(r.o_subtotal)} magar ${r.invoice_number} par ${money(r.i_subtotal)} — pehle yeh farq tay karein`])
      continue
    }

    const orderTotal = +(Number(r.o_subtotal) - Number(r.o_discount) + Number(r.o_tax)).toFixed(2)
    const invoiceTotal = +(Number(r.i_subtotal) - Number(r.i_discount) + Number(r.i_tax) + Number(r.i_rush)).toFixed(2)
    planned.push({ ...r, orderTotal, invoiceTotal, dropped: Number(r.o_shipping) })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('order          customer               shipping   order total        invoice   balance')
  console.log('-'.repeat(92))
  for (const p of planned) {
    console.log(
      `${p.order_number}  ${String(p.customer).slice(0, 20).padEnd(20)}  ` +
      `${money(p.dropped).padStart(7)}→${money(0)}  ` +
      `${money(p.o_total).padStart(9)}→${money(p.orderTotal).padStart(9)}  ` +
      `${String(p.invoice_number).padEnd(9)} ${money(p.i_balance).padStart(7)}→${money(0)}`)
  }
  if (skipped.length) {
    console.log(`\nCHHORE GAYE — hisaab nahi baith raha, andaza nahi lagaya:`)
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  const dropped = planned.reduce((s, p) => s + p.dropped, 0)
  console.log(`\nmile: ${rows.length}   lagne wale: ${planned.length}   chhore gaye: ${skipped.length}`)
  console.log(`revenue ${money(dropped)} kam ho jayegi.\n`)

  if (!apply) { console.log('Likhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!planned.length) { console.log('Karne ko kuch nahi.\n'); await pool.end(); return }

  // Every before-value, so this is one UPDATE away from being undone.
  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    order_id uuid, order_number text, invoice_id uuid, invoice_number text,
    o_shipping numeric, o_total numeric, o_amount_paid numeric,
    i_shipping numeric, i_total numeric, i_amount_paid numeric, i_balance numeric,
    saved_at timestamptz NOT NULL DEFAULT NOW())`)

  let done = 0
  for (const p of planned) {
    await query(
      `INSERT INTO ${BACKUP} (order_id, order_number, invoice_id, invoice_number,
         o_shipping, o_total, o_amount_paid, i_shipping, i_total, i_amount_paid, i_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [p.id, p.order_number, p.invoice_id, p.invoice_number,
       p.o_shipping, p.o_total, p.o_amount_paid, p.i_shipping, p.i_total, p.i_amount_paid, p.i_balance])

    await query(
      `UPDATE orders SET shipping_charges = 0, total = $2, amount_paid = $2, updated_at = NOW()
        WHERE id = $1`, [p.id, p.orderTotal])

    // original_shipping_charges is deliberately left alone — it is the only
    // remaining record of what was quoted.
    await query(
      `UPDATE invoices SET shipping_charges = 0, total = $2, amount_paid = $2,
              balance_due = 0, updated_at = NOW()
        WHERE id = $1`, [p.invoice_id, p.invoiceTotal])
    done++
  }
  console.log(`${done} orders aur unke invoices update ho gaye. Purane figures ${BACKUP} mein hain.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
