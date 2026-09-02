/**
 * The Xin Fei Yang DIGI apparel sheet — five shipped jobs.
 *
 * Two of the five are already in the book. Carl Deibler's ten pieces are
 * ORD-2026-0106, whose four lines add to the sheet's $130 exactly, and Tim
 * Britt's three are ORD-2026-0108, which already carries this sheet's own
 * source_system. Both were fed before without their tracking, which is why they
 * turned up in the missing-tracking list. Feeding them again would duplicate
 * ten pieces of real work, so they are completed, not recreated.
 *
 * Two are free. Free work is not a sale: it gets a parked order, a purchase
 * order for the factory, and a claim recording what was given away — the shape
 * the eleven earlier free jobs already have.
 *
 * One is new: Rick Grandstaff, who is not yet a customer.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const SOURCE = 'decoinks_digi_apparel_2026'
const CHANNEL = 'DIGI'
const money = n => `$${Number(n || 0).toFixed(2)}`

// Straight off the sheet. total is what the customer paid in all; the subtotal
// is that less the shipping, which is how the two already-fed rows are built.
const SHEET = [
  { ref: 'ORD-260826210333', first: 'Thomas', last: 'Garcia', full: 'Thomas Garcia',
    phone: '714-790-1460', line1: '275 Green Oaks Dr', city: 'Riverside', state: 'CA', zip: '92507',
    qty: 5, total: 0, shipping: 15, method: null, carrier: 'USPS',
    tracking: '9234690371836103199008', placed: '2026-08-26', shipped: '2026-08-28', free: true },
  { ref: 'ORD-260824221250', first: 'Juan', last: 'Moreno', full: 'Juan Moreno',
    phone: '714-790-1460', line1: '1924 S Mesa St', city: 'San Pedro', state: 'CA', zip: '90731',
    qty: 3, total: 0, shipping: 15, method: null, carrier: 'USPS',
    tracking: '9234690371836103196052', placed: '2026-08-24', shipped: '2026-08-26', free: true },
  { ref: 'ORD-260822193315', first: 'Carl', last: 'Deibler', full: 'Carl Deibler',
    phone: '714-790-1460', line1: '3757 Karl Rd', city: 'Allegany', state: 'NY', zip: '14706',
    qty: 10, total: 155, shipping: 25, method: 'PayPal', carrier: 'USPS',
    tracking: '9234690371836103190821', placed: '2026-08-22', shipped: '2026-08-26',
    already: 'ORD-2026-0106' },
  { ref: 'ORD-260821211311', first: 'Rick', last: 'Grandstaff', full: 'Rick Grandstaff',
    phone: '714-790-1460', line1: '653 Riley Ave', city: 'East Liverpool', state: 'OH', zip: '43920',
    qty: 2, total: 36, shipping: 12, method: 'Stripe', carrier: 'UPS',
    tracking: 'batch_13992676_2026-08-21T19-01-54.409111', placed: '2026-08-21', shipped: '2026-08-23' },
  { ref: 'ORD-260821201121', first: 'Tim', last: 'Britt', full: 'Tim Britt',
    phone: '714-790-1460', line1: '320 William St.', city: 'Yorkville', state: 'OH', zip: '43971',
    qty: 3, total: 56, shipping: 10, method: 'PayPal', carrier: 'UPS',
    tracking: 'batch_13992676_2026-08-21T17-03-58.432092', placed: '2026-08-21', shipped: '2026-08-23',
    already: 'ORD-2026-0108' },
]

// Free work is priced at nothing and the shipping stands on its own, which is
// how the eleven earlier free jobs read: subtotal 0, total equal to the postage.
// A paid job's total is everything the customer paid, so the goods are the
// remainder once the shipping is taken out.
const figuresFor = r => r.free
  ? { subtotal: 0, shipping: r.shipping, total: r.shipping }
  : { subtotal: +(r.total - r.shipping).toFixed(2), shipping: r.shipping, total: r.total }

async function nextNumber(table, column, prefix, width = 4) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${column},'-',3),'')::INT),0)+1 AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(width, '0')}`
}

async function main() {
  const apply = process.argv.includes('--apply')
  const say = []

  const supplier = (await query(
    `SELECT id FROM suppliers WHERE deleted_at IS NULL AND name ILIKE '%Xin Fei Yang%' LIMIT 1`)).rows[0]
  const admin = (await query(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).rows[0]

  // Who the sheet is about, and whether we already have them.
  for (const r of SHEET) {
    r.customer = (await query(
      `SELECT id, customer_number, address_line1 FROM customers
        WHERE deleted_at IS NULL AND lower(btrim(name)) = lower(btrim($1)) LIMIT 1`, [r.full])).rows[0]
    Object.assign(r, figuresFor(r))
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const r of SHEET) {
    const who = r.customer ? `${r.customer.customer_number}${r.customer.address_line1 ? '' : ' (pata bharenge)'}` : 'NAYA customer banega'
    const what = r.already ? `pehle se ${r.already} — sirf tracking + shipment`
      : r.free ? 'FREE -> parked order + PO + claim + shipment'
      : 'naya order + PO + payment + shipment'
    console.log(`  ${r.full.padEnd(16)} ${String(r.qty).padStart(2)} pcs  ${money(r.total).padStart(8)}  ${who}`)
    console.log(`      ${what}`)
  }
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const r of SHEET) {
      const addr = `${r.line1}, ${r.city}, ${r.state}, ${r.zip}, United States`

      // ── the buyer ──
      if (!r.customer) {
        const cnum = await nextNumber('customers', 'customer_number', 'CUST')
        const id = (await query(
          `INSERT INTO customers (customer_number, name, first_name, last_name, status, customer_type,
                                  phone, address_line1, city, state, zip, country, billing_address,
                                  created_at, updated_at)
           VALUES ($1,$2,$3,$4,'active','individual',$5,$6,$7,$8,$9,'US',$10,NOW(),NOW())
           RETURNING id`,
          [cnum, r.full, r.first, r.last, r.phone, r.line1, r.city, r.state, r.zip, addr])).rows[0].id
        // Ship-to and bill-to are the same address on this sheet.
        await query(
          `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, contact_person)
           VALUES ($1,'shipping',$2,$3,$4,$5,'US',TRUE,$6)`,
          [id, r.line1, r.city, r.state, r.zip, r.full])
        r.customer = { id, customer_number: cnum }
        say.push(`${r.full}: naya customer ${cnum}`)
      } else {
        // Filling only what is blank — never overwriting an address already held.
        await query(
          `UPDATE customers SET
             first_name = COALESCE(NULLIF(first_name,''), $2), last_name = COALESCE(NULLIF(last_name,''), $3),
             phone = COALESCE(NULLIF(phone,''), $4), address_line1 = COALESCE(NULLIF(address_line1,''), $5),
             city = COALESCE(NULLIF(city,''), $6), state = COALESCE(NULLIF(state,''), $7),
             zip = COALESCE(NULLIF(zip,''), $8), billing_address = COALESCE(NULLIF(billing_address,''), $9),
             updated_at = NOW()
           WHERE id = $1`,
          [r.customer.id, r.first, r.last, r.phone, r.line1, r.city, r.state, r.zip, addr])
      }

      // ── the order ──
      let orderId
      if (r.already) {
        const o = (await query(`SELECT id FROM orders WHERE order_number = $1`, [r.already])).rows[0]
        orderId = o.id
        // Everything the sheet knows that the row did not: how it travelled.
        await query(
          `UPDATE orders SET courier = $2, tracking_number = $3, shipped_at = $4::date,
                  status = 'Shipped', process_status = 'Shipped',
                  supplier_id = COALESCE(supplier_id, $5),
                  sales_channel = COALESCE(NULLIF(sales_channel,''), $6),
                  source_system = COALESCE(NULLIF(source_system,''), $7),
                  source_po_number = COALESCE(NULLIF(source_po_number,''), $8),
                  shipping_name = COALESCE(NULLIF(shipping_name,''), $9),
                  shipping_address = COALESCE(NULLIF(shipping_address,''), $10),
                  updated_at = NOW()
            WHERE id = $1`,
          [orderId, r.carrier, r.tracking, r.shipped, supplier?.id ?? null, CHANNEL, SOURCE,
           r.ref, r.full, addr])
        say.push(`${r.full}: ${r.already} par tracking aur shipment lag gaya`)
      } else {
        const onum = r.free
          ? `FREE-2026-${String((await query(
              `SELECT COALESCE(MAX(NULLIF(split_part(order_number,'-',3),'')::INT),0)+1 AS n
                 FROM orders WHERE order_number LIKE 'FREE-2026-%'`)).rows[0].n).padStart(4,'0')}`
          : await nextNumber('orders', 'order_number', 'ORD')
        orderId = (await query(
          `INSERT INTO orders (order_number, order_type, customer_id, supplier_id, order_date, due_date,
                               status, process_status, payment_status, payment_terms, payment_method,
                               subtotal, shipping_charges, total, is_free,
                               shipping_name, shipping_address, sales_channel, print_type,
                               source_system, source_po_number, courier, tracking_number, shipped_at,
                               notes, deleted_at, created_at, updated_at)
           VALUES ($1,'apparel',$2,$3,$4::date,$4::date,'Shipped','Shipped',$5,'Advance',$6,
                   $7,$8,$9,$10,$11,$12,$13,'Custom Apparel',$14::text,$15::text,$16,$17,$18::date,
                   $19,$20,NOW(),NOW())
           RETURNING id`,
          [onum, r.customer.id, supplier?.id ?? null, r.placed,
           r.free ? 'Unpaid' : 'Paid', r.free ? null : r.method,
           r.subtotal, r.shipping, r.total, Boolean(r.free), r.full, addr, CHANNEL,
           SOURCE, r.ref, r.carrier, r.tracking, r.shipped,
           `${r.ref} — Xin Fei Yang DIGI apparel sheet`,
           // A free job is parked out of the sales book the moment it is written,
           // the same as the eleven before it.
           r.free ? new Date() : null])).rows[0].id

        // The sheet gives a piece count and a price for the lot, not a line
        // for each garment, so the lot is one line at its own average.
        await query(
          `INSERT INTO order_items_apparel (order_id, item, qty, unit_price, amount,
                                            production_status, sort_order, notes)
           VALUES ($1,$2,$3,$4,$5,'Completed',0,$6)`,
          [orderId, `DIGI apparel — ${r.qty} items`, r.qty,
           r.qty ? +(r.subtotal / r.qty).toFixed(4) : 0, r.subtotal,
           `${r.ref} — piece count from the sheet; the garment breakdown was not given`])
        say.push(`${r.full}: ${onum}${r.free ? ' (parked — free)' : ''}`)
        r.onum = onum
      }

      // ── the purchase order, which free work gets too ──
      if (!r.already) {
        const ponum = await nextNumber('purchase_orders', 'po_number', 'PO')
        await query(
          `INSERT INTO purchase_orders (po_number, order_id, customer_id, supplier_id, order_date, entry_date,
                                        status, subtotal, total, grand_total, total_artworks, notes, updated_at)
           VALUES ($1,$2,$3,$4,$5::date,$5::date,'Sent',$6,$6,$6,1,$7,NOW())`,
          [ponum, orderId, r.customer.id, supplier?.id ?? null, r.placed, r.subtotal,
           `${r.ref} — Xin Fei Yang DIGI apparel sheet`])
        say.push(`  └ ${ponum}`)
      }

      // ── the money ──
      if (!r.free) {
        const already = (await query(
          `SELECT payment_number FROM payments WHERE order_id = $1 LIMIT 1`, [orderId])).rows[0]
        if (already) {
          say.push(`  └ payment ${already.payment_number} pehle se juri hui hai`)
        } else {
          const pnum = await nextNumber('payments', 'payment_number', 'PAY')
          await query(
            `INSERT INTO payments (payment_number, payment_date, amount, fee_amount, payment_method,
                                   received_from_name, status, customer_id, order_id, notes, created_at, updated_at)
             VALUES ($1,$2::date,$3,0,$4,$5,'Completed',$6,$7,$8,NOW(),NOW())`,
            [pnum, r.placed, r.total, r.method, r.full, r.customer.id, orderId,
             `${r.ref} — Xin Fei Yang DIGI apparel sheet`])
          say.push(`  └ nayi payment ${pnum} ${money(r.total)} ${r.method}`)
        }
      }

      // ── the parcel ──
      const snum = await nextNumber('shipments', 'shipment_number', 'SHP')
      await query(
        `INSERT INTO shipments (shipment_number, order_id, customer_name, carrier, tracking_number,
                                status, ship_date, recipient_name, address, ship_to_city, ship_to_state,
                                ship_to_postal_code, ship_source, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'Delivered',$6::date,$7,$8,$9,$10,$11,'Decoinks Fulfillment',$12,NOW(),NOW())`,
        [snum, orderId, r.full, r.carrier, r.tracking, r.shipped, r.full, addr,
         r.city, r.state, r.zip, `${r.ref} — Xin Fei Yang DIGI apparel sheet`])
      say.push(`  └ ${snum} ${r.carrier} ${r.tracking}`)

      // ── free work is a claim, not a sale ──
      if (r.free) {
        const cnum = await nextNumber('claims', 'claim_number', 'CLM')
        const po = (await query(
          `SELECT id FROM purchase_orders WHERE order_id = $1 AND deleted_at IS NULL LIMIT 1`, [orderId])).rows[0]
        await query(
          `INSERT INTO claims (claim_number, customer_id, order_id, purchase_order_id,
                               claim_category, sub_issue, quantity_affected, claimed_amount,
                               description, preferred_resolution, requested_amount,
                               review_notes, decision, resolution_type, approved_amount,
                               responsible_admin_id, approval_date, status, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'Other','Free Reprint / Replacement',$5,0,
                   $6,ARRAY['Replacement'],0,
                   $7,'Approve','Replacement',0,$8,$9::date,'Closed',$8,NOW(),NOW())`,
          [cnum, r.customer.id, orderId, po?.id ?? null, r.qty,
           `${r.ref} — ${r.qty} pieces produced free of charge for ${r.full}. Shipping of ${money(r.shipping)} was charged.`,
           'Order was produced and shipped at no charge. Moved out of the sales book and recorded here as a settled claim.',
           admin?.id ?? null, r.placed])
        say.push(`  └ ${cnum} (free — claim)`)
      }
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\n' + say.join('\n') + '\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
