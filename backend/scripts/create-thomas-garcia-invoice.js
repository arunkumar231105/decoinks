#!/usr/bin/env node
/**
 * One-off: create the Thomas Garcia apparel invoice from the details supplied
 * by the owner (style DG001, black, two designs, 30 pcs @ $8.00 = $240.00).
 *
 * Creates the customer if missing, then the invoice and its line items — one
 * row per design/size so the sizes read clearly on the printed invoice.
 *
 * Idempotent: re-running does nothing once the invoice exists.
 *
 * Usage:
 *   node backend/scripts/create-thomas-garcia-invoice.js            (dry-run)
 *   node backend/scripts/create-thomas-garcia-invoice.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const CUSTOMER = 'Thomas Garcia'
const UNIT_PRICE = 8.00
const STYLE = {
  description: '180G Adult 100% Cotton T-Shirt',
  brand: 'DIGI',
  model: 'DG001',
  category: 'T-Shirt',
  color: 'Black',
  // Same catalogue style the other DG001 invoices reference.
  catalog_style_id: 'ce9c108d-d49d-45ec-824f-cc40759d3a47',
  style_description: 'T-Shirt | 100% Cotton | 180.00 GSM',
}

// design → sizes, exactly as supplied
const LINES = [
  { design: 'Memory Design',      size: 'Medium', qty: 2 },
  { design: 'Memory Design',      size: '2XL',    qty: 2 },
  { design: 'Memory Design',      size: '4XL',    qty: 1 },
  { design: 'Fuck Around Design', size: 'L',      qty: 5 },
  { design: 'Fuck Around Design', size: 'XL',     qty: 12 },
  { design: 'Fuck Around Design', size: '2XL',    qty: 8 },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const qty = LINES.reduce((s, l) => s + l.qty, 0)
    const total = +(qty * UNIT_PRICE).toFixed(2)
    console.log(`${CUSTOMER} — ${LINES.length} lines, ${qty} pcs @ $${UNIT_PRICE.toFixed(2)} = $${total.toFixed(2)}`)
    LINES.forEach(l => console.log(`   ${l.design.padEnd(20)} ${String(l.size).padEnd(7)} x${l.qty}`))

    const existing = await client.query(
      `SELECT invoice_number FROM invoices WHERE customer_name = $1 AND total = $2`, [CUSTOMER, total])
    if (existing.rowCount) { console.log(`\nAlready exists: ${existing.rows[0].invoice_number}`); return }

    if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to create.'); return }

    const { rows: [meta] } = await client.query(
      `SELECT (SELECT created_by FROM invoices WHERE created_by IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS created_by`)

    await client.query('BEGIN')

    // Customer
    let { rows: [cust] } = await client.query(
      `SELECT id FROM customers WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`, [CUSTOMER])
    if (!cust) {
      const custNo = (await client.query(
        `SELECT 'CUST-2026-' || lpad((COUNT(*) + 57)::text, 4, '0') AS n
           FROM customers WHERE customer_number LIKE 'CUST-2026-%'`)).rows[0].n
      cust = (await client.query(
        `INSERT INTO customers (customer_number, name, first_name, last_name, country,
           same_as_shipping, status, created_by, customer_type, customer_segment)
         VALUES ($1,$2,'Thomas','Garcia','United States',TRUE,'active',$3,'individual','retail')
         RETURNING id`, [custNo, CUSTOMER, meta.created_by])).rows[0]
      console.log(`Created customer ${custNo}`)
    }

    // Invoice number: CUSTOMERNAME-NNNN, matching the existing manual invoices.
    const base = CUSTOMER.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12)
    const seq = (await client.query(
      `SELECT lpad((COUNT(*) + 1)::text, 4, '0') AS n FROM invoices WHERE invoice_number LIKE $1`,
      [`${base}-%`])).rows[0].n
    const invoiceNumber = `${base}-${seq}`

    const invoice = (await client.query(
      `INSERT INTO invoices (invoice_number, status, order_type, issue_date, due_date,
         subtotal, total, shipping_charges, original_shipping_charges, currency,
         payment_terms, amount_paid, balance_due,
         tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type,
         rush_charges, rush_services, customer_id, customer_name, created_by)
       VALUES ($1,'Draft','apparel',CURRENT_DATE,CURRENT_DATE,
               $2,$2,0,0,'USD','Due on Receipt',0,$2,
               0,0,0,0,0,'percentage',0,0,$3,$4,$5)
       RETURNING id, invoice_number`,
      [invoiceNumber, total, cust.id, CUSTOMER, meta.created_by])).rows[0]

    let sort = 0
    for (const l of LINES) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount,
           sizes, colors, brand, model, category, catalog_style_id, style_description,
           artwork_no, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [invoice.id, `${STYLE.description} — ${l.design}`, l.qty, UNIT_PRICE,
         +(l.qty * UNIT_PRICE).toFixed(2), l.size, STYLE.color, STYLE.brand, STYLE.model,
         STYLE.category, STYLE.catalog_style_id, STYLE.style_description, l.design, sort++])
    }

    await client.query('COMMIT')
    console.log(`\nCreated invoice ${invoice.invoice_number} — ${qty} pcs, $${total.toFixed(2)}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
