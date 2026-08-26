/**
 * ORD-2026-0120 ko us order ke mutabiq karna jo Jennifer ne asal mein diya tha.
 *
 * Order par likha hai: 1 × Gildan G5000, Maroon, M, $10 — total $10 + $15
 * shipping = $25, aur koi payment nahi lagi. Magar PAY-2026-0083 ($65, 14 Aug)
 * usi ka hai aur kahin nahi lagta.
 *
 * Chatwoot conv 717 poora order likh deta hai:
 *   13 Aug 15:32  "if I could get it on a Raiders grey colored shirt"
 *   13 Aug 18:25  "I'm just thinking a little bit of a darker grey shirt"
 *   13 Aug 18:30  "I'm looking to order 1) 2XL 2) extra large 1) adult large
 *                  and 1 kids large"                            → 5 shirts
 *   13 Aug 22:18  "Per t shirt the price will be $11 that will be total $55
 *                  + shipping"
 *   13 Aug 22:31  "That would be total $55 + $10 (Shipping)"    → $65
 *
 * Order 19 August ko bana — usi din jab wo chat par poochh rahi thi "can you
 * please give me an update on the shirts" aur jawab mila "Your order is in
 * production". Uska koi doosra order nahi hai.
 *
 * Rang: catalog mein is style ke do grey hain, Sport Grey aur Charcoal. Usne
 * "darker grey" maanga tha, is liye Charcoal.
 *
 * Kids large: is adult style mein youth size hai hi nahi. Wo line adult L par
 * rakhi ja rahi hai aur uske notes mein saaf likha hai — chhupaya nahi gaya.
 *
 * Teenon jagah — order_items_apparel, invoice_items_apparel, invoice_items —
 * ek jaisi lines rakhi jati hain, warna order aur invoice phir se alag ho
 * jayenge.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'jennifer_order_backup_20260825'
const ORDER = 'ORD-2026-0120'
const PAYMENT = 'PAY-2026-0083'

const STYLE_ID = 'a188f4fa-1d74-46a3-9644-6e825a23e76c'
const CHARCOAL = 'c5d77609-0841-4afc-a2d9-f5866337a001'
const SIZE = {
  L:   '7318cbe8-978f-4407-95b6-66f0d0b446e1',
  XL:  '1ca36e7d-8610-42e8-965e-fe24af92bf7b',
  XXL: 'a488b9e1-02be-4bfc-b4e4-a6333830f120',
}

const ITEM = 'Gildan G5000 Adult 100% Cotton T-Shirt'
const RATE = 11
const SHIPPING = 10

const LINES = [
  { size: 'XXL', size_id: SIZE.XXL, qty: 1, note: '' },
  { size: 'XL',  size_id: SIZE.XL,  qty: 2, note: '' },
  { size: 'L',   size_id: SIZE.L,   qty: 1, note: 'adult large' },
  { size: 'L',   size_id: SIZE.L,   qty: 1, note: 'kids large — youth size catalog mein nahi, adult L par rakha gaya' },
]

const money = n => `$${Number(n).toFixed(2)}`
const SUBTOTAL = +LINES.reduce((s, l) => s + l.qty * RATE, 0).toFixed(2)
const TOTAL = +(SUBTOTAL + SHIPPING).toFixed(2)

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const o = await one(
    `SELECT o.id, o.order_number, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
            o.invoice_id, o.status, c.name AS customer
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [ORDER])
  const p = await one(`SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number=$1`, [PAYMENT])

  if (!o) { console.log(`${ORDER} nahi mila.`); await pool.end(); return }
  if (!p) { console.log(`${PAYMENT} nahi mili.`); await pool.end(); return }
  if (p.order_id) { console.log(`${PAYMENT} pehle se kisi order par lagi hui hai — kuch nahi kiya.`); await pool.end(); return }

  const taken = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
  if (taken) { console.log(`${ORDER} par pehle se ${taken.payment_number} lagi hui hai — kuch nahi kiya.`); await pool.end(); return }

  if (Math.abs(TOTAL - Number(p.amount)) > 0.005) {
    console.log(`Chat ka total ${money(TOTAL)} magar payment ${money(p.amount)} — barabar nahi, kuch nahi kiya.`)
    await pool.end(); return
  }

  const inv = o.invoice_id
    ? await one(`SELECT id, invoice_number, subtotal, COALESCE(shipping_charges,0) AS shipping, total,
                        amount_paid, COALESCE(balance_due,0) AS balance_due, status
                   FROM invoices WHERE id=$1`, [o.invoice_id])
    : null

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${ORDER}  ${o.customer}  (${o.status})`)
  console.log(`  ab:  sub ${money(o.subtotal)} + ship ${money(o.shipping)} = ${money(o.total)}   — koi payment nahi`)
  console.log(`  hoga: sub ${money(SUBTOTAL)} + ship ${money(SHIPPING)} = ${money(TOTAL)}   ← ${PAYMENT} ${money(p.amount)}`)
  console.log(`\n  purani line:  1 × ${ITEM}, Maroon, M @ ${money(10)}`)
  console.log(`  nayi lines:`)
  for (const l of LINES)
    console.log(`    ${String(l.qty).padStart(2)} × Charcoal ${l.size.padEnd(3)} @ ${money(RATE)} = ${money(l.qty * RATE)}${l.note ? '   (' + l.note + ')' : ''}`)
  console.log(`    ${String(LINES.reduce((s, l) => s + l.qty, 0)).padStart(2)} pcs${' '.repeat(24)}= ${money(SUBTOTAL)}`)
  if (inv) console.log(`\n  ${inv.invoice_number}: ${money(inv.total)} → ${money(TOTAL)}, paid ${money(inv.amount_paid)} → ${money(TOTAL)}, status "${inv.status}" → "Paid"`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, row_data) VALUES ($1,$2)`, [what, r.j])
  }
  await save('order', `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [o.id])
  await save('order_items_apparel', `SELECT to_jsonb(a) AS j FROM order_items_apparel a WHERE a.order_id=$1`, [o.id])
  if (inv) {
    await save('invoice', `SELECT to_jsonb(i) AS j FROM invoices i WHERE i.id=$1`, [inv.id])
    await save('invoice_items_apparel', `SELECT to_jsonb(x) AS j FROM invoice_items_apparel x WHERE x.invoice_id=$1`, [inv.id])
    await save('invoice_items', `SELECT to_jsonb(x) AS j FROM invoice_items x WHERE x.invoice_id=$1`, [inv.id])
  }

  await query(`DELETE FROM order_items_apparel WHERE order_id=$1`, [o.id])
  let n = 0
  for (const l of LINES) {
    await query(
      `INSERT INTO order_items_apparel
         (order_id, item, color, size, qty, unit_price, amount, brand, model, category,
          catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, sort_order, notes)
       VALUES ($1,$2,'Charcoal',$3,$4,$5,$6,'Gildan','DG015','T-Shirt',$7,$8,$9,$10,$11,$12)`,
      [o.id, ITEM, l.size, l.qty, RATE, +(l.qty * RATE).toFixed(2),
       STYLE_ID, CHARCOAL, l.size_id, `DG015-CHARCOAL-${l.size}`, n, l.note || null])
    n++
  }

  await query(
    `UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
      WHERE id=$1`, [o.id, SUBTOTAL, SHIPPING, TOTAL])

  if (inv) {
    await query(`DELETE FROM invoice_items_apparel WHERE invoice_id=$1`, [inv.id])
    await query(`DELETE FROM invoice_items WHERE invoice_id=$1`, [inv.id])
    let k = 0
    for (const l of LINES) {
      await query(
        `INSERT INTO invoice_items_apparel
           (invoice_id, line_no, item_description, color, size, quantity, unit_rate, line_amount,
            brand, model, category, catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, sort_order, notes)
         VALUES ($1,$2,$3,'Charcoal',$4,$5,$6,$7,'Gildan','DG015','T-Shirt',$8,$9,$10,$11,$2,$12)`,
        [inv.id, k, ITEM, l.size, l.qty, RATE, +(l.qty * RATE).toFixed(2),
         STYLE_ID, CHARCOAL, l.size_id, `DG015-CHARCOAL-${l.size}`, l.note || null])
      await query(
        `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sizes, colors, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,'Charcoal',$7)`,
        [inv.id, ITEM, l.qty, RATE, +(l.qty * RATE).toFixed(2), l.size, k])
      k++
    }
    await query(
      `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
              balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
      [inv.id, SUBTOTAL, SHIPPING, TOTAL])
  }

  await query(`UPDATE payments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [p.id, o.id])

  const loose = await one(`SELECT COUNT(*) AS n FROM payments WHERE order_id IS NULL`)
  console.log(`\nho gaya. ab ${loose.n} payments bina order ke.`)
  console.log(`purani halat ${BACKUP} mein mehfooz hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
