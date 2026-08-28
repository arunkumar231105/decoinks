/**
 * Seven TSI DTF transfer jobs, 21–25 August, from the owner's sheet.
 *
 * Two of them are already in the system (Chris Cox and Héctor García were
 * entered by hand and match the sheet to the cent), so those are left alone and
 * only gain their TSI reference. The rest arrive complete: customer, order,
 * purchase order and payment, in that order, because each hangs off the last.
 *
 * The sheet's shipping address is also the billing address — the shop ships
 * where it bills — so both are written from the one address.
 *
 * Dry run by default. Pass --apply to write.
 */
const fs = require('fs')
const { query, pool } = require('../src/config/db')

const SUPPLIER = 'TEXSTONE INC'
const NOTE = 'Ensure no color dullness, maintain vibrant colors'
const SOURCE = 'decoinks_dtf_po_tracker_aug_2026_90_96'

const money = n => `$${Number(n || 0).toFixed(2)}`
// The sheet writes García and Héctor; the book holds Garcia and Hector. Names
// are matched without their accents so the same person is not created twice.
const plain = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')

async function nextNumber(table, col, prefix) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${col}, '-', 3), '')::INT), 0) + 1 AS n
       FROM ${table} WHERE ${col} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(4, '0')}`
}

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = fs.readFileSync(`${__dirname}/data/tsi-260821-to-260825.tsv`, 'utf8')
    .split('\n').filter(Boolean).map(l => {
      const c = l.split('\t')
      return {
        ref: c[0], date: c[1], first: c[2], last: c[3], line1: c[4], city: c[5], state: c[6], zip: c[7],
        artworks: +c[8], qty: +c[9], subtotal: +c[10], shipping: +c[11], total: +c[12],
        method: c[13], fee: +c[14], paid: +c[15],
        lengths: [c[16], c[17]].filter(v => v && v.trim()),
      }
    })

  const supplier = (await query(
    `SELECT id FROM suppliers WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT 1`, [SUPPLIER])).rows[0]

  const plan = []
  for (const r of rows) {
    const full = `${r.first} ${r.last}`
    // Already in the book? The sheet's own reference first, then the shape of
    // the job: same customer, same day, same total.
    const existing = (await query(
      // A day either side: the sheet dates a job when it was sent, the book
      // when it was entered, and the two slip by a day.
      `SELECT o.id, o.order_number FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.deleted_at IS NULL
          AND (o.source_po_number = $1
               OR (o.order_date BETWEEN $2::date - 2 AND $2::date + 2
                   AND ROUND(o.total,2) = ROUND($3::numeric,2)
                   AND (c.name ILIKE $4 OR c.company_name ILIKE $4)))
        LIMIT 1`, [r.ref, r.date, r.total, `%${plain(r.last)}%`])).rows[0]

    const customer = (await query(
      `SELECT id, customer_number, name FROM customers
        WHERE deleted_at IS NULL AND (name ILIKE $1 OR company_name ILIKE $1)
          AND (city ILIKE $2 OR city IS NULL OR city = '')
        ORDER BY (city ILIKE $2) DESC LIMIT 1`, [`%${plain(r.last)}%`, r.city])).rows[0]

    plan.push({ r, existing, customer, full })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('TSI ref           customer              qty   subtotal   shipping     total   kya hoga')
  console.log('-'.repeat(96))
  for (const p of plan) {
    const what = p.existing
      ? `pehle se: ${p.existing.order_number} — sirf TSI ref lagega`
      : `NAYA order + PO${p.r.total > 0 ? ' + payment' : ' (FREE — koi payment nahi)'}${p.customer ? '' : ' + NAYA customer'}`
    console.log(`${p.r.ref.padEnd(16)} ${p.full.padEnd(20)} ${String(p.r.qty).padStart(4)}  ${money(p.r.subtotal).padStart(9)}  ${money(p.r.shipping).padStart(9)}  ${money(p.r.total).padStart(9)}   ${what}`)
  }
  console.log(`\nsupplier ${SUPPLIER}: ${supplier ? 'mil gaya' : 'NAHI MILA — PO nahi ban payega'}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const p of plan) {
      const { r } = p
      if (p.existing) {
        await query(
          `UPDATE orders SET source_system = $2::text, source_po_number = $3::text,
                  source_entry_key = $2::text || ':' || $3::text, updated_at = NOW()
             WHERE id = $1`, [p.existing.id, SOURCE, r.ref])
        console.log(`  ${r.ref}  ${p.existing.order_number} par TSI ref lag gaya`)
        continue
      }

      let customerId = p.customer?.id
      if (!customerId) {
        const cnum = await nextNumber('customers', 'customer_number', 'CUST')
        const addr = `${r.line1}, ${r.city}, ${r.state}, ${r.zip}, United States`
        // Ship-to and bill-to are one and the same on this sheet, so billing_address
        // carries the same address the parts above describe.
        customerId = (await query(
          `INSERT INTO customers (customer_number, name, first_name, last_name, status, customer_type,
                                  address_line1, city, state, zip, country, billing_address,
                                  created_at, updated_at)
           VALUES ($1,$2,$3,$4,'active','individual',$5,$6,$7,$8,'US',$9,NOW(),NOW())
           RETURNING id`,
          [cnum, p.full, r.first, r.last, r.line1, r.city, r.state, r.zip, addr])).rows[0].id
        // Ship-to and bill-to are the same address, so one row serves both.
        await query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, contact_person)
           VALUES ($1,'shipping',$2,$3,$4,$5,'US',TRUE,$6)`,
          [customerId, r.line1, r.city, r.state, r.zip, p.full])
        console.log(`  ${r.ref}  naya customer ${cnum} ${p.full}`)
      }

      const onum = await nextNumber('orders', 'order_number', 'ORD')
      const shipAddr = `${r.line1}, ${r.city}, ${r.state}, ${r.zip}, United States`
      const isFree = r.total <= 0
      const orderId = (await query(
        `INSERT INTO orders (order_number, order_type, customer_id, supplier_id, order_date, due_date,
                             status, payment_status, payment_terms, payment_method,
                             subtotal, shipping_charges, total, is_free,
                             shipping_name, shipping_address, sales_channel, print_type,
                             source_system, source_po_number, source_entry_key, notes, created_at, updated_at)
         VALUES ($1,'dtf',$2,$3,$4::date,$4::date,'Confirmed',$5,'Advance',$6,
                 $7,$8,$9,$10,$11,$12,'TSI','DTF Transfers',$13::text,$14::text,$13::text||':'||$14::text,$15,NOW(),NOW())
         RETURNING id`,
        [onum, customerId, supplier?.id ?? null, r.date,
         isFree ? 'Unpaid' : 'Paid', isFree ? null : r.method,
         r.subtotal, r.shipping, r.total, isFree,
         p.full, shipAddr, SOURCE, r.ref, NOTE])).rows[0].id

      // One line per artwork; the sheet gives each its printed length.
      const per = r.artworks > 0 ? +(r.qty / r.artworks).toFixed(0) : r.qty
      for (let i = 0; i < Math.max(1, r.artworks); i++) {
        const qty = i === r.artworks - 1 ? r.qty - per * (r.artworks - 1) : per
        await query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, artwork_no, size, qty, unit_price, amount,
                                        width_inches, height_inches, production_status, sort_order, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,22,$8,'Pending',$9,$10)`,
          [orderId, `${r.ref} artwork ${i + 1}`, `AW-${r.ref.replace(/\D/g, '')}-${i + 1}`,
           `22" x ${r.lengths[i] ?? ''}"`.replace(' x ""', ''), qty,
           r.artworks ? +(r.subtotal / r.qty).toFixed(4) : 0,
           r.artworks ? +(r.subtotal * (qty / r.qty)).toFixed(2) : 0,
           r.lengths[i] ? Number(r.lengths[i]) : null, i, NOTE])
      }

      const ponum = await nextNumber('purchase_orders', 'po_number', 'PO')
      await query(
        `INSERT INTO purchase_orders (po_number, order_id, customer_id, supplier_id, order_date, entry_date,
                                      status, subtotal, total, grand_total, total_artworks, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$5::date,'Sent',$6,$6,$6,$8,$7,NOW())`,
        [ponum, orderId, customerId, supplier?.id ?? null, r.date, r.subtotal,
         `${r.ref} — ${NOTE}`, Math.max(1, r.artworks)])

      let payLine = 'FREE — koi payment nahi'
      if (!isFree) {
        // Kyle Morris's £50 already exists on the mailbox list; it must move to
        // the order it actually paid for, not be recorded twice.
        const already = (await query(
          `SELECT id, payment_number, order_id FROM payments
            WHERE payment_date = $1::date AND ROUND(amount,2) = ROUND($2::numeric,2)
              AND received_from_name ILIKE $3 LIMIT 1`,
          [r.date, r.paid, `%${r.last}%`])).rows[0]
        if (already) {
          await query(`UPDATE payments SET order_id = $2, customer_id = COALESCE(customer_id,$3), updated_at = NOW()
                         WHERE id = $1`, [already.id, orderId, customerId])
          payLine = `${already.payment_number} ${money(r.paid)} is order par le aayi`
        } else {
          const pnum = await nextNumber('payments', 'payment_number', 'PAY')
          await query(
            `INSERT INTO payments (payment_number, payment_date, amount, fee_amount, payment_method,
                                   received_from_name, status, customer_id, order_id, notes, created_at, updated_at)
             VALUES ($1,$2::date,$3,$4,$5,$6,'Completed',$7,$8,$9,NOW(),NOW())`,
            [pnum, r.date, r.paid, r.fee, r.method, p.full, customerId, orderId, `${r.ref} — TSI sheet`])
          payLine = `nayi payment ${pnum} ${money(r.paid)}`
        }
      }
      console.log(`  ${r.ref}  ${onum} + ${ponum}  ${payLine}`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\nho gaya.\n')
  await pool.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
