/*
 * Enrich customers already linked to the April-June DTF commercial history.
 * The PO link is authoritative; names alone are never used to create customers.
 * Cleaned CSV addresses take precedence over the workbook PO Summary export.
 */
require('dotenv').config()
const fs = require('fs')
const { parse } = require('csv-parse/sync')
const { getClient, pool } = require('../src/config/db')

const SOURCE = 'decoinks_dtf_po_master_apr_jun_2026'
const ENRICHMENT_SOURCE = 'dtf_customer_enrichment_apr_jun_2026'
const dryRun = process.argv.includes('--dry-run')
const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (paths.length !== 2) {
  throw new Error('Usage: node scripts/enrich-dtf-customers.js <po-summary.csv> <cleaned.csv> [--dry-run]')
}

const matrix = parse(fs.readFileSync(paths[0], 'utf8'), {
  skip_empty_lines: true,
  relax_column_count: true,
  bom: true,
  trim: true,
})
const summaryHeader = matrix[1]
const summaryRows = matrix.slice(2)
  .filter(row => /^TSI\s+/i.test(row[0] || ''))
  .map(row => Object.fromEntries(summaryHeader.map((key, index) => [key, row[index] || null])))
const cleanedRows = parse(fs.readFileSync(paths[1], 'utf8'), {
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
  bom: true,
  trim: true,
}).filter(row => /^TSI\s+/i.test(row['PO Number'] || ''))

const cleanByPo = new Map(cleanedRows.map(row => [row['PO Number'], row]))
const sourceByPo = new Map(summaryRows.map(row => [row['PO Number'], row]))

const cityByRegion = {
  'NC:27542': 'Kenly',
  'AZ:86426': 'Fort Mohave',
  'NY:14218': 'Lackawanna',
  'MI:48823': 'East Lansing',
  'TX:76059': 'Keene',
  'MN:55912': 'Austin',
  'FL:34746': 'Kissimmee',
  'OH:44035': 'Elyria',
  'LA:70373': 'Larose',
  'CA:92831': 'Fullerton',
  'NY:': 'Brooklyn',
}

