/**
 * Har sales order ke saath ek quotation aur ek invoice — na kam, na zyada.
 *
 * Owner ka qaida saaf hai: jitne sales order hain utni hi quotations aur utni
 * hi invoices honi chahiyen. Muft kaam is se bahar hai — us ka quotation ya
 * invoice nahi banta, wo claim mein jata hai.
 *
 * 143 orders hain, un mein ek muft (ORD-2026-0129). Yaani 142 quotations aur
 * 142 invoices banti hain.
 *
 * PEHLE JOR, PHIR BANAO. Kuch quotations aur invoices pehle se mojood hain
 * magar unka order se rishta hi nahi bana tha — unhein dobara banana galti
 * hoti, isi liye pehle jorha jata hai:
 *
 *   Q-2026-0118 + JCA-0117  $103    Jim Callahan   -> ORD-2026-0135
 *        24 August ko quote aur invoice ban kar paisa bhi aa gaya tha; factory
 *        order 3 September ko laga. Wahi ek kaam hai, do nahi.
 *   Q-2026-0127            $105.75  Robert Farrar  -> ORD-2026-0124
 *   Q-2026-0128            $232.25  Robert Farrar  -> ORD-2026-0125
 *        in dono ki invoice pehle se lagi hui hai (RFA-0127, RFA-0128), sirf
 *        quotation ka rishta reh gaya tha.
 *
 * BAQI JO BACHE, WO ASAL MEIN FAAZIL HAIN — soft-delete:
 *   Q-2026-0115 / BMO-0115  $66     Blanca Moz     — ORD-2026-0112 par pehle se
 *                                                     Q-2026-0111 aur BMO-0112 hain
 *   Q-2026-0121 / RFA-0119  $45.25  Robert Farrar  — ORD-2026-0118 par pehle se
 *                                                     Q-2026-0120 aur RFA-0121 hain
 *   Q-2026-0129 / HAN-0129  $110    Hassaan Anis   — is gaahak ka koi order nahi
 *   Q-2026-0130 / HAN-0130  $25     Hassaan Anis   — isi tarah
 *
 * NAYE DASTAVEZ ORDER SE HI BANTE HAIN — wahi raqam, wahi shipping, wahi pata,
 * wahi lines. Quotation "Approved" par kholta hai kyunke order to pehle hi ban
 * chuka hai; invoice "Paid" par agar paisa aa gaya, warna "Sent".
 *
 * Line items sirf quotation_items / invoice_items mein likhe jate hain. Purani
 * quotation_items_dtf jaisi tabelein abhi bhi database mein hain magar app
 * unhein nahi parhti — sirf generic tabel parhti hai, is liye wahi bharni hai.
 *
 * MUFT WALA ORDER CLAIM MEIN JATA HAI. ORD-2026-0129 (Robert Farrar, 6 gang
 * sheets, 73 artworks, 4 September) us gum shuda parcel ka dobara chhapa hua
 * maal hai. Uska claim wahi shakl leta hai jo pehle 13 claims ki hai:
 * category "Other", sub-issue "Free Reprint / Replacement", raqam 0, faisla
 * Approve, halat Closed.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'quotes_invoices_backup_20260905'

// Jo pehle se bane hue hain aur sirf jorne hain.
const ADOPT = [
  { order: 'ORD-2026-0135', quote: 'Q-2026-0118', invoice: 'JCA-0117' },
  { order: 'ORD-2026-0124', quote: 'Q-2026-0127' },
  { order: 'ORD-2026-0125', quote: 'Q-2026-0128' },
]

// Jo kisi order ke nahi nikle.
const RETIRE_QUOTES   = ['Q-2026-0115', 'Q-2026-0121', 'Q-2026-0129', 'Q-2026-0130']
const RETIRE_INVOICES = ['BMO-0115', 'RFA-0119', 'HAN-0129', 'HAN-0130']

const FREE_ORDER = 'ORD-2026-0129'

const money = n => `$${Number(n).toFixed(2)}`
const pad4  = n => String(n).padStart(4, '0')
async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }
async function all(sql, p) { const { rows } = await query(sql, p); return rows }

// Invoice number ka pehla hissa gaahak ka naam hai — pehle naam ka pehla haraf
// aur aakhri naam ke do. Yeh wahi qaida hai jo utils/counter.js mein likha hai.
function invoicePrefix(name) {
  if (!name || !name.trim()) return 'CUST'
  const words = name.trim().toUpperCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return 'CUST'
  const code = words.length > 1 ? words[0][0] + words[words.length - 1].slice(0, 2) : words[0].slice(0, 3)
  return code.padEnd(3, 'X').slice(0, 3)
}

// Counter ka agla number kabhi kisi hataye hue record ke paas hota hai, kyunke
// unique index un par bhi lagta hai. Aise record ko "-VOID" kar ke raasta khali
// kiya jata hai; zinda record ho to counter aage barhta hai.
async function claimNumber(scope, make, table, col, soft) {
  for (let i = 0; i < 100; i++) {
    const r = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope=$1 RETURNING last_value`, [scope])
    const num = make(r.last_value)
    const held = await one(
      `SELECT id, ${soft ? 'deleted_at' : 'NULL::timestamptz'} AS deleted_at FROM ${table} WHERE ${col}=$1`, [num])
    if (!held) return num
    if (held.deleted_at) {
      await query(`UPDATE ${table} SET ${col}=$2 WHERE id=$1`, [held.id, `${num}-VOID`])
      return num
    }
  }
  throw new Error(`${scope} ka khali number nahi mila`)
}

// Order ki lines — jis bhi shakl ke items hon, ek hi tarah mein.
async function orderLines(order) {
  const t = order.order_type
  if (t === 'apparel') return all(
    `SELECT item AS description, qty, unit_price, amount, artwork_no, front_image, back_image,
            color AS colors, size AS sizes, sort_order
       FROM order_items_apparel WHERE order_id=$1 ORDER BY sort_order`, [order.id])
  if (t === 'gangsheet') return all(
    `SELECT ('Gang sheet ' || size) AS description, qty, price_per_sheet AS unit_price, amount,
            NULL AS artwork_no, front_image, back_image, NULL AS colors, size AS sizes, sort_order
       FROM order_items_gangsheet WHERE order_id=$1 ORDER BY sort_order`, [order.id])
  return all(
    `SELECT artwork_name AS description, qty, unit_price, amount, artwork_no, front_image, back_image,
            NULL AS colors, size AS sizes, sort_order
       FROM order_items_dtf WHERE order_id=$1 ORDER BY sort_order`, [order.id])
}

async function main() {
  const apply = process.argv.includes('--apply')

  // 1. Jo jorne hain
  const adopt = []
  for (const a of ADOPT) {
    const o = await one(`SELECT id, order_number, quotation_id, invoice_id FROM orders
                          WHERE order_number=$1 AND deleted_at IS NULL`, [a.order])
    if (!o) continue
    const q = a.quote   ? await one(`SELECT id, quote_number, total FROM quotations
                                      WHERE quote_number=$1 AND deleted_at IS NULL`, [a.quote]) : null
    const i = a.invoice ? await one(`SELECT id, invoice_number, total FROM invoices
                                      WHERE invoice_number=$1 AND deleted_at IS NULL`, [a.invoice]) : null
    adopt.push({ ...a, o, q: o.quotation_id ? null : q, i: o.invoice_id ? null : i })
  }
  const adoptedQuotes  = new Set(adopt.filter(a => a.q).map(a => a.quote))
  const adoptedInvoices = new Set(adopt.filter(a => a.i).map(a => a.invoice))

  // 2. Jo banane hain — jorne ke baad bhi jo khali reh jayen
  const needing = (await all(
    `SELECT o.id, o.order_number, o.order_date, o.order_type::text AS order_type, o.status::text AS status,
            o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total, o.amount_paid,
            o.customer_id, o.lead_id, o.payment_method, o.payment_terms, o.currency,
            o.shipping_address, o.source_system, o.source_po_number,
            o.quotation_id, o.invoice_id, c.name AS customer, c.billing_address, c.email
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
      WHERE o.deleted_at IS NULL AND NOT o.is_free
        AND (o.quotation_id IS NULL OR o.invoice_id IS NULL)
      ORDER BY o.order_date, o.order_number`))
    .map(o => {
      const a = adopt.find(x => x.o.id === o.id)
      return { ...o, makeQuote: !o.quotation_id && !a?.q, makeInvoice: !o.invoice_id && !a?.i }
    })

  // 3. Jo hatane hain
  const retireQ = (await all(
    `SELECT id, quote_number, total FROM quotations WHERE quote_number = ANY($1) AND deleted_at IS NULL`,
    [RETIRE_QUOTES])).filter(q => !adoptedQuotes.has(q.quote_number))
  const retireI = (await all(
    `SELECT id, invoice_number, total FROM invoices WHERE invoice_number = ANY($1) AND deleted_at IS NULL`,
    [RETIRE_INVOICES])).filter(i => !adoptedInvoices.has(i.invoice_number))

  // 4. Muft wala order -> claim
  const freeOrder = await one(
    `SELECT o.id, o.order_number, o.order_date::date AS d, o.customer_id, o.source_po_number,
            c.name AS customer,
            (SELECT COALESCE(SUM(qty),0) FROM order_items_dtf x WHERE x.order_id=o.id) AS pieces
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
      WHERE o.order_number=$1 AND o.deleted_at IS NULL AND o.is_free`, [FREE_ORDER])
  const hasClaim = freeOrder
    ? await one(`SELECT claim_number FROM claims WHERE order_id=$1 AND deleted_at IS NULL`, [freeOrder.id])
    : null

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('JORNE HAIN:')
  for (const a of adopt)
    console.log(`   ${a.o.order_number}  ${a.q ? `quote ${a.q.quote_number} ${money(a.q.total)}` : ''}` +
                `${a.i ? `  invoice ${a.i.invoice_number} ${money(a.i.total)}` : ''}` +
                `${!a.q && !a.i ? '  (pehle se juda hua)' : ''}`)

  console.log(`\nBANANE HAIN:  ${needing.filter(o => o.makeQuote).length} quotations, ` +
              `${needing.filter(o => o.makeInvoice).length} invoices`)
  for (const o of needing)
    console.log(`   ${o.order_number}  ${o.customer}  ${money(o.total)}  ` +
                `${o.makeQuote ? 'quote ' : ''}${o.makeInvoice ? 'invoice' : ''}`)

  console.log('\nHATANE HAIN:')
  for (const q of retireQ) console.log(`   quotation ${q.quote_number}  ${money(q.total)}`)
  for (const i of retireI) console.log(`   invoice   ${i.invoice_number}  ${money(i.total)}`)

  console.log('\nCLAIM:')
  if (!freeOrder) console.log(`   ${FREE_ORDER} nahi mila (ya muft nahi hai)`)
  else if (hasClaim) console.log(`   ${FREE_ORDER} par pehle se ${hasClaim.claim_number} hai`)
  else console.log(`   ${freeOrder.order_number}  ${freeOrder.customer}  ${freeOrder.pieces} pieces  -> naya claim`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const note = (what, ref, data) =>
    query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, JSON.stringify(data)])

  await query('BEGIN')
  try {
    for (const a of adopt) {
      if (a.q) {
        await note('adopt-quote', a.quote, { order: a.o.order_number })
        await query(`UPDATE orders SET quotation_id=$2, updated_at=NOW() WHERE id=$1`, [a.o.id, a.q.id])
      }
      if (a.i) {
        await note('adopt-invoice', a.invoice, { order: a.o.order_number })
        await query(`UPDATE orders SET invoice_id=$2, updated_at=NOW() WHERE id=$1`, [a.o.id, a.i.id])
        await query(`UPDATE invoices SET order_id=$2, updated_at=NOW() WHERE id=$1 AND order_id IS NULL`,
          [a.i.id, a.o.id])
      }
      if (a.q || a.i) console.log(`   ${a.o.order_number} jur gaya`)
    }

    let madeQ = 0, madeI = 0
    for (const o of needing) {
      const lines = await orderLines(o)
      const paid = Number(o.amount_paid) >= Number(o.total) && Number(o.total) > 0

      let quotationId = o.quotation_id || adopt.find(a => a.o.id === o.id && a.q)?.q?.id || null
      if (o.makeQuote) {
        const qn = await claimNumber('Q-2026', v => `Q-2026-${pad4(v)}`, 'quotations', 'quote_number', true)
        const q = await one(
          `INSERT INTO quotations (quote_number, customer_id, lead_id, status, order_type, currency,
                                   subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total,
                                   estimated_shipping, rush_services, customer_name, billing_email,
                                   shipping_address, billing_address, payment_method, payment_terms,
                                   entry_date, valid_until, approved_at, source_system, source_po_number,
                                   created_at, updated_at)
           VALUES ($1,$2,$3,'Approved',$4,COALESCE($5,'USD'),$6,0,0,0,0,$7,$8,0,$9,$10,$11,$12,$13,
                   COALESCE($14,'Due on Receipt'),$15,NULL,$15::date,$16,$17,NOW(),NOW())
           RETURNING id`,
          [qn, o.customer_id, o.lead_id, o.order_type, o.currency, o.subtotal, o.total, o.shipping,
           o.customer, o.email || null, o.shipping_address, o.billing_address || o.shipping_address,
           o.payment_method, o.payment_terms, o.order_date, o.source_system, o.source_po_number])
        for (let n = 0; n < lines.length; n++) {
          const l = lines[n]
          await query(
            `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order,
                                          line_no, sizes, colors, artwork_no, front_image, back_image)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [q.id, l.description, l.qty, l.unit_price, l.amount, n, n + 1,
             l.sizes, l.colors, l.artwork_no, l.front_image, l.back_image])
        }
        await query(`UPDATE orders SET quotation_id=$2, updated_at=NOW() WHERE id=$1`, [o.id, q.id])
        await note('quotation', qn, { order: o.order_number, total: o.total })
        quotationId = q.id
        madeQ++
      }

      if (o.makeInvoice) {
        const inum = await claimNumber('INV', v => `${invoicePrefix(o.customer)}-${pad4(v)}`,
                                       'invoices', 'invoice_number', true)
        const inv = await one(
          `INSERT INTO invoices (invoice_number, internal_no, order_id, quote_id, customer_id, status,
                                 issue_date, due_date, subtotal, discount_pct, discount_amt, tax_pct, tax_amt,
                                 total, amount_paid, balance_due, customer_name, billing_email,
                                 billing_address, shipping_address, order_type, payment_terms, payment_method,
                                 currency, rush_services, rush_charges, shipping_charges,
                                 source_system, source_po_number, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6::invoice_status,$7,NULL,$8,0,0,0,0,$9,$10,$11,$12,$13,$14,$15,$16,
                   COALESCE($17,'Due on Receipt'),$18,COALESCE($19,'USD'),0,0,$20,$21,$22,NOW(),NOW())
           RETURNING id`,
          [inum, `INV-INT-${inum}`, o.id, quotationId, o.customer_id, paid ? 'Paid' : 'Sent',
           o.order_date, o.subtotal, o.total, paid ? o.total : 0, paid ? 0 : o.total,
           o.customer, o.email || null, o.billing_address || o.shipping_address, o.shipping_address,
           o.order_type, o.payment_terms, o.payment_method, o.currency, o.shipping,
           o.source_system, o.source_po_number])
        for (let n = 0; n < lines.length; n++) {
          const l = lines[n]
          await query(
            `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sort_order,
                                        sizes, colors, artwork_no, front_image, back_image)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [inv.id, l.description, l.qty, l.unit_price, l.amount, n,
             l.sizes, l.colors, l.artwork_no, l.front_image, l.back_image])
        }
        await query(`UPDATE orders SET invoice_id=$2, updated_at=NOW() WHERE id=$1`, [o.id, inv.id])
        // Payment bhi apni invoice jaan le, warna paisa order par to dikhta hai
        // magar invoice khali lagti hai.
        await query(`UPDATE payments SET invoice_id=$2, updated_at=NOW()
                      WHERE order_id=$1 AND invoice_id IS NULL`, [o.id, inv.id])
        await note('invoice', inum, { order: o.order_number, total: o.total })
        madeI++
      }
    }
    console.log(`   ${madeQ} quotations aur ${madeI} invoices banayi`)

    for (const q of retireQ) {
      await note('retired-quotation', q.quote_number, { id: q.id, total: q.total })
      await query(`UPDATE quotations SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [q.id])
    }
    for (const i of retireI) {
      await note('retired-invoice', i.invoice_number, { id: i.id, total: i.total })
      await query(`UPDATE invoices SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [i.id])
    }
    console.log(`   ${retireQ.length} quotations aur ${retireI.length} invoices hata din`)

    if (freeOrder && !hasClaim) {
      const maxClm = await one(`SELECT COALESCE(MAX(SUBSTRING(claim_number FROM 10)::int),0) AS n
                                  FROM claims WHERE claim_number ~ '^CLM-2026-[0-9]{4}$'`)
      const cn = `CLM-2026-${pad4(Number(maxClm.n) + 1)}`
      await query(
        `INSERT INTO claims (claim_number, customer_id, order_id, claim_category, sub_issue,
                             quantity_affected, claimed_amount, requested_amount, approved_amount,
                             description, decision, status, approval_date, created_at, updated_at)
         VALUES ($1,$2,$3,'Other','Free Reprint / Replacement',$4,0,0,0,$5,'Approve','Closed',NOW(),NOW(),NOW())`,
        [cn, freeOrder.customer_id, freeOrder.id, freeOrder.pieces,
         `${freeOrder.source_po_number || freeOrder.order_number} — ${freeOrder.pieces} pieces produced ` +
         `free of charge for ${freeOrder.customer}. Reprint of the 28 August parcel SHP-2026-0140, which ` +
         `UPS lost; the money was already collected on ORD-2026-0120.`])
      await note('claim', cn, { order: freeOrder.order_number })
      console.log(`   ${cn}  ${freeOrder.order_number}  ${freeOrder.customer}`)
    }

    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = await one(`
    SELECT (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL) AS orders,
           (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND is_free) AS free,
           (SELECT COUNT(*) FROM quotations WHERE deleted_at IS NULL) AS quotes,
           (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL) AS invoices,
           (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND NOT is_free AND quotation_id IS NULL) AS no_q,
           (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND NOT is_free AND invoice_id IS NULL) AS no_i,
           (SELECT COUNT(*) FROM claims WHERE deleted_at IS NULL) AS claims`)
  console.log(`\nho gaya. ${after.orders} orders (${after.free} muft), ${after.quotes} quotations, ` +
              `${after.invoices} invoices, ${after.claims} claims.`)
  console.log(`bina quotation ke orders: ${after.no_q}, bina invoice ke: ${after.no_i}`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
