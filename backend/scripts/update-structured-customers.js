/*
 * Update existing customers from the user-supplied structured customer CSV.
 *
 * Customer UUIDs are preserved so quotations, invoices, orders, POs, leads,
 * and artwork links remain intact. The script refuses ambiguous, missing, or
 * duplicate matches and supports a full transactional dry run.
 */
require('dotenv').config()

const fs = require('fs')
const { parse } = require('csv-parse/sync')
const { getClient, pool } = require('../src/config/db')

const dryRun = process.argv.includes('--dry-run')
const csvPath = process.argv.slice(2).find(arg => !arg.startsWith('--'))

if (!csvPath) {
  throw new Error('Usage: node scripts/update-structured-customers.js <customers.csv> [--dry-run]')
}

const requiredColumns = [
  'First Name',
  'Last Name',
  'Company Name',
  'Email Address',
  'Company Phone',
  'Mobile Number',
  'WhatsApp Number',
  'Preferred Language',
  'Customer Segment',
  'Loyalty Tier',
  'Shipping Address Line 1',
  'Shipping Address Line 2',
  'Shipping City',
  'Shipping State',
  'Shipping ZIP',
  'Shipping Country',
  'Billing Address Line 1',
  'Billing Address Line 2',
  'Billing City',
  'Billing State',
  'Billing ZIP',
  'Billing Country',
]

const rows = parse(fs.readFileSync(csvPath, 'utf8'), {
  columns: true,
  skip_empty_lines: true,
  bom: true,
  trim: true,
})

if (!rows.length) throw new Error('Customer CSV contains no data rows')
for (const column of requiredColumns) {
  if (!Object.prototype.hasOwnProperty.call(rows[0], column)) {
    throw new Error(`Customer CSV is missing required column: ${column}`)
  }
}

const clean = value => {
  const result = String(value || '').trim()
  return result || null
}

const normalizeName = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const normalizeCountry = value => {
  const country = clean(value)
  if (!country) return null
  if (/^(usa|u\.s\.a\.|us|united states(?: of america)?)$/i.test(country)) return 'United States'
  return country
}

function customerName(row) {
  return clean(row['Company Name'])
    || [clean(row['First Name']), clean(row['Last Name'])].filter(Boolean).join(' ')
}

function customerMatchKeys(customer) {
  return new Set([
    customer.name,
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    customer.company,
    customer.company_name,
  ].map(normalizeName).filter(Boolean))
}

function sourceMatchKeys(row) {
  return new Set([
    customerName(row),
    [clean(row['First Name']), clean(row['Last Name'])].filter(Boolean).join(' '),
    clean(row['Company Name']),
  ].map(normalizeName).filter(Boolean))
}

function addressesFor(row) {
  return {
    shipping: {
      line1: clean(row['Shipping Address Line 1']),
      line2: clean(row['Shipping Address Line 2']),
      city: clean(row['Shipping City']),
      state: clean(row['Shipping State']),
      zipcode: clean(row['Shipping ZIP']),
      country: normalizeCountry(row['Shipping Country']),
    },
    billing: {
      line1: clean(row['Billing Address Line 1']),
      line2: clean(row['Billing Address Line 2']),
      city: clean(row['Billing City']),
      state: clean(row['Billing State']),
      zipcode: clean(row['Billing ZIP']),
      country: normalizeCountry(row['Billing Country']),
    },
  }
}

function addressText(address) {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.zipcode,
    address.country,
  ].filter(Boolean).join(', ') || null
}

function hasAddressData(address) {
  return Boolean(address.line1 || address.line2 || address.city || address.state || address.zipcode)
}

