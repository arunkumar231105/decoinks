#!/usr/bin/env node

/*
 * Idempotent importer for the Custom_TShirt_PO_Orders workbook after it has
 * been exported to CSV. It creates one connected production chain per row:
 * Lead -> Customer -> Quotation -> paid Invoice -> confirmed Sales Order ->
 * draft Purchase Order. Unknown source values (email, supplier/vendor cost,
 * dates and payment method) are deliberately not invented.
 */
const fs = require('fs')
const { parse } = require('csv-parse/sync')
const { pool } = require('../src/config/db')

const SOURCE_SYSTEM = 'excel_custom_tshirt_po_orders'
const REQUIRED_HEADERS = ['Customer', 'Phone', 'Address', 'Product', 'Color', 'Print', 'Size Breakdown', 'Qty', 'Shipping', 'Total Received']
const NUMBER_TARGETS = {
  LEAD: ['leads', 'lead_number'], CUST: ['customers', 'customer_number'],
  QT: ['quotations', 'quote_number'], ORD: ['orders', 'order_number'], PO: ['purchase_orders', 'po_number'],
}

const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const clean = value => String(value ?? '').trim()

function parseAddress(raw) {
  const text = clean(raw)
  const match = text.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?),\s*(?:US|USA|United States)$/i)
  if (!match) return { address_line1: text, city: null, state: null, zip: null, country: 'United States' }
  return { address_line1: match[1], city: match[2], state: match[3].toUpperCase(), zip: match[4], country: 'United States' }
}

function sizePairs(text) {
  return [...clean(text).matchAll(/\b(XXXXL|XXXL|XXL|XL|XS|L|M|S)\s*:\s*(\d+)/gi)]
    .map(match => ({ size: match[1].toUpperCase(), qty: Number(match[2]) }))
}

function buildLines(row) {
  const product = clean(row.Product)
  const breakdown = clean(row['Size Breakdown'])
  const color = clean(row.Color)
  const print = clean(row.Print)
  let lines = []

  const colorSizeEntries = color.split(',').map(v => v.trim()).filter(v => /^(?:XS|S|M|L|XL|XXL|XXXL|XXXXL)\s+/i.test(v))
  if (colorSizeEntries.length) {
    lines = colorSizeEntries.map(entry => {
      const [size, ...colorParts] = entry.split(/\s+/)
      return { category: 'T-Shirt', item: 'T-Shirt', size, color: colorParts.join(' '), qty: 1 }
    })
  } else if (/hoodies?/i.test(product) && /\|/.test(breakdown)) {
    for (const segment of breakdown.split('|')) {
      const isHoodie = /hoodies?/i.test(segment)
      for (const pair of sizePairs(segment)) {
        lines.push({ category: isHoodie ? 'Hoodie' : 'T-Shirt', item: isHoodie ? 'Hoodie' : 'T-Shirt', size: pair.size, color: color === 'Not specified' ? null : color, qty: pair.qty })
      }
    }
  } else {
    lines = sizePairs(breakdown).map(pair => ({ category: /hoodie/i.test(product) ? 'Hoodie' : 'T-Shirt', item: /hoodie/i.test(product) ? 'Hoodie' : 'T-Shirt', size: pair.size, color: color === 'Not specified' ? null : color, qty: pair.qty }))
  }

  if (!lines.length) lines = [{ category: product || 'Apparel', item: product || 'Apparel', size: breakdown || null, color: color === 'Not specified' ? null : color || null, qty: Number(row.Qty) }]
  const expectedQty = Number(row.Qty)
  let parsedQty = lines.reduce((sum, line) => sum + line.qty, 0)
  if (parsedQty > expectedQty) throw new Error(`${row.Customer}: size quantities total ${parsedQty}, exceed expected ${expectedQty}`)
  if (parsedQty < expectedQty) {
    lines.push({
      category: /hoodie/i.test(product) && !/shirt/i.test(product) ? 'Hoodie' : 'T-Shirt',
      item: /hoodie/i.test(product) && !/shirt/i.test(product) ? 'Hoodie' : 'T-Shirt',
      size: null,
      color: color === 'Not specified' ? null : color || null,
      qty: expectedQty - parsedQty,
      source_warning: `Size breakdown accounted for ${parsedQty} of ${expectedQty} pieces`,
    })
    parsedQty = expectedQty
  }

  const productTotal = money(Number(row['Total Received']) - Number(row.Shipping))
  let allocated = 0
  return lines.map((line, index) => {
    const amount = index === lines.length - 1
      ? money(productTotal - allocated)
      : money(productTotal * line.qty / expectedQty)
    allocated = money(allocated + amount)
    return { ...line, amount, unit_price: money(amount / line.qty), print, description: `${line.item} · ${line.size || 'Size not provided'} · ${print || 'Print location not provided'}` }
  })
}

