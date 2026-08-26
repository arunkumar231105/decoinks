/**
 * Owner ki di hui payment sheet ko orders par lagana.
 *
 * Sheet mein 36 orders ke saamne payment ki tafseel hai — tareekh, tareeqa,
 * raqam, fee, net aur payer ka naam. In mein se 6 payments DB mein pehle se
 * mojood thin aur 30 bilkul nahi.
 *
 * Kyun nahi thin: payments table sirf owner ke mailbox deposits (PayPal, Zelle,
 * Stripe notifications) se bani thi. Sheet ke tareeqe us se bahar ke hain —
 * Shopify (16), Cash App (5), Credit Card, Venmo, Apple Pay, Bank Deposit,
 * Stripe. Yehi wajah hai ke itne orders unpaid dikh rahe the.
 *
 * Har nayi row ke notes mein SHEET-DARJ likha jata hai, taake yeh ek query se
 * alag ki ja sakein:
 *     SELECT * FROM payments WHERE notes LIKE '%SHEET-DARJ%'
 *
 * TEEN KAAM:
 *
 * 1. EK PAYMENT GHALAT ORDER PAR LAGI HUI HAI.
 *    PAY-2026-0008 ($46.85, Walby Vellon, 22 Apr) ORD-2026-0022 par lagi hai
 *    jiska total $103.00 hai — wahi -$56.15 ka farq jo pehle se pakra gaya tha.
 *    Sheet ke mutabiq wo ORD-2026-0003 ki hai, jiska total theek $46.85 hai.
 *    Wahan le jayi ja rahi hai. ORD-2026-0022 phir se unpaid ho jayega.
 *
 * 2. TEEN LOOSE PAYMENTS KO UNKE ORDER PAR LAGANA.
 *    PAY-2026-0015  $265.00  Kyjuon Butler    → ORD-2026-0011  Luxe Gang
 *    PAY-2026-0018  $230.00  Emmychette Peter → ORD-2026-0017  Lashanniya Saick
 *    PAY-2026-0048  $80.00   Manuel González  → ORD-2026-0074  Alex M Cabrera
 *    Pehle do ke order ka total shipping ke barabar zyada hai — wahi purani
 *    ghalti, quote ka total subtotal ke khane mein aur shipping dobara upar.
 *    $280 → $265 aur $245 → $230.
 *
 * 3. UNTEES NAYI PAYMENTS BANANA aur unke order par lagana.
 *
 * JAAN BUJH KAR CHHORE GAYE:
 *   ORD-2026-0005 — sheet is par $27 (Danny Hernandez, 30 May) dikhati hai,
 *     magar wo PAY-2026-0024 hai jo pehle se ORD-2026-0026 par sahi lagi hui
 *     hai (Dannyboy, total theek $27). Sheet yahan ghalat hai; 0005 unpaid
 *     rahega.
 *   ORD-2026-0066 — sheet ka $127 dono orders ko mila kar hai: 0066 ke $72
 *     aur 0067 ke $40 = $112, plus $15 shipping. Sheet mein 0067 hai hi nahi
 *     aur qty bhi jamaa hai (8 = 6 + 2). Pehle yeh tay ho ke dono ek order
 *     hain ya do — warna $40 do baar gina jayega.
 *   ORD-2026-0085 — sheet ka $245 PAY-2026-0061 hai jo ORD-2026-0081 par lagi
 *     hui hai. Vianelly ke dono orders $245 ke hain aur ek hi job hai; wo
 *     duplicate alag se hal karna hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const fs = require('fs')
const path = require('path')
const { query, pool } = require('../src/config/db')

const SHEET = path.join(__dirname, 'data', 'owner-order-payments.tsv')
const BACKUP = 'owner_sheet_payments_20260825'
const MARK = 'SHEET-DARJ'
const money = n => `$${Number(n).toFixed(2)}`

// Sheet in orders par ghalat ya adhoori hai — haath nahi lagaya ja raha.
const SKIP = {
  'ORD-2026-0005': 'sheet ki payment PAY-2026-0024 hai jo ORD-2026-0026 par sahi lagi hui hai',
  'ORD-2026-0066': 'sheet ka $127 ismein 0067 ka $40 bhi shaamil hai — pehle tay karein',
  'ORD-2026-0085': 'sheet ki payment PAY-2026-0061 hai jo ORD-2026-0081 par lagi hai (Vianelly duplicate)',
}

// Payment ghalat order par lagi hui hai.
const MOVE = [{ pay: 'PAY-2026-0008', from: 'ORD-2026-0022', to: 'ORD-2026-0003' }]

// Order ka total sheet ke mutabiq theek karna (subtotal + shipping = total).
const FIX = {
  'ORD-2026-0011': { subtotal: 250.00, shipping: 15.00, total: 265.00 },
  'ORD-2026-0017': { subtotal: 215.00, shipping: 15.00, total: 230.00 },
}

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

function readSheet() {
  return fs.readFileSync(SHEET, 'utf8').trim().split('\n').slice(1).map(line => {
    const c = line.split('\t')
    return { ord: c[0], date: c[1], method: c[2], amount: +c[3],
             fee: c[4] ? +c[4] : 0, net: c[5] ? +c[5] : null, payer: c[6] }
  })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const toMove = [], toLink = [], toCreate = [], skipped = []

  for (const [ord, why] of Object.entries(SKIP)) skipped.push([ord, why])

  for (const m of MOVE) {
    const p = await one(`SELECT p.id, p.payment_number, p.amount, o.order_number AS on_order
                           FROM payments p LEFT JOIN orders o ON o.id=p.order_id
                          WHERE p.payment_number=$1`, [m.pay])
    const toOrder = await one(`SELECT id, order_number, total FROM orders WHERE order_number=$1 AND deleted_at IS NULL`, [m.to])
    if (!p || !toOrder) { skipped.push([m.pay, 'payment ya order nahi mila']); continue }
    if (p.on_order !== m.from) { skipped.push([m.pay, `${m.from} par nahi, ${p.on_order || 'kahin nahi'} par hai`]); continue }
    if (Math.abs(Number(p.amount) - Number(toOrder.total)) > 0.005) {
      skipped.push([m.pay, `${money(p.amount)} magar ${m.to} ka total ${money(toOrder.total)}`]); continue
    }
    const busy = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [toOrder.id])
    if (busy) { skipped.push([m.to, `pehle se ${busy.payment_number} lagi hui hai`]); continue }
    toMove.push({ ...m, p, toOrder })
  }

  for (const r of readSheet()) {
    if (SKIP[r.ord]) continue
    const o = await one(
      `SELECT o.id, o.order_number, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
              o.customer_id, o.invoice_id, c.name AS customer
         FROM orders o JOIN customers c ON c.id=o.customer_id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [r.ord])
    if (!o) { skipped.push([r.ord, 'order nahi mila']); continue }

    const target = FIX[r.ord] || { subtotal: Number(o.subtotal), shipping: Number(o.shipping), total: Number(o.total) }
    if (Math.abs(target.subtotal + target.shipping - target.total) > 0.005) {
      skipped.push([r.ord, `${money(target.subtotal)} + ${money(target.shipping)} ≠ ${money(target.total)}`]); continue
    }
    if (Math.abs(target.total - r.amount) > 0.005) {
      skipped.push([r.ord, `order ${money(target.total)} magar sheet ${money(r.amount)} — barabar nahi`]); continue
    }

    const busy = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
    const moving = toMove.find(m => m.to === r.ord)
    if (busy && !moving) { skipped.push([r.ord, `pehle se ${busy.payment_number} lagi hui hai`]); continue }
    if (moving) continue   // move step already covers it

    // Wahi raqam wahi din pehle se hai to nayi na banayein — usay lagayein.
    const have = await one(
      `SELECT id, payment_number, order_id FROM payments
        WHERE ROUND(amount,2)=ROUND($1,2) AND payment_date::date=$2::date`, [r.amount, r.date])
    if (have && !have.order_id) { toLink.push({ ...r, o, target, p: have }); continue }
    if (have && have.order_id) { skipped.push([r.ord, `${have.payment_number} usi raqam/din ki hai magar kisi aur order par lagi hai`]); continue }

    toCreate.push({ ...r, o, target })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  console.log('1. GHALAT ORDER SE HATA KAR SAHI PAR:')
  for (const m of toMove) console.log(`   ${m.pay} ${money(m.p.amount)}   ${m.from} → ${m.to}`)

  console.log('\n2. LOOSE PAYMENTS JO LAGENGI:')
  for (const l of toLink) {
    const fix = FIX[l.ord] ? `   order ${money(l.o.total)} → ${money(l.target.total)}` : ''
    console.log(`   ${l.p.payment_number} ${money(l.amount).padStart(9)}  ${l.payer.padEnd(22)} → ${l.ord}  ${l.o.customer}${fix}`)
  }

  console.log('\n3. NAYI PAYMENTS:')
  for (const c of toCreate)
    console.log(`   ${money(c.amount).padStart(9)}  ${c.date}  ${c.method.padEnd(24)} ${c.payer.padEnd(22)} → ${c.ord}  ${c.o.customer}`)

  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`   ${n}  ${why}`)
  }

  const before = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  const unpaid = await one(`SELECT COUNT(*) AS n FROM orders o WHERE o.deleted_at IS NULL AND NOT o.is_free
                              AND o.order_number<>'ORD-2026-0070'
                              AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id)`)
  const newlyPaid = toMove.length + toLink.length + toCreate.length - toMove.length  // move frees one, fills one
  console.log(`\nhatengi: ${toMove.length}   lagengi: ${toLink.length}   banengi: ${toCreate.length}`)
  console.log(`payments ${before.n} → ${Number(before.n) + toCreate.length}   |   loose ${before.loose} → ${before.loose - toLink.length}`)
  console.log(`unpaid orders ${unpaid.n} → ${Number(unpaid.n) - (toLink.length + toCreate.length)}   (ORD-2026-0022 wapas unpaid ho jayega)`)
  console.log(`\nMitane ke liye:  DELETE FROM payments WHERE notes LIKE '%${MARK}%';\n`)

  if (!apply) { console.log('Likhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }

  async function retotal(o, target) {
    if (Math.abs(target.total - Number(o.total)) < 0.005 && Math.abs(target.shipping - Number(o.shipping)) < 0.005) {
      await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [o.id, target.total])
      if (o.invoice_id) await query(
        `UPDATE invoices SET amount_paid=$2, balance_due=GREATEST(total-$2,0), updated_at=NOW() WHERE id=$1`,
        [o.invoice_id, target.total])
      return
    }
    await save('order', o.order_number, `SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [o.id])
    await query(`UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
                  WHERE id=$1`, [o.id, target.subtotal, target.shipping, target.total])
    if (o.invoice_id) await query(
      `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
              balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
      [o.invoice_id, target.subtotal, target.shipping, target.total])
  }

  for (const m of toMove) {
    await save('payment', m.pay, `SELECT to_jsonb(p) AS j FROM payments p WHERE p.id=$1`, [m.p.id])
    await query(`UPDATE payments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [m.p.id, m.toOrder.id])
    await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [m.toOrder.id, m.p.amount])
    // Jis order se hati hai, uska amount_paid saaf karna.
    await query(`UPDATE orders SET amount_paid=0, updated_at=NOW() WHERE order_number=$1`, [m.from])
    console.log(`   ${m.pay}  ${m.from} → ${m.to}`)
  }

  for (const l of toLink) {
    await retotal(l.o, l.target)
    await query(`UPDATE payments SET order_id=$2, customer_id=$3, updated_at=NOW() WHERE id=$1`,
      [l.p.id, l.o.id, l.o.customer_id])
    console.log(`   ${l.p.payment_number} → ${l.ord}`)
  }

  // Counter ko aakhri asal number par le aana.
  const maxNo = await one(`SELECT COALESCE(MAX(SUBSTRING(payment_number FROM 10)::int),0) AS n
                             FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PAY-2026'`, [maxNo.n])

  for (const c of toCreate) {
    await retotal(c.o, c.target)
    const n = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope='PAY-2026' RETURNING last_value`)
    const payNo = `PAY-2026-${String(n.last_value).padStart(4, '0')}`
    const note = `${MARK} — owner ki payment sheet se. Tareeqa: ${c.method}. ` +
                 `Mailbox deposit file (PayPal/Zelle/Stripe) mein NAHI, kyunke yeh rasta us file mein aata hi nahi.`
    const ins = await one(
      `INSERT INTO payments (payment_number, payment_date, amount, fee_amount, payment_method, notes,
                             order_id, customer_id, customer_name, received_from_name, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'completed',NOW(),NOW()) RETURNING id`,
      [payNo, c.date, c.amount, c.fee || 0, c.method, note, c.o.id, c.o.customer_id, c.payer])
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('payment',$1,$2)`,
      [payNo, JSON.stringify({ id: ins.id, order: c.ord, amount: c.amount, method: c.method, payer: c.payer })])
    console.log(`   ${payNo}  ${money(c.amount).padStart(9)}  ${c.method.padEnd(24)} → ${c.ord}`)
  }

  const after = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  const unpaidAfter = await one(`SELECT COUNT(*) AS n FROM orders o WHERE o.deleted_at IS NULL AND NOT o.is_free
                                   AND o.order_number<>'ORD-2026-0070'
                                   AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id)`)
  console.log(`\nho gaya. ${after.n} payments, ${after.loose} loose, ${unpaidAfter.n} orders bina payment ke.`)
  console.log(`Mitane ke liye:  DELETE FROM payments WHERE notes LIKE '%${MARK}%';\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