async function databaseState(client) {
  const counts = (await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM customers) AS customers,
       (SELECT COUNT(*)::int FROM customers WHERE deleted_at IS NULL) AS active_customers,
       (SELECT COUNT(*)::int FROM customer_addresses) AS customer_addresses,
       (SELECT COUNT(*)::int FROM leads) AS leads,
       (SELECT COUNT(*)::int FROM quotations) AS quotations,
       (SELECT COUNT(*)::int FROM invoices) AS invoices,
       (SELECT COUNT(*)::int FROM orders) AS orders,
       (SELECT COUNT(*)::int FROM purchase_orders) AS purchase_orders`
  )).rows[0]

  const linkFingerprints = {}
  for (const table of ['leads', 'quotations', 'invoices', 'orders', 'purchase_orders', 'artwork_vault_assets']) {
    linkFingerprints[table] = (await client.query(
      `SELECT md5(COALESCE(string_agg(id::text || ':' || COALESCE(customer_id::text, ''), ',' ORDER BY id), ''))
         AS fingerprint
       FROM ${table}`
    )).rows[0].fingerprint
  }
  return { counts, link_fingerprints: linkFingerprints }
}

async function upsertAddress(client, customerId, type, address) {
  const existing = (await client.query(
    `SELECT id
     FROM customer_addresses
     WHERE customer_id=$1 AND address_type=$2
     ORDER BY is_default DESC, created_at, id`,
    [customerId, type]
  )).rows

  if (existing.length > 1) {
    throw new Error(`Customer ${customerId} has multiple ${type} addresses; refusing ambiguous update`)
  }

  if (existing.length) {
    await client.query(
      `UPDATE customer_addresses
       SET line1=$1,line2=$2,city=$3,state=$4,zipcode=$5,country=$6,is_default=TRUE
       WHERE id=$7`,
      [address.line1, address.line2, address.city, address.state, address.zipcode,
        address.country, existing[0].id]
    )
    return 'updated'
  }

  await client.query(
    `INSERT INTO customer_addresses
       (customer_id,address_type,line1,line2,city,state,zipcode,country,is_default)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
    [customerId, type, address.line1, address.line2, address.city, address.state,
      address.zipcode, address.country]
  )
  return 'created'
}

