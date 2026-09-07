/**
 * Owner ki September wali TEXSTONE sheet — chaar kaam, poora record bana kar.
 *
 * Sheet ki har line ek gang sheet PO hai jo TEXSTONE (TSI) ko gayi. Har line se
 * teen cheezein banti hain, wahi tarteeb jo pehle 100 TSI lines par chali:
 *
 *     sales order (dtf)  ->  har gang sheet ka ek DTF line item
 *     purchase order     ->  TEXSTONE INC, gangsheet
 *     payment            ->  jis tareeqe se paisa aaya
 *
 *   TSI 260901-103  1 Sep  Ricardo Malia      2 sheets  44 artworks  Zelle  $70 + $15 = $85
 *   TSI 260901-104  1 Sep  Alfredo Huiracocha 1 sheet  100 artworks  Zelle  $25 + $12 = $37
 *   TSI 260903-107  3 Sep  Samuel Ngwamukie   2 sheets  15 artworks  Zelle  $55 + $25 = $80
 *   TSI 260904-108  4 Sep  Robert Farrar      6 sheets  73 artworks  Free   $0
 *
 * Sheet ka hisaab khud apne aap se milta hai — $202 wasool, $52 shipping, $150
 * maal ki qeemat, ek kaam muft. Yahan wahi tarah rakhi gayi hai jo poore system
 * mein chalti hai: maal ki qeemat SUBTOTAL mein, shipping alag khane mein, aur
 * dono ka jama TOTAL. Yeh us purani ghalti ka ulat hai jahan quote ka poora
 * total subtotal ke khane mein daal diya jata tha aur shipping dobara jur jati
 * thi.
 *
 * NAYA CUSTOMER SIRF EK: Alfredo Huiracocha. Baqi teen pehle se mojood hain
 * (Ricardo Malia, Ngwamukie Samuel, Robert Farrar) aur unke pate bhi wahi hain
 * jo sheet par likhe hain — is liye unke record chhue nahi jate.
 *
 * ALFREDO KA PARCEL PEHLE SE PARA HUA HAI. SHP-2026-0144 (2 September, UPS,
 * Jersey City NJ) kisi order se juri nahi thi, kyunke uska order hi darj nahi
 * tha. Ab order banne par wo parcel usi par lag jata hai.
 *
 * GANG SHEETON PAR ARTWORK KAISE BAANTE GAYE: sheet sirf kul ginti deti hai —
 * 2 sheets, 44 artworks — yeh nahi batati ke kis sheet par kitne. Is liye
 * barabar baant diye gaye hain (44 = 22 + 22), aur jahan barabar na baten
 * (15 = 8 + 7) wahan aakhri sheet baqi utha leti hai. Paise ka jama bilkul
 * theek rehta hai; sirf sheeton ke darmiyan taqseem andaza hai.
 *
 * CHAUTHI LINE MUFT KAAM HAI. Yeh Robert Farrar ka wo dobara chhapa hua maal
 * hai jo UPS ke gum karne par bheja gaya (28 August ka parcel SHP-2026-0140
 * abhi tak "Exception" par khara hai). Order to banta hai — 6 sheets ka kaam
 * asal mein hua aur TEXSTONE ko gaya — magar uski koi payment nahi, kyunke
 * paisa pehle hi ORD-2026-0120 par mil chuka hai. Us par is_free lagta hai.
 * Jo parcel gaya wo SHP-2026-0152 hai aur wo ORD-2026-0120 par hi laga rehta
 * hai, kyunke maal usi order ka tha — bilkul waise hi jaise August wali kami
 * ka bharai wala parcel apne asal order par laga hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP   = 'texstone_september_backup_20260905'
const SUPPLIER = 'TEXSTONE INC'

const ROWS = [
  { po: 'TSI 260901-103', customer: 'Ricardo Malia',      match: 'CUST-2026-0037',
    date: '2026-09-01', paid_on: '2026-09-01', sheets: 2, artworks: 44,
    method: 'Zelle', goods: 70.00, shipping: 15.00, total: 85.00, fee: 0,
    address: '34799 Windrow Rd, Murrieta, CA 92563-1165, United States' },

  { po: 'TSI 260901-104', customer: 'Alfredo Huiracocha', match: null,
    date: '2026-09-01', paid_on: '2026-09-01', sheets: 1, artworks: 100,
    method: 'Zelle', goods: 25.00, shipping: 12.00, total: 37.00, fee: 0,
    address: '22 Sheffield St, Jersey City, NJ 07305, United States',
    // Naya customer, is liye pata tukron mein bhi chahiye.
    line1: '22 Sheffield St', city: 'Jersey City', state: 'NJ', zip: '07305',
    // Uska parcel pehle se para hua hai, bas order ka intezaar tha.
    shipment: 'SHP-2026-0144' },

  { po: 'TSI 260903-107', customer: 'Samuel Ngwamukie',   match: 'CUST-2026-0048',
    date: '2026-09-03', paid_on: '2026-09-03', sheets: 2, artworks: 15,
    method: 'Zelle', goods: 55.00, shipping: 25.00, total: 80.00, fee: 0,
    address: '236 Red Cedar Way, Fuquay Varina, NC 27526-4567, United States' },

  { po: 'TSI 260904-108', customer: 'Robert Farrar',      match: 'CUST-2026-0041',
    date: '2026-09-04', paid_on: null, sheets: 6, artworks: 73,
    method: null, goods: 0, shipping: 0, total: 0, fee: 0, free: true,
    address: '748 Alcovy Mill Park, Lawrenceville, GA 30045-5900, United States' },
]

const money = n => `$${Number(n).toFixed(2)}`
const pad4  = n => String(n).padStart(4, '0')
async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }

async function nextNumber(scope, prefix) {
  const r = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                        WHERE scope=$1 RETURNING last_value`, [scope])
  return `${prefix}-${pad4(r.last_value)}`
}

// Kul artworks ko sheeton mein barabar baantna; jo bache wo shuru wali sheeton
// par. Paise usi nisbat se, aur aakhri sheet rounding ka farq utha leti hai
// taake jama bilkul subtotal ke barabar rahe.
function split(row) {
  const base = Math.floor(row.artworks / row.sheets)
  const extra = row.artworks % row.sheets
  const qtys = Array.from({ length: row.sheets }, (_, i) => base + (i < extra ? 1 : 0))
  let used = 0
  return qtys.map((qty, i) => {
    const amount = i === qtys.length - 1
      ? Number((row.goods - used).toFixed(2))
      : Number(((row.goods * qty) / row.artworks).toFixed(2))
    used = Number((used + amount).toFixed(2))
    return { qty, amount }
  })
}

async function main() {
  const apply = process.argv.includes('--apply')

  const supplier = await one(`SELECT id FROM suppliers WHERE name=$1 AND deleted_at IS NULL`, [SUPPLIER])
  if (!supplier) { console.log(`supplier "${SUPPLIER}" nahi mila — ruk raha hoon.`); await pool.end(); return }

  const plan = [], skip = []
  for (const r of ROWS) {
    // Sheet ka apna hisaab pehle jaanch lo — agar maal + shipping total se na
    // milen to aage barhne ka koi faida nahi.
    if (Number((r.goods + r.shipping).toFixed(2)) !== Number(r.total.toFixed(2))) {
      skip.push([r.po, `hisaab nahi milta: ${money(r.goods)} + ${money(r.shipping)} <> ${money(r.total)}`]); continue
    }
    const already = await one(
      `SELECT order_number FROM orders WHERE source_po_number=$1 AND deleted_at IS NULL`, [r.po])
    if (already) { skip.push([r.po, `pehle se ${already.order_number} bana hua hai`]); continue }

    let cust = null
    if (r.match) {
      cust = await one(`SELECT id, customer_number, name FROM customers
                         WHERE customer_number=$1 AND deleted_at IS NULL`, [r.match])
      if (!cust) { skip.push([r.po, `${r.match} nahi mila`]); continue }
    } else {
      // Naya customer banane se pehle dekh lo ke kisi aur naam se pehle se to
      // nahi baitha — warna duplicate ban jayega.
      const dup = await one(`SELECT customer_number, name FROM customers
                              WHERE deleted_at IS NULL AND name ILIKE $1`, [`%${r.customer.split(' ').pop()}%`])
      if (dup) { skip.push([r.po, `"${dup.name}" (${dup.customer_number}) pehle se mojood hai`]); continue }
    }

    let shp = null
    if (r.shipment) {
      shp = await one(`SELECT id, shipment_number, order_id, po_id FROM shipments
                        WHERE shipment_number=$1 AND deleted_at IS NULL`, [r.shipment])
      if (shp && (shp.order_id || shp.po_id)) shp = null   // pehle se laga hua hai, chhor do
    }

    plan.push({ ...r, cust, supplier_id: supplier.id, lines: split(r), shp })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.po}  ${p.date}  ${p.customer}` + (p.cust ? `  (${p.cust.customer_number})` : '  (NAYA CUSTOMER)'))
    console.log(`   maal ${money(p.goods)} + shipping ${money(p.shipping)} = ${money(p.total)}` +
                (p.free ? '   [MUFT KAAM]' : `   ${p.method}`))
    p.lines.forEach((l, i) => console.log(`   gangsheet ${i + 1}:  ${l.qty} artworks  ${money(l.amount)}`))
    console.log(`   ${p.address}`)
    if (p.shp) console.log(`   ${p.shp.shipment_number} isi order par lag jayegi`)
    console.log('')
  }
  for (const [n, w] of skip) console.log(`${n}  chhora — ${w}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const note = (what, ref, data) =>
    query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, JSON.stringify(data)])

  await query('BEGIN')
  try {
    for (const p of plan) {
      let customerId = p.cust?.id
      if (!customerId) {
        const cn = await nextNumber('CUST-2026', 'CUST-2026')
        const [first, ...rest] = p.customer.split(' ')
        const c = await one(
          `INSERT INTO customers (customer_number, name, first_name, last_name, address_line1, city, state, zip,
                                  country, billing_address, same_as_shipping, status, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'United States',$9,true,'active','TSI PO sheet',NOW(),NOW())
           RETURNING id`,
          [cn, p.customer, first, rest.join(' ') || null, p.line1, p.city, p.state, p.zip, p.address])
        customerId = c.id
        for (const kind of ['shipping', 'billing'])
          await query(
            `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country,
                                             is_default, contact_person, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'United States',true,$7,NOW())`,
            [customerId, kind, p.line1, p.city, p.state, p.zip, p.customer])
        await note('customer', cn, { name: p.customer })
        console.log(`   ${cn}  ${p.customer}  naya customer bana`)
      }

      // Alfredo ka parcel pehle se ja chuka hai, is liye us order ki halat
      // "Shipped" hai; baqi abhi production ke marhale par hain.
      const status = p.shp ? 'Shipped' : 'Confirmed'
      const poStatus = p.shp ? 'Shipped' : 'In Production'

      const on = await nextNumber('ORD-2026', 'ORD-2026')
      const o = await one(
        `INSERT INTO orders (order_number, customer_id, order_type, status, payment_status, payment_method,
                             order_date, entry_date, payment_date, subtotal, shipping_charges, tax_pct, tax_amt,
                             total, amount_paid, shipping_name, shipping_address, source_system, source_po_number,
                             sales_channel, print_type, is_free, created_at, updated_at)
         VALUES ($1,$2,'dtf',$3::order_status,$4::payment_status,$5,$6,$6,$7,$8,$9,0,0,$10,$11,$12,$13,
                 'TSI',$14,'TSI','DTF Transfers',$15,NOW(),NOW())
         RETURNING id`,
        [on, customerId, status, 'Paid', p.method, p.date, p.paid_on, p.goods, p.shipping,
         p.total, p.total, p.customer, p.address, p.po, !!p.free])
      await note('order', on, { po: p.po, total: p.total })

      const digits = p.po.replace(/\D/g, '')
      for (let i = 0; i < p.lines.length; i++) {
        const l = p.lines[i]
        await query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, artwork_no, size, width_inches,
                                        qty, unit_price, amount, sort_order, production_status)
           VALUES ($1,$2,$3,'22" gangsheet',22,$4,$5,$6,$7,'Pending')`,
          [o.id, `${p.po} gangsheet ${i + 1}`, `AW-${digits}-${i + 1}`,
           l.qty, p.artworks ? Number((p.goods / p.artworks).toFixed(4)) : 0, l.amount, i])
      }

      const pon = await nextNumber('PO-2026', 'PO-2026')
      const po = await one(
        `INSERT INTO purchase_orders (po_number, po_type, order_id, customer_id, supplier_id, status,
                                      payment_status, order_date, entry_date, subtotal, shipping_charge,
                                      total, grand_total, created_at, updated_at)
         VALUES ($1,'gangsheet',$2,$3,$4,$5::po_status,'Paid',$6,NOW(),$7,$8,$9,$9,NOW(),NOW())
         RETURNING id`,
        [pon, o.id, customerId, p.supplier_id, poStatus, p.date, p.goods, p.shipping, p.total])
      await query(`INSERT INTO po_orders (po_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [po.id, o.id])
      await note('purchase_order', pon, { order: on })

      let payLine = 'muft kaam — koi payment nahi'
      if (!p.free) {
        const pn = await nextNumber('PAY-2026', 'PAY-2026')
        await query(
          `INSERT INTO payments (payment_number, order_id, customer_id, customer_name, amount, fee_amount,
                                 payment_method, payment_date, paid_at, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$8::date,'Completed',NOW(),NOW())`,
          [pn, o.id, customerId, p.customer, p.total, p.fee, p.method, p.paid_on])
        await note('payment', pn, { order: on, amount: p.total })
        payLine = `${pn} ${money(p.total)} ${p.method}`
      }

      let shipLine = ''
      if (p.shp) {
        await note('shipment', p.shp.shipment_number, { id: p.shp.id, order_id: null })
        await query(`UPDATE shipments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [p.shp.id, o.id])
        await query(`INSERT INTO shipment_orders (shipment_id, order_id, is_primary) VALUES ($1,$2,true)
                     ON CONFLICT (shipment_id, order_id) DO NOTHING`, [p.shp.id, o.id])
        shipLine = `, ${p.shp.shipment_number}`
      }

      console.log(`   ${p.po}  ->  ${on} ${money(p.total)}, ${pon}, ${payLine}${shipLine}`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = await one(`
    SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS orders,
           (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS pos,
           (SELECT COUNT(*) FROM payments) AS pays,
           (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL) AS custs,
           (SELECT COUNT(*) FROM shipments WHERE deleted_at IS NULL AND order_id IS NULL AND po_id IS NULL) AS loose_shp`)
  console.log(`\nho gaya. ${after.custs} customers, ${after.orders} orders, ${after.pos} PO, ${after.pays} payments, ` +
              `${after.loose_shp} shipments abhi bhi bina order ke.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
