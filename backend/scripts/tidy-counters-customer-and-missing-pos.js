/**
 * Teen alag cheezein, teenon chhoti aur seedhi.
 *
 * 1. SHP-2026 COUNTER TOOTA HUA HAI — yeh sab se zaroori hai.
 *    Counter 106 par khara hai jabke sab se badi shipment SHP-2026-0155 hai,
 *    aur SHP-2026-0107 pehle se mojood hai. shipment_number par unique index
 *    laga hua hai, is liye app se agli shipment banate hi takraav hoga aur
 *    shipment ban hi nahi payegi. Counter 155 par le jaya jata hai.
 *    Baqi chhe counters apne apne max se mel khate hain — unhein haath nahi.
 *
 * 2. MUHAMMAD HASSAN (CUST-2026-0091) HATANA — owner ke kehne par.
 *    Uska koi order ya payment nahi. Sirf do records hain, dono 31 August ke
 *    aur dono $1.00 ke — invoice MHA-0127 aur quotation Q-2026-0127. Shakl se
 *    test entries lagti hain. Customer ke saath wo dono bhi soft-delete hote
 *    hain, warna wo bin-maalik reh jayenge.
 *
 * 3. DO ORDERS KA PO NAHI — ORD-2026-0124 aur ORD-2026-0125, dono 2 September,
 *    dono Robert Farrar ke. Wahi qaida jo baqi 123 par chalta hai:
 *        order_type dtf → po_type gangsheet → TEXSTONE INC
 *
 * Sab kuch soft-delete hai aur har badli hui row pehle backup mein jati hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'tidy_backup_20260905'
const DROP_CUSTOMER = 'CUST-2026-0091'
const MISSING_PO_FOR = ['ORD-2026-0124', 'ORD-2026-0125']

const PO_STATUS = { 'Draft': 'Draft', 'Confirmed': 'In Production', 'In Production': 'In Production',
                    'Shipped': 'Shipped', 'Delivered': 'Shipped', 'Completed': 'Closed', 'Closed': 'Closed' }
const RULE = { dtf: { po_type: 'gangsheet', supplier: 'TEXSTONE INC' },
               apparel: { po_type: 'apparel', supplier: 'Xin Fei Yang Factory' } }

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  // 1. Counter
  const shp = await one(`
    SELECT (SELECT last_value FROM counters WHERE scope='SHP-2026') AS counter,
           (SELECT MAX(SUBSTRING(shipment_number FROM 10)::int) FROM shipments
             WHERE shipment_number ~ '^SHP-2026-[0-9]{4}$') AS max_no`)
  const counterBroken = Number(shp.counter) < Number(shp.max_no)

  // 2. Customer
  const cust = await one(
    `SELECT id, customer_number, name FROM customers WHERE customer_number=$1 AND deleted_at IS NULL`,
    [DROP_CUSTOMER])
  let custBlockers = [], custDocs = { invoices: [], quotes: [] }
  if (cust) {
    const orders = await one(`SELECT COUNT(*) AS n FROM orders WHERE customer_id=$1 AND deleted_at IS NULL`, [cust.id])
    const pays  = await one(`SELECT COUNT(*) AS n FROM payments WHERE customer_id=$1`, [cust.id])
    if (Number(orders.n)) custBlockers.push(`${orders.n} orders`)
    if (Number(pays.n))   custBlockers.push(`${pays.n} payments`)
    custDocs.invoices = (await query(
      `SELECT id, invoice_number, total FROM invoices WHERE customer_id=$1 AND deleted_at IS NULL`, [cust.id])).rows
    custDocs.quotes = (await query(
      `SELECT id, quote_number, total FROM quotations WHERE customer_id=$1 AND deleted_at IS NULL`, [cust.id])).rows
    // Sirf choti test-numa raqmein saath mein hataayi jayengi.
    const heavy = [...custDocs.invoices, ...custDocs.quotes].filter(d => Number(d.total) > 5)
    if (heavy.length) custBlockers.push(`${heavy.length} documents jinki raqam $5 se zyada hai`)
  }

  // 3. Missing POs
  const poPlan = [], poSkip = []
  for (const num of MISSING_PO_FOR) {
    const o = await one(
      `SELECT o.id, o.order_number, o.order_date, o.order_type, o.status, o.subtotal,
              COALESCE(o.shipping_charges,0) AS shipping, o.total, c.name AS customer
         FROM orders o JOIN customers c ON c.id=o.customer_id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [num])
    if (!o) { poSkip.push([num, 'order nahi mila']); continue }
    const has = await one(`SELECT po_number FROM purchase_orders WHERE order_id=$1 AND deleted_at IS NULL`, [o.id])
    if (has) { poSkip.push([num, `pehle se ${has.po_number} hai`]); continue }
    const rule = RULE[o.order_type]
    const st = PO_STATUS[o.status]
    if (!rule) { poSkip.push([num, `order_type "${o.order_type}" ka rule nahi`]); continue }
    if (!st)   { poSkip.push([num, `status "${o.status}" ka tarjuma nahi`]); continue }
    const sup = await one(`SELECT id FROM suppliers WHERE name=$1 AND deleted_at IS NULL`, [rule.supplier])
    if (!sup) { poSkip.push([num, `supplier "${rule.supplier}" nahi mila`]); continue }
    poPlan.push({ o, ...rule, po_status: st, supplier_id: sup.id })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  console.log('1. SHP-2026 COUNTER')
  console.log(`   counter ${shp.counter}, sab se badi shipment ${shp.max_no}` +
              (counterBroken ? `  →  ${shp.max_no} par set hoga (abhi tooti hui hai)` : '  →  theek hai, chhora jayega'))

  console.log('\n2. CUSTOMER HATANA')
  if (!cust) console.log(`   ${DROP_CUSTOMER} nahi mila (ya pehle se hata hua)`)
  else if (custBlockers.length) console.log(`   ${cust.name}: ${custBlockers.join(', ')} — hatana mehfooz nahi, chhora jayega`)
  else {
    console.log(`   ${cust.customer_number}  ${cust.name}  → soft-delete`)
    for (const i of custDocs.invoices) console.log(`      invoice ${i.invoice_number} ${money(i.total)} → soft-delete`)
    for (const q of custDocs.quotes)   console.log(`      quote   ${q.quote_number} ${money(q.total)} → soft-delete`)
  }

  console.log('\n3. NAYE PO')
  for (const p of poPlan)
    console.log(`   ${p.o.order_number}  ${String(p.o.order_date).slice(0,10)}  ${p.o.order_type} → ${p.po_type}  ` +
                `${p.supplier}  ${p.po_status}  ${money(p.o.total)}  ${p.o.customer}`)
  for (const [n, why] of poSkip) console.log(`   ${n}  chhora — ${why}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }

  if (counterBroken) {
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('counter','SHP-2026',$1)`,
      [JSON.stringify({ was: Number(shp.counter), now: Number(shp.max_no) })])
    await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='SHP-2026'`, [shp.max_no])
    console.log(`   SHP-2026 counter ${shp.counter} → ${shp.max_no}`)
  }

  if (cust && !custBlockers.length) {
    await save('customer', cust.customer_number, `SELECT to_jsonb(x) AS j FROM customers x WHERE x.id=$1`, [cust.id])
    for (const i of custDocs.invoices) {
      await save('invoice', i.invoice_number, `SELECT to_jsonb(x) AS j FROM invoices x WHERE x.id=$1`, [i.id])
      await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [i.id])
    }
    for (const q of custDocs.quotes) {
      await save('quotation', q.quote_number, `SELECT to_jsonb(x) AS j FROM quotations x WHERE x.id=$1`, [q.id])
      await query(`UPDATE quotations SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [q.id])
    }
    await query(`UPDATE customers SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [cust.id])
    console.log(`   ${cust.customer_number} ${cust.name} hata diya`)
  }

  for (const p of poPlan) {
    const maxPo = await one(`SELECT COALESCE(MAX(SUBSTRING(po_number FROM 9)::int),0) AS n
                               FROM purchase_orders WHERE po_number ~ '^PO-2026-[0-9]{4}$'`)
    await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PO-2026'`, [maxPo.n])
    const c = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope='PO-2026' RETURNING last_value`)
    const poNo = `PO-2026-${String(c.last_value).padStart(4, '0')}`
    const ins = await one(
      `INSERT INTO purchase_orders (po_number, po_type, order_id, supplier_id, status, payment_status,
                                    order_date, entry_date, subtotal, shipping_charge, total, grand_total,
                                    created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'Paid',$6,NOW(),$7,$8,$9,$9,NOW(),NOW()) RETURNING id`,
      [poNo, p.po_type, p.o.id, p.supplier_id, p.po_status, p.o.order_date, p.o.subtotal, p.o.shipping, p.o.total])
    await query(`INSERT INTO po_orders (po_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ins.id, p.o.id])
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('created-po',$1,$2)`,
      [poNo, JSON.stringify({ po_id: ins.id, order: p.o.order_number, total: p.o.total })])
    console.log(`   ${poNo}  ${money(p.o.total)}  → ${p.o.order_number}`)
  }

  const after = await one(`
    SELECT (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL) AS customers,
           (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS pos,
           (SELECT COUNT(*) FROM orders o WHERE o.deleted_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM purchase_orders po WHERE po.order_id=o.id AND po.deleted_at IS NULL)) AS bina_po`)
  console.log(`\nho gaya. ${after.customers} customers, ${after.pos} PO, ${after.bina_po} orders bina PO ke.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
