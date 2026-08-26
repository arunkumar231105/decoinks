/**
 * Har sales order ka apna purchase order, aur us par wahi raqam jo order par hai.
 *
 * Do masle the:
 *
 *   1. PAANCH ORDERS KA PO HAI HI NAHI — ORD-2026-0123 aur aaj banaye gaye
 *      chaar (0124–0127). 126 orders the aur 121 PO.
 *
 *   2. RAQAM MEL NAHI KHATI. 121 PO mein se sirf 53 apne order ke barabar the.
 *      26 par bilkul sifar likha tha, aur 43 par kuch aur — un mein wo bhi hain
 *      jo aaj order theek karte waqt peeche reh gaye: PO-2026-0011 abhi bhi
 *      $280 kehta hai jabke uska order $265 ho chuka, PO-2026-0017 $245 jabke
 *      order $230, PO-2026-0035 $100 jabke order $115.
 *
 * Owner ka faisla: PO ki raqam wahi ho jo uske sales order par hai. So har PO
 * ka subtotal, shipping aur total apne order se le liya jata hai.
 *
 * Naye PO mojooda tarteeb ke mutabiq bante hain — yeh rishta 121 mein se 121
 * par bila istisna chalta hai:
 *     order_type dtf      →  po_type gangsheet  →  TEXSTONE INC
 *     order_type apparel  →  po_type apparel    →  Xin Fei Yang Factory
 *
 * Number aakhir mein lagte hain; tarteeb alag script mein durust hogi.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'po_sync_backup_20260825'
const money = n => `$${Number(n).toFixed(2)}`

const RULE = {
  dtf:     { po_type: 'gangsheet', supplier: 'TEXSTONE INC' },
  apparel: { po_type: 'apparel',   supplier: 'Xin Fei Yang Factory' },
}

// PO ka status apna enum rakhta hai (Draft, In Production, Shipped, Closed) —
// order ka "Confirmed" us mein hai hi nahi, is liye tarjuma zaroori hai.
const PO_STATUS = {
  'Draft': 'Draft',
  'Confirmed': 'In Production',
  'In Production': 'In Production',
  'Shipped': 'Shipped',
  'Delivered': 'Shipped',
  'Completed': 'Closed',
  'Closed': 'Closed',
}

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  // 1. Jin orders ka PO nahi
  const missing = (await query(`
    SELECT o.id, o.order_number, o.order_date, o.order_type, o.subtotal,
           COALESCE(o.shipping_charges,0) AS shipping, o.total, o.status, c.name AS customer
      FROM orders o JOIN customers c ON c.id=o.customer_id
     WHERE o.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.order_id=o.id AND po.deleted_at IS NULL)
     ORDER BY o.order_date, o.order_number`)).rows

  // 2. Jin PO ki raqam apne order se alag hai
  const wrong = (await query(`
    SELECT po.id, po.po_number, po.subtotal AS po_sub, COALESCE(po.shipping_charge,0) AS po_ship,
           po.total AS po_total, o.order_number, o.subtotal AS o_sub,
           COALESCE(o.shipping_charges,0) AS o_ship, o.total AS o_total, c.name AS customer
      FROM purchase_orders po JOIN orders o ON o.id=po.order_id JOIN customers c ON c.id=o.customer_id
     WHERE po.deleted_at IS NULL AND o.deleted_at IS NULL
       AND (ROUND(po.subtotal,2) <> ROUND(o.subtotal,2)
         OR ROUND(COALESCE(po.shipping_charge,0),2) <> ROUND(COALESCE(o.shipping_charges,0),2)
         OR ROUND(po.total,2) <> ROUND(o.total,2))
     ORDER BY po.po_number`)).rows

  const suppliers = {}
  for (const [, r] of Object.entries(RULE)) {
    if (suppliers[r.supplier]) continue
    const s = await one(`SELECT id, name FROM suppliers WHERE name=$1 AND deleted_at IS NULL`, [r.supplier])
    if (!s) { console.log(`Supplier "${r.supplier}" nahi mila — kuch nahi kiya.`); await pool.end(); return }
    suppliers[r.supplier] = s.id
  }

  const plan = []
  const skipped = []
  for (const o of missing) {
    const rule = RULE[o.order_type]
    if (!rule) { skipped.push([o.order_number, `order_type "${o.order_type}" ka koi rule nahi`]); continue }
    const poStatus = PO_STATUS[o.status]
    if (!poStatus) { skipped.push([o.order_number, `order status "${o.status}" ka koi PO status nahi`]); continue }
    plan.push({ ...o, ...rule, po_status: poStatus, supplier_id: suppliers[rule.supplier] })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  console.log(`1. NAYE PO (${plan.length}):`)
  for (const p of plan)
    console.log(`   ${p.order_number}  ${String(p.order_date).slice(0,10)}  ${p.order_type.padEnd(8)} → ${p.po_type.padEnd(10)} ${p.supplier.padEnd(21)} ${p.po_status.padEnd(14)} ${money(p.total).padStart(9)}  ${p.customer}`)

  console.log(`\n2. RAQAM THEEK HOGI (${wrong.length}):`)
  for (const w of wrong)
    console.log(`   ${w.po_number} → ${w.order_number}  ${w.customer.slice(0,20).padEnd(20)}  ` +
                `${money(w.po_sub).padStart(9)}+${money(w.po_ship).padStart(7)}=${money(w.po_total).padStart(9)}  →  ` +
                `${money(w.o_sub).padStart(9)}+${money(w.o_ship).padStart(7)}=${money(w.o_total).padStart(9)}`)

  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`   ${n}  ${why}`)
  }

  const before = await one(`SELECT COUNT(*) AS n FROM purchase_orders WHERE deleted_at IS NULL`)
  const orders = await one(`SELECT COUNT(*) AS n FROM orders WHERE deleted_at IS NULL`)
  console.log(`\nPO ${before.n} → ${Number(before.n) + plan.length}   |   orders ${orders.n}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  // Counter ko aakhri asal number par lana, warna numbers mein khali jagah bane.
  const maxPo = await one(`SELECT COALESCE(MAX(SUBSTRING(po_number FROM 9)::int),0) AS n
                             FROM purchase_orders WHERE po_number LIKE 'PO-2026-%'`)
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PO-2026'`, [maxPo.n])

  for (const p of plan) {
    const c = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope='PO-2026' RETURNING last_value`)
    const poNo = `PO-2026-${String(c.last_value).padStart(4, '0')}`
    const ins = await one(
      `INSERT INTO purchase_orders (po_number, po_type, order_id, supplier_id, status, payment_status,
                                    order_date, entry_date, subtotal, shipping_charge, total, grand_total,
                                    created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'Paid',$6,NOW(),$7,$8,$9,$9,NOW(),NOW()) RETURNING id`,
      [poNo, p.po_type, p.id, p.supplier_id, p.po_status, p.order_date, p.subtotal, p.shipping, p.total])
    await query(`INSERT INTO po_orders (po_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ins.id, p.id])
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('created-po',$1,$2)`,
      [poNo, JSON.stringify({ po_id: ins.id, order: p.order_number, total: p.total })])
    console.log(`   ${poNo}  ${money(p.total).padStart(9)}  → ${p.order_number}`)
  }

  let fixed = 0
  for (const w of wrong) {
    const { rows } = await query(`SELECT to_jsonb(x) AS j FROM purchase_orders x WHERE x.id=$1`, [w.id])
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('purchase_order',$1,$2)`, [w.po_number, rows[0].j])
    await query(
      `UPDATE purchase_orders SET subtotal=$2, shipping_charge=$3, total=$4, grand_total=$4, updated_at=NOW()
        WHERE id=$1`, [w.id, w.o_sub, w.o_ship, w.o_total])
    fixed++
  }

  const chk = await one(`
    SELECT COUNT(*) AS po, COUNT(*) FILTER (WHERE ROUND(po.total,2)=ROUND(o.total,2)) AS barabar,
           ROUND(SUM(po.total),2) AS po_total, ROUND(SUM(o.total),2) AS ord_total
      FROM purchase_orders po JOIN orders o ON o.id=po.order_id
     WHERE po.deleted_at IS NULL AND o.deleted_at IS NULL`)
  const after = await one(`SELECT (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS po,
                                  (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o`)
  console.log(`\nho gaya. ${plan.length} naye PO, ${fixed} ki raqam theek hui.`)
  console.log(`ab ${after.po} PO aur ${after.o} orders. ${chk.barabar}/${chk.po} PO apne order ke barabar.`)
  console.log(`PO total ${money(chk.po_total)}, order total ${money(chk.ord_total)}.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