function validateRows(rows) {
  if (!rows.length) throw new Error('Workbook contains no data rows')
  for (const header of REQUIRED_HEADERS) if (!(header in rows[0])) throw new Error(`Missing required column: ${header}`)
  return rows.map((row, index) => {
    const normalized = { ...row, __row: index + 2 }
    normalized.Customer = clean(row.Customer)
    normalized.Phone = clean(row.Phone).replace(/\.0$/, '')
    normalized.Qty = Number(row.Qty)
    normalized.Shipping = money(row.Shipping)
    normalized['Total Received'] = money(row['Total Received'])
    if (!normalized.Customer) throw new Error(`Row ${normalized.__row}: customer is required`)
    if (!Number.isInteger(normalized.Qty) || normalized.Qty <= 0) throw new Error(`Row ${normalized.__row}: quantity must be a positive whole number`)
    if (normalized.Shipping < 0 || normalized['Total Received'] < normalized.Shipping) throw new Error(`Row ${normalized.__row}: invalid financial values`)
    normalized.address = parseAddress(row.Address)
    normalized.lines = buildLines(normalized)
    normalized.sourceKey = `custom-tshirt-po-orders:row:${normalized.__row}:${normalized.Customer.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    return normalized
  })
}

async function nextNumber(client, prefix) {
  const [table, column] = NUMBER_TARGETS[prefix]
  const year = new Date().getUTCFullYear()
  const scope = `${prefix}-${year}`
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])
  await client.query('INSERT INTO counters(scope,last_value) VALUES($1,0) ON CONFLICT(scope) DO NOTHING', [scope])
  const max = await client.query(`SELECT COALESCE(MAX(CAST(SPLIT_PART(${column}, '-', 3) AS INTEGER)),0)::bigint value FROM ${table} WHERE ${column} ~ $1`, [`^${scope}-[0-9]+$`])
  const claimed = await client.query('UPDATE counters SET last_value=GREATEST(last_value,$2)+1,updated_at=NOW() WHERE scope=$1 RETURNING last_value', [scope, max.rows[0].value])
  return `${scope}-${String(claimed.rows[0].last_value).padStart(4, '0')}`
}

function invoicePrefix(name) {
  return clean(name).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join('').slice(0, 12) || 'CUST'
}

async function nextInvoiceNumber(client, customerName) {
  const prefix = invoicePrefix(customerName)
  const scope = `INV:${prefix}`
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope])
  await client.query('INSERT INTO counters(scope,last_value) VALUES($1,0) ON CONFLICT(scope) DO NOTHING', [scope])
  const max = await client.query("SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number,'-',2) AS INTEGER)),0)::bigint value FROM invoices WHERE invoice_number ~ $1", [`^${prefix}-[0-9]+$`])
  const claimed = await client.query('UPDATE counters SET last_value=GREATEST(last_value,$2)+1,updated_at=NOW() WHERE scope=$1 RETURNING last_value', [scope, max.rows[0].value])
  return `${prefix}-${String(claimed.rows[0].last_value).padStart(4, '0')}`
}

async function insertLineItems(client, ids, lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    await client.query(`INSERT INTO quotation_items(quotation_id,category,description,qty,unit_price,amount,sort_order,sizes,colors,decoration_method,product_type,unit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Custom Printed Apparel','pcs')`, [ids.quote, line.category, line.description, line.qty, line.unit_price, line.amount, i, line.size, line.color, line.print])
    await client.query(`INSERT INTO invoice_items(invoice_id,category,description,qty,unit_price,amount,sort_order,sizes,colors,style_description)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ids.invoice, line.category, line.item, line.qty, line.unit_price, line.amount, i, line.size, line.color, line.description])
    await client.query(`INSERT INTO order_items_apparel(order_id,category,item,color,size,qty,unit_price,amount,sort_order,style_description)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ids.order, line.category, line.item, line.color, line.size, line.qty, line.unit_price, line.amount, i, line.description])
    await client.query(`INSERT INTO purchase_order_items(po_id,item_name,description,qty_ordered,unit_price,line_total,uom,remarks,sort_order,category,color,size,print_type)
      VALUES($1,$2,$3,$4,0,0,'pcs',$5,$6,$7,$8,$9,$10)`, [ids.po, line.item, line.description, line.qty, 'Vendor unit cost was not provided in source workbook', i, line.category, line.color, line.size, line.print])
  }
}

async function importRow(client, row, actorId) {
  const duplicate = await client.query('SELECT quote_number FROM quotations WHERE source_entry_key=$1', [row.sourceKey])
  if (duplicate.rows[0]) return { skipped: true, customer: row.Customer, quote: duplicate.rows[0].quote_number }

  const marker = `[import:${row.sourceKey}]`
  const leadNumber = await nextNumber(client, 'LEAD')
  const customerNumber = await nextNumber(client, 'CUST')
  const quoteNumber = await nextNumber(client, 'QT')
  const orderNumber = await nextNumber(client, 'ORD')
  const poNumber = await nextNumber(client, 'PO')
  const invoiceNumber = await nextInvoiceNumber(client, row.Customer)
  const productTotal = money(row['Total Received'] - row.Shipping)
  const requirement = `${row.Product}; color: ${row.Color}; print: ${row.Print}; sizes: ${row['Size Breakdown']}; quantity: ${row.Qty}`

  const lead = await client.query(`INSERT INTO leads(lead_number,customer_name,source,stage,status,assigned_to,has_artwork,phone,whatsapp,shipping_address,billing_address,customer_intent,product_interest,estimated_value,internal_notes,description,updated_by)
    VALUES($1,$2,'Phone','confirmed','Confirmed',$3,FALSE,$4,$4,$5,$5,'Ready to Buy','Custom Printed Apparel',$6,$7,$8,$3) RETURNING id,display_number`,
    [leadNumber, row.Customer, actorId, row.Phone || null, row.Address, row['Total Received'], marker, requirement])
  const leadId = lead.rows[0].id
  const customer = await client.query(`INSERT INTO customers(customer_number,lead_id,name,phone,whatsapp,address_line1,city,state,zip,country,billing_address,same_as_shipping,buyer_type,internal_notes,source,created_by,first_name,last_name,company_phone_number,mobile_number,customer_segment,customer_type,payment_terms,assigned_agent_id,status)
    VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,TRUE,'customer',$11,$12,$13,$14,$15,$4,$4,'Customer','individual','Due on Receipt',$13,'active') RETURNING id`,
    [customerNumber, leadId, row.Customer, row.Phone || null, row.address.address_line1, row.address.city, row.address.state, row.address.zip, row.address.country, row.Address, marker, 'Custom_TShirt_PO_Orders.xlsx', actorId, row.Customer.split(/\s+/)[0], row.Customer.split(/\s+/).slice(1).join(' ') || null])
  const customerId = customer.rows[0].id
  await client.query('UPDATE leads SET customer_id=$1 WHERE id=$2', [customerId, leadId])

  const quote = await client.query(`INSERT INTO quotations(quote_number,lead_id,customer_id,status,subtotal,total,created_by,customer_name,contact_number,whatsapp,customer_category,customer_source,shipping_country,shipping_state,shipping_city,zip_code,shipping_address,billing_address,sales_agent_id,internal_notes,customer_requirement_summary,quote_estimate,order_type,currency,approved_at,estimated_shipping,payment_terms,shipping_amount,source_system,source_entry_key)
    VALUES($1,$2,$3,'Approved',$4,$4,$5,$6,$7,$7,'Individual','Excel Import',$8,$9,$10,$11,$12,$12,$5,$13,$14,$4,'apparel','USD',NOW(),$15,'Due on Receipt',$15,$16,$17) RETURNING id`,
    [quoteNumber, leadId, customerId, row['Total Received'], actorId, row.Customer, row.Phone || null, row.address.country, row.address.state, row.address.city, row.address.zip, row.Address, marker, requirement, row.Shipping, SOURCE_SYSTEM, row.sourceKey])
  const quoteId = quote.rows[0].id

  const invoice = await client.query(`INSERT INTO invoices(invoice_number,internal_no,quote_id,customer_id,status,issue_date,subtotal,total,amount_paid,balance_due,notes,created_by,customer_name,contact_number,billing_address,shipping_address,order_type,payment_terms,payment_method,currency,shipping_charges,original_shipping_charges,source_system,source_entry_key,paid_at)
    VALUES($1,$2,$3,$4,'Paid',CURRENT_DATE,$5,$5,$5,0,$6,$7,$8,$9,$10,$10,'apparel','Due on Receipt','other','USD',$11,$11,$12,$13,NOW()) RETURNING id`,
    [invoiceNumber, `INV-INT-${invoiceNumber}`, quoteId, customerId, row['Total Received'], marker, actorId, row.Customer, row.Phone || null, row.Address, row.Shipping, SOURCE_SYSTEM, row.sourceKey])
  const invoiceId = invoice.rows[0].id
  await client.query(`INSERT INTO payments(invoice_id,amount,payment_method,notes,recorded_by) VALUES($1,$2,'other',$3,$4)`, [invoiceId, row['Total Received'], 'Imported paid amount; payment method was not provided in source workbook', actorId])

  const order = await client.query(`INSERT INTO orders(order_number,quotation_id,invoice_id,customer_id,order_type,status,payment_status,payment_method,payment_terms,currency,order_date,shipping_charges,subtotal,total,notes,shipping_name,shipping_address,contact_name,contact_phone,assigned_to,created_by,source_system,source_entry_key,total_print_locations)
    VALUES($1,$2,$3,$4,'apparel','Confirmed','Paid','other','Due on Receipt','USD',CURRENT_DATE,$5,$6,$6,$7,$8,$9,$8,$10,$11,$11,$12,$13,$14) RETURNING id`,
    [orderNumber, quoteId, invoiceId, customerId, row.Shipping, row['Total Received'], marker, row.Customer, row.Address, row.Phone || null, actorId, SOURCE_SYSTEM, row.sourceKey, /front.*back|back.*front/i.test(row.Print) ? 2 : 1])
  const orderId = order.rows[0].id
  await client.query('UPDATE invoices SET order_id=$1 WHERE id=$2', [orderId, invoiceId])

  const po = await client.query(`INSERT INTO purchase_orders(po_number,status,order_date,subtotal,total,grand_total,notes,created_by,currency,priority,shipping_address,billing_address,order_id,po_type,communication_method,payment_status,customer_id,source_system,source_entry_key,source_entry_index,net_product_amount,shipping_charge,payment_received,source_payment_status,imported_at,total_artworks)
    VALUES($1,'Draft',CURRENT_DATE,0,0,0,$2,$3,'USD','Medium',$4,$4,$5,'apparel','email','Unpaid',$6,$7,$8,$9,0,$10,$11,'Paid',NOW(),0) RETURNING id`,
    [poNumber, `${marker}\nSupplier/vendor and vendor costs were not provided in the source workbook. Customer product amount: $${productTotal.toFixed(2)}.`, actorId, row.Address, orderId, customerId, SOURCE_SYSTEM, row.sourceKey, row.__row, row.Shipping, row['Total Received']])
  const poId = po.rows[0].id
  await client.query('INSERT INTO po_orders(po_id,order_id) VALUES($1,$2)', [poId, orderId])
  await client.query("INSERT INTO po_status_history(po_id,from_status,to_status,changed_by,comment) VALUES($1,NULL,'Draft',$2,'Imported from Custom_TShirt_PO_Orders.xlsx')", [poId, actorId])
  await insertLineItems(client, { quote: quoteId, invoice: invoiceId, order: orderId, po: poId }, row.lines)
  await client.query(`UPDATE customers SET total_orders=(SELECT COUNT(*) FROM orders WHERE customer_id=$1 AND deleted_at IS NULL),lifetime_value=(SELECT COALESCE(SUM(total),0) FROM orders WHERE customer_id=$1 AND deleted_at IS NULL),last_order_at=NOW() WHERE id=$1`, [customerId])

  return { customer: row.Customer, lead: lead.rows[0].display_number, quote: quoteNumber, invoice: invoiceNumber, order: orderNumber, po: poNumber, total: row['Total Received'], lines: row.lines.length }
}

async function main() {
  const csvPath = process.argv.find(arg => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1])
  const dryRun = process.argv.includes('--dry-run')
  if (!csvPath || !fs.existsSync(csvPath)) throw new Error('Usage: node scripts/import-custom-tshirt-orders.js <workbook.csv> [--dry-run]')
  const rows = validateRows(parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, trim: true }))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const actor = await client.query("SELECT id FROM users WHERE is_active=TRUE ORDER BY CASE WHEN role='Admin' THEN 0 ELSE 1 END,created_at LIMIT 1")
    if (!actor.rows[0]) throw new Error('No active system user found')
    const results = []
    for (const row of rows) results.push(await importRow(client, row, actor.rows[0].id))
    if (dryRun) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    console.log(JSON.stringify({ dry_run: dryRun, source_rows: rows.length, imported: results.filter(r => !r.skipped).length, skipped: results.filter(r => r.skipped).length, results }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
module.exports = { parseAddress, buildLines, validateRows }
