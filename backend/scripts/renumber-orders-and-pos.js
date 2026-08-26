/**
 * Orders aur purchase orders ke number tareekh ki tarteeb se, bina kisi gap ke.
 *
 * Christine Calhoun ke do orders ek hone ke baad 126 orders aur 126 PO bache,
 * magar number 0127 tak jate hain — beech mein 0067 ki jagah khali hai. Saath
 * hi aakhir ke chhe orders tareekh ki tarteeb se bahar hain, kyunke aaj banaye
 * gaye chaar orders 18–23 August ke hain aur wo maujooda 0123 ke baad lage the.
 *
 * Do kaam:
 *
 *   1. LIVE ORDERS ko 0001 se 0126 tak, order_date ke hisaab se. Ek hi din ke
 *      orders apni maujooda tarteeb mein rehte hain.
 *
 *   2. HAR PO ko wahi number jo uske sales order ka hai. 126 mein se 81 par
 *      yeh pehle se aisa hi tha; baqi 45 zyadatar ek hi din ke aapas mein
 *      badle hue the (PO-0004 ka order ORD-0005, PO-0006 ka ORD-0004). Ab
 *      PO-2026-00NN aur ORD-2026-00NN hamesha ek doosre ke hain.
 *
 * MITAYE GAYE NUMBER PEHLE HATANE PARTE HAIN. order_number aur po_number par
 * unique index soft-deleted rows par bhi lagta hai, aur aaj merge hone wala
 * ORD-2026-0067 / PO-2026-0067 abhi bhi wo number ghere hue hai. Unhein
 * -MERGED lagakar hata diya jata hai, taake wo number khali ho aur record bhi
 * pehchana ja sake.
 *
 * Number do marhalon mein badalte hain — pehle sab ek aarzi naam par, phir
 * asal number — warna beech mein do rows ka number takra jata hai.
 *
 * NOTES MEIN LIKHE PURANE NUMBER bhi durust kiye jate hain. Unnees invoices ke
 * notes mein "Raised to match ORD-2026-XXXX" likha hai, aur wo pehle hi galat
 * ho chuke the (JTR-0114 ORD-2026-0123 kehta hai jabke uska order ORD-2026-0120
 * hai) — kisi purane renumber ke baad kisi ne unhein nahi badla. Ab har invoice
 * ka note uske apne order ke naye number par le aaya jata hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'renumber_backup_20260825'

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }
const ordNo = n => `ORD-2026-${String(n).padStart(4, '0')}`
const poNo  = n => `PO-2026-${String(n).padStart(4, '0')}`

async function main() {
  const apply = process.argv.includes('--apply')

  // Mitaye gaye jo asal number ghere hue hain
  const blocking = (await query(`
    SELECT 'order' AS kism, id, order_number AS num FROM orders
     WHERE deleted_at IS NOT NULL AND order_number ~ '^ORD-2026-[0-9]{4}$'
    UNION ALL
    SELECT 'po', id, po_number FROM purchase_orders
     WHERE deleted_at IS NOT NULL AND po_number ~ '^PO-2026-[0-9]{4}$'`)).rows

  const orders = (await query(`
    SELECT o.id, o.order_number, o.order_date::date AS d, c.name AS customer, o.total
      FROM orders o JOIN customers c ON c.id=o.customer_id
     WHERE o.deleted_at IS NULL
     ORDER BY o.order_date, o.order_number`)).rows

  const pos = (await query(`
    SELECT po.id, po.po_number, po.order_id, o.order_number AS ka_order
      FROM purchase_orders po LEFT JOIN orders o ON o.id=po.order_id AND o.deleted_at IS NULL
     WHERE po.deleted_at IS NULL
     ORDER BY po.po_number`)).rows

  const orphan = pos.filter(p => !p.ka_order)
  if (orphan.length) {
    console.log(`\n${orphan.length} PO aise hain jinka koi live order nahi — pehle wo dekhein:`)
    for (const p of orphan) console.log(`   ${p.po_number}`)
    console.log('Kuch nahi kiya.\n'); await pool.end(); return
  }
  if (pos.length !== orders.length) {
    console.log(`\n${orders.length} orders magar ${pos.length} PO — barabar nahi. Kuch nahi kiya.\n`)
    await pool.end(); return
  }

  // order id → naya number
  const newOrd = new Map()
  orders.forEach((o, i) => newOrd.set(String(o.id), i + 1))

  const ordChanges = orders.filter((o, i) => o.order_number !== ordNo(i + 1))
  const poChanges = pos.filter(p => p.po_number !== poNo(newOrd.get(String(p.order_id))))

  // Notes jinme purane number likhe hain
  const invNotes = (await query(`
    SELECT i.id, i.invoice_number, i.notes, o.id AS order_id, o.order_number
      FROM invoices i JOIN orders o ON o.invoice_id = i.id AND o.deleted_at IS NULL
     WHERE i.deleted_at IS NULL AND i.notes ~ 'ORD-2026-[0-9]{4}'`)).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  console.log(`0. MITAYE GAYE NUMBER HATANE HAIN (${blocking.length}):`)
  for (const b of blocking) console.log(`   ${b.num}  →  ${b.num}-MERGED`)

  console.log(`\n1. ORDERS — ${orders.length} kul, ${ordChanges.length} ka number badlega:`)
  for (const o of ordChanges.slice(0, 12)) {
    const i = orders.findIndex(x => x.id === o.id)
    console.log(`   ${o.order_number} → ${ordNo(i + 1)}   ${o.d}  ${o.customer}`)
  }
  if (ordChanges.length > 12) console.log(`   … aur ${ordChanges.length - 12}`)

  console.log(`\n2. PURCHASE ORDERS — ${pos.length} kul, ${poChanges.length} ka number badlega:`)
  for (const p of poChanges.slice(0, 12))
    console.log(`   ${p.po_number} → ${poNo(newOrd.get(String(p.order_id)))}   (${p.ka_order} → ${ordNo(newOrd.get(String(p.order_id)))})`)
  if (poChanges.length > 12) console.log(`   … aur ${poChanges.length - 12}`)

  console.log(`\n3. INVOICE NOTES — ${invNotes.length} mein purana order number likha hai, apne order par le aaye jayenge`)

  console.log(`\nbaad mein: orders ${ordNo(1)} … ${ordNo(orders.length)}, PO ${poNo(1)} … ${poNo(pos.length)}, koi gap nahi`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    kism text, purana text, naya text, id uuid, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  // 0. Mitaye gaye number hatana
  for (const b of blocking) {
    const t = b.kism === 'order' ? 'orders' : 'purchase_orders'
    const col = b.kism === 'order' ? 'order_number' : 'po_number'
    await query(`INSERT INTO ${BACKUP} (kism, purana, naya, id) VALUES ($1,$2,$3,$4)`,
      [b.kism + '-deleted', b.num, `${b.num}-MERGED`, b.id])
    await query(`UPDATE ${t} SET ${col} = $2 WHERE id = $1`, [b.id, `${b.num}-MERGED`])
  }

  // 1. Orders — do marhale
  for (let i = 0; i < orders.length; i++) {
    await query(`UPDATE orders SET order_number = $2 WHERE id = $1`, [orders[i].id, `TMP-O-${i}`])
  }
  for (let i = 0; i < orders.length; i++) {
    await query(`INSERT INTO ${BACKUP} (kism, purana, naya, id) VALUES ('order',$1,$2,$3)`,
      [orders[i].order_number, ordNo(i + 1), orders[i].id])
    await query(`UPDATE orders SET order_number = $2, updated_at = NOW() WHERE id = $1`, [orders[i].id, ordNo(i + 1)])
  }

  // 2. PO — do marhale, apne order ke number par
  for (let i = 0; i < pos.length; i++) {
    await query(`UPDATE purchase_orders SET po_number = $2 WHERE id = $1`, [pos[i].id, `TMP-P-${i}`])
  }
  for (const p of pos) {
    const n = poNo(newOrd.get(String(p.order_id)))
    await query(`INSERT INTO ${BACKUP} (kism, purana, naya, id) VALUES ('po',$1,$2,$3)`, [p.po_number, n, p.id])
    await query(`UPDATE purchase_orders SET po_number = $2, updated_at = NOW() WHERE id = $1`, [p.id, n])
  }

  // 3. Counters
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='ORD-2026'`, [orders.length])
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PO-2026'`, [pos.length])

  // 4. Notes — har invoice ka hawala uske apne order par
  let notesFixed = 0
  for (const n of invNotes) {
    const correct = ordNo(newOrd.get(String(n.order_id)))
    const fixed = n.notes.replace(/ORD-2026-\d{4}/g, correct)
    if (fixed !== n.notes) {
      await query(`UPDATE invoices SET notes=$2, updated_at=NOW() WHERE id=$1`, [n.id, fixed])
      notesFixed++
    }
  }

  const chk = await one(`
    SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS o,
           (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS p,
           (SELECT MAX(SUBSTRING(order_number FROM 10)::int) FROM orders WHERE deleted_at IS NULL) AS o_max,
           (SELECT MAX(SUBSTRING(po_number FROM 9)::int) FROM purchase_orders WHERE deleted_at IS NULL) AS p_max,
           (SELECT COUNT(*) FROM purchase_orders po JOIN orders o ON o.id=po.order_id
             WHERE po.deleted_at IS NULL AND o.deleted_at IS NULL
               AND SUBSTRING(po.po_number FROM 9)::int = SUBSTRING(o.order_number FROM 10)::int) AS aligned`)
  console.log(`\nho gaya. ${ordChanges.length} orders aur ${poChanges.length} PO ke number badle, ${notesFixed} notes durust hue.`)
  console.log(`orders ${chk.o} (aakhri ${chk.o_max}), PO ${chk.p} (aakhri ${chk.p_max}), ${chk.aligned}/${chk.p} PO apne order ke number par.`)
  console.log(`purana-naya naqsha ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