async function main() {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')

    const before = await databaseState(client)
    const customers = (await client.query(
      `SELECT id,customer_number,name,first_name,last_name,company,company_name
       FROM customers
       WHERE deleted_at IS NULL
       ORDER BY name,id`
    )).rows

    const mappings = []
    const usedCustomerIds = new Set()
    for (const [index, row] of rows.entries()) {
      const keys = sourceMatchKeys(row)
      const matches = customers.filter(customer =>
        [...customerMatchKeys(customer)].some(key => keys.has(key))
      )
      if (matches.length !== 1) {
        throw new Error(
          `CSV row ${index + 2} (${customerName(row)}): expected one active customer match, found ${matches.length}`
        )
      }
      const customer = matches[0]
      if (usedCustomerIds.has(customer.id)) {
        throw new Error(`CSV row ${index + 2} reuses customer ${customer.customer_number}`)
      }
      usedCustomerIds.add(customer.id)
      mappings.push({ rowNumber: index + 2, row, customer })
    }

    if (mappings.length !== rows.length) throw new Error('Not all CSV rows were mapped')

    const stats = {
      csv_rows: rows.length,
      matched_customers: mappings.length,
      customers_updated: 0,
      shipping_addresses_updated: 0,
      shipping_addresses_created: 0,
      billing_addresses_updated: 0,
      billing_addresses_created: 0,
    }
    const mapped = []

    for (const { rowNumber, row, customer } of mappings) {
      const name = customerName(row)
      const firstName = clean(row['First Name'])
      const lastName = clean(row['Last Name'])
      const companyName = clean(row['Company Name'])
      const email = clean(row['Email Address'])
      const companyPhone = clean(row['Company Phone'])
      const mobile = clean(row['Mobile Number'])
      const whatsapp = clean(row['WhatsApp Number'])
      const preferredLanguage = clean(row['Preferred Language'])
      const segment = clean(row['Customer Segment'])
      const tier = clean(row['Loyalty Tier'])
      const { shipping, billing } = addressesFor(row)
      const billingText = hasAddressData(billing) ? addressText(billing) : null

      await client.query(
        `UPDATE customers SET
           name=$1,
           first_name=$2,
           last_name=$3,
           company=$4,
           company_name=$4,
           email=$5,
           company_phone_number=$6,
           mobile_number=$7,
           phone=COALESCE($6::varchar,$7::varchar),
           whatsapp=$8,
           preferred_language=$9,
           customer_segment=$10,
           buyer_type=$10,
           tier=$11,
           address_line1=$12,
           city=$13,
           state=$14,
           zip=$15,
           country=$16,
           billing_address=$17,
           same_as_shipping=FALSE,
           updated_at=NOW()
         WHERE id=$18`,
        [
          name, firstName, lastName, companyName, email, companyPhone, mobile, whatsapp,
          preferredLanguage, segment, tier, shipping.line1, shipping.city, shipping.state,
          shipping.zipcode, shipping.country, billingText, customer.id,
        ]
      )
      stats.customers_updated++

      const shippingResult = await upsertAddress(client, customer.id, 'shipping', shipping)
      stats[`shipping_addresses_${shippingResult}`]++

      if (hasAddressData(billing)) {
        const billingResult = await upsertAddress(client, customer.id, 'billing', billing)
        stats[`billing_addresses_${billingResult}`]++
      }

      mapped.push({
        csv_row: rowNumber,
        customer_id: customer.id,
        customer_number: customer.customer_number,
        previous_name: customer.name,
        name,
      })
    }

    const after = await databaseState(client)
    for (const key of ['customers', 'active_customers', 'leads', 'quotations', 'invoices', 'orders', 'purchase_orders']) {
      if (before.counts[key] !== after.counts[key]) {
        throw new Error(`Integrity check failed: ${key} count changed from ${before.counts[key]} to ${after.counts[key]}`)
      }
    }
    for (const [table, fingerprint] of Object.entries(before.link_fingerprints)) {
      if (after.link_fingerprints[table] !== fingerprint) {
        throw new Error(`Integrity check failed: ${table}.customer_id links changed`)
      }
    }

    const validation = (await client.query(
      `SELECT
         COUNT(*)::int AS mapped,
         COUNT(*) FILTER (WHERE ca.id IS NOT NULL)::int AS shipping_address_rows,
         COUNT(*) FILTER (
           WHERE c.first_name IS NOT DISTINCT FROM source.first_name
             AND c.last_name IS NOT DISTINCT FROM source.last_name
             AND c.company_name IS NOT DISTINCT FROM source.company_name
             AND c.address_line1 IS NOT DISTINCT FROM source.line1
             AND c.city IS NOT DISTINCT FROM source.city
             AND c.state IS NOT DISTINCT FROM source.state
             AND c.zip IS NOT DISTINCT FROM source.zipcode
         )::int AS exact_core_matches
       FROM jsonb_to_recordset($1::jsonb)
         AS source(customer_id uuid,first_name text,last_name text,company_name text,line1 text,city text,state text,zipcode text)
       JOIN customers c ON c.id=source.customer_id
       LEFT JOIN customer_addresses ca
         ON ca.customer_id=c.id AND ca.address_type='shipping' AND ca.is_default`,
      [JSON.stringify(mappings.map(({ row, customer }) => {
        const shipping = addressesFor(row).shipping
        return {
          customer_id: customer.id,
          first_name: clean(row['First Name']),
          last_name: clean(row['Last Name']),
          company_name: clean(row['Company Name']),
          ...shipping,
        }
      }))]
    )).rows[0]

    if (validation.mapped !== rows.length
      || validation.shipping_address_rows !== rows.length
      || validation.exact_core_matches !== rows.length) {
      throw new Error(`Post-update validation failed: ${JSON.stringify(validation)}`)
    }

    if (dryRun) await client.query('ROLLBACK')
    else await client.query('COMMIT')

    console.log(JSON.stringify({
      mode: dryRun ? 'dry-run' : 'committed',
      stats,
      validation,
      before,
      after,
      mappings: mapped,
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
