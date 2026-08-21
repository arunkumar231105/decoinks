#!/usr/bin/env node
/**
 * Import the DIGI apparel orders — the ones pushed straight in by API and
 * produced by Xin Fei Yang Factory, as opposed to the TSI sheet batch.
 *
 * SOURCE. The factory's order export, 36 rows. Eight are Closed and are NOT
 * imported: the owner confirmed those are testing artefacts, and they are —
 * three Muhammad Hassan/Hassaan rows, "Test", "Testing", "John Test", and a
 * duplicate Carrie Trenk that was re-placed the next day. That leaves 28 real
 * orders, 249 items.
 *
 * NO MONEY IN THE SOURCE. The export carries quantities and nothing else: no
 * order amount, no shipping, no payment column. Every order is therefore
 * created at 0.00 and the owner will supply the figures separately. Nothing is
 * estimated or invented — a wrong number here would be worse than a blank one,
 * and the reconciliation work on the TSI batch depended on being able to trust
 * that stored figures came from a real source.
 *
 * WHAT IS BUILT. Customer → Sales Order → Purchase Order. No quotation and no
 * invoice: an invoice for $0.00 would be a false document and would clutter the
 * invoice list. Once the amounts arrive, the invoices can be raised properly.
 *
 * CUSTOMERS are resolved in a fixed order of preference, reported per row:
 *   1. a live customer with that name
 *   2. a soft-deleted one, which is restored — several of these people were
 *      removed in the 1–6 Aug cleanup but their addresses are still correct,
 *      and restoring beats creating a second record for the same person
 *   3. a new record from the DIGI address
 *
 * STATUS. The factory's own vocabulary is mapped onto ours:
 *   Shipped          → Shipped        (stage Sent,  process Shipped)
 *   In Production    → In Production  (stage Sent,  process In Production)
 *   Factory Review   → Confirmed      (stage Sent,  process Pushed)
 *   Pushing to Store → Draft          (stage Draft, no process yet)
 *
 * Every row is stamped sales_channel = 'DIGI' so it can be told apart from the
 * TSI batch on screen and in the export. These orders are NOT locked — locking
 * is for records reconciled against a source, and these still need their money.
 *
 * Idempotent: keyed on source_po_number (the factory's order number), so a
 * second run is a no-op. One transaction, dry-run by default.
 *
 * Usage:
 *   node backend/scripts/import-digi-apparel-orders.js            (dry-run)
 *   node backend/scripts/import-digi-apparel-orders.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

const SOURCE_SYSTEM = 'decoinks_digi_apparel_2026'
const FACTORY       = 'Xin Fei Yang Factory'
const ENTRY_DATE    = '2026-08-21'

// factory status → [order status, order_stage, process_status]
const STATUS_MAP = {
  'Shipped':          ['Shipped',       'Sent',  'Shipped'],
  'In Production':    ['In Production', 'Sent',  'In Production'],
  'Factory Review':   ['Confirmed',     'Sent',  'Pushed'],
  'Pushing to Store': ['Draft',         'Draft', null],
}

// The export, verbatim, Closed rows already excluded.
// order, qty, shipped_qty, factory status, customer, phone, address, courier, tracking, order date
const ROWS = [
  ['ORD-260820210740',5,0,'Pushing to Store','Joseph Giles','714 790-1460','412 South Collins Street, Griffin, GA, 30224, US','USPS','','2026-08-20'],
  ['ORD-260820040425',3,0,'Factory Review','Tim Britt','714-790-1460','320 William St., Yorkville, OH, 439714, US','USPS','','2026-08-19'],
  ['ORD-260819193649',5,0,'In Production','Jennifer Ann Trujeque C/O Teresa Perez','714 7901460','11528 Chadwick Rd, Corona, CA, 92878, US','USPS','9234690371836103179680','2026-08-19'],
  ['ORD-260818233212',54,0,'In Production','Thomas Garcia','714 790-1460','275 Green Oaks Dr, Riverside, California, 92507, US','UPS','','2026-08-18'],
  ['ORD-260818123305',10,0,'In Production','Kenny Jones','714-790-1460','3343 Biscay Drive, San Diego, CA, 92154, US','UPS','','2026-08-18'],
  ['ORD-260817072736',3,3,'Shipped','Carrie Trenk','7147901460','73 Fox Meadow Road, Scarsdale, NY, 10583, US','USPS','9200190371836133532101','2026-08-17'],
  ['ORD-260814185129',6,6,'Shipped','Mac Dumas','7147901460','3024 Pen St, Baton Rouge, LA, 70802, US','USPS','9234690371836103165447','2026-08-14'],
  ['ORD-260813093445',3,3,'Shipped','Juan Moreno','7147901460','1924 S Mesa St, San Pedro, CA, 90731, US','USPS','9234690371836103162972','2026-08-13'],
  ['ORD-260807210219',30,30,'Shipped','Thomas Garcia','7147901460','275 Green Oaks Dr, Riverside, CA, 92507, US','USPS','9234690371836103147092','2026-08-07'],
  ['ORD-260807204835',1,1,'Shipped','M.C. Bennett','7147901460','700 Cassel Road, Trailer #8, Manchester, PA, 17345, US','USPS','9200190371836133197386','2026-08-07'],
  ['ORD-260807203150',5,5,'Shipped','Nathaniel Carl c/o Owen Carl','7147901460','20231 Brightwood Court, Yorba Linda, CA, 92886, US','USPS','9234690371836103147108','2026-08-07'],
  ['ORD-260806082836',6,6,'Shipped','Cory P. Lehmann','7147901460','415 N. Orlando Ave, #102, Winter Park, FL, 32789, US','USPS','9234690371836103154540','2026-08-06'],
  ['ORD-260806075907',2,2,'Shipped','John Lilly','7147901460','2800 N Atlantic Ave, Apt 909, Daytona Beach, FL, 32118, US','USPS','9200190371836133214588','2026-08-06'],
  ['ORD-260731093139',15,15,'Shipped','Dexter-Fatso Kaohelaulii','7147901460','4511 puolo rd, Hanapepe, Hawaii, 96716, US','USPS','9234690371836103129821','2026-07-31'],
  ['ORD-260729121724',20,18,'Shipped','Vianelly Chichipa','7147901460','780 Avenida Del Vista, Apt G, Corona, CA, 92882, US','UPS','','2026-07-29'],
  ['ORD-260728105241',3,3,'Shipped','Audrey Tapia','7147901460','7841 Enchanted Trail Dr., El Paso, TX, 79911, US','USPS','9234690371836103123331','2026-07-28'],
  ['ORD-260728082314',10,10,'Shipped','Jim Callahan','7147901460','80 Prescott Street, Nashua, NH, 03064, US','USPS','9234690371836103123072','2026-07-28'],
  ['ORD-260722095825',5,5,'Shipped','Darrel DeBree','7147901460','1106 Brooks Rd, Hastings, MI, 49058, US','USPS','9234690371836103114971','2026-07-22'],
  ['ORD-260722094023',2,2,'Shipped','Alex M Cabrera','7147901460','15129 Foxglove Lane, Urbandale, IA, 50323, US','USPS','9200190371836132717998','2026-07-22'],
  ['ORD-260720203132',6,6,'Shipped','Enrique Vasquez','7147901460','1365 Capitol Ave, Bridgeport, CT, 06604, US','USPS','9234690371836103109182','2026-07-20'],
  ['SG2077177352423895040',6,6,'Shipped','Christine Calhoun','(714) 7901460','350 Berkeley Avenue, Claremont, CA, 91711, US','USPS','9234690371836103098189','2026-07-15'],
  ['SG2077175909938122752',2,2,'Shipped','Christine Calhoun','(714) 7901460','350 Berkeley Avenue, Claremont, CA, 91711, US','USPS','9234690371836103098080','2026-07-15'],
  ['ORD-260707083816',10,10,'Shipped','BAR NEL','7147901460','2331 W 11th Street, Apt 4G, Brooklyn, NY, 11223, US','USPS','9234690371836103087305','2026-07-07'],
  ['ORD-260706100629',10,10,'Shipped','George Rogers','7147901460','6840 Bandicoot Trl., Oak Hills, CA, 92344, US','USPS','9234690371836103087435','2026-07-06'],
  ['ORD-260705224624',6,6,'Shipped','George Rogers','7147901460','6840 Bandicoot Trl., Oak Hills, CA, 92344, US','USPS','9234690371836103086391','2026-07-05'],
  ['SG2073447965155676160',5,5,'Shipped','Jac jean','1236987452','475 Dickson Springs Rd, Fayetteville, GA, 30215, US','USPS','9234690371836103079713','2026-07-05'],
  ['ORD-260703095106',4,4,'Shipped','Mark Taylor','7147901460','2125 South 16th Street, Springfield, Illinois, 62703, US','USPS','9234690371836103080023','2026-07-03'],
  ['SG2071945091699056640',12,12,'Shipped','Trina Nez','1365462341','22 Chihootso DrPo Box 641, Saint Michaels, Arizona, 86511, US','USPS','9234690371836103071434','2026-06-30'],
]

// Names the factory writes differently from the customer record. Checked one
// by one against the address, not just the surname.
const NAME_ALIASES = {
  'Cory P. Lehmann': 'Cory Pabilando Lehmann',   // same person, 415 N. Orlando Ave, Winter Park FL
}

const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)
const stats = { ordersCreated: 0, posCreated: 0, customersRestored: 0, customersCreated: 0, customersReused: 0 }

// "412 South Collins Street, Griffin, GA, 30224, US" → its parts.
function splitAddress(addr) {
  const p = addr.split(',').map(x => x.trim()).filter(Boolean)
  const country = p.length > 1 ? p.pop() : 'US'
  const zip     = p.length > 1 ? p.pop() : null
  const state   = p.length > 1 ? p.pop() : null
  const city    = p.length > 1 ? p.pop() : null
  return { line1: p.join(', ') || null, city, state, zip, country: country === 'US' ? 'United States' : country }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [actor] } = await client.query(
      `SELECT id FROM users WHERE email = 'info@technocas.com' LIMIT 1`)

    // The producing factory as a supplier, created once.
    let { rows: [supplier] } = await client.query(
      `SELECT id FROM suppliers WHERE name = $1 LIMIT 1`, [FACTORY])
    if (!supplier) {
      ;({ rows: [supplier] } = await client.query(
        `INSERT INTO suppliers (name, country, created_by) VALUES ($1,'China',$2) RETURNING id`,
        [FACTORY, actor ? actor.id : null]))
      note('SUPPLIER', `${FACTORY} created`)
    }

    const nextNum = async (table, col, prefix, width) => {
      const { rows } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(${col} FROM '[0-9]+$')::int), 0) AS n
           FROM ${table} WHERE ${col} LIKE $1`, [`${prefix}%`])
      let n = rows[0].n
      return () => `${prefix}${String(++n).padStart(width, '0')}`
    }
    const oNext = await nextNum('orders', 'order_number', 'ORD-2026-', 4)
    const pNext = await nextNum('purchase_orders', 'po_number', 'PO-2026-', 4)
    const cNext = await nextNum('customers', 'customer_number', 'CUST-2026-', 4)

    const resolved = new Map()
    async function resolveCustomer(rawName, phone, addr) {
      const name = NAME_ALIASES[rawName] || rawName
      if (resolved.has(name)) return resolved.get(name)
      const a = splitAddress(addr)

      // 1. a live record wins, even if a deleted duplicate also exists.
      // Ordered by created_at so a customer with two live records — Thomas
      // Garcia has two — always resolves to the same one, run after run.
      let { rows: [c] } = await client.query(
        `SELECT id, customer_number FROM customers
          WHERE deleted_at IS NULL AND lower(btrim(name)) = lower(btrim($1))
          ORDER BY created_at LIMIT 1`, [name])
      if (c) {
        stats.customersReused++
        if (name !== rawName) note('CUSTOMER', `"${rawName}" matched to ${c.customer_number} ${name}`)
        resolved.set(name, c.id); return c.id
      }

      // 2. restore a soft-deleted one rather than duplicating the person
      ;({ rows: [c] } = await client.query(
        `SELECT id, customer_number FROM customers
          WHERE deleted_at IS NOT NULL AND lower(btrim(name)) = lower(btrim($1))
          ORDER BY created_at LIMIT 1`, [name]))
      if (c) {
        await client.query(
          `UPDATE customers SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`, [c.id])
        stats.customersRestored++
        note('CUSTOMER', `${name} restored (${c.customer_number})`)
        resolved.set(name, c.id); return c.id
      }

      // 3. new
      const num = cNext()
      ;({ rows: [c] } = await client.query(
        `INSERT INTO customers (customer_number, name, phone, address_line1, city, state, zip, country, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [num, name, phone || null, a.line1, a.city, a.state, a.zip, a.country, actor ? actor.id : null]))
      stats.customersCreated++
      note('CUSTOMER', `${name} created (${num})`)
      resolved.set(name, c.id); return c.id
    }

    for (const [srcOrder, qty, shippedQty, factoryStatus, name, phone, addr, courier, tracking, orderDate] of ROWS) {
      const { rows: exists } = await client.query(
        `SELECT 1 FROM orders WHERE source_po_number = $1 AND deleted_at IS NULL`, [srcOrder])
      if (exists.length) continue

      const [status, stage, process] = STATUS_MAP[factoryStatus]
      const customerId = await resolveCustomer(name, phone, addr)
      const fullAddr = addr

      const orderNo = oNext()
      const { rows: [order] } = await client.query(
        `INSERT INTO orders (order_number, status, order_type, sales_channel, order_date, entry_date, due_date,
           subtotal, total, shipping_charges, currency, payment_terms, payment_method, payment_status, amount_paid,
           tax_amt, tax_pct, discount_amt, discount_pct, rush_services,
           customer_id, supplier_id, contact_name, contact_phone, shipping_name, shipping_address,
           courier, tracking_number, shipping_method, order_stage, process_status,
           notes, created_by, gangsheet_status, production_priority, total_print_locations,
           production_facility, source_system, source_po_number, source_entry_key)
         VALUES ($1,$2::order_status,'apparel','DIGI',$3::date,$4::date,$3::date,
                 0,0,0,'USD','Advance','DIGI API','Unpaid'::payment_status,0,
                 0,0,0,0,0,
                 $5,$6,$7,$8,$7,$9,
                 $10,$11,'Factory Fulfilment',$12,$13,
                 NULL,$14,'none','Standard',0,
                 $15,$16,$17,$18)
         RETURNING id`,
        [orderNo, status, orderDate, ENTRY_DATE,
         customerId, supplier.id, name, phone || null, fullAddr,
         courier && courier !== 'Factory Default' ? courier : null, tracking || null,
         stage, process, actor ? actor.id : null,
         FACTORY, SOURCE_SYSTEM, srcOrder, `${SOURCE_SYSTEM}:${srcOrder}`])

      // One aggregate line: the export gives a total quantity, not a breakdown,
      // so inventing per-size rows would be fabricating detail we do not have.
      await client.query(
        `INSERT INTO order_items_apparel (order_id, item, qty, unit_price, amount, sort_order)
         VALUES ($1,$2,$3,0,0,0)`,
        [order.id, `DIGI apparel — ${qty} item${qty > 1 ? 's' : ''}` +
                   (shippedQty !== qty ? ` (${shippedQty} shipped)` : ''), qty])

      const poNo = pNext()
      await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_reference, order_id, customer_id, status, po_type,
           order_date, entry_date, subtotal, total, grand_total, freight_charges, other_charges,
           total_tax, total_discount, currency, exchange_rate, payment_terms, payment_status,
           supplier_id, vendor_name, brand, language, priority, production_priority,
           shipping_address, communication_method, tracking_number, carrier,
           notes, created_by, imported_at, source_system, source_po_number, source_entry_key)
         VALUES ($1,$2,$3,$4,$5::po_status,'apparel',
                 $6::date,$7::date,0,0,0,0,0,
                 0,0,'USD',1.0000,'Advance','Unpaid',
                 $8,$9,'Decoinks LLC','en','Medium','Standard',
                 $10,'email',$11,$12,
                 NULL,$13,NOW(),$14,$15,$16)`,
        [poNo, srcOrder, order.id, customerId,
         status === 'Shipped' ? 'Shipped' : status === 'In Production' ? 'In Production' : 'Draft',
         orderDate, ENTRY_DATE,
         supplier.id, FACTORY, fullAddr, tracking || null,
         courier && courier !== 'Factory Default' ? courier : null,
         actor ? actor.id : null, SOURCE_SYSTEM, srcOrder, `${SOURCE_SYSTEM}:${srcOrder}`])

      await client.query(
        `INSERT INTO po_orders (po_id, order_id, sort_order)
         SELECT id, $1, 0 FROM purchase_orders WHERE source_entry_key = $2
         ON CONFLICT DO NOTHING`, [order.id, `${SOURCE_SYSTEM}:${srcOrder}`])

      stats.ordersCreated++; stats.posCreated++
      note('ORDER', `${srcOrder} → ${orderNo} / ${poNo}  ${name}  qty ${qty}  ${factoryStatus} → ${status}`)
    }

    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE sales_channel = 'TSI')::int  AS tsi,
              COUNT(*) FILTER (WHERE sales_channel = 'DIGI')::int AS digi,
              COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::int  AS locked
         FROM orders WHERE deleted_at IS NULL`)
    const { rows: [p] } = await client.query(
      `SELECT COUNT(*)::int AS total FROM purchase_orders WHERE deleted_at IS NULL`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (nothing to import — already present)')
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(20)} ${v}`)
    console.log('\nResulting state')
    console.log(`  Sales orders     ${c.total}  =  ${c.tsi} TSI + ${c.digi} DIGI`)
    console.log(`  Purchase orders  ${p.total}`)
    console.log(`  Locked           ${c.locked}  (the TSI batch; DIGI stays open until it has its amounts)`)

    if (APPLY) { await client.query('COMMIT'); console.log('\nCommitted.') }
    else { await client.query('ROLLBACK'); console.log('\nRolled back. Re-run with --apply to keep these changes.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