function normalizeAddress(value) {
  return String(value || '')
    .replace(/\b(?:USA|United States(?: of America)?)\b/ig, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseUsAddress(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim()
  if (!raw) return { raw: null, line1: null, line2: null, city: null, state: null, zip: null, country: 'United States' }

  const withoutCountry = raw
    .replace(/[,\s]*(?:USA|United States(?: of America)?)\s*$/i, '')
    .replace(/[,\s]+$/, '')
  const region = withoutCountry.match(/^(.*?)[,\s]+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\s*$/)
  if (!region) {
    return { raw, line1: withoutCountry, line2: null, city: null, state: null, zip: null, country: 'United States' }
  }

  let prefix = region[1].replace(/[,\s]+$/, '').trim()
  const state = region[2]
  const zip = region[3] || null
  const parts = prefix.split(/\s*,\s*/).filter(Boolean)
  let city
  let line1
  let line2 = null

  if (parts.length >= 2) {
    city = parts.pop()
    if (parts.length >= 2 && !/\d/.test(parts[0]) && /^\d/.test(parts[1])) {
      line2 = parts.shift()
    }
    line1 = parts.join(', ')
  } else {
    city = cityByRegion[`${state}:${zip || ''}`] || null
    if (city && prefix.toLowerCase().endsWith(city.toLowerCase())) {
      line1 = prefix.slice(0, -city.length).replace(/[,\s]+$/, '').trim()
    } else {
      line1 = prefix
    }
  }

  return { raw, line1: line1 || null, line2, city: city || null, state, zip, country: 'United States' }
}

function bestSourceForPo(poNumber) {
  const clean = cleanByPo.get(poNumber)
  const source = sourceByPo.get(poNumber)
  return {
    address: clean?.['Shipping Address'] || source?.['Ship To Address'] || null,
    sourceName: clean?.['Customer Name'] || source?.['Client Name'] || null,
  }
}

async function main() {
  const client = await getClient()
  const stats = { linked_customers: 0, enriched: 0, merged: 0, address_rows_updated: 0, address_rows_created: 0 }
  const enrichedCustomers = []
  try {
    await client.query('BEGIN')
    const before = (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers WHERE deleted_at IS NULL) AS customers,
         (SELECT COUNT(*)::int FROM leads) AS leads,
         (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM leads) AS lead_hash,
         (SELECT COUNT(*)::int FROM quotations) AS quotations,
         (SELECT COUNT(*)::int FROM orders) AS orders,
         (SELECT COUNT(*)::int FROM invoices) AS invoices,
         (SELECT COUNT(*)::int FROM purchase_orders WHERE deleted_at IS NULL) AS purchase_orders,
         (SELECT COALESCE(SUM(total),0)::numeric(12,2) FROM invoices) AS invoice_total`
    )).rows[0]

    const { rows: links } = await client.query(
      `SELECT po.source_po_number,po.source_entry_index,po.customer_id,c.name,c.created_at
       FROM purchase_orders po
       JOIN customers c ON c.id=po.customer_id
       WHERE po.source_system=$1 AND po.deleted_at IS NULL AND c.deleted_at IS NULL
       ORDER BY po.order_date,po.source_entry_index`,
      [SOURCE]
    )
    if (links.length !== 31) throw new Error(`Expected 31 linked PO entries, found ${links.length}`)

    const byCustomer = new Map()
    for (const link of links) {
      if (!byCustomer.has(link.customer_id)) byCustomer.set(link.customer_id, { ...link, poNumbers: [] })
      byCustomer.get(link.customer_id).poNumbers.push(link.source_po_number)
    }
    stats.linked_customers = byCustomer.size

    // Consolidate active source customers that have the same normalized shipping address.
    const addressGroups = new Map()
    for (const record of byCustomer.values()) {
      const candidates = record.poNumbers.map(bestSourceForPo).filter(item => item.address)
      const selected = candidates.find(item => cleanByPo.has(record.poNumbers[candidates.indexOf(item)])) || candidates[0]
      record.selected = selected || { address: null, sourceName: null }
      const key = normalizeAddress(record.selected.address)
      if (!key) continue
      if (!addressGroups.has(key)) addressGroups.set(key, [])
      addressGroups.get(key).push(record)
    }

    for (const group of addressGroups.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => {
        const aPaid = /Vellon/i.test(a.name) ? 1 : 0
        const bPaid = /Vellon/i.test(b.name) ? 1 : 0
        return bPaid - aPaid || new Date(a.created_at) - new Date(b.created_at)
      })
      const target = group[0]
      for (const duplicate of group.slice(1)) {
        for (const table of ['purchase_orders', 'quotations', 'orders', 'invoices', 'leads', 'artwork_vault_assets']) {
          await client.query(`UPDATE ${table} SET customer_id=$1 WHERE customer_id=$2`, [target.customer_id, duplicate.customer_id])
        }
        await client.query(`DELETE FROM customer_addresses WHERE customer_id=$1`, [duplicate.customer_id])
        await client.query(
          `UPDATE customers SET deleted_at=NOW(),internal_notes=concat_ws(E'\\n',internal_notes,$1::text) WHERE id=$2`,
          [`Merged into ${target.name} (${target.customer_id}) by ${ENRICHMENT_SOURCE}.`, duplicate.customer_id]
        )
        await client.query(
          `UPDATE customers SET internal_notes=CASE WHEN COALESCE(internal_notes,'') LIKE $1 THEN internal_notes
             ELSE concat_ws(E'\\n',internal_notes,$2::text) END WHERE id=$3`,
          [`%Merged alias ${duplicate.name}%`, `Merged alias ${duplicate.name}; source records preserved.`, target.customer_id]
        )
        for (const poNumber of duplicate.poNumbers) {
          target.poNumbers.push(poNumber)
        }
        byCustomer.delete(duplicate.customer_id)
        stats.merged++
      }
    }

    for (const record of byCustomer.values()) {
      const cleanedCandidate = record.poNumbers
        .map(poNumber => ({ poNumber, source: bestSourceForPo(poNumber) }))
        .find(item => cleanByPo.has(item.poNumber) && item.source.address)
      const selected = cleanedCandidate?.source || record.poNumbers.map(bestSourceForPo).find(item => item.address)
      if (!selected?.address) continue
      const address = parseUsAddress(selected.address)
      enrichedCustomers.push({
        customer: record.name,
        source_name: selected.sourceName,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: address.country,
      })

      await client.query(
        `UPDATE customers SET
           address_line1=$1,city=$2,state=$3,zip=$4,country=$5,
           internal_notes=CASE
             WHEN COALESCE(internal_notes,'') LIKE $6 THEN internal_notes
             ELSE concat_ws(E'\\n',internal_notes,$7::text)
           END,
           updated_at=NOW()
         WHERE id=$8`,
        [address.line1, address.city, address.state, address.zip, address.country,
         `%${ENRICHMENT_SOURCE}%`,
         `Shipping address enriched from ${ENRICHMENT_SOURCE}; raw address remains on linked PO records.`,
         record.customer_id]
      )

      const existingAddress = (await client.query(
        `SELECT id FROM customer_addresses
         WHERE customer_id=$1 AND address_type='shipping'
         ORDER BY is_default DESC,created_at LIMIT 1`,
        [record.customer_id]
      )).rows[0]
      if (existingAddress) {
        await client.query(
          `UPDATE customer_addresses SET line1=$1,line2=$2,city=$3,state=$4,zipcode=$5,country=$6,is_default=TRUE
           WHERE id=$7`,
          [address.line1, address.line2, address.city, address.state, address.zip, address.country, existingAddress.id]
        )
        stats.address_rows_updated++
      } else {
        await client.query(
          `INSERT INTO customer_addresses(customer_id,address_type,line1,line2,city,state,zipcode,country,is_default)
           VALUES($1,'shipping',$2,$3,$4,$5,$6,$7,TRUE)`,
          [record.customer_id, address.line1, address.line2, address.city, address.state, address.zip, address.country]
        )
        stats.address_rows_created++
      }
      stats.enriched++
    }

    // Recalculate customer commercial aggregates after any merge.
    await client.query(
      `UPDATE customers c SET total_orders=x.order_count,lifetime_value=x.revenue,last_order_at=x.last_order
       FROM (
         SELECT customer_id,COUNT(*)::int order_count,COALESCE(SUM(total),0) revenue,MAX(order_date)::timestamptz last_order
         FROM orders WHERE customer_id IS NOT NULL GROUP BY customer_id
       ) x
       WHERE c.id=x.customer_id AND c.deleted_at IS NULL`
    )

    const after = (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers WHERE deleted_at IS NULL) AS customers,
         (SELECT COUNT(*)::int FROM leads) AS leads,
         (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM leads) AS lead_hash,
         (SELECT COUNT(*)::int FROM quotations) AS quotations,
         (SELECT COUNT(*)::int FROM orders) AS orders,
         (SELECT COUNT(*)::int FROM invoices) AS invoices,
         (SELECT COUNT(*)::int FROM purchase_orders WHERE deleted_at IS NULL) AS purchase_orders,
         (SELECT COALESCE(SUM(total),0)::numeric(12,2) FROM invoices) AS invoice_total,
         (SELECT COUNT(*)::int FROM customers c
          WHERE c.deleted_at IS NULL AND c.id IN (
            SELECT DISTINCT customer_id FROM purchase_orders WHERE source_system=$1
          ) AND c.address_line1 IS NOT NULL AND c.city IS NOT NULL AND c.state IS NOT NULL
            AND c.country IS NOT NULL) AS structured_customers`,
      [SOURCE]
    )).rows[0]
    for (const key of ['leads', 'lead_hash', 'quotations', 'orders', 'invoices', 'purchase_orders', 'invoice_total']) {
      if (String(before[key]) !== String(after[key])) throw new Error(`Integrity check failed for ${key}: ${before[key]} -> ${after[key]}`)
    }
    if (after.structured_customers !== 18) {
      throw new Error(`Expected 18 customers with city/state/country; found ${after.structured_customers}`)
    }

    if (dryRun) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'committed', stats, enriched_customers: enrichedCustomers, before, after }, null, 2))
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
