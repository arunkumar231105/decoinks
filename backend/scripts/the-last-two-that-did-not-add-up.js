/**
 * Aakhri do orders jo apni payment se barabar nahi the.
 *
 * Poora total to barabar tha — 108 orders aur 108 payments, dono $14,632.64 —
 * magar andar do orders ulte rukh mein $15 se hat rahe the aur aapas mein kat
 * rahe the. Owner ne asal figures diye:
 *
 *   ORD-2026-0111  Ricardo Malia   item $51.00 + shipping $15.00 = $66.00
 *                  (abhi: $66.00 + $15.00 = $81.00, payment $66.00)
 *   ORD-2026-0036  Kyle Morris     item $100.00 + shipping $15.00 = $115.00
 *                  (abhi: $85.00 + $15.00 = $100.00, payment $115.00)
 *
 * Sirf header badalna kaafi nahi. Dono ke line items purane subtotal se milte
 * hain, aur ORD-2026-0036 ki lines invoice KMO-0036 mein bhi do jagah maujood
 * hain (invoice_items aur invoice_items_dtf). Agar header badle aur lines wahi
 * rahen to document apne aap se jhoot bolne lagega.
 *
 * Is liye lines dobara rate ki jati hain: qty waisi ki waisi rehti hai, unit
 * rate naye subtotal se nikala jata hai (subtotal ÷ kul qty), aur paison ka jo
 * chhota sa farq gol karne se bachta hai wo sab se bari line par daal diya
 * jata hai. Adad nahi badle ja rahe — sirf rate, kyunke ghalti rate mein thi.
 *
 * ORD-2026-0111 ke invoice RMA-0106 ki koi line hai hi nahi, sirf header hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'last_two_orders_backup_20260825'
const money = n => `$${Number(n).toFixed(2)}`

const JOBS = [
  { ord: 'ORD-2026-0111', subtotal: 51.00,  shipping: 15.00, total: 66.00 },
  { ord: 'ORD-2026-0036', subtotal: 100.00, shipping: 15.00, total: 115.00 },
]

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

/** qty ke hisaab se naya rate, aur gol karne ka farq sab se bari line par. */
function rerate(lines, subtotal) {
  const qty = lines.reduce((s, l) => s + Number(l.qty), 0)
  if (!qty) return null
  const unit = +(subtotal / qty).toFixed(4)
  const out = lines.map(l => ({ ...l, unit, amount: +(Number(l.qty) * unit).toFixed(2) }))
  const diff = +(subtotal - out.reduce((s, l) => s + l.amount, 0)).toFixed(2)
  if (diff !== 0) {
    const big = out.reduce((a, b) => (Number(b.qty) > Number(a.qty) ? b : a))
    big.amount = +(big.amount + diff).toFixed(2)
  }
  return { unit, qty, lines: out }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skipped = []

  for (const j of JOBS) {
    const o = await one(
      `SELECT o.id, o.order_number, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
              o.invoice_id, c.name AS customer, p.payment_number, p.amount AS paid
         FROM orders o JOIN customers c ON c.id=o.customer_id
         LEFT JOIN payments p ON p.order_id=o.id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [j.ord])
    if (!o) { skipped.push([j.ord, 'order nahi mila']); continue }
    if (Math.abs(j.subtotal + j.shipping - j.total) > 0.005) {
      skipped.push([j.ord, `${money(j.subtotal)} + ${money(j.shipping)} ≠ ${money(j.total)}`]); continue
    }
    if (!o.paid || Math.abs(Number(o.paid) - j.total) > 0.005) {
      skipped.push([j.ord, `naya total ${money(j.total)} magar payment ${o.paid ? money(o.paid) : 'koi nahi'}`]); continue
    }

    const dtf = (await query(`SELECT id, qty, unit_price, amount FROM order_items_dtf WHERE order_id=$1 ORDER BY sort_order`, [o.id])).rows
    const app = (await query(`SELECT id, qty, unit_price, amount FROM order_items_apparel WHERE order_id=$1 ORDER BY sort_order`, [o.id])).rows
    if (dtf.length && app.length) { skipped.push([j.ord, 'dtf aur apparel dono lines hain — haath nahi lagaya']); continue }
    const table = dtf.length ? 'order_items_dtf' : (app.length ? 'order_items_apparel' : null)
    const r = table ? rerate(dtf.length ? dtf : app, j.subtotal) : null
    if (table && !r) { skipped.push([j.ord, 'lines ki qty sifar hai']); continue }

    const inv = o.invoice_id ? await one(
      `SELECT id, invoice_number, subtotal, COALESCE(shipping_charges,0) AS shipping, total, amount_paid, status
         FROM invoices WHERE id=$1`, [o.invoice_id]) : null

    const invGeneric = inv ? (await query(`SELECT id, qty, unit_price, amount FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order`, [inv.id])).rows : []
    const invDtf = inv ? (await query(`SELECT id, quantity AS qty, unit_rate, line_amount FROM invoice_items_dtf WHERE invoice_id=$1 ORDER BY line_no`, [inv.id])).rows : []

    plan.push({ ...j, o, inv, table, r,
                invGeneric: invGeneric.length ? rerate(invGeneric, j.subtotal) : null,
                invDtf: invDtf.length ? rerate(invDtf, j.subtotal) : null })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.ord}  ${p.o.customer}   payment ${p.o.payment_number} ${money(p.o.paid)}`)
    console.log(`  order:  sub ${money(p.o.subtotal)} + ship ${money(p.o.shipping)} = ${money(p.o.total)}`)
    console.log(`      →   sub ${money(p.subtotal)} + ship ${money(p.shipping)} = ${money(p.total)}   (farq ab $0.00)`)
    if (p.r) console.log(`  ${p.table}: ${p.r.lines.length} lines, ${p.r.qty} pcs, naya rate ${money(p.r.unit)} — jama ${money(p.r.lines.reduce((s, l) => s + l.amount, 0))}`)
    if (p.inv) console.log(`  ${p.inv.invoice_number}: ${money(p.inv.total)} → ${money(p.total)}, paid ${money(p.inv.amount_paid)} → ${money(p.total)}`)
    if (p.invGeneric) console.log(`     invoice_items: ${p.invGeneric.lines.length} lines dobara rate hongi`)
    if (p.invDtf) console.log(`     invoice_items_dtf: ${p.invDtf.lines.length} lines dobara rate hongi`)
  }
  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!plan.length) { console.log('Karne ko kuch nahi.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }

  for (const p of plan) {
    await save('order', p.ord, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [p.o.id])
    if (p.table) await save(p.table, p.ord, `SELECT to_jsonb(x) AS j FROM ${p.table} x WHERE x.order_id=$1`, [p.o.id])
    if (p.inv) {
      await save('invoice', p.inv.invoice_number, `SELECT to_jsonb(i) AS j FROM invoices i WHERE i.id=$1`, [p.inv.id])
      await save('invoice_items', p.inv.invoice_number, `SELECT to_jsonb(x) AS j FROM invoice_items x WHERE x.invoice_id=$1`, [p.inv.id])
      await save('invoice_items_dtf', p.inv.invoice_number, `SELECT to_jsonb(x) AS j FROM invoice_items_dtf x WHERE x.invoice_id=$1`, [p.inv.id])
    }

    await query(`UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
                  WHERE id=$1`, [p.o.id, p.subtotal, p.shipping, p.total])

    if (p.r) for (const l of p.r.lines) {
      await query(`UPDATE ${p.table} SET unit_price=$2, amount=$3 WHERE id=$1`, [l.id, p.r.unit, l.amount])
    }
    if (p.invGeneric) for (const l of p.invGeneric.lines) {
      await query(`UPDATE invoice_items SET unit_price=$2, amount=$3 WHERE id=$1`, [l.id, p.invGeneric.unit, l.amount])
    }
    if (p.invDtf) for (const l of p.invDtf.lines) {
      await query(`UPDATE invoice_items_dtf SET unit_rate=$2, line_amount=$3 WHERE id=$1`, [l.id, p.invDtf.unit, l.amount])
    }
    if (p.inv) await query(
      `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
              balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
      [p.inv.id, p.subtotal, p.shipping, p.total])

    console.log(`  ${p.ord}  →  ${money(p.total)}`)
  }

  const chk = await one(`
    SELECT COUNT(*) AS n, ROUND(SUM(o.total),2) AS ord_total, ROUND(SUM(p.amount),2) AS pay_total,
           COUNT(*) FILTER (WHERE ROUND(p.amount-o.total,2)<>0) AS na_barabar
      FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.deleted_at IS NULL`)
  console.log(`\nho gaya. ${chk.n} orders: order total ${money(chk.ord_total)}, payment total ${money(chk.pay_total)}, na-barabar ${chk.na_barabar}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
