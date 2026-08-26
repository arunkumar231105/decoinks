/**
 * Two invoices the reconciliation left inconsistent.
 *
 * RFA-0110 — ORD-2026-0115. what-the-chats-proved.js re-totalled the invoice to
 * $460.25 and marked it fully paid, but did not touch the status, so it still
 * reads "Partially Paid" on a balance of zero. Mine to fix.
 *
 * VCH-0076 — ORD-2026-0081, Vianelly Chichipa. The invoice was created on 3
 * August holding only the $15 shipping: subtotal $0.00, total $15.00, against
 * an order of $210.00 + $35.00 = $245.00. The item money never reached it. This
 * predates today by three weeks; it only became obvious once the $5 verification
 * transfer was merged and the invoice showed $245.00 paid against a $15.00
 * total. The invoice is brought onto the order's figures, which the customer's
 * two transfers have already settled in full.
 *
 * Deliberately NOT touched: five free orders (ORD-2026-0014, 0021, 0029, 0052,
 * 0068, 0112) whose invoices carry $10–$15 of shipping against a $0.00 order.
 * The work was given away and the postage still charged, so those two numbers
 * are meant to differ.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'invoice_fixes_backup_20260825'
const money = n => `$${Number(n).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  const planned = [], skipped = []

  // 1. Any invoice settled in full but not saying so.
  const { rows: statusRows } = await query(
    `SELECT id, invoice_number, total, amount_paid, balance_due, status
       FROM invoices
      WHERE deleted_at IS NULL AND total > 0 AND COALESCE(balance_due,0) = 0
        AND amount_paid >= total AND status <> 'Paid'`)
  for (const r of statusRows) planned.push({ kind: 'status', r })

  // 2. VCH-0076, named explicitly rather than swept up by a rule, because the
  //    other order/invoice disagreements each need a judgement this does not make.
  const { rows: vch } = await query(
    `SELECT i.id, i.invoice_number, i.subtotal, COALESCE(i.shipping_charges,0) AS shipping,
            i.total, i.amount_paid, COALESCE(i.balance_due,0) AS balance_due, i.status,
            o.order_number, o.subtotal AS o_subtotal, COALESCE(o.shipping_charges,0) AS o_shipping,
            o.total AS o_total, o.is_free
       FROM invoices i JOIN orders o ON o.invoice_id = i.id
      WHERE i.invoice_number = 'VCH-0076' AND i.deleted_at IS NULL AND o.deleted_at IS NULL`)
  if (!vch.length) skipped.push(['VCH-0076', 'invoice ya uska order nahi mila'])
  else {
    const v = vch[0]
    const paid = await query(
      `SELECT COALESCE(SUM(p.amount),0) AS paid FROM payments p
        WHERE p.order_id = (SELECT id FROM orders WHERE order_number=$1)`, [v.order_number])
    const settled = Number(paid.rows[0].paid)
    if (v.is_free) skipped.push(['VCH-0076', 'order free hai — chhora ja raha hai'])
    else if (Math.abs(Number(v.o_total) - settled) > 0.005)
      skipped.push(['VCH-0076', `order ${money(v.o_total)} magar payment ${money(settled)} — barabar nahi, haath nahi lagaya`])
    else planned.push({ kind: 'totals', r: v, settled })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of planned) {
    if (p.kind === 'status')
      console.log(`  ${p.r.invoice_number}  status "${p.r.status}" → "Paid"  (${money(p.r.amount_paid)} of ${money(p.r.total)}, balance ${money(p.r.balance_due)})`)
    else
      console.log(`  ${p.r.invoice_number}  ${p.r.order_number} ke mutabiq: sub ${money(p.r.subtotal)}→${money(p.r.o_subtotal)}, ` +
                  `ship ${money(p.r.shipping)}→${money(p.r.o_shipping)}, total ${money(p.r.total)}→${money(p.r.o_total)}, ` +
                  `paid ${money(p.settled)}`)
  }
  if (!planned.length) console.log('  karne ko kuch nahi.')
  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    invoice_number text, invoice_row jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  for (const p of planned) {
    const { rows: snap } = await query(`SELECT to_jsonb(i) AS j FROM invoices i WHERE i.id=$1`, [p.r.id])
    await query(`INSERT INTO ${BACKUP} (invoice_number, invoice_row) VALUES ($1,$2)`,
      [p.r.invoice_number, snap[0].j])

    if (p.kind === 'status') {
      await query(`UPDATE invoices SET status='Paid', updated_at=NOW() WHERE id=$1`, [p.r.id])
    } else {
      await query(
        `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$5,
                balance_due=ROUND($4::numeric - $5::numeric, 2), status='Paid', updated_at=NOW()
          WHERE id=$1`,
        [p.r.id, p.r.o_subtotal, p.r.o_shipping, p.r.o_total, p.settled])
    }
  }
  console.log(`\n${planned.length} invoice theek ho gaye. Purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
