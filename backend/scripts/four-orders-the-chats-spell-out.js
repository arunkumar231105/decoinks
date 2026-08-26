/**
 * Chaar sales order banana, jin ki poori tafseel Chatwoot mein mojood hai, aur
 * un par unki payment lagana.
 *
 * Yeh khokhe nahi hain. Har ek ke saath wo guftagu hai jismein maal, adad, rang,
 * rate, shipping aur pata sab likha hai — aur customer ne paisa bhej diya:
 *
 *   Carl Deibler       $155.00  conv 846, 18 Aug: "Hoodies: $17 x2 / Tshirts:
 *                               $12 x8" = $130, "Shipping would be $25",
 *                               "Your total would be $155". 4 men's tees,
 *                               4 women's tees, 1 men's hoodie, 1 women's hoodie.
 *   Chris Cox           $73.00  conv 266, 20 Aug: "For 20 transfers of this
 *                               design, Size is Width 13.6 x Height 10.8 the
 *                               price is $58 + $15" → "Just paid".
 *   Blanca Mosqueda     $66.00  conv 929, 21 Aug: "It will cost $14 each" for
 *                               V-necks, then 4 shirts → "It will cost $66".
 *                               1 L black, 1 XL black, 1 L pink, 1 XL pink.
 *                               3546 Lila St, Riverside CA 92504.
 *   Milangella Navarro  $65.00  conv 210, 22 Aug: "El costo de los 20 transfers
 *                               será de $50, más $15 de envío. El total será de
 *                               $65". Zelle ref #5942056871. 507 Wilshire Dr
 *                               Apt 6, Bellevue NE 68005.
 *
 * JAAN BUJH KAR CHHORE GAYE:
 *   Robert Farrar ke teen ($71.50 + $198.75 + $191.00 = $461.25) — wo maal
 *   ORD-2026-0086 ke 167 transfers mein pehle se shaamil hai. 26+65+60+16=167,
 *   aur sab ek hi package 1Z24C3141338464023 mein gaya. Naye order banane se
 *   $461.25 ka farzi revenue khada ho jayega. Wo overpayment ka masla hai.
 *   Lana Rogers ($45) — uska design aaj bhi approval mein hai, order abhi
 *   mukammal nahi hua.
 *   Maria Elena P Lagunday ($55) — chat mein uska koi payment confirmation nahi.
 *
 * Invoice nahi banaya ja raha. ORD-2026-0097 ke paas bhi invoice nahi hai aur
 * uski payment theek lagi hui hai — order aur payment kaafi hain. Invoice jab
 * chahiye hoga app se ban jayega.
 *
 * Order number aakhir mein lagte hain (0124 aage). Carl aur Chris ki tareekhein
 * ORD-2026-0123 (21 Aug) se pehle ki hain, to yeh do tareekh ki tarteeb se bahar
 * rahenge — renumber alag kaam hai, yahan nahi kiya ja raha.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'created_orders_20260825'
const money = n => `$${Number(n).toFixed(2)}`

const JOBS = [
  {
    pay: 'PAY-2026-0096', customer: 'Chris Cox', type: 'dtf',
    date: '2026-08-20', subtotal: 58.00, shipping: 15.00, total: 73.00,
    why: 'conv 266, 20 Aug: "20 transfers ... the price is $58 + $15" → "Just paid"',
    dtf: [{ artwork: 'DTF Transfers', size: '13.6" × 10.8"', qty: 20, unit: 2.90, amount: 58.00, w: 13.6, h: 10.8 }],
  },
  {
    pay: 'PAY-2026-0097', customer: 'Blanca Mosqueda', type: 'apparel',
    date: '2026-08-21', subtotal: 56.00, shipping: 10.00, total: 66.00,
    why: 'conv 929, 21 Aug: "It will cost $14 each", 4 V-necks → "It will cost $66"',
    address: { line1: '3546 Lila St', city: 'Riverside', state: 'CA', zip: '92504' },
    apparel: [
      { item: 'V-Neck T-Shirt', color: 'Black', size: 'L',  qty: 1, unit: 14.00, amount: 14.00 },
      { item: 'V-Neck T-Shirt', color: 'Black', size: 'XL', qty: 1, unit: 14.00, amount: 14.00 },
      { item: 'V-Neck T-Shirt', color: 'Pink',  size: 'L',  qty: 1, unit: 14.00, amount: 14.00 },
      { item: 'V-Neck T-Shirt', color: 'Pink',  size: 'XL', qty: 1, unit: 14.00, amount: 14.00 },
    ],
  },
  {
    pay: 'PAY-2026-0090', customer: 'Carl Deibler', type: 'apparel',
    date: '2026-08-18', subtotal: 130.00, shipping: 25.00, total: 155.00,
    why: 'conv 846, 18 Aug: "Hoodies: $17 x2 / Tshirts: $12 x8", "Shipping would be $25", "Your total would be $155"',
    apparel: [
      { item: "Men's T-Shirt",   color: '', size: '', qty: 4, unit: 12.00, amount: 48.00 },
      { item: "Women's T-Shirt", color: '', size: '', qty: 4, unit: 12.00, amount: 48.00 },
      { item: "Men's Hoodie",    color: '', size: '', qty: 1, unit: 17.00, amount: 17.00 },
      { item: "Women's Hoodie",  color: '', size: '', qty: 1, unit: 17.00, amount: 17.00 },
    ],
  },
  {
    pay: 'PAY-2026-0099', customer: 'Milangella Navarro', type: 'dtf',
    date: '2026-08-23', subtotal: 50.00, shipping: 15.00, total: 65.00,
    why: 'conv 210, 22 Aug: "El costo de los 20 transfers será de $50, más $15 de envío. El total será de $65". Zelle #5942056871',
    address: { line1: '507 Wilshire Dr, Apt 6', city: 'Bellevue', state: 'NE', zip: '68005' },
    dtf: [{ artwork: 'DTF Transfers', size: 'L shirt size', qty: 20, unit: 2.50, amount: 50.00 }],
  },
]

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function nextNumber(scope, pad) {
  const r = await one(`UPDATE counters SET last_value = last_value + 1, updated_at = NOW()
                        WHERE scope = $1 RETURNING last_value`, [scope])
  return `${scope}-${String(r.last_value).padStart(pad, '0')}`
}

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skipped = []

  for (const j of JOBS) {
    const p = await one(`SELECT id, payment_number, amount, order_id,
                                COALESCE(received_from_name, customer_name) AS payer
                           FROM payments WHERE payment_number=$1`, [j.pay])
    if (!p) { skipped.push([j.pay, 'payment nahi mili']); continue }
    if (p.order_id) { skipped.push([j.pay, 'pehle se kisi order par lagi hui hai']); continue }
    if (Math.abs(Number(p.amount) - j.total) > 0.005) {
      skipped.push([j.pay, `payment ${money(p.amount)} magar chat ka total ${money(j.total)}`]); continue
    }
    const lines = j.apparel || j.dtf
    const lineSum = +lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
    if (Math.abs(lineSum - j.subtotal) > 0.005) {
      skipped.push([j.pay, `lines ${money(lineSum)} magar subtotal ${money(j.subtotal)}`]); continue
    }
    if (Math.abs(j.subtotal + j.shipping - j.total) > 0.005) {
      skipped.push([j.pay, `${money(j.subtotal)} + ${money(j.shipping)} ≠ ${money(j.total)}`]); continue
    }
    // Customer pehle se ho to naya nahi banega.
    const existing = await one(`SELECT id, customer_number, name FROM customers
                                 WHERE deleted_at IS NULL AND LOWER(name)=LOWER($1)`, [j.customer])
    plan.push({ ...j, p, existing, lines })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const j of plan) {
    console.log(`${j.customer}${j.existing ? `  (${j.existing.customer_number} pehle se hai)` : '  (naya customer banega)'}`)
    console.log(`  ${j.date}  ${j.type}   sub ${money(j.subtotal)} + ship ${money(j.shipping)} = ${money(j.total)}   ← ${j.pay} ${money(j.p.amount)} (${j.p.payer})`)
    for (const l of j.lines)
      console.log(`     ${String(l.qty).padStart(2)} × ${(l.item || l.artwork)}${l.color ? ' ' + l.color : ''}${l.size ? ' ' + l.size : ''} @ ${money(l.unit)} = ${money(l.amount)}`)
    console.log(`     ${j.why}`)
  }
  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  const before = await one(`SELECT COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  console.log(`\nbanenge: ${plan.length} orders   |   loose payments ${before.loose} → ${before.loose - plan.length}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!plan.length) { console.log('Karne ko kuch nahi.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  for (const j of plan) {
    let customerId = j.existing?.id
    let customerNo = j.existing?.customer_number
    if (!customerId) {
      customerNo = await nextNumber('CUST-2026', 4)
      const parts = j.customer.split(' ')
      const c = await one(
        `INSERT INTO customers (customer_number, name, first_name, last_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'active',NOW(),NOW()) RETURNING id`,
        [customerNo, j.customer, parts[0], parts.slice(1).join(' ') || null])
      customerId = c.id
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('customer',$1,$2)`,
        [customerNo, JSON.stringify({ id: customerId, name: j.customer })])
    }

    const orderNo = await nextNumber('ORD-2026', 4)
    const o = await one(
      `INSERT INTO orders (order_number, customer_id, order_type, order_date, status, payment_status,
                           subtotal, shipping_charges, total, amount_paid, is_free,
                           shipping_name, notes, created_at, updated_at)
       VALUES ($1,$2,$3::order_type,$4,'Confirmed','Paid',$5,$6,$7,$7,false,$8,$9,NOW(),NOW())
       RETURNING id`,
      [orderNo, customerId, j.type, j.date, j.subtotal, j.shipping, j.total, j.customer,
       `Chat se banaya gaya (Chatwoot). ${j.why}`])

    if (j.address) {
      await query(
        `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, created_at)
         VALUES ($1,'shipping',$2,$3,$4,$5,'US',true,NOW())`,
        [customerId, j.address.line1, j.address.city, j.address.state, j.address.zip])
    }

    let n = 0
    for (const l of j.lines) {
      if (j.type === 'apparel') {
        await query(
          `INSERT INTO order_items_apparel (order_id, item, color, size, qty, unit_price, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [o.id, l.item, l.color || null, l.size || null, l.qty, l.unit, l.amount, n])
      } else {
        await query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount,
                                        width_inches, height_inches, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [o.id, l.artwork, l.size || null, l.qty, l.unit, l.amount, l.w || null, l.h || null, n])
      }
      n++
    }

    await query(`UPDATE payments SET order_id=$2, customer_id=$3, updated_at=NOW() WHERE id=$1`,
      [j.p.id, o.id, customerId])
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('order',$1,$2)`,
      [orderNo, JSON.stringify({ order_id: o.id, customer: j.customer, payment: j.pay, total: j.total })])

    console.log(`  ${orderNo}  ${customerNo}  ${j.customer}  ${money(j.total)}  ← ${j.pay}`)
  }

  const after = await one(`SELECT COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  console.log(`\nho gaya. ab ${after.loose} payments bina order ke.`)
  console.log(`kya bana, ${BACKUP} mein likha hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
