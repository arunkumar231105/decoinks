require('dotenv').config()
const bcrypt = require('bcryptjs')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── Users ──────────────────────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('Admin@1234', 12)
    const { rows: [admin] } = await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name
      RETURNING id
    `, ['Arun Kumar', 'admin@decoinks.com', adminHash, 'Admin'])

    const salesHash = await bcrypt.hash('Sales@1234', 12)
    const { rows: [salesUser] } = await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
      RETURNING id
    `, ['Maria Jose', 'maria@decoinks.com', salesHash, 'Sales'])

    const prodHash = await bcrypt.hash('Prod@1234', 12)
    const { rows: [prodUser] } = await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
      RETURNING id
    `, ['James Taylor', 'james@decoinks.com', prodHash, 'Production'])

    // ── Customers ──────────────────────────────────────────────────────────────
    const CUSTOMERS = [
      { name: 'Northstar Apparel',   email: 'john@northstar.com',      phone: '+1 (305) 555-0147', company: 'Northstar Apparel LLC',    city: 'Miami',       state: 'FL' },
      { name: 'Urban Stitch Co.',    email: 'sarah@urbanstitch.com',   phone: '+1 (213) 555-0198', company: 'Urban Stitch Co.',         city: 'Los Angeles', state: 'CA' },
      { name: 'Cedar Events',        email: 'mike@cedarevents.com',    phone: '+1 (512) 555-0134', company: 'Cedar Events Group',       city: 'Austin',      state: 'TX' },
      { name: 'Blue Peak Gym',       email: 'lisa@bluepeakgym.com',    phone: '+1 (720) 555-0162', company: 'Blue Peak Fitness LLC',    city: 'Denver',      state: 'CO' },
      { name: 'Metro Events',        email: 'carlos@metroevents.com',  phone: '+1 (312) 555-0175', company: 'Metro Events Inc.',        city: 'Chicago',     state: 'IL' },
      { name: 'Sunburst Merch',      email: 'anna@sunburstmerch.com',  phone: '+1 (404) 555-0128', company: 'Sunburst Merchandise',     city: 'Atlanta',     state: 'GA' },
      { name: 'Pacific Print House', email: 'tom@pacificprint.com',    phone: '+1 (503) 555-0183', company: 'Pacific Print House',      city: 'Portland',    state: 'OR' },
      { name: 'Lone Star Tees',      email: 'rachel@lonestartees.com', phone: '+1 (469) 555-0191', company: 'Lone Star Tees LLC',       city: 'Dallas',      state: 'TX' },
      { name: 'Harbor Custom Goods', email: 'ben@harborcustom.com',    phone: '+1 (617) 555-0156', company: 'Harbor Custom Goods',      city: 'Boston',      state: 'MA' },
      { name: 'Summit Brands',       email: 'jess@summitbrands.com',   phone: '+1 (702) 555-0142', company: 'Summit Brands Group',      city: 'Las Vegas',   state: 'NV' },
    ]

    const custId = {}
    for (const c of CUSTOMERS) {
      const { rows: [row] } = await client.query(`
        INSERT INTO customers (name, email, phone, company, city, state, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [c.name, c.email, c.phone, c.company, c.city, c.state, admin.id])
      custId[c.email] = row.id
    }

    // ── Leads ──────────────────────────────────────────────────────────────────
    const LEADS = [
      { num: 'LEAD-2026-0001', email: 'john@northstar.com',      source: 'Email',              stage: 'initiated', desc: '50 custom tees and 25 polos for team uniform reorder' },
      { num: 'LEAD-2026-0002', email: 'sarah@urbanstitch.com',   source: 'Instagram',          stage: 'quotation', desc: 'Gangsheet run for new streetwear drop — 22"x120" sheets' },
      { num: 'LEAD-2026-0003', email: 'mike@cedarevents.com',    source: 'Facebook Messenger', stage: 'artwork',   desc: 'DTF transfers for annual event merchandise — logos + full backs' },
      { num: 'LEAD-2026-0004', email: 'lisa@bluepeakgym.com',    source: 'WhatsApp',           stage: 'payment',   desc: 'Embroidered gym shirts for all 3 locations, 100 units each' },
      { num: 'LEAD-2026-0005', email: 'carlos@metroevents.com',  source: 'Phone',              stage: 'confirmed', desc: 'Full event kit: printed shirts, caps, and tote bags — 500 units' },
    ]

    for (const l of LEADS) {
      const custName = CUSTOMERS.find(c => c.email === l.email).name
      await client.query(`
        INSERT INTO leads (lead_number, customer_id, customer_name, source, stage, description, assigned_to)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (lead_number) DO NOTHING
      `, [l.num, custId[l.email], custName, l.source, l.stage, l.desc, salesUser.id])
    }

    // ── Orders ─────────────────────────────────────────────────────────────────

    // Order 1 — Apparel: Northstar Apparel (50 Custom Tees + 25 Polos)
    const app_subtotal = (50 * 12.00) + (25 * 18.00)                   // 1050.00
    const app_tax      = +((app_subtotal) * 0.07).toFixed(2)           //   73.50
    const app_total    = +(app_subtotal + app_tax).toFixed(2)           // 1123.50

    const { rows: [ord1] } = await client.query(`
      INSERT INTO orders
        (order_number, customer_id, order_type, status,
         order_date, due_date, payment_terms,
         subtotal, tax_pct, tax_amt, total,
         contact_name, contact_email, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id
    `, [
      'ORD-2026-0001', custId['john@northstar.com'], 'apparel', 'Confirmed',
      '2026-05-01', '2026-05-15', 'Net 15',
      app_subtotal, 7, app_tax, app_total,
      'John Mitchell', 'john@northstar.com', admin.id,
    ])

    if (ord1) {
      await client.query(`
        INSERT INTO order_items_apparel
          (order_id, item, color, size, qty, artwork_no, artwork_size, unit_price, amount, sort_order)
        VALUES
          ($1, 'Custom Printed Tee', 'White', 'M/L/XL', 50, 'AW-2026-001', '10"x10"', 12.00, 600.00, 0),
          ($1, 'Embroidered Polo',   'Navy',  'M/L/XL', 25, 'AW-2026-002',  '4"x4"',  18.00, 450.00, 1)
      `, [ord1.id])
    }

    // Order 2 — Gangsheet: Urban Stitch Co. (two sheet sizes)
    const gs_subtotal = (10 * 12.00) + (5 * 22.00)                     // 230.00
    const gs_tax      = +(gs_subtotal * 0.07).toFixed(2)               //  16.10
    const gs_total    = +(gs_subtotal + gs_tax).toFixed(2)             // 246.10

    const { rows: [ord2] } = await client.query(`
      INSERT INTO orders
        (order_number, customer_id, order_type, status,
         order_date, due_date, payment_terms,
         subtotal, tax_pct, tax_amt, total,
         contact_name, contact_email, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id
    `, [
      'ORD-2026-0002', custId['sarah@urbanstitch.com'], 'gangsheet', 'In Production',
      '2026-05-03', '2026-05-18', 'Due on Receipt',
      gs_subtotal, 7, gs_tax, gs_total,
      'Sarah Kim', 'sarah@urbanstitch.com', salesUser.id,
    ])

    if (ord2) {
      await client.query(`
        INSERT INTO order_items_gangsheet
          (order_id, size, no_artworks, qty, price_per_sheet, amount, sort_order)
        VALUES
          ($1, '22"x60"',  4, 10, 12.00, 120.00, 0),
          ($1, '22"x120"', 8,  5, 22.00, 110.00, 1)
      `, [ord2.id])
    }

    // Order 3 — DTF: Cedar Events (logo, full back, sleeve)
    const dtf_subtotal = (100 * 0.75) + (50 * 3.00) + (100 * 0.50)    // 275.00
    const dtf_tax      = +(dtf_subtotal * 0.07).toFixed(2)             //  19.25
    const dtf_total    = +(dtf_subtotal + dtf_tax).toFixed(2)          // 294.25

    const { rows: [ord3] } = await client.query(`
      INSERT INTO orders
        (order_number, customer_id, order_type, status,
         order_date, due_date, payment_terms,
         subtotal, tax_pct, tax_amt, total,
         contact_name, contact_email, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id
    `, [
      'ORD-2026-0003', custId['mike@cedarevents.com'], 'dtf', 'Ready to Ship',
      '2026-05-05', '2026-05-20', 'Due on Receipt',
      dtf_subtotal, 7, dtf_tax, dtf_total,
      'Mike Chen', 'mike@cedarevents.com', salesUser.id,
    ])

    if (ord3) {
      await client.query(`
        INSERT INTO order_items_dtf
          (order_id, artwork_name, size, qty, unit_price, amount, sort_order)
        VALUES
          ($1, 'Cedar Events Logo',  '4"x4"',   100, 0.75,  75.00, 0),
          ($1, 'Full Back Print',    '12"x12"',   50, 3.00, 150.00, 1),
          ($1, 'Sleeve Accent',      '3"x3"',    100, 0.50,  50.00, 2)
      `, [ord3.id])
    }

    // ── Invoices ───────────────────────────────────────────────────────────────

    // Invoice 1: apparel order — Sent (awaiting payment)
    if (ord1) {
      await client.query(`
        INSERT INTO invoices
          (invoice_number, order_id, customer_id, status,
           issue_date, due_date,
           subtotal, tax_amt, total, amount_paid, balance_due, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (invoice_number) DO NOTHING
      `, [
        'INV-2026-0001', ord1.id, custId['john@northstar.com'], 'Sent',
        '2026-05-01', '2026-05-16',
        app_subtotal, app_tax, app_total, 0, app_total, admin.id,
      ])
    }

    // Invoice 2: gangsheet order — Paid in full
    if (ord2) {
      await client.query(`
        INSERT INTO invoices
          (invoice_number, order_id, customer_id, status,
           issue_date, due_date,
           subtotal, tax_amt, total, amount_paid, balance_due, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (invoice_number) DO NOTHING
      `, [
        'INV-2026-0002', ord2.id, custId['sarah@urbanstitch.com'], 'Paid',
        '2026-05-03', '2026-05-03',
        gs_subtotal, gs_tax, gs_total, gs_total, 0, salesUser.id,
      ])
    }

    // ── Products ───────────────────────────────────────────────────────────────
    const PRODUCTS = [
      { sku: 'PRD-DTF-0001', name: 'Standard DTF Transfer',     product_type: 'DTF',        base_price: 0.75,  stock_qty: 5000 },
      { sku: 'PRD-GNG-0001', name: 'Gangsheet 22"x60"',         product_type: 'Gangsheet',  base_price: 12.00, stock_qty:  200 },
      { sku: 'PRD-GNG-0002', name: 'Gangsheet 22"x120"',        product_type: 'Gangsheet',  base_price: 22.00, stock_qty:  100 },
      { sku: 'PRD-APP-0001', name: 'Custom Printed Tee',         product_type: 'Apparel',    base_price: 12.00, stock_qty:  300 },
      { sku: 'PRD-APP-0002', name: 'Embroidered Polo',           product_type: 'Apparel',    base_price: 18.00, stock_qty:  150 },
      { sku: 'PRD-EMB-0001', name: 'Custom Embroidery Patch',    product_type: 'Embroidery', base_price:  4.50, stock_qty:  500 },
    ]

    for (const p of PRODUCTS) {
      await client.query(`
        INSERT INTO products (sku, name, product_type, base_price, stock_qty, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (sku) DO NOTHING
      `, [p.sku, p.name, p.product_type, p.base_price, p.stock_qty, admin.id])
    }

    await client.query('COMMIT')

    console.log('\n✅  Seed complete\n')
    console.log('  Users')
    console.log('  ─────────────────────────────────────────')
    console.log('  Admin:       admin@decoinks.com  /  Admin@1234')
    console.log('  Sales:       maria@decoinks.com  /  Sales@1234')
    console.log('  Production:  james@decoinks.com  /  Prod@1234')
    console.log('\n  Data')
    console.log('  ─────────────────────────────────────────')
    console.log(`  ${CUSTOMERS.length} customers, ${LEADS.length} leads, 3 orders, 2 invoices, ${PRODUCTS.length} products\n`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌  Seed failed:', err.message)
    if (err.detail) console.error('   detail:', err.detail)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
