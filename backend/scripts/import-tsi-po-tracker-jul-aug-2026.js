#!/usr/bin/env node
/**
 * Import the TSI PO Tracker (Jul–Aug 2026) — POs 53…69.
 *
 * For each PO row it builds the same chain the earlier TSI batches use:
 *   Customer → Quotation (QT-*) → Sales Order (ORD-*) → Invoice (INV-*)
 *            → Purchase Order (TSI *) → Payment (PAY-*)
 * with identical numbering, statuses and source_* provenance fields, so the
 * new rows are indistinguishable in shape from the ones already in the system.
 *
 * Faithful to the source sheet:
 *  - Billing amounts (not the "stated" amounts) drive the money, because POs
 *    63/64/65/67 were billed once, combined, on PO 63. The other three carry
 *    $0 and are marked as part of that shipment group.
 *  - "Free" rows keep $0 product and their still-billable shipping.
 *  - A payment is only written where the billing total is greater than zero
 *    (payments.amount has a CHECK amount > 0).
 *
 * Idempotent: every insert is keyed on its business number, so re-running
 * skips whatever already exists. Nothing outside these records is touched.
 *
 * Usage:
 *   node backend/scripts/import-tsi-po-tracker-jul-aug-2026.js            (dry-run)
 *   node backend/scripts/import-tsi-po-tracker-jul-aug-2026.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SOURCE_SYSTEM = 'decoinks_dtf_po_tracker_jul_aug_2026'
const VENDOR_NAME = 'TEXSTONE INC'
const ENTRY_DATE = '2026-08-03'   // the day this sheet was handed over / uploaded

// ── Source rows, exactly as supplied ─────────────────────────────────────────
// suffix        = the NN in "TSI 2607NN-xx" style numbering (used for QT/ORD/INV)
// po_date       = PO Date column · dispatch = Required Dispatch column
// product/ship  = BILLING product amount / BILLING shipping (money actually billed)
// stated        = Stated PO Amount (kept in notes when it differs from billing)
const ROWS = [
  { po: 'TSI 260720-53', suffix: '260720-53', po_date: '2026-07-20', dispatch: '2026-07-20', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',       gangsheets: 1,  lengths: '108',                                        total_len: 108, artworks: 7,  stated: 0,      product: 0,      ship: 16.00, group: 'Individual',             note: 'Product amount marked Free' },
  { po: 'TSI 260720-54', suffix: '260720-54', po_date: '2026-07-20', dispatch: '2026-07-20', customer: 'Victor Spates',     address: '2513 Grove Way, Castro Valley, CA 94546',            gangsheets: 9,  lengths: '109, 106, 99, 99, 99, 99, 99, 99, 11, 44',     total_len: 864, artworks: 52, stated: 332.00, product: 332.00, ship: 15.00, group: 'Individual',             note: '10 lengths were listed although declared gangsheets = 9' },
  { po: 'TSI 260722-55', suffix: '260722-55', po_date: '2026-07-22', dispatch: '2026-07-22', customer: 'Alex M. Cabrera',   address: '15129 Foxglove Lane, Urbandale, IA 50323',           gangsheets: 1,  lengths: '34',                                         total_len: 34,  artworks: 52, stated: 25.00,  product: 25.00,  ship: 10.00, group: 'Individual',             note: '' },
  { po: 'TSI 260723-56', suffix: '260723-56', po_date: '2026-07-22', dispatch: '2026-07-23', customer: 'Leisha Rogers',     address: '4485 Hwy 17 North, Guyton, GA 31312',                gangsheets: 1,  lengths: '69',                                         total_len: 69,  artworks: 11, stated: 28.00,  product: 28.00,  ship: 10.00, group: 'Individual',             note: '' },
  { po: 'TSI 260723-57', suffix: '260723-57', po_date: '2026-07-23', dispatch: '2026-07-23', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',      gangsheets: 2,  lengths: '106, 46, 106, 106',                           total_len: 364, artworks: 18, stated: 57.75,  product: 57.75,  ship: 16.00, group: 'Individual',             note: '4 lengths were listed although declared gangsheets = 2' },
  { po: 'TSI 260725-58', suffix: '260725-58', po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Keith DuBois',      address: '12425 Bridgewood Ln, Victorville, CA 92395',         gangsheets: 1,  lengths: '66',                                         total_len: 66,  artworks: 20, stated: 27.00,  product: 27.00,  ship: 15.00, group: 'Individual',             note: '' },
  { po: 'TSI 260727-59', suffix: '260727-59', po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Pam Guernsey',      address: '145 Briarwood Trail, Decatur, IN 46733',             gangsheets: 1,  lengths: '80',                                         total_len: 80,  artworks: 11, stated: 50.00,  product: 50.00,  ship: 15.00, group: 'Individual',             note: 'PO number date differs from PO/dispatch date' },
  { po: 'TSI 260727-60', suffix: '260727-60', po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Kyle Morris',       address: '1001 11th Ave W, Bradenton, FL 34205',               gangsheets: 1,  lengths: '60',                                         total_len: 60,  artworks: 9,  stated: 25.00,  product: 25.00,  ship: 15.00, group: 'Individual',             note: 'PO number date differs from PO/dispatch date' },
  { po: 'TSI 260727-61', suffix: '260727-61', po_date: '2026-07-27', dispatch: '2026-07-27', customer: 'Victor Spates',     address: '2513 Grove Way #133, Castro Valley, CA 94546, USA',  gangsheets: 2,  lengths: '109, 66',                                    total_len: 175, artworks: 8,  stated: 88.00,  product: 88.00,  ship: 15.00, group: 'Individual',             note: 'Second length label was repeated as Length01 in source' },
  { po: 'TSI 260727-62', suffix: '260727-62', po_date: '2026-07-27', dispatch: '2026-07-27', customer: 'Bobbie Lee Hansen', address: '9015 3rd St 438-1, Elburz, Elko, NV 89801',          gangsheets: 1,  lengths: '60',                                         total_len: 60,  artworks: 16, stated: 25.00,  product: 25.00,  ship: 11.50, group: 'Individual',             note: 'Address preserved as provided' },
  { po: 'TSI 260730-63', suffix: '260730-63', po_date: '2026-07-27', dispatch: '2026-07-30', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',      gangsheets: 5,  lengths: '106, 106, 110, 110, 31, 48',                  total_len: 511, artworks: 65, stated: 71.50,  product: 534.25, ship: 75.00, group: 'Combined RF 63/64/65/67', note: 'Combined billing entered once here for POs 63, 64, 65 and 67; 6 lengths listed vs 5 declared' },
  { po: 'TSI 260730-64', suffix: '260730-64', po_date: '2026-07-27', dispatch: '2026-07-30', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',      gangsheets: 5,  lengths: '109, 110, 108, 107, 31',                      total_len: 465, artworks: 60, stated: 198.75, product: 0,      ship: 0,     group: 'Combined RF 63/64/65/67', note: 'Included in combined product total $534.25 and shipping $75' },
  { po: 'TSI 260730-65', suffix: '260730-65', po_date: '2026-07-31', dispatch: '2026-07-30', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',      gangsheets: 10, lengths: '108, 95, 107, 95, 31, 94, 110, 109, 108, 16', total_len: 873, artworks: 60, stated: null,   product: 0,      ship: 0,     group: 'Combined RF 63/64/65/67', note: 'PO date is after required dispatch date; individual amount not provided' },
  { po: 'TSI 260731-66', suffix: '260731-66', po_date: '2026-07-27', dispatch: '2026-07-31', customer: 'Vianelly Chichipa', address: '780 Avenida Del Vista, Apt G, Corona, CA 92882',     gangsheets: 10, lengths: '109',                                        total_len: 109, artworks: 74, stated: 0,      product: 0,      ship: 15.00, group: 'Individual',             note: 'Product amount marked Free; only one length listed although declared gangsheets = 10' },
  { po: 'TSI 260731-67', suffix: '260731-67', po_date: '2026-07-31', dispatch: '2026-07-31', customer: 'Robert Farrar',     address: '748 Alcovy Mill Park, Lawrenceville, GA 30045',      gangsheets: 10, lengths: '108, 99, 105, 108, 96',                       total_len: 516, artworks: 60, stated: null,   product: 0,      ship: 0,     group: 'Combined RF 63/64/65/67', note: 'Included in combined billing; 5 lengths listed although declared gangsheets = 10' },
  { po: 'TSI 260801-68', suffix: '260801-68', po_date: '2026-07-31', dispatch: '2026-08-01', customer: 'Ricardo Malia',     address: '34799 Windrow Road, Murrieta, CA 92563',             gangsheets: 2,  lengths: '101, 42',                                    total_len: 143, artworks: 50, stated: 71.00,  product: 71.00,  ship: 10.00, group: 'Individual',             note: '' },
  { po: 'TSI 260801-69', suffix: '260801-69', po_date: '2026-07-31', dispatch: '2026-08-01', customer: 'Victor Spates',     address: '2513 Grove Way #133, Castro Valley, CA 94546',       gangsheets: 1,  lengths: '83',                                         total_len: 83,  artworks: 3,  stated: 50.00,  product: 50.00,  ship: 15.00, group: 'Individual',             note: '' },
]

// Split "748 Alcovy Mill Park, Lawrenceville, GA 30045" into its parts.
function splitAddress(address) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  const tail = parts[parts.length - 1].replace(/\bUSA\b/i, '').trim()
  const m = /^([A-Z]{2})\s+(\d{5})$/.exec(tail) || /^([A-Z]{2})\s+(\d{5})/.exec(tail)
  let state = '', zip = '', city = '', line1 = address
  if (m) {
    state = m[1]; zip = m[2]
    city = parts[parts.length - 2] || ''
    line1 = parts.slice(0, Math.max(1, parts.length - 2)).join(', ')
  }
  return { line1, city, state, zip }
}

const money = n => Number(n || 0).toFixed(2)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const stats = { customers_created: 0, quotes: 0, orders: 0, invoices: 0, pos: 0, payments: 0, skipped: 0 }
  const plan = []

  try {
    // Reuse the same actor/vendor the earlier TSI batches used.
    const { rows: [meta] } = await client.query(`
      SELECT (SELECT created_by FROM purchase_orders WHERE po_number='TSI 260714-50') AS created_by,
             (SELECT supplier_id FROM purchase_orders WHERE po_number='TSI 260714-50') AS supplier_id`)
    if (!meta?.created_by) throw new Error('Could not resolve the importing user from the earlier TSI batch')

    if (APPLY) await client.query('BEGIN')

    for (const r of ROWS) {
      const exists = await client.query('SELECT 1 FROM purchase_orders WHERE po_number = $1', [r.po])
      if (exists.rowCount) { stats.skipped++; plan.push(`SKIP  ${r.po} (already imported)`); continue }

      const subtotal = Number(r.product)
      const shipping = Number(r.ship)
      const total = +(subtotal + shipping).toFixed(2)
      const addr = splitAddress(r.address)
      const noteLines = [
        `Historical DTF record generated from ${r.po}.`,
        `Source payment status: Paid.`,
        r.note ? `Data check: ${r.note}` : null,
        r.stated !== null && Number(r.stated) !== subtotal
          ? `Stated PO amount ${money(r.stated)} differs from billed product amount ${money(subtotal)} (${r.group}).`
          : null,
        `Gangsheets: ${r.gangsheets} · lengths (in): ${r.lengths} · total ${r.total_len}" · artworks ${r.artworks}.`,
      ].filter(Boolean).join('\n')

      plan.push(`ADD   ${r.po}  ${r.customer.padEnd(20)} product $${money(subtotal)} + ship $${money(shipping)} = $${money(total)}  [${r.group}]`)
      if (!APPLY) continue

      // ── Customer (match on exact name; create when new) ──
      let { rows: [cust] } = await client.query(
        `SELECT id, name FROM customers WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
        [r.customer])
      if (!cust) {
        const custNo = (await client.query(
          `SELECT 'CUST-TSI-2026-' || lpad((COUNT(*) + 1)::text, 3, '0') AS n
             FROM customers WHERE customer_number LIKE 'CUST-TSI-2026-%'`)).rows[0].n
        const [first, ...rest] = r.customer.split(' ')
        const ins = await client.query(
          `INSERT INTO customers (customer_number, name, first_name, last_name,
             address_line1, city, state, zip, country, same_as_shipping,
             status, source, created_by, customer_type, customer_segment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'United States',TRUE,'active',$9,$10,'individual','retail')
           RETURNING id, name`,
          [custNo, r.customer, first, rest.join(' ') || null,
           addr.line1, addr.city, addr.state, addr.zip, SOURCE_SYSTEM, meta.created_by])
        cust = ins.rows[0]
        await client.query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default)
           VALUES ($1,'shipping',$2,$3,$4,$5,'United States',TRUE)`,
          [cust.id, addr.line1, addr.city, addr.state, addr.zip])
        stats.customers_created++
      }

      const common = [r.customer, r.address, subtotal, total, shipping, meta.created_by, cust.id, SOURCE_SYSTEM, r.po]

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
        [`QT-${r.suffix}`, r.customer, cust.id, r.address, subtotal, total, shipping,
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
                 CASE WHEN $6::numeric > 0 THEN 'Paid'::payment_status ELSE 'Unpaid'::payment_status END,
                 CASE WHEN $6::numeric > 0 THEN $6::numeric ELSE 0 END,
                 0,0,0,0,0,$8,$9,$9,$10,$11,$12,'none','Normal',0,$13,$14,$15)
         RETURNING id`,
        [`ORD-${r.suffix}`, quote.id, r.dispatch, ENTRY_DATE, subtotal, total, shipping,
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
         VALUES ($1,$2,$3,$4, (CASE WHEN $9::numeric > 0 THEN 'Paid' ELSE 'Draft' END)::invoice_status,'dtf',
                 $5::date,$5::date,$8,$9,$10,$10,'USD','Advance','Historical Import',
                 CASE WHEN $9::numeric > 0 THEN $9::numeric ELSE 0 END, 0,
                 CASE WHEN $9::numeric > 0 THEN $5::date::timestamptz ELSE NULL END,
                 0,0,0,0,0,'percentage',0,0,$6,$7,$11,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [`INV-${r.suffix}`, `INV-INT-${r.suffix}`, quote.id, order.id, r.dispatch,
         cust.id, r.customer, subtotal, total, shipping, r.address, noteLines, meta.created_by,
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
           print_type, gangsheet_width, total_gangsheets, total_artworks, packages,
           shipping_method, courier_account, shipping_address, communication_method,
           notes, created_by, imported_at, source_system, source_po_number, source_entry_key, source_entry_index)
         VALUES ($1,$1,$2,$3, (CASE WHEN $6::numeric > 0 THEN 'Closed' ELSE 'Draft' END)::po_status,'gangsheet',
                 $4::date,$5::date,$4::date,$16,
                 $7,$6,$6,$7,$8,$8,0,0,0,'USD',1.0000,
                 'Advance', CASE WHEN $6::numeric > 0 THEN 'Paid' ELSE 'Unpaid' END,
                 CASE WHEN $6::numeric > 0 THEN 'Paid' ELSE 'Unpaid' END,
                 CASE WHEN $6::numeric > 0 THEN $6::numeric ELSE 0 END,
                 $9,$10,'Decoinks LLC','en','Medium','Standard',
                 'DTF Transfers','22"',$11,$12,1,
                 'Decoinks Fulfillment','Shippo/Yours',$13,'email',
                 $14,$15,NOW(),$17,$1,$18,1)`,
        [r.po, order.id, cust.id, r.po_date, ENTRY_DATE, total, subtotal, shipping,
         meta.supplier_id, VENDOR_NAME, r.gangsheets, r.artworks, r.address,
         noteLines, meta.created_by, r.dispatch.split('-').reverse().join('-'),
         SOURCE_SYSTEM, `${SOURCE_SYSTEM}:${r.po}`])
      stats.pos++

      // ── Payment (only where money was actually billed) ──
      if (total > 0) {
        const payNo = (await client.query(
          `SELECT 'PAY-2026-' || lpad((COUNT(*) + 1)::text, 4, '0') AS n
             FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)).rows[0].n
        await client.query(
          `INSERT INTO payments (payment_number, payment_date, paid_at, amount, payment_method,
             status, customer_id, order_id, invoice_id, customer_name, notes, recorded_by)
           VALUES ($1,$2::date,$2::date::timestamptz,$3,'Historical Import','Completed',$4,$5,$6,$7,$8,$9)`,
          [payNo, r.dispatch, total, cust.id, order.id, invoice.id, r.customer,
           `Advance payment recorded with the ${r.po} import`, meta.created_by])
        stats.payments++
      }
    }

    if (!APPLY) {
      console.log(plan.join('\n'))
      console.log(`\nDRY RUN — ${ROWS.length - stats.skipped} PO chain(s) would be created, ${stats.skipped} already present.`)
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
