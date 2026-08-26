/**
 * Christine Calhoun ke do orders ek hi order the — jorr kar ek karna.
 *
 * Owner ne tasdeeq ki: ORD-2026-0066 aur ORD-2026-0067 ek hi kharidari hai.
 * Dono 15 July ke hain, ek hi customer ke, ek hi pate par:
 *
 *   ORD-2026-0066   6 × T-shirt (print both sides) @ $12 = $72
 *   ORD-2026-0067   2 × Pullover hoodie           @ $20 = $40
 *                                                  ─────────
 *                   8 pcs, item $112 + shipping $15 = $127
 *
 * Payment (owner se): 15 July 2026, Shopify, $127.00, Christine Calhoun.
 *
 * 0067 ki line 0066 par le jayi jati hai, 0066 ka total $127 hota hai, aur
 * 0067 soft-delete ho jata hai — mitta nahi, sirf chhup jata hai, taake
 * zaroorat par wapas laya ja sake.
 *
 * PO bhi saath chalti hai: PO-2026-0067 bhi soft-delete hota hai (dono PO
 * khali hain — koi item, koi shipment nahi, sirf po_orders ki ek line) aur
 * PO-2026-0066 apne order ke mutabiq $112 + $15 = $127 par aa jata hai.
 *
 * Is ke baad orders 127 se 126 aur POs 122 se 121 ho jayenge. Numbering alag
 * script mein theek hogi.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'calhoun_merge_backup_20260825'
const KEEP = 'ORD-2026-0066'
const DROP = 'ORD-2026-0067'
const KEEP_PO = 'PO-2026-0066'
const DROP_PO = 'PO-2026-0067'
const SUBTOTAL = 112.00
const SHIPPING = 15.00
const TOTAL = 127.00
const PAY = { date: '2026-07-15', method: 'Shopify', amount: 127.00, payer: 'Christine Calhoun' }

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const keep = await one(
    `SELECT o.id, o.order_number, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
            o.customer_id, o.invoice_id, c.name AS customer
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [KEEP])
  const drop = await one(
    `SELECT o.id, o.order_number, o.subtotal, o.total, o.customer_id, o.invoice_id
       FROM orders o WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [DROP])
  if (!keep || !drop) { console.log('Dono orders nahi mile — kuch nahi kiya.'); await pool.end(); return }
  if (String(keep.customer_id) !== String(drop.customer_id)) {
    console.log('Dono ka customer alag hai — jorna mehfooz nahi.'); await pool.end(); return
  }

  const keepLines = (await query(`SELECT id, item, qty, unit_price, amount FROM order_items_apparel WHERE order_id=$1`, [keep.id])).rows
  const dropLines = (await query(`SELECT id, item, qty, unit_price, amount FROM order_items_apparel WHERE order_id=$1`, [drop.id])).rows
  const lineSum = +[...keepLines, ...dropLines].reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
  const qtySum = [...keepLines, ...dropLines].reduce((s, l) => s + Number(l.qty), 0)

  if (Math.abs(lineSum - SUBTOTAL) > 0.005) {
    console.log(`Lines ka jama ${money(lineSum)} hai magar subtotal ${money(SUBTOTAL)} — kuch nahi kiya.`)
    await pool.end(); return
  }
  if (Math.abs(SUBTOTAL + SHIPPING - TOTAL) > 0.005 || Math.abs(TOTAL - PAY.amount) > 0.005) {
    console.log('Hisaab nahi baith raha — kuch nahi kiya.'); await pool.end(); return
  }
  for (const o of [keep, drop]) {
    const busy = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
    if (busy) { console.log(`${o.order_number} par pehle se ${busy.payment_number} lagi hui hai — kuch nahi kiya.`); await pool.end(); return }
  }

  const keepPo = await one(`SELECT id, po_number, subtotal, COALESCE(shipping_charge,0) AS shipping, total, grand_total
                              FROM purchase_orders WHERE po_number=$1 AND deleted_at IS NULL`, [KEEP_PO])
  const dropPo = await one(`SELECT id, po_number, total FROM purchase_orders WHERE po_number=$1 AND deleted_at IS NULL`, [DROP_PO])

  // PO khali honi chahiye, warna uska maal kho jayega.
  if (dropPo) {
    const busy = await one(`
      SELECT (SELECT COUNT(*) FROM po_apparel_items WHERE purchase_order_id=$1)
           + (SELECT COUNT(*) FROM po_dtf_items WHERE purchase_order_id=$1)
           + (SELECT COUNT(*) FROM purchase_order_items WHERE po_id=$1)
           + (SELECT COUNT(*) FROM shipments WHERE po_id=$1) AS n`, [dropPo.id])
    if (Number(busy.n)) { console.log(`${DROP_PO} par ${busy.n} lines/shipments hain — jorna mehfooz nahi.`); await pool.end(); return }
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${keep.customer}  —  do orders ek karna\n`)
  console.log(`  ${KEEP}  rakha jayega`)
  for (const l of keepLines) console.log(`     ${String(l.qty).padStart(2)} × ${l.item} @ ${money(l.unit_price)} = ${money(l.amount)}`)
  console.log(`  ${DROP}  soft-delete hoga, uski line ${KEEP} par jayegi`)
  for (const l of dropLines) console.log(`     ${String(l.qty).padStart(2)} × ${l.item} @ ${money(l.unit_price)} = ${money(l.amount)}`)
  console.log(`\n  ${KEEP}:  ${money(keep.total)}  →  sub ${money(SUBTOTAL)} + ship ${money(SHIPPING)} = ${money(TOTAL)}   (${qtySum} pcs)`)
  if (keepPo) console.log(`  ${KEEP_PO}:  ${money(keepPo.total)}  →  ${money(TOTAL)}`)
  if (dropPo) console.log(`  ${DROP_PO}:  soft-delete`)
  console.log(`  nayi payment:  ${money(PAY.amount)}  ${PAY.date}  ${PAY.method}  ${PAY.payer}  → ${KEEP}`)

  const before = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                   (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                   (SELECT COUNT(*) FROM payments) AS pay`)
  console.log(`\norders ${before.o} → ${Number(before.o) - 1}   POs ${before.p} → ${Number(before.p) - 1}   payments ${before.pay} → ${Number(before.pay) + 1}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }
  await save('order', KEEP, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [keep.id])
  await save('order', DROP, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [drop.id])
  await save('order_items_apparel', DROP, `SELECT to_jsonb(x) AS j FROM order_items_apparel x WHERE x.order_id=$1`, [drop.id])
  if (keepPo) await save('purchase_order', KEEP_PO, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [keepPo.id])
  if (dropPo) await save('purchase_order', DROP_PO, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [dropPo.id])

  // 0067 ki line 0066 par
  let n = keepLines.length
  for (const l of dropLines) {
    await query(`UPDATE order_items_apparel SET order_id=$2, sort_order=$3 WHERE id=$1`, [l.id, keep.id, n++])
  }

  await query(
    `UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
            notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END ||
                    $5, updated_at=NOW()
      WHERE id=$1`,
    [keep.id, SUBTOTAL, SHIPPING, TOTAL,
     `${DROP} isi order ka hissa tha (2 × Pullover hoodie, $40) — usme mila diya gaya.`])

  await query(`UPDATE orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [drop.id])
  if (drop.invoice_id) await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [drop.invoice_id])

  if (keepPo) await query(
    `UPDATE purchase_orders SET subtotal=$2, shipping_charge=$3, total=$4, grand_total=$4, updated_at=NOW()
      WHERE id=$1`, [keepPo.id, SUBTOTAL, SHIPPING, TOTAL])
  if (dropPo) {
    await query(`DELETE FROM po_orders WHERE po_id=$1`, [dropPo.id])
    await query(`UPDATE purchase_orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [dropPo.id])
  }

  const maxNo = await one(`SELECT COALESCE(MAX(SUBSTRING(payment_number FROM 10)::int),0) AS n
                             FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PAY-2026'`, [maxNo.n])
  const c = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                        WHERE scope='PAY-2026' RETURNING last_value`)
  const payNo = `PAY-2026-${String(c.last_value).padStart(4, '0')}`
  await query(
    `INSERT INTO payments (payment_number, payment_date, amount, payment_method, notes,
                           order_id, customer_id, customer_name, received_from_name, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'completed',NOW(),NOW())`,
    [payNo, PAY.date, PAY.amount, PAY.method,
     `SHEET-DARJ — owner ki payment sheet se. Tareeqa: ${PAY.method}. ${KEEP} aur ${DROP} ek hi order the.`,
     keep.id, keep.customer_id, PAY.payer])

  const after = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                  (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                  (SELECT COUNT(*) FROM payments) AS pay`)
  console.log(`\nho gaya. ${payNo} ${money(PAY.amount)} → ${KEEP}`)
  console.log(`orders ${after.o}, POs ${after.p}, payments ${after.pay}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
