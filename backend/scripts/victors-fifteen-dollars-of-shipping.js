/**
 * ORD-2026-0088 ka subtotal/shipping split theek karna.
 *
 * what-the-chats-proved.js ne is order ko $65 se $50 kiya, kyunke conv 21 ki
 * jis line par nazar padi wo sirf "Total $50" thi. Usi guftagu ki pichli line
 * poora split deti hai:
 *
 *   31 Jul 01:16:03  out  "It will cost $ 35 + $15 shipping"
 *   31 Jul 01:16:04  out  "Total $50"
 *
 * Total durust hai aur payment usi ke barabar hai. Sirf split ghalat gaya —
 * $50 + $0 likha gaya jabke $35 + $15 hona chahiye tha. Yeh wahi ghalti hai
 * jiske khilaf yeh saara kaam hai, is liye theek ki ja rahi hai.
 *
 * Payment ko haath nahi lagaya ja raha. PAY-2026-0065 waqai isi order ki hai:
 * Victor ne pehle Cash App par bheji (jo hamare paas nahi tha), phir staff ne
 * 31 Jul ko Stripe ka link bheja, aur 1 Aug ko usne likha "I made the deposit
 * please let me know when you receive it" — PAY-2026-0065 usi din ki Stripe
 * payment hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'victor_split_backup_20260825'
const ORDER = 'ORD-2026-0088'
const SUBTOTAL = 35.00
const SHIPPING = 15.00
const TOTAL = 50.00

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const o = await one(
    `SELECT o.id, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total, o.invoice_id,
            c.name AS customer, p.payment_number, p.amount AS paid
       FROM orders o JOIN customers c ON c.id=o.customer_id
       LEFT JOIN payments p ON p.order_id=o.id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [ORDER])
  if (!o) { console.log(`${ORDER} nahi mila.`); await pool.end(); return }

  if (Math.abs(Number(o.total) - TOTAL) > 0.005) {
    console.log(`${ORDER} ka total ${money(o.total)} hai, ${money(TOTAL)} nahi — kuch nahi kiya.`)
    await pool.end(); return
  }
  if (Math.abs(SUBTOTAL + SHIPPING - TOTAL) > 0.005) {
    console.log(`${money(SUBTOTAL)} + ${money(SHIPPING)} ≠ ${money(TOTAL)} — kuch nahi kiya.`)
    await pool.end(); return
  }

  const inv = o.invoice_id
    ? await one(`SELECT id, invoice_number, subtotal, COALESCE(shipping_charges,0) AS shipping, total FROM invoices WHERE id=$1`, [o.invoice_id])
    : null

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`${ORDER}  ${o.customer}   payment ${o.payment_number || '—'} ${money(o.paid || 0)}`)
  console.log(`  ab:   sub ${money(o.subtotal)} + ship ${money(o.shipping)} = ${money(o.total)}`)
  console.log(`  hoga: sub ${money(SUBTOTAL)} + ship ${money(SHIPPING)} = ${money(TOTAL)}   (total wahi rehta hai)`)
  if (inv) console.log(`  ${inv.invoice_number}: sub ${money(inv.subtotal)} + ship ${money(inv.shipping)} → ${money(SUBTOTAL)} + ${money(SHIPPING)}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const { rows: os } = await query(`SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [o.id])
  await query(`INSERT INTO ${BACKUP} (what,row_data) VALUES ('order',$1)`, [os[0].j])
  if (inv) {
    const { rows: is } = await query(`SELECT to_jsonb(i) AS j FROM invoices i WHERE i.id=$1`, [inv.id])
    await query(`INSERT INTO ${BACKUP} (what,row_data) VALUES ('invoice',$1)`, [is[0].j])
  }

  await query(`UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW() WHERE id=$1`,
    [o.id, SUBTOTAL, SHIPPING, TOTAL])
  if (inv) await query(
    `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, balance_due=0, status='Paid', updated_at=NOW()
      WHERE id=$1`, [inv.id, SUBTOTAL, SHIPPING, TOTAL])

  console.log(`\nho gaya. purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
