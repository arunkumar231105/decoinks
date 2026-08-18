#!/usr/bin/env node
/**
 * Import the TSI PO Tracker (Aug 2026) — POs 75…88.
 *
 * Builds the full chain the earlier TSI batches use:
 *   Customer → Quotation → Sales Order → Invoice → Purchase Order → Payment
 *            → Shipment
 *
 * MONEY. The sheet's "Order Amount (USD)" is the product amount and "Shipping
 * (USD)" is separate, so the order total is product + shipping — confirmed by
 * the owner, and the same convention the earlier sheet used. It also makes the
 * per-inch rate behave: small jobs cost more per gangsheet inch (0.69–0.88) and
 * large ones less (0.29–0.38), which the alternative reading does not.
 *
 * ADDRESSES. Shipping and billing are the same address, and the street / city /
 * state / postcode below were split by hand from the sheet and checked against
 * the customer record and the Shippo label for that parcel. Nothing is parsed at
 * write time.
 *
 * WHAT IS NOT INVENTED. Three rows arrived incomplete and are imported exactly
 * as they are, with the empty fields left empty (owner's instruction):
 *   - TSI 260808-77  no gangsheets / artworks / lengths / print type
 *   - TSI 260814-85  order amount $0.00 against 80 artworks
 *   - TSI 260815-88  no order amount and no shipping
 * A payment is only recorded where there is money to record, so the last row
 * gets none and its invoice stays Draft rather than pretending to be Paid.
 *
 * SHIPMENTS. Seven of these parcels are already in Decoinks — they were pulled
 * from Shippo earlier with no sales order to attach to. Those are linked to the
 * order this import creates rather than duplicated; the tracking numbers below
 * were matched by recipient, destination and ship date. The rows from 14-Aug
 * onwards have no label in the Shippo account yet, so they get a Pending
 * shipment with the address and dispatch date and no tracking number.
 *
 * DATA CHECKS FOLDED IN (sheet vs. system of record):
 *   - "Anglea Tate" is Angela Tate (CUST-2026-0024, same address).
 *   - "Samuel Ngwamukie" is Ngwamukie Samuel (CUST-2026-0076).
 *   - TSI 260808-78 is ALREADY in Decoinks as ORD-2026-0076, keyed in by hand on
 *     08-Aug for the same customer, date and address. No second chain is built
 *     for it; its purchase order is enriched with the TSI reference and the
 *     gangsheet figures instead. Its money is left alone and reported: the order
 *     says $68 total where this sheet reads $68 + $18 = $86.
 *   - TSI 260815-88 carries no street, only "Lawrenceville, GA 30045-5900". The
 *     address on file for this customer is used.
 *   - Robert Farrar exists twice (CUST-2026-0042 with four orders and
 *     CUST-2026-0080 with one). These rows go to CUST-2026-0042; the duplicate
 *     still needs merging.
 *   - Gangsheet counts and length lists disagree on two rows (81: 7 vs 8 lengths,
 *     88: 7 vs 11). Both are recorded verbatim.
 *
 * The sheet's colour profile and special instruction have no column on
 * purchase_orders, so they are carried in the notes with the rest of the
 * production detail rather than dropped.
 *
 * Idempotent: keyed on source_po_number, so re-running skips what exists.
 *
 * Usage:
 *   node backend/scripts/import-tsi-po-tracker-aug-2026-75-88.js            (dry-run)
 *   node backend/scripts/import-tsi-po-tracker-aug-2026-75-88.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SOURCE_SYSTEM = 'decoinks_dtf_po_tracker_aug_2026_75_88'
const VENDOR_NAME = 'TEXSTONE INC'
const ENTRY_DATE = '2026-08-18'          // today — the day this sheet was handed over
const FARRAR_CUSTOMER = 'CUST-2026-0042' // the record with the trading history

const FARRAR = { line1: '748 Alcovy Mill Park', city: 'Lawrenceville', state: 'GA', zip: '30045' }

const ROWS = [
  { po: 'TSI 260806-75', po_date: '2026-08-06', dispatch: '2026-08-06', customer: 'Bobbie Lee Hansen',
    addr: { line1: '9015 3rd St 438-1 Elburz', city: 'Elko', state: 'NV', zip: '89801' },
    gangsheets: 1, artworks: 6, width: '22"', lengths: '58', product: 40.00, ship: 15.00,
    trk: '1ZB8F618YW65918640', note: '' },

  { po: 'TSI 260807-76', po_date: '2026-08-07', dispatch: '2026-08-07', customer: 'Richard Dukes',
    addr: { line1: '108 Lucky Ln', city: 'Elkton', state: 'KY', zip: '42220' },
    gangsheets: 1, artworks: 12, width: '22"', lengths: '57', product: 40.00, ship: 15.00,
    trk: '1ZB8F618YW60771389', note: '' },

  { po: 'TSI 260808-77', po_date: '2026-08-08', dispatch: '2026-08-08', customer: 'Robert Farrar',
    addr: FARRAR,
    gangsheets: null, artworks: null, width: null, lengths: null, product: 95.00, ship: 15.00,
    trk: '1Z24C3140220280052',
    note: 'Sheet row carries no gangsheets, artworks, lengths, print type or colour profile.' },

  { po: 'TSI 260808-78', po_date: '2026-08-08', dispatch: '2026-08-08', customer: 'Ngwamukie Samuel',
    addr: { line1: '236 Red Cedar Way', city: 'Fuquay-Varina', state: 'NC', zip: '27526' },
    gangsheets: 3, artworks: 28, width: '22"', lengths: '109, 92, 31', product: 68.00, ship: 18.00,
    trk: '1Z24C3140228384060', existingOrder: 'ORD-2026-0076',
    note: 'Already keyed in by hand as ORD-2026-0076; its PO is enriched instead of building a second chain.' },

  { po: 'TSI 260810-79', po_date: '2026-08-10', dispatch: '2026-08-10', customer: 'Angela Tate',
    addr: { line1: '8893 Jennifer Drive', city: 'Tyler', state: 'TX', zip: '75703' },
    gangsheets: 1, artworks: 38, width: '22"', lengths: '57', product: 50.00, ship: 15.00,
    trk: '1Z24C3140322904079', note: 'Sheet spells the customer "Anglea Tate".' },

  { po: 'TSI 260810-80', po_date: '2026-08-10', dispatch: '2026-08-10', customer: 'Carol Johnson Garlin',
    addr: { line1: '210 Buttrum Rd NE', city: 'Adairsville', state: 'GA', zip: '30103' },
    gangsheets: 2, artworks: 40, width: '22"', lengths: '106, 87', product: 95.00, ship: 10.00,
    trk: '1ZB8F618YW69185390', note: '' },

  { po: 'TSI 260811-81', po_date: '2026-08-11', dispatch: '2026-08-11', customer: 'Robert Farrar',
    addr: FARRAR,
    gangsheets: 7, artworks: 101, width: '22"', lengths: '94, 93, 93, 108, 108, 108, 108, 76',
    product: 303.00, ship: 26.00, trk: '1Z24C3140229440087',
    note: 'Sheet lists 7 gangsheets but 8 lengths.' },

  { po: 'TSI 260812-82', po_date: '2026-08-12', dispatch: '2026-08-12', customer: 'Maurice Boykins',
    addr: { line1: '1057 East Ave R4', city: 'Palmdale', state: 'CA', zip: '93550' },
    gangsheets: 1, artworks: 22, width: '22"', lengths: '105', product: 65.00, ship: 15.00,
    trk: '1Z24C3140316400080', note: '' },

  { po: 'TSI 260814-83', po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Ricardo Malia',
    addr: { line1: '34799 Windrow Road', city: 'Murrieta', state: 'CA', zip: '92563' },
    gangsheets: 2, artworks: 50, width: '22"', lengths: '104, 43', product: 64.00, ship: 15.00,
    trk: null, note: '' },

  { po: 'TSI 260814-84', po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Kyle Morris',
    addr: { line1: '1001 11th Ave W', city: 'Bradenton', state: 'FL', zip: '34205' },
    gangsheets: 1, artworks: 12, width: '22"', lengths: '84', product: 40.00, ship: 15.00,
    trk: null, note: '' },

  { po: 'TSI 260814-85', po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Marc Dagupion',
    addr: { line1: '128 Kapunakea St', city: 'Lahaina', state: 'HI', zip: '96761' },
    gangsheets: 1, artworks: 80, width: '22"', lengths: '77', product: 0.00, ship: 10.00,
    trk: null, note: 'Sheet shows $0.00 against 80 artworks — imported as it stands.' },

  { po: 'TSI 260814-86', po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Robert Farrar',
    addr: FARRAR,
    gangsheets: 4, artworks: 42, width: '22"', lengths: '77, 77, 77, 77', product: 109.00, ship: 26.00,
    trk: null, note: '' },

  { po: 'TSI 260815-87', po_date: '2026-08-15', dispatch: '2026-08-15', customer: 'Johney Gates',
    addr: { line1: '7130 Ladd Circle', city: 'Frederick', state: 'MD', zip: '21703' },
    gangsheets: 1, artworks: 10, width: '22"', lengths: '48', product: 37.00, ship: 15.00,
    trk: null, note: '' },

  { po: 'TSI 260815-88', po_date: '2026-08-15', dispatch: '2026-08-15', customer: 'Robert Farrar',
    addr: FARRAR,
    gangsheets: 7, artworks: 82, width: '22"',
    lengths: '15, 108, 93, 107, 93, 107, 107, 105, 107, 15, 15', product: 0.00, ship: 0.00,
    trk: null,
    note: 'Sheet gives no order amount and no shipping, no street address (only "Lawrenceville, GA 30045-5900"), and lists 7 gangsheets against 11 lengths.' },
]

const money = n => Number(n || 0).toFixed(2)
const addrText = a => `${a.line1}, ${a.city}, ${a.state} ${a.zip}`

async function nextNumber(client, table, column, prefix, width) {
  const { rows } = await client.query(
    `SELECT ${column} AS v FROM ${table} WHERE ${column} ~ ('^' || $1 || '[0-9]+$')
      ORDER BY CAST(SPLIT_PART(${column}, '-', 3) AS int) DESC LIMIT 1`, [prefix])
  const last = rows[0] ? parseInt(String(rows[0].v).slice(prefix.length), 10) : 0
  return n => `${prefix}${String(last + n).padStart(width, '0')}`
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const stats = { customers: 0, quotes: 0, orders: 0, invoices: 0, pos: 0, payments: 0,
                  shipments_linked: 0, shipments_created: 0, skipped: 0, enriched: 0 }
  const plan = []
  try {
    const { rows: [meta] } = await client.query(
      `SELECT created_by, supplier_id FROM purchase_orders
        WHERE source_system LIKE 'decoinks_dtf_po_tracker%' AND created_by IS NOT NULL AND supplier_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`)
    if (!meta) throw new Error('Could not resolve the importing user / TEXSTONE supplier from the earlier TSI batches')

    const qNext = await nextNumber(client, 'quotations',      'quote_number',   'Q-2026-',    4)
    const oNext = await nextNumber(client, 'orders',          'order_number',   'ORD-2026-',  4)
    const iNext = await nextNumber(client, 'invoices',        'invoice_number', 'INV-2026-',  4)
    const pNext = await nextNumber(client, 'purchase_orders', 'po_number',      'PO-2026-',   4)
    const yNext = await nextNumber(client, 'payments',        'payment_number', 'PAY-2026-',  4)
    const sNext = await nextNumber(client, 'shipments',       'shipment_number','SHP-2026-',  4)
    const cNext = await nextNumber(client, 'customers',       'customer_number','CUST-2026-', 4)

    if (APPLY) await client.query('BEGIN')

    let seq = 0, custSeq = 0, paySeq = 0, shipSeq = 0
    for (const r of ROWS) {
      try {
      const dup = await client.query(
        `SELECT 1 FROM purchase_orders WHERE source_po_number = $1 AND deleted_at IS NULL`, [r.po])
      if (dup.rowCount) { stats.skipped++; plan.push(`SKIP  ${r.po} — already imported`); continue }

      const product = Number(r.product || 0)
      const shipping = Number(r.ship || 0)
      const total = +(product + shipping).toFixed(2)

      // ── The row that is already in Decoinks: enrich its PO, build nothing new ──
      if (r.existingOrder) {
        const { rows: [ex] } = await client.query(
          `SELECT o.id AS order_id, o.total AS order_total, p.id AS po_id, p.po_number
             FROM orders o LEFT JOIN purchase_orders p ON p.order_id = o.id AND p.deleted_at IS NULL
            WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [r.existingOrder])
        if (!ex) { plan.push(`WARN  ${r.po} — ${r.existingOrder} not found, skipped`); continue }
        plan.push(`LINK  ${r.po}  ${r.customer.padEnd(22)} → existing ${r.existingOrder} ` +
          `(order $${money(ex.order_total)}, sheet reads $${money(product)} + $${money(shipping)} = $${money(total)})` +
          `  PO ${ex.po_number} enriched`)
        stats.enriched++
        if (!APPLY) continue
        await client.query(
          `UPDATE purchase_orders
              SET source_po_number = $2, supplier_reference = $2, source_system = $3,
                  total_gangsheets = $4, total_artworks = $5, gangsheet_width = $6,
                  gangsheet_lengths = $7, print_type = 'DTF Transfers',
                  packages = 1, payment_terms = 'Advance', production_priority = 'Standard',
                  notes = COALESCE(NULLIF(notes,''), '') ||
                          CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END || $8,
                  updated_at = NOW()
            WHERE id = $1`,
          [ex.po_id, r.po, SOURCE_SYSTEM, r.gangsheets, r.artworks, r.width, r.lengths,
           `Matched to TSI sheet row ${r.po}: ${r.gangsheets} gangsheets · lengths ${r.lengths} · ${r.artworks} artworks. ` +
           `Sheet reads $${money(product)} product + $${money(shipping)} shipping; the order on file totals $${money(ex.order_total)} — left as keyed in.`])
        continue
      }

      seq += 1
      const nums = { q: qNext(seq), o: oNext(seq), i: iNext(seq), p: pNext(seq) }
      const address = addrText(r.addr)
      const noteLines = [
        `Historical DTF record generated from ${r.po}.`,
        `Payment terms: Advance.`,
        r.gangsheets ? `Gangsheets: ${r.gangsheets} · width ${r.width} · lengths ${r.lengths} · artworks ${r.artworks}.`
                     : `Production figures not supplied on the sheet.`,
        r.gangsheets ? `Colour profile: CMYK. Special instruction: ensure no colour dullness, maintain vibrant colours.` : null,
        r.trk ? `UPS tracking ${r.trk}.` : `No carrier label raised yet.`,
        r.note ? `Data check: ${r.note}` : null,
      ].filter(Boolean).join('\n')

      plan.push(`ADD   ${r.po}  ${r.customer.padEnd(22)} $${money(product)} + ship $${money(shipping)} = $${money(total)}  ` +
        `→ ${nums.q} / ${nums.o} / ${nums.i} / ${nums.p}` +
        `${total > 0 ? ' / payment' : ' / (no payment — $0)'}  ` +
        `${r.trk ? `trk ${r.trk} (existing shipment linked)` : 'new shipment (no tracking yet)'}`)
      if (!APPLY) continue

      // ── Customer ──
      let { rows: [cust] } = await client.query(
        r.customer === 'Robert Farrar'
          ? `SELECT id, name FROM customers WHERE deleted_at IS NULL AND customer_number = $1 LIMIT 1`
          : `SELECT id, name FROM customers WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
        [r.customer === 'Robert Farrar' ? FARRAR_CUSTOMER : r.customer])
      if (!cust) {
        custSeq += 1
        const [first, ...rest] = r.customer.split(' ')
        cust = (await client.query(
          `INSERT INTO customers (customer_number, name, first_name, last_name,
             address_line1, city, state, zip, country, billing_address, same_as_shipping,
             status, source, created_by, customer_type, customer_segment, buyer_type, tier,
             payment_terms, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'United States',$9,TRUE,'active',$10,$11,
                   'individual','retail','individual','standard','Due on Receipt',$12::date)
           RETURNING id, name`,
          [cNext(custSeq), r.customer, first, rest.join(' ') || null,
           r.addr.line1, r.addr.city, r.addr.state, r.addr.zip, address,
           SOURCE_SYSTEM, meta.created_by, r.po_date])).rows[0]
        await client.query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default)
           VALUES ($1,'shipping',$2,$3,$4,$5,'United States',TRUE),
                  ($1,'billing', $2,$3,$4,$5,'United States',TRUE)`,
          [cust.id, r.addr.line1, r.addr.city, r.addr.state, r.addr.zip])
        stats.customers++
      }

      // ── Existing Shippo shipment for this parcel, if there is one ──
      const { rows: [shp] } = r.trk
        ? await client.query(
            `SELECT id, shipment_number, tracking_status, ship_date, delivered_date, service_type,
                    shipping_cost, status::text AS status
               FROM shipments WHERE tracking_number = $1 AND deleted_at IS NULL`, [r.trk])
        : { rows: [] }

      // Order and PO status follow the carrier, not a guess.
      const carrier = shp?.tracking_status || null
      const orderStatus = carrier === 'DELIVERED' ? 'Delivered'
        : carrier ? 'Shipped' : 'In Production'
      const poStatus = carrier === 'DELIVERED' ? 'Closed' : carrier ? 'Shipped' : 'In Production'

      // ── Quotation ──
      const quote = (await client.query(
        `INSERT INTO quotations (quote_number, status, customer_name, customer_id, billing_address, shipping_address,
           shipping_city, shipping_state, zip_code, shipping_country,
           subtotal, total, estimated_shipping, shipping_amount, quote_estimate, currency, order_type,
           payment_terms, payment_method, due_date, valid_until, approved_at, entry_date, sent_at,
           tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_services,
           revision_number, notes, customer_notes, created_by, sales_agent_id,
           source_system, source_po_number, source_entry_key, customer_source, customer_requirement_summary)
         VALUES ($1,'Approved',$2,$3,$4,$4,$5,$6,$7,'United States',
                 $8,$9,$10,$10,$9,'USD','dtf','Advance','Historical Import',
                 $11::date,($11::date + 7),$11::date::timestamptz,$12::date,$11::date::timestamptz,
                 0,0,0,0,0,'fixed',0,1,$13,$13,$14,$14,$15,$16,$17,$15,$18)
         RETURNING id`,
        [nums.q, r.customer, cust.id, address, r.addr.city, r.addr.state, r.addr.zip,
         product, total, shipping, r.dispatch, ENTRY_DATE, noteLines, meta.created_by,
         SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`,
         r.artworks ? `DTF Transfers: ${r.artworks} artworks across ${r.gangsheets} gangsheets`
                    : 'DTF Transfers — production figures not supplied'])).rows[0]
      stats.quotes++

      // ── Sales order ──
      const order = (await client.query(
        `INSERT INTO orders (order_number, quotation_id, status, order_type, order_date, entry_date, due_date,
           subtotal, total, shipping_charges, currency, payment_terms, payment_method, payment_status,
           amount_paid, tax_amt, tax_pct, discount_amt, discount_pct, rush_services,
           customer_id, contact_name, shipping_name, shipping_address,
           courier, tracking_number, shipping_method, shipped_at,
           notes, created_by, gangsheet_status, production_priority, total_print_locations,
           source_system, source_po_number, source_entry_key)
         VALUES ($1,$2,$3::order_status,'dtf',$4::date,$5::date,$4::date,
                 $6,$7,$8,'USD','Advance','Historical Import',$9::payment_status,
                 $10,0,0,0,0,0,$11,$12,$12,$13,
                 $14,$15,'Decoinks Fulfillment',$16::timestamptz,
                 $17,$18,'none','Standard',0,$19,$20,$21)
         RETURNING id`,
        [nums.o, quote.id, orderStatus, r.dispatch, ENTRY_DATE,
         product, total, shipping, total > 0 ? 'Paid' : 'Unpaid', total > 0 ? total : 0,
         cust.id, r.customer, address,
         r.trk ? 'UPS' : null, r.trk, shp?.ship_date || null,
         noteLines, meta.created_by, SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`])).rows[0]
      stats.orders++

      await client.query(
        `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, sort_order, production_status)
         VALUES ($1,'AGGREGATE - DTF Transfers (aggregate)',$2,$3,$4,$5,0,'Artwork Approved')`,
        [order.id, r.gangsheets ? `${r.width} × ${r.gangsheets} sheet${r.gangsheets > 1 ? 's' : ''}` : null,
         r.artworks || 0, r.artworks ? +(product / r.artworks).toFixed(2) : 0, product])

      // ── Invoice ──
      const invoice = (await client.query(
        `INSERT INTO invoices (invoice_number, internal_no, quote_id, order_id, status, order_type,
           issue_date, due_date, subtotal, total, shipping_charges, original_shipping_charges,
           currency, payment_terms, payment_method, amount_paid, balance_due, paid_at,
           tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_charges, rush_services,
           customer_id, customer_name, billing_address, shipping_address, notes, created_by,
           source_system, source_po_number, source_entry_key)
         VALUES ($1,$2,$3,$4,$5::invoice_status,'dtf',
                 $6::date,$6::date,$7,$8,$9,$9,'USD','Advance','Historical Import',
                 $10,$11,$12,
                 0,0,0,0,0,'percentage',0,0,$13,$14,$15,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [nums.i, `INV-INT-${nums.i.replace('INV-', '')}`, quote.id, order.id,
         total > 0 ? 'Paid' : 'Draft', r.dispatch,
         product, total, shipping,
         total > 0 ? total : 0, total > 0 ? 0 : total, total > 0 ? `${r.dispatch}T00:00:00Z` : null,
         cust.id, r.customer, address, noteLines, meta.created_by,
         SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`])).rows[0]
      stats.invoices++
      await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [invoice.id, order.id])

      // ── Purchase order ──
      await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_reference, order_id, customer_id, status, po_type,
           order_date, entry_date, expected_date, required_dispatch_text,
           subtotal, total, grand_total, net_product_amount, shipping_charge, freight_charges,
           total_tax, total_discount, other_charges, currency, exchange_rate,
           payment_terms, payment_status, source_payment_status, payment_received,
           supplier_id, vendor_name, brand, language, priority, production_priority,
           print_type, gangsheet_width, gangsheet_lengths, total_gangsheets, total_artworks, packages,
           shipping_method, courier_account, shipping_address, communication_method,
           tracking_number, carrier,
           notes, created_by, imported_at, source_system, source_po_number, source_entry_key, source_entry_index)
         VALUES ($1,$2,$3,$4,$5::po_status,'gangsheet',
                 $6::date,$7::date,$8::date,$9,
                 $10,$11,$11,$10,$12,$12,0,0,0,'USD',1.0000,
                 'Advance',$13,$13,$14,
                 $15,$16,'Decoinks LLC','en','Medium','Standard',
                 $17,$18,$19,$20,$21,1,
                 'Decoinks Fulfillment','Shippo/Yours',$22,'email',
                 $23,$24,
                 $25,$26,NOW(),$27,$28,$29,$30)`,
        [nums.p, r.po, order.id, cust.id, poStatus,
         r.po_date, ENTRY_DATE, r.dispatch, r.dispatch,
         product, total, shipping,
         total > 0 ? 'Paid' : 'Unpaid', total > 0 ? total : 0,
         meta.supplier_id, VENDOR_NAME,
         r.gangsheets ? 'DTF Transfers' : null,
         r.width, r.lengths, r.gangsheets, r.artworks,
         address, r.trk, r.trk ? 'UPS' : null,
         noteLines, meta.created_by, SOURCE_SYSTEM, r.po, `${SOURCE_SYSTEM}:${r.po}`, seq])
      stats.pos++

      // ── Payment (Advance) — only where there is money ──
      if (total > 0) {
        await client.query(
          `INSERT INTO payments (payment_number, payment_date, paid_at, amount, payment_method,
             status, customer_id, order_id, invoice_id, customer_name, notes, recorded_by)
           VALUES ($1,$2::date,$2::date::timestamptz,$3,'Historical Import','Completed',$4,$5,$6,$7,$8,$9)`,
          [yNext(++paySeq), r.dispatch, total, cust.id, order.id, invoice.id, r.customer,
           `Advance payment recorded with the ${r.po} import`, meta.created_by])
        stats.payments++
      }

      // ── Shipment ──
      if (shp) {
        await client.query(
          `UPDATE shipments
              SET order_id = $2, recipient_name = $3, customer_name = $3, address = $4,
                  notes = $5, updated_at = NOW()
            WHERE id = $1`,
          [shp.id, order.id, r.customer, address,
           `Linked to ${nums.o} (${r.po}) by recipient, destination and ship date.`])
        await client.query(
          `INSERT INTO shipment_orders (shipment_id, order_id, is_primary) VALUES ($1,$2,TRUE)
           ON CONFLICT (shipment_id, order_id) DO NOTHING`, [shp.id, order.id])
        stats.shipments_linked++
      } else {
        await client.query(
          `INSERT INTO shipments (shipment_number, order_id, status, carrier, ship_date,
             recipient_name, customer_name, address, ship_to_city, ship_to_state, ship_to_postal_code,
             ship_source, notes, created_by)
           VALUES ($1,$2,'Pending'::shipment_status,'UPS',$3::date,
                   $4,$4,$5,$6,$7,$8,'Decoinks Fulfillment',$9,$10)`,
          [sNext(++shipSeq), order.id, r.dispatch, r.customer, address,
           r.addr.city, r.addr.state, r.addr.zip,
           `Raised with ${r.po}. No carrier label exists for this parcel yet — tracking to be filled in when the label is bought.`,
           meta.created_by])
        stats.shipments_created++
      }
      } catch (rowErr) {
        rowErr.message = `${r.po}: ${rowErr.message}`
        throw rowErr
      }
    }

    if (!APPLY) {
      console.log(plan.join('\n'))
      console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit.`)
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

main().catch(err => { console.error(err.message); process.exit(1) })
