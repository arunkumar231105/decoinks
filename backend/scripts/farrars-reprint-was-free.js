/**
 * ORD-2026-0068 free tha — sirf postage li gayi thi.
 *
 * Robert Farrar ka 20 July ka order: 7 transfers, unit price $0.00, aur us par
 * sirf $16.00 shipping. Chatwoot conv 23 ismein saath deti hai — 24 July ko wo
 * likhta hai "I got the back order today" aur usi din staff kehti hai "our
 * printer unexpectedly had an issue today". Yaani yeh reprint tha jiska maal
 * muft diya gaya aur sirf bhijwai ka kharcha liya gaya.
 *
 * Owner ne tasdeeq ki ke yeh free hai, so is par is_free lag raha hai.
 *
 * Baqi nau free orders ki tarteeb yeh hai: order par subtotal, shipping aur
 * total teenon $0.00, aur postage invoice par rehti hai. Aath par bilkul aisa
 * hi hai (sirf ORD-2026-0024 par shipping order par bhi padi hai, jo us tarteeb
 * se hat kar hai). Is ka invoice RFA-0065 pehle hi us tarteeb mein hai — items
 * $0.00, shipping $16.00, total $16.00, poora paid, balance $0.00 — is liye
 * invoice ko haath nahi lagaya ja raha. Sirf order aur uska PO $0.00 par aate
 * hain.
 *
 * Is ke baad free orders 9 se 10 ho jayenge aur bina payment wale orders 6 se 5.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'farrar_free_backup_20260825'
const ORDER = 'ORD-2026-0068'

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const o = await one(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.is_free, o.subtotal,
            COALESCE(o.shipping_charges,0) AS shipping, o.total, o.invoice_id, c.name AS customer,
            COALESCE((SELECT SUM(qty) FROM order_items_dtf WHERE order_id=o.id),0) AS qty
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [ORDER])
  if (!o) { console.log(`${ORDER} nahi mila.`); await pool.end(); return }
  if (o.is_free) { console.log(`${ORDER} pehle se free hai — kuch nahi kiya.`); await pool.end(); return }

  const pay = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
  if (pay) { console.log(`${ORDER} par ${pay.payment_number} lagi hui hai — free karna mehfooz nahi.`); await pool.end(); return }
  if (Number(o.subtotal) !== 0) {
    console.log(`${ORDER} ka subtotal ${money(o.subtotal)} hai, sifar nahi — pehle wo dekhein.`); await pool.end(); return
  }

  const inv = o.invoice_id ? await one(
    `SELECT invoice_number, subtotal, COALESCE(shipping_charges,0) AS shipping, total, amount_paid,
            COALESCE(balance_due,0) AS balance_due, status FROM invoices WHERE id=$1`, [o.invoice_id]) : null
  const po = await one(`SELECT id, po_number, subtotal, COALESCE(shipping_charge,0) AS shipping, total
                          FROM purchase_orders WHERE order_id=$1 AND deleted_at IS NULL`, [o.id])

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${ORDER}  ${o.d}  ${o.customer}   ${o.qty} transfers`)
  console.log(`  order:  is_free ${o.is_free} → true`)
  console.log(`          sub ${money(o.subtotal)} + ship ${money(o.shipping)} = ${money(o.total)}  →  ${money(0)} + ${money(0)} = ${money(0)}`)
  if (po)  console.log(`  ${po.po_number}:  ${money(po.total)} → ${money(0)}`)
  if (inv) console.log(`  ${inv.invoice_number}:  items ${money(inv.subtotal)} + ship ${money(inv.shipping)} = ${money(inv.total)}, paid ${money(inv.amount_paid)}, balance ${money(inv.balance_due)}  —  waise hi rahega (postage yahin rehti hai)`)

  const before = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND is_free) AS free,
                                   (SELECT COUNT(*) FROM orders x WHERE x.deleted_at IS NULL AND NOT x.is_free
                                      AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=x.id)) AS unpaid`)
  console.log(`\nfree orders ${before.free} → ${Number(before.free) + 1}   |   bina payment ${before.unpaid} → ${Number(before.unpaid) - 1}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }
  await save('order', ORDER, `SELECT to_jsonb(x) AS j FROM orders x WHERE x.id=$1`, [o.id])
  if (po) await save('purchase_order', po.po_number, `SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [po.id])

  await query(
    `UPDATE orders SET is_free = true, subtotal = 0, shipping_charges = 0, total = 0, amount_paid = 0,
            notes = COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || $2,
            updated_at = NOW() WHERE id = $1`,
    [o.id, `Reprint — maal muft diya gaya, sirf ${money(16)} postage li gayi (invoice par).`])

  if (po) await query(
    `UPDATE purchase_orders SET subtotal = 0, shipping_charge = 0, total = 0, grand_total = 0, updated_at = NOW()
      WHERE id = $1`, [po.id])

  const after = await one(`SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND is_free) AS free,
                                  (SELECT COUNT(*) FROM orders x WHERE x.deleted_at IS NULL AND NOT x.is_free
                                     AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=x.id)) AS unpaid,
                                  (SELECT ROUND(SUM(total),2) FROM orders WHERE deleted_at IS NULL) AS ord,
                                  (SELECT ROUND(SUM(total),2) FROM purchase_orders WHERE deleted_at IS NULL) AS po`)
  console.log(`\nho gaya. free orders ${after.free}, bina payment ${after.unpaid}.`)
  console.log(`order value ${money(after.ord)}, PO value ${money(after.po)}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
