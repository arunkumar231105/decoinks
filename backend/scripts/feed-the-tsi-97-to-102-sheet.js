/**
 * TSI purchase orders 97 to 102 — five DTF gang-sheet jobs from TEXSTONE.
 *
 * The sheet gives the goods and the postage in separate columns. What the
 * customer paid is the two together, so the order's total is the grand total
 * and its subtotal is the order amount — the same way every earlier TSI order
 * in the book is built, each of which was checked before writing this.
 *
 * Robert Farrar's job is already half in the book. Invoice DFA-0123, quote
 * Q-2026-0122 and payment PAY-2026-0148 were raised for it at $218.50 — the
 * goods without the postage — and left attached to nothing, which is why they
 * have been sitting in the orphan list. They are adopted by the order this
 * script creates and corrected to $244.50, rather than raised a second time.
 *
 * Four of the five buyers are already on file, three of them under a name the
 * sheet writes differently — "Samuel Ngwamukie" for Ngwamukie Samuel,
 * "Milangella Navarro Fernández" for Milangella Navarro — so each is pinned by
 * customer number rather than matched on the name and duplicated.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const money = n => `$${Number(n || 0).toFixed(2)}`
const NOTE = 'Ensure no color dullness, maintain vibrant colors'

const SHEET = [
  { ref: 'TSI 260827-97', date: '2026-08-27', existing: 'CUST-2026-0090',
    full: 'Lana Green Rogers', first: 'Lana', last: 'Green Rogers',
    line1: '101 Private Road 3490', city: 'Big Sandy', state: 'TX', zip: '75755',
    sheets: [34], artworks: 9, method: 'Zelle', amount: 45.00, shipping: 10.00 },

  { ref: 'TSI 260828-999', date: '2026-08-28', existing: 'CUST-2026-0051',
    full: 'Milangella Navarro', first: 'Milangella', last: 'Navarro',
    line1: '507 Wilshire Dr, Apt 6', city: 'Bellevue', state: 'NE', zip: '68005',
    sheets: [28, 103], artworks: 20, method: 'Zelle', amount: 65.00, shipping: 15.00 },

  { ref: 'TSI 260828-100', date: '2026-08-28', existing: null,
    full: 'TrashWorx', company: 'TrashWorx', type: 'business',
    line1: '9205 Grant Ave', city: 'Laurel', state: 'MD', zip: '20723',
    sheets: [83], artworks: 40, method: 'PayPal', amount: 53.50, shipping: 12.00 },

  { ref: 'TSI 260828-101', date: '2026-08-28', existing: 'CUST-2026-0049',
    full: 'Ngwamukie Samuel', first: 'Ngwamukie', last: 'Samuel',
    line1: '236 Red Cedar Way', city: 'Fuquay-Varina', state: 'NC', zip: '27526',
    sheets: [108, 107, 15], artworks: 50, method: 'Zelle', amount: 128.00, shipping: 18.00 },

  { ref: 'TSI 260828-102', date: '2026-08-28', existing: 'CUST-2026-0042',
    full: 'Robert Farrar', first: 'Robert', last: 'Farrar',
    line1: '748 Alcovy Mill Park', city: 'Lawrenceville', state: 'GA', zip: '30045-5900',
    sheets: [108, 107, 106, 105, 106], artworks: 70, method: 'PayPal', amount: 218.50, shipping: 26.00,
    // Raised for this job before the order existed, at the goods figure only.
    adopt: { invoice: 'DFA-0123', quote: 'Q-2026-0122', payment: 'PAY-2026-0148' } },
]

// The goods are the subtotal, the postage rides on top, and the two together
// are what the customer paid — which is the order's total and the payment.
for (const r of SHEET) r.total = +(r.amount + r.shipping).toFixed(2)

async function nextNumber(table, column, prefix) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${column},'-',3),'')::INT),0)+1 AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(4, '0')}`
}

async function main() {
  const apply = process.argv.includes('--apply')
  const supplier = (await query(
    `SELECT id FROM suppliers WHERE deleted_at IS NULL AND name ILIKE '%TEXSTONE%' LIMIT 1`)).rows[0]

  for (const r of SHEET) {
    r.customer = r.existing
      ? (await query(`SELECT id, customer_number, name FROM customers WHERE customer_number = $1`, [r.existing])).rows[0]
      : (await query(`SELECT id, customer_number, name FROM customers
                       WHERE deleted_at IS NULL AND lower(btrim(name)) = lower(btrim($1)) LIMIT 1`, [r.full])).rows[0]
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${'PO'.padEnd(15)} ${'customer'.padEnd(20)} ${'goods'.padStart(9)} ${'post'.padStart(7)} ${'total'.padStart(9)}  kya hoga`)
  for (const r of SHEET) {
    const who = r.customer ? r.customer.customer_number : 'NAYA banega'
    const extra = r.adopt ? `  + ${r.adopt.invoice}/${r.adopt.quote}/${r.adopt.payment} adopt` : ''
    console.log(`  ${r.ref.padEnd(15)} ${(r.customer?.name ?? r.full).padEnd(20)} ` +
                `${money(r.amount).padStart(9)} ${money(r.shipping).padStart(7)} ${money(r.total).padStart(9)}  ${who}${extra}`)
  }
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  const say = []
  await query('BEGIN')
  try {
    for (const r of SHEET) {
      const addr = `${r.line1}, ${r.city}, ${r.state}, ${r.zip}, United States`

      if (!r.customer) {
        const cnum = await nextNumber('customers', 'customer_number', 'CUST')
        const id = (await query(
          `INSERT INTO customers (customer_number, name, first_name, last_name, company_name,
                                  status, customer_type, address_line1, city, state, zip, country,
                                  billing_address, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,'US',$11,NOW(),NOW()) RETURNING id`,
          [cnum, r.full, r.first ?? null, r.last ?? null, r.company ?? null,
           r.type ?? 'individual', r.line1, r.city, r.state, r.zip, addr])).rows[0].id
        // Ship-to and bill-to are the same address on this sheet.
        await query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, contact_person)
           VALUES ($1,'shipping',$2,$3,$4,$5,'US',TRUE,$6)`,
          [id, r.line1, r.city, r.state, r.zip, r.full])
        r.customer = { id, customer_number: cnum, name: r.full }
        say.push(`${r.ref}  naya customer ${cnum} ${r.full}`)
      } else {
        await query(
          `UPDATE customers SET
             first_name = COALESCE(NULLIF(first_name,''), $2), last_name = COALESCE(NULLIF(last_name,''), $3),
             address_line1 = COALESCE(NULLIF(address_line1,''), $4), city = COALESCE(NULLIF(city,''), $5),
             state = COALESCE(NULLIF(state,''), $6), zip = COALESCE(NULLIF(zip,''), $7),
             billing_address = COALESCE(NULLIF(billing_address,''), $8), updated_at = NOW()
           WHERE id = $1`,
          [r.customer.id, r.first ?? null, r.last ?? null, r.line1, r.city, r.state, r.zip, addr])
      }

      const onum = await nextNumber('orders', 'order_number', 'ORD')
      const orderId = (await query(
        `INSERT INTO orders (order_number, order_type, customer_id, supplier_id, order_date, due_date,
                             status, process_status, payment_status, payment_terms, payment_method,
                             subtotal, shipping_charges, total, is_free,
                             shipping_name, shipping_address, sales_channel, print_type,
                             source_system, source_po_number, notes, created_at, updated_at)
         VALUES ($1,'dtf',$2,$3,$4::date,$4::date,'Confirmed','Pushed','Paid','Advance',$5,
                 $6,$7,$8,FALSE,$9,$10,'TSI','DTF Transfers','TSI',$11::text,$12,NOW(),NOW())
         RETURNING id`,
        [onum, r.customer.id, supplier?.id ?? null, r.date, r.method,
         r.amount, r.shipping, r.total, r.customer.name, addr, r.ref, NOTE])).rows[0].id

      // One line per gang sheet, each 22 inches wide and its own printed length.
      // The artworks ride on the sheets, so they are spread across them.
      const per = Math.floor(r.artworks / r.sheets.length)
      for (let i = 0; i < r.sheets.length; i++) {
        const qty = i === r.sheets.length - 1 ? r.artworks - per * (r.sheets.length - 1) : per
        await query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, artwork_no, size, qty, unit_price, amount,
                                        width_inches, height_inches, production_status, sort_order, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,22,$8,'Pending',$9,$10)`,
          [orderId, `${r.ref} gangsheet ${i + 1}`,
           `AW-${r.ref.replace(/\D/g, '')}-${i + 1}`, `22" x ${r.sheets[i]}"`,
           qty, +(r.amount / r.artworks).toFixed(4),
           +(r.amount * (qty / r.artworks)).toFixed(2), r.sheets[i], i, NOTE])
      }

      const ponum = await nextNumber('purchase_orders', 'po_number', 'PO')
      await query(
        `INSERT INTO purchase_orders (po_number, order_id, customer_id, supplier_id, order_date, entry_date,
                                      status, subtotal, total, grand_total, total_artworks, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$5::date,'Sent',$6,$6,$6,$7,$8,NOW())`,
        [ponum, orderId, r.customer.id, supplier?.id ?? null, r.date, r.amount, r.artworks,
         `${r.ref} — TEXSTONE INC. ${NOTE}`])

      // ── the money ──
      let payLine
      if (r.adopt) {
        // The figure was the goods alone; the customer paid the postage too.
        await query(
          `UPDATE payments SET amount = $2, payment_method = $3, order_id = $4,
                  received_from_name = COALESCE(NULLIF(received_from_name,''), $5),
                  notes = $6, updated_at = NOW()
            WHERE payment_number = $1`,
          [r.adopt.payment, r.total, r.method, orderId, r.customer.name,
           `${r.ref} — TSI sheet; raised at the goods figure before the order existed, corrected to the grand total`])
        payLine = `${r.adopt.payment} ${money(r.amount)} -> ${money(r.total)} aur ${onum} se juri`
      } else {
        // Terms are Advance, so the money often lands days before the job is
        // raised and is already on file unattached. Taking that one is right;
        // writing a second is how one payment becomes two.
        const already = (await query(
          `SELECT payment_number FROM payments
            WHERE order_id IS NULL AND customer_id = $1
              AND ROUND(amount,2) = ROUND($2::numeric,2) LIMIT 1`,
          [r.customer.id, r.total])).rows[0]
        if (already) {
          await query(`UPDATE payments SET order_id = $2, updated_at = NOW() WHERE payment_number = $1`,
            [already.payment_number, orderId])
          say.push(`${r.ref}  ${onum} + ${ponum}  |  ${already.payment_number} ${money(r.total)} pehle se thi, jor di`)
          continue
        }
        const pnum = await nextNumber('payments', 'payment_number', 'PAY')
        await query(
          `INSERT INTO payments (payment_number, payment_date, amount, fee_amount, payment_method,
                                 received_from_name, status, customer_id, order_id, notes, created_at, updated_at)
           VALUES ($1,$2::date,$3,0,$4,$5,'Completed',$6,$7,$8,NOW(),NOW())`,
          [pnum, r.date, r.total, r.method, r.customer.name, r.customer.id, orderId, `${r.ref} — TSI sheet`])
        payLine = `nayi payment ${pnum} ${money(r.total)} ${r.method}`
      }

      // ── the paperwork this job already had ──
      if (r.adopt) {
        const inv = (await query(
          `UPDATE invoices SET order_id = $2, customer_id = $3, subtotal = $4, shipping_charges = $5,
                  total = $6, amount_paid = $6, balance_due = 0, status = 'Paid', updated_at = NOW()
            WHERE invoice_number = $1 RETURNING id`,
          [r.adopt.invoice, orderId, r.customer.id, r.amount, r.shipping, r.total])).rows[0]
        const quo = (await query(
          `UPDATE quotations SET customer_id = $2, subtotal = $3, estimated_shipping = $4,
                  total = $5, status = 'Approved', updated_at = NOW()
            WHERE quote_number = $1 RETURNING id`,
          [r.adopt.quote, r.customer.id, r.amount, r.shipping, r.total])).rows[0]
        await query(`UPDATE orders SET invoice_id = $2, quotation_id = $3, updated_at = NOW() WHERE id = $1`,
          [orderId, inv.id, quo.id])
        await query(`UPDATE invoices SET quote_id = $2, updated_at = NOW() WHERE id = $1`, [inv.id, quo.id])
        say.push(`${r.ref}  ${onum} + ${ponum}  |  ${r.adopt.invoice} aur ${r.adopt.quote} ` +
                 `${money(r.amount)} -> ${money(r.total)} par theek kar ke jore  |  ${payLine}`)
      } else {
        say.push(`${r.ref}  ${onum} + ${ponum}  |  ${payLine}`)
      }
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\n' + say.join('\n') + '\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
