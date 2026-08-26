/**
 * Vianelly Chichipa ka ek hi kaam do orders mein darj tha — sahi wala rakhna.
 *
 * ORD-2026-0080  27 Jul  dtf      AGGREGATE DTF Transfers × 74      $245.00
 * ORD-2026-0084  29 Jul  apparel  180G Cotton T-Shirt × 19 +
 *                                 270G Fleece Hooded Sweatshirt × 1 $245.00
 *
 * Dono $245 ke hain, do din ke faasle par, ek hi customer ke. Chatwoot conv 229
 * batati hai ke usne kya mangwaya tha:
 *
 *   27 Jul 22:42  "19 Shirts / 1 hoddie"
 *   27 Jul 22:54  "Tshirts 19 Pcs = $ 10 x 19 = $190, Hoodie 1 Pcs = $ 20 x 1 = $20"
 *   27 Jul 22:59  "The shipping charges will be $35"
 *                 → $210 + $35 = $245
 *
 * Yaani asal order ORD-2026-0084 hai — uske items lafz-ba-lafz wahi hain. Usne
 * DTF transfers mangwaye hi nahi the, is liye ORD-2026-0080 usi kaam ki ghalat
 * entry hai.
 *
 * Magar payment aur shipment dono ghalat wale par lage hue hain, is liye pehle
 * unhein sahi order par le jaya jata hai, phir 0080 soft-delete hota hai:
 *
 *   PAY-2026-0061  $245.00  Zelle, 28 Jul, Vianelly Chchipa Cruz  → ORD-2026-0084
 *   shipment       tracking 1Z24C3140320024014                     → ORD-2026-0084
 *
 * Nayi payment JAAN BUJH KAR nahi banayi ja rahi. Owner ki sheet is order ke
 * saamne jo tafseel deti hai — 28 Jul, Bank of America / Zelle, $245.00,
 * Vianelly Chchipa Cruz — wo hu-ba-hu PAY-2026-0061 hai. Vianelly se $245 sirf
 * ek baar aaya. Doosri banane se wahi paisa do baar gina jata.
 *
 * PO bhi saath chalta hai: 0080 ka PO soft-delete, aur 0084 ke PO par wahi
 * raqam. Number aakhir mein dobara tarteeb mein aayenge.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'vianelly_merge_backup_20260825'
const KEEP = 'ORD-2026-0084'
const DROP = 'ORD-2026-0080'

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const get = n => one(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.order_type, o.total, o.subtotal,
            COALESCE(o.shipping_charges,0) AS shipping, o.customer_id, o.invoice_id, c.name AS customer
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [n])

  const keep = await get(KEEP)
  const drop = await get(DROP)
  if (!keep || !drop) { console.log('Dono orders nahi mile — kuch nahi kiya.'); await pool.end(); return }
  if (String(keep.customer_id) !== String(drop.customer_id)) {
    console.log('Customer alag hai — jorna mehfooz nahi.'); await pool.end(); return
  }
  if (Math.abs(Number(keep.total) - Number(drop.total)) > 0.005) {
    console.log(`Total alag hain (${money(keep.total)} aur ${money(drop.total)}) — kuch nahi kiya.`); await pool.end(); return
  }

  const pay = await one(`SELECT id, payment_number, amount, payment_date::date AS d, payment_method,
                                COALESCE(received_from_name,customer_name) AS payer
                           FROM payments WHERE order_id=$1`, [drop.id])
  const keepPay = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [keep.id])
  if (keepPay) { console.log(`${KEEP} par pehle se ${keepPay.payment_number} lagi hui hai — kuch nahi kiya.`); await pool.end(); return }
  if (pay && Math.abs(Number(pay.amount) - Number(keep.total)) > 0.005) {
    console.log(`Payment ${money(pay.amount)} magar ${KEEP} ka total ${money(keep.total)} — kuch nahi kiya.`); await pool.end(); return
  }

  const ships = (await query(
    `SELECT so.shipment_id, s.tracking_number FROM shipment_orders so
       JOIN shipments s ON s.id=so.shipment_id WHERE so.order_id=$1`, [drop.id])).rows

  const dropPo = await one(`SELECT id, po_number, total FROM purchase_orders
                             WHERE order_id=$1 AND deleted_at IS NULL`, [drop.id])
  const keepPo = await one(`SELECT id, po_number, total FROM purchase_orders
                             WHERE order_id=$1 AND deleted_at IS NULL`, [keep.id])
  if (dropPo) {
    const busy = await one(`
      SELECT (SELECT COUNT(*) FROM po_apparel_items WHERE purchase_order_id=$1)
           + (SELECT COUNT(*) FROM po_dtf_items WHERE purchase_order_id=$1)
           + (SELECT COUNT(*) FROM purchase_order_items WHERE po_id=$1) AS n`, [dropPo.id])
    if (Number(busy.n)) { console.log(`${dropPo.po_number} par ${busy.n} lines hain — mitana mehfooz nahi.`); await pool.end(); return }
  }

  const keepItems = (await query(`SELECT item, qty FROM order_items_apparel WHERE order_id=$1 ORDER BY sort_order`, [keep.id])).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${keep.customer}\n`)
  console.log(`  RAKHA JAYEGA   ${KEEP}  ${keep.d}  ${keep.order_type}  ${money(keep.total)}`)
  for (const i of keepItems) console.log(`                    ${i.qty} × ${i.item}`)
  console.log(`  SOFT-DELETE    ${DROP}  ${drop.d}  ${drop.order_type}  ${money(drop.total)}   (74 DTF transfers — ghalat entry)`)
  if (pay)  console.log(`\n  payment  ${pay.payment_number} ${money(pay.amount)} ${pay.d} ${pay.payment_method} ${pay.payer}   ${DROP} → ${KEEP}`)
  for (const s of ships) console.log(`  shipment ${s.tracking_number}   ${DROP} → ${KEEP}`)
  if (dropPo) console.log(`  ${dropPo.po_number}  soft-delete`)
  if (keepPo) console.log(`  ${keepPo.po_number}  ${money(keepPo.total)} → ${money(keep.total)}`)

  const before = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                   (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                   (SELECT COUNT(*) FROM payments) AS pay`)
  console.log(`\norders ${before.o} → ${Number(before.o) - 1}   PO ${before.p} → ${Number(before.p) - 1}   payments ${before.pay} (waise hi)`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }
  await save('order', DROP, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [drop.id])
  await save('order_items_dtf', DROP, `SELECT to_jsonb(x) AS j FROM order_items_dtf x WHERE x.order_id=$1`, [drop.id])
  await save('shipment_orders', DROP, `SELECT to_jsonb(x) AS j FROM shipment_orders x WHERE x.order_id=$1`, [drop.id])
  if (pay) await save('payment', pay.payment_number, `SELECT to_jsonb(p) AS j FROM payments p WHERE p.id=$1`, [pay.id])
  if (dropPo) await save('purchase_order', dropPo.po_number, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [dropPo.id])

  // Payment pehle hatani hai, warna unique index dono par ek saath nahi dega.
  if (pay) {
    await query(`UPDATE payments SET order_id=NULL WHERE id=$1`, [pay.id])
    await query(`UPDATE payments SET order_id=$2,
                        notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $3,
                        updated_at=NOW() WHERE id=$1`,
      [pay.id, keep.id, `${DROP} usi kaam ki ghalat entry thi; yeh payment ${KEEP} ki hai.`])
  }
  for (const s of ships) {
    await query(`UPDATE shipment_orders SET order_id=$2 WHERE shipment_id=$1 AND order_id=$3`,
      [s.shipment_id, keep.id, drop.id])
  }

  await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [keep.id, keep.total])
  await query(`UPDATE orders SET amount_paid=0, deleted_at=NOW(), updated_at=NOW(),
                      notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $2
                WHERE id=$1`,
    [drop.id, `${KEEP} isi kaam ka sahi record hai (19 shirts + 1 hoodie); yeh ghalat entry thi.`])
  if (drop.invoice_id) await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [drop.invoice_id])
  if (keep.invoice_id) await query(
    `UPDATE invoices SET amount_paid=$2, balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
    [keep.invoice_id, keep.total])

  if (dropPo) {
    await query(`DELETE FROM po_orders WHERE po_id=$1`, [dropPo.id])
    await query(`UPDATE purchase_orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [dropPo.id])
  }
  if (keepPo) await query(
    `UPDATE purchase_orders SET subtotal=$2, shipping_charge=$3, total=$4, grand_total=$4, updated_at=NOW()
      WHERE id=$1`, [keepPo.id, keep.subtotal, keep.shipping, keep.total])

  const after = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                  (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                  (SELECT COUNT(*) FROM payments WHERE order_id IS NULL) AS loose`)
  console.log(`\nho gaya. orders ${after.o}, PO ${after.p}, loose payments ${after.loose}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
