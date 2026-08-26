/**
 * Dannyboy ke do orders ek hi kaam the — sahi wala rakhna aur uski raqam
 * payment ke mutabiq karna.
 *
 * ORD-2026-0001  21 Apr  Elite Towing & Repair   10 + 10 @ $1.50  $30 + $10 = $40
 * ORD-2026-0005  27 Apr  Elite gold/white         7 + 3 + 10 @ $2  $40 + $10 = $50
 *
 * Owner ne tay kiya: 27 April wala ($50 likha hua) sahi record hai, 21 April
 * wala uski duplicate entry hai. Payment magar duplicate par lagi hui hai.
 *
 * PAYMENT KA MASLA. Owner ki apni tasdeeq shuda deposit file 20 April par sirf
 * yeh dikhati hai:
 *     2026-04-20  Bank of America / Zelle  Danny Hernandez  39.00
 *     2026-04-20  Bank of America / Zelle  Danny Hernandez   1.00
 * Yaani $40. Danny Hernandez se us ke baad 30 May tak koi aur paisa nahi aaya.
 * Owner ka faisla: paisa jo aaya wo durust hai, sales order ki raqam galat ho
 * sakti hai. So order payment ke mutabiq kiya ja raha hai, na ke payment order
 * ke mutabiq.
 *
 * Items khud bhi yehi kehte hain: 7 + 3 + 10 = 20 pcs @ $2.00 = $40.00, jo
 * bilkul payment ke barabar hai. Shipping $10 quote hui thi magar aayi nahi —
 * wahi soorat jo aaj subah wale bees orders mein thi, jahan owner ne yehi
 * usool diya tha ke jo paisa aaya wohi charge hua.
 *
 * LINES BHI TOOTI HUI HAIN. Teenon lines par amount $40.00 likha hai — 7 × $2
 * ka $14 hona chahiye tha, 3 × $2 ka $6, 10 × $2 ka $20. Lagta hai har line
 * mein order ka total copy ho gaya. Jama $120 banta hai jabke subtotal $40 hai.
 * Qty aur rate durust hain, sirf amount ghalat hai, so amount qty × rate se
 * dobara nikala jata hai.
 *
 * PO bhi saath: duplicate ka PO soft-delete, bachne wale ka PO $40 par.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'dannyboy_merge_backup_20260825'
const KEEP = 'ORD-2026-0005'
const DROP = 'ORD-2026-0001'
const SUBTOTAL = 40.00
const SHIPPING = 0.00
const TOTAL = 40.00

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const get = n => one(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping,
            o.total, o.customer_id, o.invoice_id, c.name AS customer
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [n])
  const keep = await get(KEEP)
  const drop = await get(DROP)
  if (!keep || !drop) { console.log('Dono orders nahi mile — kuch nahi kiya.'); await pool.end(); return }
  if (String(keep.customer_id) !== String(drop.customer_id)) {
    console.log('Customer alag hai — kuch nahi kiya.'); await pool.end(); return
  }

  const pay = await one(`SELECT id, payment_number, amount, payment_date::date AS d, payment_method,
                                COALESCE(received_from_name,customer_name) AS payer
                           FROM payments WHERE order_id=$1`, [drop.id])
  if (!pay) { console.log(`${DROP} par koi payment nahi — kuch nahi kiya.`); await pool.end(); return }
  const busy = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [keep.id])
  if (busy) { console.log(`${KEEP} par pehle se ${busy.payment_number} lagi hui hai — kuch nahi kiya.`); await pool.end(); return }
  if (Math.abs(Number(pay.amount) - TOTAL) > 0.005) {
    console.log(`Payment ${money(pay.amount)} magar naya total ${money(TOTAL)} — barabar nahi, kuch nahi kiya.`)
    await pool.end(); return
  }
  if (Math.abs(SUBTOTAL + SHIPPING - TOTAL) > 0.005) {
    console.log('Hisaab nahi baith raha — kuch nahi kiya.'); await pool.end(); return
  }

  const lines = (await query(
    `SELECT id, artwork_name, qty, unit_price, amount FROM order_items_dtf WHERE order_id=$1 ORDER BY sort_order`,
    [keep.id])).rows
  const fixedLines = lines.map(l => ({ ...l, naya: +(Number(l.qty) * Number(l.unit_price)).toFixed(2) }))
  const lineSum = +fixedLines.reduce((s, l) => s + l.naya, 0).toFixed(2)
  if (Math.abs(lineSum - SUBTOTAL) > 0.005) {
    console.log(`Lines qty × rate se ${money(lineSum)} banti hain magar subtotal ${money(SUBTOTAL)} — kuch nahi kiya.`)
    await pool.end(); return
  }

  const dropPo = await one(`SELECT id, po_number FROM purchase_orders WHERE order_id=$1 AND deleted_at IS NULL`, [drop.id])
  const keepPo = await one(`SELECT id, po_number, total FROM purchase_orders WHERE order_id=$1 AND deleted_at IS NULL`, [keep.id])
  // Duplicate ke PO par apni lines hain aur hona bhi yehi chahiye — wo usi
  // duplicate ka maal hai aur uske saath chhup jayega (soft delete, mitta nahi).
  // Dekhne wali baat yeh hai ke bachne wale PO ke paas apni lines hon, warna
  // is kaam ka koi tafseeli record hi na bache.
  if (keepPo) {
    const n = await one(`SELECT (SELECT COUNT(*) FROM po_apparel_items WHERE purchase_order_id=$1)
                              + (SELECT COUNT(*) FROM po_dtf_items WHERE purchase_order_id=$1)
                              + (SELECT COUNT(*) FROM purchase_order_items WHERE po_id=$1) AS n`, [keepPo.id])
    if (!Number(n.n)) { console.log(`${keepPo.po_number} par koi line nahi — pehle wo dekhein.`); await pool.end(); return }
  }
  const ships = (await query(`SELECT so.shipment_id, s.tracking_number FROM shipment_orders so
                                JOIN shipments s ON s.id=so.shipment_id WHERE so.order_id=$1`, [drop.id])).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${keep.customer}\n`)
  console.log(`  RAKHA JAYEGA   ${KEEP}  ${keep.d}   ${money(keep.total)} → sub ${money(SUBTOTAL)} + ship ${money(SHIPPING)} = ${money(TOTAL)}`)
  for (const l of fixedLines)
    console.log(`                    ${String(l.qty).padStart(2)} × ${l.artwork_name} @ ${money(l.unit_price)}   amount ${money(l.amount)} → ${money(l.naya)}`)
  console.log(`  SOFT-DELETE    ${DROP}  ${drop.d}   ${money(drop.total)}   (duplicate)`)
  console.log(`\n  payment  ${pay.payment_number} ${money(pay.amount)} ${pay.d} ${pay.payment_method} ${pay.payer}   ${DROP} → ${KEEP}`)
  for (const s of ships) console.log(`  shipment ${s.tracking_number}   ${DROP} → ${KEEP}`)
  if (dropPo) console.log(`  ${dropPo.po_number}  soft-delete`)
  if (keepPo) console.log(`  ${keepPo.po_number}  ${money(keepPo.total)} → ${money(TOTAL)}`)

  const before = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                   (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p`)
  console.log(`\norders ${before.o} → ${Number(before.o) - 1}   PO ${before.p} → ${Number(before.p) - 1}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }
  await save('order', DROP, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [drop.id])
  await save('order', KEEP, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [keep.id])
  await save('order_items_dtf', KEEP, `SELECT to_jsonb(x) AS j FROM order_items_dtf x WHERE x.order_id=$1`, [keep.id])
  await save('payment', pay.payment_number, `SELECT to_jsonb(p) AS j FROM payments p WHERE p.id=$1`, [pay.id])
  if (dropPo) await save('purchase_order', dropPo.po_number, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [dropPo.id])

  await query(`UPDATE payments SET order_id=NULL WHERE id=$1`, [pay.id])
  await query(`UPDATE payments SET order_id=$2,
                      notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $3,
                      updated_at=NOW() WHERE id=$1`,
    [pay.id, keep.id, `${DROP} isi kaam ki duplicate entry thi; yeh payment ${KEEP} ki hai.`])
  for (const s of ships)
    await query(`UPDATE shipment_orders SET order_id=$2 WHERE shipment_id=$1 AND order_id=$3`, [s.shipment_id, keep.id, drop.id])

  for (const l of fixedLines)
    await query(`UPDATE order_items_dtf SET amount=$2 WHERE id=$1`, [l.id, l.naya])

  await query(
    `UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
            notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $5,
            updated_at=NOW() WHERE id=$1`,
    [keep.id, SUBTOTAL, SHIPPING, TOTAL,
     `Shipping ${money(10)} quote hui thi magar aayi nahi — deposit file par $39 + $1 = $40 hi hai.`])
  if (keep.invoice_id) await query(
    `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
            balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
    [keep.invoice_id, SUBTOTAL, SHIPPING, TOTAL])

  await query(`UPDATE orders SET amount_paid=0, deleted_at=NOW(), updated_at=NOW(),
                      notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $2
                WHERE id=$1`, [drop.id, `${KEEP} isi kaam ka sahi record hai; yeh duplicate thi.`])
  if (drop.invoice_id) await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [drop.invoice_id])

  if (dropPo) {
    await query(`DELETE FROM po_orders WHERE po_id=$1`, [dropPo.id])
    await query(`UPDATE purchase_orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [dropPo.id])
  }
  if (keepPo) await query(
    `UPDATE purchase_orders SET subtotal=$2, shipping_charge=$3, total=$4, grand_total=$4, updated_at=NOW()
      WHERE id=$1`, [keepPo.id, SUBTOTAL, SHIPPING, TOTAL])

  const after = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                  (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                  (SELECT COUNT(*) FROM payments WHERE order_id IS NULL) AS loose`)
  console.log(`\nho gaya. orders ${after.o}, PO ${after.p}, loose payments ${after.loose}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
