#!/usr/bin/env node
/**
 * Import the TSI PO Tracker (Aug 2026) — POs 70…74.
 *
 * Builds the same chain the earlier TSI batches use, with the numbering that is
 * current in this database (Q-/ORD-/INV-/PO-/PAY-/SHP- 2026-NNNN):
 *   Customer → Quotation → Sales Order → Invoice → Purchase Order → Payment
 *            → Shipment (owner-supplied UPS tracking, matched from Shippo)
 *
 * Money: the sheet's "Total Amount" is the product amount and "Shipping" is
 * separate, so grand total = product + shipping. This matches the rows already
 * imported (e.g. TSI 260801-68 → product 71 + ship 10 = total 81).
 *
 * Dates: document dates are the sheet's PO / required-dispatch dates; entry_date
 * is today (the day this sheet was handed over).
 *
 * Data corrections folded in (source sheet vs. system of record):
 *  - PO 71 lists Jaysin Julios at "1001 11th Ave W, Bradenton, FL 34205", which
 *    is Kyle Morris's address (PO 74). The customer on file — and the Shippo
 *    shipment — are 1806 5th Ave SW, Austin, MN 55912, which is used instead.
 *
 * Tracking is matched to each row by customer + destination + ship date from the
 * owner's Shippo list. No fuzzy matching happens at write time — every value
 * below is explicit and reviewed.
 *
 * Idempotent: keyed on source_po_number / tracking_number, so re-running skips
 * whatever already exists. Nothing outside these records is touched.
 *
 * Usage:
 *   node backend/scripts/import-tsi-po-tracker-aug-2026-70-74.js            (dry-run)
 *   node backend/scripts/import-tsi-po-tracker-aug-2026-70-74.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SOURCE_SYSTEM = 'decoinks_dtf_po_tracker_aug_2026'
const VENDOR_NAME = 'TEXSTONE INC'
const ENTRY_DATE = '2026-08-11'   // today — the day this sheet was handed over

// ── Source rows, exactly as supplied (address corrections noted above) ───────
const ROWS = [
  {
    po: 'TSI 260803-70', po_date: '2026-08-03', dispatch: '2026-08-03',
    customer: 'Milangella Navarro',
    address: '507 Wilshire Dr, Apt. 6, Bellevue, NE 68005',
    gangsheets: 1, artworks: 10, lengths: 'W/22 H:65',
    product: 37.00, ship: 15.00,
    trk: '1Z24C3140310830448', ship_date: '2026-08-03', weight: 2.00,
    to_city: 'Bellevue', to_state: 'NE', to_zip: '68005',
    note: '',
  },
  {
    po: 'TSI 260804-71', po_date: '2026-08-04', dispatch: '2026-08-04',
    customer: 'Jaysin Julios',
    address: '1806 5th Ave SW, Austin, MN 55912',
    gangsheets: 6, artworks: 127, lengths: 'W/22 H:105; W/22 H:103; W/22 H:100; W/22 H:105; W/22 H:109; W/22 H:27',
    product: 260.00, ship: 16.00,
    trk: '1Z24C3140216711871', ship_date: '2026-08-04', weight: 2.00,
    to_city: 'Austin', to_state: 'MN', to_zip: '55912',
    note: 'Source sheet listed this customer at Kyle Morris’s address (1001 11th Ave W, Bradenton, FL 34205); the address on file and the Shippo shipment (Austin, MN 55912) were used instead.',
  },
  {
    po: 'TSI 260803-72', po_date: '2026-08-03', dispatch: '2026-08-03',
    customer: 'Angela Tate',
    address: '8893 Jennifer Dr, Tyler, TX 75703',
    gangsheets: 1, artworks: 38, lengths: 'W/22 H:75',
    product: 35.00, ship: 15.00,
    trk: '1Z24C3140208036867', ship_date: '2026-08-04', weight: 1.50,
    to_city: 'Tyler', to_state: 'TX', to_zip: '75703',
    note: 'Parcel went out on 04-Aug, one day after the required dispatch date.',
  },
  {
    po: 'TSI 260804-73', po_date: '2026-08-04', dispatch: '2026-08-04',
    customer: 'Robert Farrar',
    address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',
    gangsheets: 6, artworks: 128, lengths: 'W/22 H:105; W/22 H:103; W/22 H:100; W/22 H:105; W/22 H:109; W/22 H:27',
    product: 229.50, ship: 26.00,
    trk: '1Z24C3140207031051', ship_date: '2026-08-04', weight: 4.00,
    to_city: 'Lawrenceville', to_state: 'GA', to_zip: '30045',
    note: '',
  },
  {
    po: 'TSI 260804-74', po_date: '2026-08-04', dispatch: '2026-08-04',
    customer: 'Kyle Morris',
    address: '1001 11th Ave W, Bradenton, FL 34205',
    gangsheets: 1, artworks: 11, lengths: 'W/22 H:63',
    product: 32.00, ship: 15.00,
    trk: '1Z24C3140232992047', ship_date: '2026-08-04', weight: 1.00,
    to_city: 'Bradenton', to_state: 'FL', to_zip: '34205',
    note: '',
  },
]

// Split "748 Alcovy Mill Park, Lawrenceville, GA 30045" into its parts.
function splitAddress(address) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  const tail = parts[parts.length - 1].replace(/\bUSA\b/i, '').trim()
  const m = /^([A-Z]{2})\s+(\d{5})/.exec(tail)
  let state = '', zip = '', city = '', line1 = address
  if (m) {
    state = m[1]; zip = m[2]
    city = parts[parts.length - 2] || ''
    line1 = parts.slice(0, Math.max(1, parts.length - 2)).join(', ')
  }
  return { line1, city, state, zip }
}

const money = n => Number(n || 0).toFixed(2)

// Next free business number for a series, e.g. next('Q-2026-', 4) → Q-2026-0078
async function nextNumber(client, table, column, prefix, width) {
  const { rows } = await client.query(
    `SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
    [`${prefix}%`])
  const last = rows[0] ? parseInt(String(rows[0].v).slice(prefix.length), 10) : 0
  return n => `${prefix}${String(last + n).padStart(width, '0')}`
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const stats = { customers_created: 0, quotes: 0, orders: 0, invoices: 0, pos: 0, payments: 0, shipments: 0, skipped: 0 }
  const plan = []

  try {
    // Reuse the actor/vendor the earlier TSI batches used.
    const { rows: [meta] } = await client.query(`
      SELECT created_by, supplier_id FROM purchase_orders
      WHERE source_system = 'decoinks_dtf_po_tracker_jul_aug_2026'
        AND created_by IS NOT NULL AND supplier_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`)
    if (!meta?.created_by) throw new Error('Could not resolve the importing user from the earlier TSI batch')

    const qNext = await nextNumber(client, 'quotations', 'quote_number', 'Q-2026-', 4)
    const oNext = await nextNumber(client, 'orders', 'order_number', 'ORD-2026-', 4)
    const iNext = await nextNumber(client, 'invoices', 'invoice_number', 'INV-2026-', 4)
    const pNext = await nextNumber(client, 'purchase_orders', 'po_number', 'PO-2026-', 4)
    const yNext = await nextNumber(client, 'payments', 'payment_number', 'PAY-2026-', 4)
    const sNext = await nextNumber(client, 'shipments', 'shipment_number', 'SHP-2026-', 4)
    const cNext = await nextNumber(client, 'customers', 'customer_number', 'CUST-2026-', 4)

    if (APPLY) await client.query('BEGIN')

    let seq = 0, custSeq = 0
    for (const r of ROWS) {
      const dup = await client.query(
        `SELECT 1 FROM purchase_orders WHERE source_po_number = $1
          UNION SELECT 1 FROM shipments WHERE tracking_number = $2`, [r.po, r.trk])
      if (dup.rowCount) { stats.skipped++; plan.push(`SKIP  ${r.po} (already imported)`); continue }

      seq += 1
      const subtotal = Number(r.product)
      const shipping = Number(r.ship)
      const total = +(subtotal + shipping).toFixed(2)
      const addr = splitAddress(r.address)
      const nums = {
        q: qNext(seq), o: oNext(seq), i: iNext(seq),
        p: pNext(seq), y: yNext(seq), s: sNext(seq),
      }
      const noteLines = [
        `Historical DTF record generated from ${r.po}.`,
        `Source payment status: Paid (Advance).`,
        r.note ? `Data check: ${r.note}` : null,
        `Gangsheets: ${r.gangsheets} · lengths: ${r.lengths} · artworks ${r.artworks}.`,
        `UPS tracking ${r.trk} (shipped ${r.ship_date}).`,
      ].filter(Boolean).join('\n')

      plan.push(
        `ADD   ${r.po}  ${r.customer.padEnd(20)} $${money(subtotal)} + ship $${money(shipping)} = $${money(total)}  ` +
        `→ ${nums.q} / ${nums.o} / ${nums.i} / ${nums.p} / ${nums.y} / ${nums.s}  trk ${r.trk}`)
      if (!APPLY) continue

      // ── Customer (match on exact name; create when new) ──
      let { rows: [cust] } = await client.query(
        `SELECT id, name FROM customers WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
        [r.customer])
      if (!cust) {
        custSeq += 1
        const [first, ...rest] = r.customer.split(' ')
        const ins = await client.query(
          // payment_terms is deliberately left unset: customers.chk_customers_payment_terms
          // still only allows Due on Receipt / Net 15 / Net 30 / Net 60. The chain
          // documents below carry 'Advance', which those tables accept.
          `INSERT INTO customers (customer_number, name, first_name, last_name,
             address_line1, city, state, zip, country, same_as_shipping,
             status, source, created_by, customer_type, customer_segment, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'United States',TRUE,'active',$9,$10,'individual','retail',$11::date)
           RETURNING id, name`,
          [cNext(custSeq), r.customer, first, rest.join(' ') || null,
           addr.line1, addr.city, addr.state, addr.zip, SOURCE_SYSTEM, meta.created_by, r.po_date])
        cust = ins.rows[0]
        await client.query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default)
           VALUES ($1,'shipping',$2,$3,$4,$5,'United States',TRUE),
                  ($1,'billing', $2,$3,$4,$5,'United States',TRUE)`,
          [cust.id, addr.line1, addr.city, addr.state, addr.zip])
        stats.customers_created++
      }

      // ── Quotation ──
      const quote = (await client.query(
        `INSERT INTO quotations (quote_number, status, customer_name, customer_id, billing_address, shipping_address,
           subtotal, total, estimated_shipping, shipping_amount, quote_estimate, currency, order_type,
           payment_terms, payment_method, due_date, valid_until, approved_at, entry_date,
           tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_services,
           revision_number, notes, customer_notes, created_by, sales_agent_id,
           source_system, source_po_number, source_entry_key, customer_source, customer_requirement_summary)
         VALUES ($1,'Approved',$2,$3,$4,$4,$5,$6,$7,$7,$6,'USD','dtf','Advance','Historical Import',
                 $8::date,($8::date + 7),$8::date::timestamptz,$9::date,
                 0,0,0,0,0,'fixed',0,1,$10,$10,$11,$11,$12,$13,$14,$12,$15)
         RETURNING id`,
        [nums.q, r.customer, cust.id, r.address, subtotal, total, shipping,
         r.dispatch, ENTRY_DATE, noteLines, meta.created_by, SOURCE_SYSTEM, r.po,
         `${SOURCE_SYSTEM}:${r.po}`,
         `DTF Transfers: ${r.artworks} artworks across ${r.gangsheets} gangsheets`])).rows[0]
      stats.quotes++

      // ── Sales order ──
      const order = (await client.query(
        `INSERT INTO orders (order_number, quotation_id, status, order_type, order_date, entry_date, due_date,
           subtotal, total, shipping_charges, currency, payment_terms, payment_method, payment_status,
           amount_paid, tax_amt, tax_pct, discount_amt, discount_pct, rush_services,
           customer_id, contact_name, shipping_name, shipping_address,
           notes, created_by, gangsheet_status, production_priority, total_print_locations,
           source_system, source_po_number, source_entry_key)
         VALUES ($1,$2,'Delivered','dtf',$3::date,$4::date,$3::date,$5,$6,$7,'USD','Advance','Historical Import',
                 'Paid'::payment_status,$6,0,0,0,0,0,$8,$9,$9,$10,$11,$12,'none','Standard',0,$13,$14,$15)
         RETURNING id`,
        [nums.o, quote.id, r.dispatch, ENTRY_DATE, subtotal, total, shipping,
         cust.id, r.customer, r.address, noteLines, meta.created_by,
         SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`])).rows[0]
      stats.orders++

      await client.query(
        `INSERT INTO order_items_dtf (order_id, artwork_name, qty, unit_price, amount, sort_order, production_status)
         VALUES ($1,'AGGREGATE - DTF Transfers (aggregate)',$2,$3,$4,0,'Artwork Approved')`,
        [order.id, r.artworks, r.artworks ? +(subtotal / r.artworks).toFixed(2) : 0, subtotal])

      // ── Invoice ──
      const invoice = (await client.query(
        `INSERT INTO invoices (invoice_number, internal_no, quote_id, order_id, status, order_type,
           issue_date, due_date, subtotal, total, shipping_charges, original_shipping_charges,
           currency, payment_terms, payment_method, amount_paid, balance_due, paid_at,
           tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_charges, rush_services,
           customer_id, customer_name, billing_address, shipping_address, notes, created_by,
           source_system, source_po_number, source_entry_key)
         VALUES ($1,$2,$3,$4,'Paid'::invoice_status,'dtf',
                 $5::date,$5::date,$8,$9,$10,$10,'USD','Advance','Historical Import',
                 $9,0,$5::date::timestamptz,
                 0,0,0,0,0,'percentage',0,0,$6,$7,$11,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [nums.i, `INV-INT-${nums.i.replace('INV-', '')}`, quote.id, order.id, r.dispatch,
         cust.id, r.customer, subtotal, total, shipping, r.address, noteLines, meta.created_by,
         SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`])).rows[0]
      stats.invoices++

      await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [invoice.id, order.id])

      // ── Purchase order ──
      const po = (await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_reference, order_id, customer_id, status, po_type,
           order_date, entry_date, expected_date, required_dispatch_text,
           subtotal, total, grand_total, net_product_amount, shipping_charge, freight_charges,
           total_tax, total_discount, other_charges, currency, exchange_rate,
           payment_terms, payment_status, source_payment_status, payment_received,
           supplier_id, vendor_name, brand, language, priority, production_priority,
           print_type, gangsheet_width, total_gangsheets, total_artworks, packages,
           shipping_method, courier_account, shipping_address, communication_method,
           tracking_number, carrier,
           notes, created_by, imported_at, source_system, source_po_number, source_entry_key, source_entry_index)
         VALUES ($1,$2,$3,$4,'Closed'::po_status,'gangsheet',
                 $5::date,$6::date,$5::date,$7,
                 $8,$9,$9,$8,$10,$10,0,0,0,'USD',1.0000,
                 'Advance','Paid','Paid',$9,
                 $11,$12,'Decoinks LLC','en','Medium','Standard',
                 'DTF Transfers','22"',$13,$14,1,
                 'Decoinks Fulfillment','Shippo/Yours',$15,'email',
                 $16,'UPS',
                 $17,$18,NOW(),$19,$20,$21,$22)
         RETURNING id`,
        [nums.p, r.po, order.id, cust.id, r.po_date, ENTRY_DATE,
         r.dispatch.split('-').reverse().join('-'),
         subtotal, total, shipping,
         meta.supplier_id, VENDOR_NAME, r.gangsheets, r.artworks, r.address,
         r.trk, noteLines, meta.created_by,
         SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`, seq])).rows[0]
      stats.pos++

      // ── Payment (Advance, paid in full) ──
      await client.query(
        `INSERT INTO payments (payment_number, payment_date, paid_at, amount, payment_method,
           status, customer_id, order_id, invoice_id, customer_name, notes, recorded_by)
         VALUES ($1,$2::date,$2::date::timestamptz,$3,'Historical Import','Completed',$4,$5,$6,$7,$8,$9)`,
        [nums.y, r.dispatch, total, cust.id, order.id, invoice.id, r.customer,
         `Advance payment recorded with the ${r.po} import`, meta.created_by])
      stats.payments++

      // ── Shipment (owner-supplied UPS tracking) ──
      // chk_shipments_target_xor: a shipment links to an order OR a PO, never both.
      // Every existing shipment is order-linked, so we follow that; the PO carries
      // the same tracking number (set above) to tie the two together.
      await client.query(
        `INSERT INTO shipments (shipment_number, order_id, status, carrier, tracking_number,
           ship_date, weight_lbs, shipping_cost, recipient_name, customer_name, address,
           ship_to_city, ship_to_state, ship_to_postal_code, ship_source, notes, created_by)
         VALUES ($1,$2,'In Transit','UPS',$3,$4::date,$5,$6,$7,$7,$8,$9,$10,$11,'Decoinks Fulfillment',$12,$13)`,
        [nums.s, order.id, r.trk, r.ship_date, r.weight, shipping,
         r.customer, addr.line1, r.to_city, r.to_state, r.to_zip,
         `Tracking supplied by the owner from Shippo for ${r.po} (PO ${nums.p}).`, meta.created_by])
      stats.shipments++
    }

    if (!APPLY) {
      console.log(plan.join('\n'))
      console.log(`\nDRY RUN — ${ROWS.length - stats.skipped} chain(s) would be created, ${stats.skipped} already present.`)
      console.log('Re-run with --apply to commit.')
      return
    }

    await client.query('COMMIT')
    console.log(plan.join('\n'))
    console.log('\nImported:', stats)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
