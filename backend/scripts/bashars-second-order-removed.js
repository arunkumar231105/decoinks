/**
 * ORD-2026-0037 hatana — owner ke kehne par.
 *
 * Bashar Mamlouk par do orders the:
 *   ORD-2026-0036  18 Jun  3 designs (B&B CAR/CLEAN/B&B), 300 pcs @ $0.95
 *                          $285 + $15 = $300   — PAY-2026-0029 se paid
 *   ORD-2026-0037  21 Jun  17 designs (auntie/grandma/cousin/uncle), 22 pcs
 *                          @ $4.09, $90 + $10 = $100   — unpaid
 *
 * Owner kehte hain Bashar ka ek hi order hai aur yeh dusra ghalat feed hua.
 *
 * YEH DUPLICATE NAHI THA, AUR YEH LIKH DENA ZAROORI HAI. Dono ke designs
 * bilkul alag hain — ek car wash ka kaam, doosra rishtedaron wale 17 designs —
 * rate alag ($0.95 banam $4.09), aur dono ka apna alag tracking number
 * (1Z2B14J80309134207 aur 1Z2B14J80304559213), yaani do alag package gaye.
 * Farrar ke chaar duplicate orders ka ek hi tracking tha; yahan aisa nahi.
 * Saboot dikhane ke baad owner ne phir bhi hatane ko kaha, so hataya ja raha
 * hai — magar soft delete se, taake wapas laya ja sake.
 *
 * Shipment ka record chhora ja raha hai. Package waqai gaya tha aur uska
 * tracking mojood hai; usay mitane ka matlab hoga ke bhijwai ka saboot bhi
 * chala jaye. Wo ab ek chhupe hue order se juda rahega, wahi soorat jo baqi
 * soft-deleted orders ki hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'bashar_0037_backup_20260825'
const ORDER = 'ORD-2026-0037'

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const o = await one(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping,
            o.total, o.invoice_id, c.name AS customer,
            COALESCE((SELECT SUM(qty) FROM order_items_dtf WHERE order_id=o.id),0) AS qty,
            (SELECT COUNT(*) FROM order_items_dtf WHERE order_id=o.id) AS lines
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [ORDER])
  if (!o) { console.log(`${ORDER} nahi mila (ya pehle se hata hua hai).`); await pool.end(); return }

  const pay = await one(`SELECT payment_number, amount FROM payments WHERE order_id=$1`, [o.id])
  if (pay) {
    console.log(`${ORDER} par ${pay.payment_number} ${money(pay.amount)} lagi hui hai — hatana mehfooz nahi. Pehle payment kahin aur lagayein.`)
    await pool.end(); return
  }

  const po = await one(`SELECT id, po_number, total FROM purchase_orders WHERE order_id=$1 AND deleted_at IS NULL`, [o.id])
  const inv = o.invoice_id ? await one(`SELECT id, invoice_number, total FROM invoices WHERE id=$1 AND deleted_at IS NULL`, [o.invoice_id]) : null
  const ships = (await query(`SELECT s.tracking_number FROM shipment_orders so JOIN shipments s ON s.id=so.shipment_id
                               WHERE so.order_id=$1`, [o.id])).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${ORDER}  ${o.d}  ${o.customer}   ${o.lines} designs, ${o.qty} pcs   ${money(o.subtotal)} + ${money(o.shipping)} = ${money(o.total)}`)
  console.log(`  soft-delete hoga (mitega nahi — wapas aa sakta hai)`)
  if (po)  console.log(`  ${po.po_number}  ${money(po.total)}  →  soft-delete`)
  if (inv) console.log(`  ${inv.invoice_number}  ${money(inv.total)}  →  soft-delete`)
  for (const s of ships) console.log(`  shipment ${s.tracking_number}  →  chhora ja raha hai (package waqai gaya tha)`)

  const before = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                   (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                   (SELECT ROUND(SUM(total),2) FROM orders WHERE deleted_at IS NULL) AS val`)
  console.log(`\norders ${before.o} → ${Number(before.o) - 1}   PO ${before.p} → ${Number(before.p) - (po ? 1 : 0)}`)
  console.log(`order value ${money(before.val)} → ${money(Number(before.val) - Number(o.total))}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }
  await save('order', ORDER, `SELECT to_jsonb(x) AS j FROM orders x WHERE x.id=$1`, [o.id])
  await save('order_items_dtf', ORDER, `SELECT to_jsonb(x) AS j FROM order_items_dtf x WHERE x.order_id=$1`, [o.id])
  await save('shipment_orders', ORDER, `SELECT to_jsonb(x) AS j FROM shipment_orders x WHERE x.order_id=$1`, [o.id])
  if (po)  await save('purchase_order', po.po_number, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [po.id])
  if (inv) await save('invoice', inv.invoice_number, `SELECT to_jsonb(x) AS j FROM invoices x WHERE x.id=$1`, [inv.id])

  const why = 'Owner ke kehne par hataya gaya — Bashar Mamlouk ka ek hi order hai. ' +
              'Iske 17 designs aur alag tracking (1Z2B14J80304559213) ORD-2026-0036 se mukhtalif the.'
  await query(`UPDATE orders SET deleted_at=NOW(), updated_at=NOW(),
                      notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $2
                WHERE id=$1`, [o.id, why])
  if (po) {
    await query(`DELETE FROM po_orders WHERE po_id=$1`, [po.id])
    await query(`UPDATE purchase_orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [po.id])
  }
  if (inv) await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [inv.id])

  const after = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
                                  (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
                                  (SELECT ROUND(SUM(total),2) FROM orders WHERE deleted_at IS NULL) AS val`)
  console.log(`\nho gaya. orders ${after.o}, PO ${after.p}, order value ${money(after.val)}.`)
  console.log(`purani halat ${BACKUP} mein hai. Ab renumber chalayein.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
