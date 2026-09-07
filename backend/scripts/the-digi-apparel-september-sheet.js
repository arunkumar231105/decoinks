/**
 * Xinfeiyang (DIGI) apparel sheet — 1 se 5 September ke chaudah store orders.
 *
 * Har line se poora silsila banta hai, wahi tarteeb jo pehle ke DIGI orders par
 * chali (ORD-2026-0039, ORD-2026-0086 wagera):
 *
 *     customer (agar naya ho)  ->  sales order (apparel)  ->  ek apparel line
 *     ->  purchase order (Xin Fei Yang Factory)  ->  shipment  ->  payment
 *
 * PATE SHIPPING INFO SE NIKALE GAYE HAIN. Sheet ka khana aisa hai:
 *     "Shaunte Jackson, 714 790-1460, 11915 Teeside Drive, Fredericksburg, VA, 22407, US"
 * yaani naam, phone, phir gali, sheher, riyasat, zip. Phone sab par ek hi hai
 * (714-790-1460) — wo Decoinks ka apna number hai jo store labels par chapta
 * hai, gaahak ka nahi, is liye usay customer par darj nahi kiya jata.
 * Billing wahi hai jo shipping — owner ne yehi kaha.
 *
 * ATH PARCEL PEHLE SE PARE HUE THE. Ye wahi shipments hain jo pichle jaanch
 * mein "kisi order se juri nahi" nikli thin — kyunke unka order hi darj nahi
 * tha. Tracking number bilkul mel khate hain, is liye ab wo apne order par lag
 * jate hain: SHP-2026-0141, 0146, 0148, 0149, 0150, 0153, 0154, 0155.
 * Nauwan SHP-2026-0142 hai — Rick Cantu, wahi din, wahi carrier; sheet par
 * uski jagah "batch_13992676_..." likha hai jo abhi label banne ka aarzi
 * nishan hai, asal tracking baad mein laga. Baqi paanch ke parcel system mein
 * the hi nahi, wo naye banaye jate hain.
 *
 * PAYMENT KE MAAMLE MEIN QAIDA YEH HAI: nayi payment sirf wahan banti hai jahan
 * pehle se koi bina-order payment us par daawa nahi karti. Jahan koi purani
 * payment us order ki lagti hai magar poori tarah mel nahi khati, wahan order
 * bina payment ke chhora jata hai aur maamla owner ke saamne rakha jata hai —
 * kyunke do jagah ek hi paisa darj karna use ganwane se zyada bura hai.
 *
 *   jurti hain (naam + raqam + tareeqa teenon mile):
 *     PAY-2026-0126  $25   Stripe  Craig A Mcdonald   -> ORD-260904233253
 *     PAY-2026-0124  $125  Stripe  Taima Vunibaka     -> ORD-260901213147
 *     PAY-2026-0122  $75   Stripe  (bina naam)        -> ORD-260903101308 (Rick Cantu)
 *                    poore system mein yahi ek $75 Stripe hai aur yahi ek $75 order
 *     PAY-2026-0114  $103  Jim Callahan               -> ORD-260903211712
 *                    is par tareeqa "other" aur tareekh 24 August likhi hai, magar
 *                    uske apne note mein hai "original method and date not recorded" —
 *                    yaani wo dono khane bharosay ke laayaq nahin. Raqam aur gaahak
 *                    dono theek milte hain, is liye ise sheet ke mutabiq PayPal aur
 *                    3 September par durust kar diya jata hai.
 *
 *   nahi jurtin, owner se poochhna hai:
 *     PAY-2026-0131  $480  Stripe  Brooke Wylie — yeh theek 240 + 240 hai, yaani
 *                    ORD-260904103430 aur ORD-260904092101 dono. Ek order ke saath
 *                    ek hi payment lagti hai, is liye ise do hisson mein baantna
 *                    parega. Jab tak owner na kahe, dono order bina payment ke.
 *     PAY-2026-0123  $90   Zelle  (bina naam) — Alhelí AR ka order $92 ka hai aur
 *                    wahi ek Zelle hai. Do dollar ka farq hai, is liye chhora ja
 *                    raha hai; naya $92 banane se $90 phir bhi loose reh jata aur
 *                    ek hi paisa do baar chadh jata.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP   = 'digi_september_backup_20260905'
const SUPPLIER = 'Xin Fei Yang Factory'

// pay: 'new' = sheet se nayi payment banao
//      '<PAY-…>' = wo purani payment isi order par lagao
//      null = abhi kuch nahi, owner se poochhna hai
const ROWS = [
  { ref: 'ORD-260905001059', date: '2026-09-05', who: 'Shaunte Jackson',
    line1: '11915 Teeside Drive', city: 'Fredericksburg', state: 'VA', zip: '22407',
    items: 2, shipped: false, carrier: 'UPS', trk: '1Z24C3140335864213',
    method: 'PayPal', shipping: 15.00, total: 41.00, shp: 'SHP-2026-0155', pay: 'new' },

  { ref: 'ORD-260904233253', date: '2026-09-04', who: 'Craig A. McDonald', match: 'CUST-2026-0083',
    line1: '159 N Meridian', city: 'Wichita', state: 'KS', zip: '67203',
    items: 1, shipped: false, carrier: 'USPS', trk: '9200190371836134218226',
    method: 'Stripe', shipping: 10.00, total: 25.00, shp: null, pay: 'PAY-2026-0126' },

  { ref: 'ORD-260904103430', date: '2026-09-04', who: 'Brooke Wylie', match: 'CUST-2026-0087',
    line1: '2575 Swanson Rd', city: 'Crouse', state: 'NC', zip: '28033',
    items: 30, shipped: false, carrier: 'USPS', trk: '9305520845500013164506',
    method: 'Stripe', shipping: 15.00, total: 240.00, shp: 'SHP-2026-0154', pay: null },

  { ref: 'ORD-260904092101', date: '2026-09-04', who: 'Brooke Wylie', match: 'CUST-2026-0087',
    line1: '2575 Swanson Rd', city: 'Crouse', state: 'NC', zip: '28033',
    items: 30, shipped: false, carrier: 'USPS', trk: '9305520845500013163585',
    method: 'Stripe', shipping: 15.00, total: 240.00, shp: 'SHP-2026-0153', pay: null },

  { ref: 'ORD-260903101308', date: '2026-09-03', who: 'Rick Cantu',
    line1: '658 D St', city: 'Wasco', state: 'CA', zip: '93280',
    items: 5, shipped: false, carrier: 'USPS', trk: 'batch_13992676_2026-09-03T17-24-15.958414',
    method: 'Stripe', shipping: 15.00, total: 75.00, shp: 'SHP-2026-0142', pay: 'PAY-2026-0122' },

  { ref: 'ORD-260903211712', date: '2026-09-03', who: 'Jim Callahan', match: 'CUST-2026-0070',
    line1: '80 Prescott Street', city: 'Nashua', state: 'NH', zip: '03064',
    items: 10, shipped: true, carrier: 'USPS', trk: '9334620845500035588761',
    method: 'PayPal', shipping: 18.00, total: 103.00, shp: 'SHP-2026-0141', pay: 'PAY-2026-0114',
    fixPayment: true },

  { ref: 'ORD-260902065229', date: '2026-09-02', who: 'Alhelí AR',
    line1: '209 Low Country Court', city: 'Morrisville', state: 'NC', zip: '27560',
    items: 9, shipped: true, carrier: 'UPS', trk: '1Z24C3140323520204',
    method: 'Zelle', shipping: 15.00, total: 92.00, shp: 'SHP-2026-0146', pay: null },

  { ref: 'ORD-260901213147', date: '2026-09-01', who: 'Taima Vunibaka', match: 'CUST-2026-0082',
    line1: '771 Limestone Avenue', city: 'Lathrop', state: 'CA', zip: '95330',
    items: 10, shipped: true, carrier: 'USPS', trk: '9234690371836103214992',
    method: 'Stripe', shipping: 15.00, total: 125.00, shp: null, pay: 'PAY-2026-0124' },

  { ref: 'ORD-260901085553', date: '2026-09-01', who: 'Brooke Wylie', match: 'CUST-2026-0087',
    line1: '2575 Swanson Rd', city: 'Crouse', state: 'NC', zip: '28033',
    items: 9, shipped: true, carrier: 'UPS', trk: '1Z24C3140335992192',
    method: 'Stripe', shipping: 0, total: 250.00, shp: 'SHP-2026-0148', pay: 'new' },

  { ref: 'ORD-260901084621', date: '2026-09-01', who: 'Brooke Wylie', match: 'CUST-2026-0087',
    line1: '2575 Swanson Rd', city: 'Crouse', state: 'NC', zip: '28033',
    items: 42, shipped: true, carrier: 'UPS', trk: '1Z24C3140327680187',
    method: 'Stripe', shipping: 0, total: 250.00, shp: 'SHP-2026-0150', pay: 'new' },

  { ref: 'ORD-260901083350', date: '2026-09-01', who: 'Brooke Wylie', match: 'CUST-2026-0087',
    line1: '2575 Swanson Rd', city: 'Crouse', state: 'NC', zip: '28033',
    items: 49, shipped: true, carrier: 'UPS', trk: '1Z24C3140311483152',
    method: 'Stripe', shipping: 0, total: 250.00, shp: 'SHP-2026-0149', pay: 'new' },

  { ref: 'ORD-260901082010', date: '2026-09-01', who: 'Jody Roy',
    line1: '110 Lakeside Drive', city: 'Baxley', state: 'GA', zip: '31513',
    items: 10, shipped: true, carrier: 'USPS', trk: '9234690371836103214619',
    method: 'Stripe', shipping: 10.00, total: 260.00, shp: null, pay: 'new' },

  { ref: 'ORD-260901080320', date: '2026-09-01', who: 'Jody Roy',
    line1: '110 Lakeside Drive', city: 'Baxley', state: 'GA', zip: '31513',
    items: 43, shipped: true, carrier: 'USPS', trk: '9234690371836103214633',
    method: 'Stripe', shipping: 10.00, total: 260.00, shp: null, pay: 'new' },

  { ref: 'ORD-260901065054', date: '2026-09-01', who: 'Jody Roy',
    line1: '110 Lakeside Drive', city: 'Baxley', state: 'GA', zip: '31513',
    items: 47, shipped: true, carrier: 'USPS', trk: '9234690371836103214626',
    method: 'Stripe', shipping: 10.00, total: 260.00, shp: null, pay: 'new' },
]

const money = n => `$${Number(n).toFixed(2)}`
const pad4  = n => String(n).padStart(4, '0')
const oneLine = r => `${r.line1}, ${r.city}, ${r.state}, ${r.zip}, US`
async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }

// Unique index hataye hue rows par bhi lagta hai, is liye counter ka agla
// number kabhi kabhi pehle se kisi hataye hue record ke paas hota hai —
// CUST-2026-0091 par Muhammad hassan isi tarah baitha tha. Aisi soorat mein us
// purane record ko "-VOID" laga kar raaste se hata diya jata hai taake zinda
// silsila lagataar rahe. Agar number kisi ZINDA record ke paas ho to counter
// aage barhta hai, kyunke us par haath nahi lagta.
const TABLES = {
  'CUST-2026': { table: 'customers',       col: 'customer_number', soft: true  },
  'ORD-2026':  { table: 'orders',          col: 'order_number',    soft: true  },
  'PO-2026':   { table: 'purchase_orders', col: 'po_number',       soft: true  },
  'SHP-2026':  { table: 'shipments',       col: 'shipment_number', soft: true  },
  'PAY-2026':  { table: 'payments',        col: 'payment_number',  soft: false },
}

async function nextNumber(scope, prefix) {
  const t = TABLES[scope]
  for (let guard = 0; guard < 100; guard++) {
    const r = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope=$1 RETURNING last_value`, [scope])
    const num = `${prefix}-${pad4(r.last_value)}`
    const held = await one(
      `SELECT id, ${t.soft ? 'deleted_at' : 'NULL::timestamptz'} AS deleted_at
         FROM ${t.table} WHERE ${t.col}=$1`, [num])
    if (!held) return num
    if (held.deleted_at) {
      await query(`UPDATE ${t.table} SET ${t.col}=$2 WHERE id=$1`, [held.id, `${num}-VOID`])
      console.log(`   ${num} par ek hataya hua record tha, usay ${num}-VOID kar diya`)
      return num
    }
  }
  throw new Error(`${scope} ka koi khali number nahi mila`)
}

async function main() {
  const apply = process.argv.includes('--apply')

  const supplier = await one(`SELECT id FROM suppliers WHERE name=$1 AND deleted_at IS NULL`, [SUPPLIER])
  if (!supplier) { console.log(`supplier "${SUPPLIER}" nahi mila — ruk raha hoon.`); await pool.end(); return }

  const plan = [], skip = []
  for (const r of ROWS) {
    const dup = await one(`SELECT order_number FROM orders WHERE source_po_number=$1 AND deleted_at IS NULL`, [r.ref])
    if (dup) { skip.push([r.ref, `pehle se ${dup.order_number} bana hua hai`]); continue }

    let cust = null
    if (r.match) {
      cust = await one(`SELECT id, customer_number, name FROM customers
                         WHERE customer_number=$1 AND deleted_at IS NULL`, [r.match])
      if (!cust) { skip.push([r.ref, `${r.match} nahi mila`]); continue }
    } else {
      // Poora naam mila kar dekho, tukron se nahi. Pehle surname se dhoonda tha
      // aur "Alhelí AR" ka "AR" "Mery Garcia" ke andar ja baitha — us tarah ek
      // gaahak ka kaam doosre par chadh jata.
      cust = await one(`SELECT id, customer_number, name FROM customers
                         WHERE deleted_at IS NULL AND lower(btrim(name))=lower(btrim($1))`, [r.who])
    }

    let shp = null
    if (r.shp) {
      shp = await one(`SELECT id, shipment_number, order_id, po_id FROM shipments
                        WHERE shipment_number=$1 AND deleted_at IS NULL`, [r.shp])
      if (!shp) { skip.push([r.ref, `${r.shp} nahi mili`]); continue }
      if (shp.order_id || shp.po_id) { skip.push([r.ref, `${r.shp} pehle se lagi hui hai`]); continue }
    }

    let pay = null
    if (r.pay && r.pay !== 'new') {
      pay = await one(`SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number=$1`, [r.pay])
      if (!pay)           { skip.push([r.ref, `${r.pay} nahi mili`]); continue }
      if (pay.order_id)   { skip.push([r.ref, `${r.pay} pehle se kisi order par lagi hui hai`]); continue }
      if (Number(pay.amount).toFixed(2) !== r.total.toFixed(2)) {
        skip.push([r.ref, `${r.pay} ${money(pay.amount)} ki hai magar order ${money(r.total)} ka`]); continue
      }
    }

    plan.push({ ...r, goods: Number((r.total - r.shipping).toFixed(2)),
                cust, shp, pay, supplier_id: supplier.id })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.ref}  ${p.date}  ${p.who}` + (p.cust ? `  (${p.cust.customer_number})` : '  (NAYA CUSTOMER)'))
    console.log(`   ${p.items} items  ${money(p.goods)} + shipping ${money(p.shipping)} = ${money(p.total)}  ` +
                `${p.method}  ${p.shipped ? 'Shipped' : 'In Production'}`)
    console.log(`   ${oneLine(p)}`)
    console.log(`   parcel:  ${p.shp ? `${p.shp.shipment_number} isi par lagegi` : `nayi banegi (${p.carrier} ${p.trk})`}`)
    console.log(`   payment: ` + (p.pay
      ? `${p.pay.payment_number} ${money(p.pay.amount)} lagegi` +
        (p.fixPayment ? ' (tareeqa aur tareekh sheet se durust)' : '')
      : p.pay === null && ROWS.find(x => x.ref === p.ref).pay === 'new'
        ? `nayi banegi ${money(p.total)} ${p.method}`
        : 'ABHI KOI NAHI — owner se poochhna hai'))
    console.log('')
  }
  for (const [n, w] of skip) console.log(`${n}  chhora — ${w}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const note = (what, ref, data) =>
    query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, JSON.stringify(data)])

  // Ek hi gaahak ki kai lines ho sakti hain — Jody Roy ke teen order isi tarah
  // hain. Jo is chalne mein bana, usay yaad rakha jata hai warna teen Jody Roy
  // ban jayenge.
  const madeHere = new Map()

  await query('BEGIN')
  try {
    for (const p of plan) {
      let customerId = p.cust?.id || madeHere.get(p.who.toLowerCase())
      if (!customerId) {
        const cn = await nextNumber('CUST-2026', 'CUST-2026')
        const parts = p.who.split(' ')
        const c = await one(
          `INSERT INTO customers (customer_number, name, first_name, last_name, address_line1, city, state, zip,
                                  country, billing_address, same_as_shipping, status, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'United States',$9,true,'active','DIGI apparel store',NOW(),NOW())
           RETURNING id`,
          [cn, p.who, parts[0], parts.slice(1).join(' ') || null, p.line1, p.city, p.state, p.zip, oneLine(p)])
        customerId = c.id
        for (const kind of ['shipping', 'billing'])
          await query(
            `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country,
                                             is_default, contact_person, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'United States',true,$7,NOW())`,
            [customerId, kind, p.line1, p.city, p.state, p.zip, p.who])
        madeHere.set(p.who.toLowerCase(), customerId)
        await note('customer', cn, { name: p.who })
        console.log(`   ${cn}  ${p.who}  naya customer bana`)
      }

      const willPay = !!p.pay || ROWS.find(x => x.ref === p.ref).pay === 'new'
      const on = await nextNumber('ORD-2026', 'ORD-2026')
      const o = await one(
        `INSERT INTO orders (order_number, customer_id, order_type, status, payment_status, payment_method,
                             order_date, entry_date, payment_date, subtotal, shipping_charges, tax_pct, tax_amt,
                             total, amount_paid, shipping_name, shipping_address, courier, tracking_number,
                             source_system, source_po_number, sales_channel, created_at, updated_at)
         VALUES ($1,$2,'apparel',$3::order_status,$4::payment_status,$5,$6,$6,$7,$8,$9,0,0,$10,$11,$12,$13,$14,$15,
                 'decoinks_digi_apparel_2026',$16,'DIGI',NOW(),NOW())
         RETURNING id`,
        [on, customerId, p.shipped ? 'Shipped' : 'In Production', willPay ? 'Paid' : 'Unpaid', p.method,
         p.date, willPay ? p.date : null, p.goods, p.shipping, p.total, willPay ? p.total : 0,
         p.who, oneLine(p), p.carrier, p.trk, p.ref])
      await note('order', on, { ref: p.ref, total: p.total })

      await query(
        `INSERT INTO order_items_apparel (order_id, item, qty, unit_price, amount, sort_order, production_status)
         VALUES ($1,$2,$3,$4,$5,0,$6)`,
        [o.id, `DIGI apparel — ${p.items} items`, p.items,
         Number((p.goods / p.items).toFixed(4)), p.goods,
         p.shipped ? 'Shipped' : 'In Production'])

      const pon = await nextNumber('PO-2026', 'PO-2026')
      const po = await one(
        `INSERT INTO purchase_orders (po_number, po_type, order_id, customer_id, supplier_id, status,
                                      payment_status, order_date, entry_date, subtotal, shipping_charge,
                                      total, grand_total, created_at, updated_at)
         VALUES ($1,'apparel',$2,$3,$4,$5::po_status,$6,$7,NOW(),$8,$9,$10,$10,NOW(),NOW())
         RETURNING id`,
        [pon, o.id, customerId, p.supplier_id, p.shipped ? 'Shipped' : 'In Production',
         willPay ? 'Paid' : 'Unpaid', p.date, p.goods, p.shipping, p.total])
      await query(`INSERT INTO po_orders (po_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [po.id, o.id])

      let shipName
      if (p.shp) {
        await note('shipment', p.shp.shipment_number, { id: p.shp.id, order_id: null })
        await query(`UPDATE shipments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [p.shp.id, o.id])
        await query(`INSERT INTO shipment_orders (shipment_id, order_id, is_primary) VALUES ($1,$2,true)
                     ON CONFLICT (shipment_id, order_id) DO NOTHING`, [p.shp.id, o.id])
        shipName = p.shp.shipment_number
      } else {
        shipName = await nextNumber('SHP-2026', 'SHP-2026')
        const s = await one(
          `INSERT INTO shipments (shipment_number, order_id, status, carrier, tracking_number, ship_date,
                                  shipping_cost, recipient_name, customer_name, address, ship_to_city,
                                  ship_to_state, ship_to_postal_code, ship_source, created_at, updated_at)
           VALUES ($1,$2,$3::shipment_status,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,'Decoinks Fulfillment',NOW(),NOW())
           RETURNING id`,
          [shipName, o.id, p.shipped ? 'In Transit' : 'Label Created', p.carrier, p.trk, p.date,
           p.shipping, p.who, oneLine(p), p.city, p.state, p.zip])
        await query(`INSERT INTO shipment_orders (shipment_id, order_id, is_primary) VALUES ($1,$2,true)`,
          [s.id, o.id])
        await note('created-shipment', shipName, { order: on })
      }

      let payName = 'koi nahi'
      if (p.pay) {
        await note('payment', p.pay.payment_number, { id: p.pay.id, order_id: null })
        if (p.fixPayment) {
          // Is row ka apna note kehta hai ke tareeqa aur tareekh darj nahi hue
          // the. Sheet unhein bata rahi hai, is liye ab bhar diye jate hain.
          await query(
            `UPDATE payments SET order_id=$2, customer_id=$3, customer_name=$4, payment_method=$5,
                    payment_date=$6::date, paid_at=$6::date, notes=$7, updated_at=NOW() WHERE id=$1`,
            [p.pay.id, o.id, customerId, p.who, p.method, p.date,
             `DIGI store order ${p.ref}. Pehle "other" aur 24 August likha tha kyunke asal tareeqa aur ` +
             `tareekh darj nahi hui thi; sheet se durust kiya gaya.`])
        } else {
          await query(`UPDATE payments SET order_id=$2, customer_id=$3,
                              customer_name=COALESCE(NULLIF(customer_name,''),$4), updated_at=NOW()
                        WHERE id=$1`, [p.pay.id, o.id, customerId, p.who])
        }
        payName = p.pay.payment_number
      } else if (willPay) {
        const pn = await nextNumber('PAY-2026', 'PAY-2026')
        await query(
          `INSERT INTO payments (payment_number, order_id, customer_id, customer_name, amount, fee_amount,
                                 payment_method, payment_date, paid_at, status, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7::date,$7::date,'Completed',$8,NOW(),NOW())`,
          [pn, o.id, customerId, p.who, p.total, p.method, p.date, `DIGI store order ${p.ref}`])
        await note('payment', pn, { order: on, amount: p.total })
        payName = pn
      }

      console.log(`   ${p.ref}  ->  ${on} ${money(p.total)}, ${pon}, ${shipName}, ${payName}`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = await one(`
    SELECT (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL) AS custs,
           (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS orders,
           (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS pos,
           (SELECT COUNT(*) FROM shipments WHERE deleted_at IS NULL) AS shps,
           (SELECT COUNT(*) FROM shipments WHERE deleted_at IS NULL AND order_id IS NULL AND po_id IS NULL) AS loose_shp,
           (SELECT COUNT(*) FROM payments) AS pays,
           (SELECT COUNT(*) FROM payments WHERE order_id IS NULL) AS loose_pay`)
  console.log(`\nho gaya. ${after.custs} customers, ${after.orders} orders, ${after.pos} PO, ` +
              `${after.shps} shipments (${after.loose_shp} bina order), ${after.pays} payments (${after.loose_pay} bina order).`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
