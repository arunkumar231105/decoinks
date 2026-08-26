/**
 * ORD-2026-0124, 0125 aur 0126 ka gap band karna.
 *
 * four-orders-the-chats-spell-out.js ne counter se number liye, aur counter
 * 126 par khada tha jabke aakhri asal order ORD-2026-0123 tha — renumber ke
 * baad counter peeche nahi kiya gaya tha. Is liye naye orders 0127 se shuru ho
 * gaye aur beech mein teen number khali reh gaye.
 *
 * Sales order numbers mein gap nahi hona chahiye. Chaaron naye orders ko
 * 0124–0127 par le aaya ja raha hai, apni tareekh ki tarteeb se, aur counter
 * 127 par set kiya ja raha hai.
 *
 * Yeh mehfooz hai kyunke in chaar ka koi invoice, koi purchase order aur koi
 * shipment nahi — sirf order aur us par lagi payment. Kisi doosre document ka
 * hawala nahi toota.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const MOVE = ['ORD-2026-0127', 'ORD-2026-0128', 'ORD-2026-0129', 'ORD-2026-0130']
const FIRST = 124

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const { rows } = await query(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.total, c.name AS customer,
            o.invoice_id,
            (SELECT COUNT(*) FROM shipment_orders s WHERE s.order_id=o.id) AS shipments,
            (SELECT COUNT(*) FROM purchase_orders po WHERE po.order_id=o.id) AS pos
       FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number = ANY($1) AND o.deleted_at IS NULL
      ORDER BY o.order_date, o.order_number`, [MOVE])

  if (rows.length !== MOVE.length) {
    console.log(`${MOVE.length} orders chahiye the, ${rows.length} mile — kuch nahi kiya.`)
    await pool.end(); return
  }
  const attached = rows.filter(r => r.invoice_id || Number(r.shipments) || Number(r.pos))
  if (attached.length) {
    console.log('In par doosre document lage hue hain, number badalna mehfooz nahi:')
    for (const r of attached) console.log(`  ${r.order_number}`)
    await pool.end(); return
  }
  // Jo orders khud move ho rahe hain wo apne hi target par "pehle se maujood"
  // ginne nahi chahiyen — warna guard bewajah rok deta hai.
  const taken = await one(
    `SELECT string_agg(order_number, ', ') AS n FROM orders
      WHERE order_number = ANY($1) AND NOT (order_number = ANY($2))`,
    [rows.map((_, i) => `ORD-2026-${String(FIRST + i).padStart(4, '0')}`), MOVE])
  if (taken?.n) { console.log(`Yeh number pehle se lage hue hain: ${taken.n} — kuch nahi kiya.`); await pool.end(); return }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  rows.forEach((r, i) => {
    const to = `ORD-2026-${String(FIRST + i).padStart(4, '0')}`
    console.log(`  ${r.order_number} → ${to}   ${r.d}  ${r.customer}  $${Number(r.total).toFixed(2)}`)
  })
  console.log(`\n  counter ORD-2026 → ${FIRST + rows.length - 1}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  // Pehle ek aisi jagah rakh dena jahan takraav na ho, phir asal number.
  // order_number sirf 24 characters ka hai, is liye uuid nahi — chhota index.
  for (let i = 0; i < rows.length; i++) {
    await query(`UPDATE orders SET order_number = $2 WHERE id = $1`,
      [rows[i].id, `TMP-RENUM-${String(i).padStart(2, '0')}`])
  }
  for (let i = 0; i < rows.length; i++) {
    const to = `ORD-2026-${String(FIRST + i).padStart(4, '0')}`
    await query(`UPDATE orders SET order_number = $2, updated_at = NOW() WHERE id = $1`, [rows[i].id, to])
  }
  await query(`UPDATE counters SET last_value = $1, updated_at = NOW() WHERE scope = 'ORD-2026'`,
    [FIRST + rows.length - 1])

  const gaps = await one(`
    SELECT COUNT(*) AS n FROM generate_series(1, (SELECT MAX(SUBSTRING(order_number FROM 10)::int)
                                                    FROM orders WHERE deleted_at IS NULL AND order_number LIKE 'ORD-2026-%')) g
     WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.deleted_at IS NULL
                        AND o.order_number = 'ORD-2026-'||LPAD(g::text,4,'0'))`)
  console.log(`\nho gaya. ab ${gaps.n} number khali hain.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
