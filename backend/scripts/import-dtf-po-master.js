/*
 * Idempotent importer for the Decoinks DTF PO master workbook.
 * Input is a JSON export with keys: po_summary, artwork_details,
 * shipping_payments, dashboard, qa_notes. Use --dry-run to roll back.
 */
require('dotenv').config()
const fs = require('fs')
const { getClient, pool } = require('../src/config/db')

const SOURCE = process.env.DTF_IMPORT_SOURCE || 'decoinks_dtf_po_master_apr_jun_2026'
const dryRun = process.argv.includes('--dry-run')
const inputPath = process.argv.slice(2).find(arg => !arg.startsWith('--'))
if (!inputPath) throw new Error('Usage: node scripts/import-dtf-po-master.js <input.json> [--dry-run]')
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'))

const money = value => value == null || value === '' || /^free$/i.test(String(value)) ? null : Number(value)
const number = value => value == null || value === '' ? null : Number(value)
const isoDate = value => {
  if (!value) return null
  const match = String(value).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (!match) return null
  const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' }
  return `${match[3]}-${months[match[2]]}-${String(match[1]).padStart(2, '0')}`
}
const splitName = name => {
  const parts = String(name || '').trim().split(/\s+/)
  return { first: parts[0] || null, last: parts.slice(1).join(' ') || null }
}
const fragments = text => String(text || '').split(';').map(value => value.trim()).filter(Boolean).map((value, index) => {
  const match = value.match(/^(?:(\d+)\s+)?W?([\d.]+)\/H([\d.]+)$/i)
  return match ? { no: match[1] || String(index + 1).padStart(2, '0'), width: Number(match[2]), length: Number(match[3]) } : { no: String(index + 1).padStart(2, '0'), width: null, length: null, raw: value }
})

async function main() {
  const client = await getClient()
  const stats = { customers: 0, suppliers: 0, pos: 0, skipped: 0, items: 0, placeholders: 0, fragments: 0, qa: 0 }
  try {
    await client.query('BEGIN')
    const beforeLeads = (await client.query(`SELECT COUNT(*)::int AS count, md5(string_agg(id::text, ',' ORDER BY id)) AS hash FROM leads`)).rows[0]
    const user = (await client.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).rows[0]
    if (!user) throw new Error('No application user found for imported_by/created_by')

    let supplier = (await client.query(`SELECT id FROM suppliers WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1`, ['TEXSTONE INC'])).rows[0]
    if (!supplier) {
      supplier = (await client.query(
        `INSERT INTO suppliers (name, company, status, notes, created_by) VALUES ($1,$1,'Active',$2,$3) RETURNING id`,
        ['TEXSTONE INC', `Imported from ${SOURCE}`, user.id]
      )).rows[0]
      stats.suppliers++
    }

    const customerByName = new Map()
    const uniqueClients = [...new Set(data.po_summary.map(row => row['Client Name']).filter(Boolean))]
    for (let i = 0; i < uniqueClients.length; i++) {
      const name = uniqueClients[i]
      let customer = (await client.query(`SELECT id FROM customers WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1`, [name])).rows[0]
      const sourceRow = data.po_summary.find(row => row['Client Name'] === name)
      if (!customer) {
        const person = splitName(name)
        const prefix = process.env.DTF_CUSTOMER_PREFIX || 'CUST-DTF-2026-'
        let sequence = i + 1
        let customerNumber
        do {
          customerNumber = `${prefix}${String(sequence++).padStart(3, '0')}`
        } while ((await client.query(`SELECT 1 FROM customers WHERE customer_number=$1`, [customerNumber])).rowCount)
        customer = (await client.query(
          `INSERT INTO customers
             (customer_number,name,first_name,last_name,address_line1,country,status,source,internal_notes,created_by)
           VALUES ($1,$2,$3,$4,$5,'United States','Active',$6,$7,$8) RETURNING id`,
          [customerNumber, name, person.first, person.last,
           sourceRow['Ship To Address'] || null, SOURCE, `Imported from DTF PO master. Source address retained as provided.`, user.id]
        )).rows[0]
        await client.query(
          `INSERT INTO customer_addresses (customer_id,address_type,line1,country,is_default)
           VALUES ($1,'shipping',$2,'United States',TRUE)`, [customer.id, sourceRow['Ship To Address'] || null]
        )
        stats.customers++
      }
      customerByName.set(name, customer.id)
    }

    const shippingQueues = new Map()
    for (const row of data.shipping_payments) {
      const key = row['PO Number']
      if (!shippingQueues.has(key)) shippingQueues.set(key, [])
      shippingQueues.get(key).push(row)
    }
    const artworkByPo = new Map()
    for (const row of data.artwork_details) {
      const key = row['PO Number']
      if (!artworkByPo.has(key)) artworkByPo.set(key, [])
      artworkByPo.get(key).push(row)
    }
    const qaByPo = new Map()
    for (const row of data.qa_notes) {
      const key = row['PO Number']
      if (!qaByPo.has(key)) qaByPo.set(key, [])
      qaByPo.get(key).push(row)
      const inserted = await client.query(
        `INSERT INTO po_import_qa_notes (source_system,source_po_number,issue_type,details)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
        [SOURCE, key, row['Issue / Check'], row.Details]
      )
      stats.qa += inserted.rowCount
    }

    const occurrence = new Map()
    for (const row of data.po_summary) {
      const sourcePo = row['PO Number']
      const index = (occurrence.get(sourcePo) || 0) + 1
      occurrence.set(sourcePo, index)
      const sourceKey = `${SOURCE}:${sourcePo}:${index}`
      const exists = await client.query(`SELECT id FROM purchase_orders WHERE source_entry_key=$1`, [sourceKey])
      const itemRows = artworkByPo.get(sourcePo) || []
      if (exists.rowCount) {
        stats.skipped++
        if (itemRows.length === 0) {
          const itemCount = await client.query(`SELECT COUNT(*)::int AS count FROM purchase_order_items WHERE po_id=$1`, [exists.rows[0].id])
          if (itemCount.rows[0].count === 0) {
            await client.query(
              `INSERT INTO purchase_order_items
                 (po_id,item_name,description,qty_ordered,unit_price,line_total,uom,remarks,sort_order,brand,print_type,gangsheet_lengths)
               VALUES ($1,'Artwork details not provided in source',$2,$3,0,0,'pcs',$4,0,$5,$6,$7)`,
              [exists.rows[0].id, `PO Summary total retained: ${number(row['Total Artworks']) || 0} artworks`,
               number(row['Total Artworks']) || 0, `Generated placeholder because the workbook Artwork Details sheet has no rows for ${sourcePo}`,
               row.Brand || null, row['Print Type'] || null, row['Gangsheet Length(s)'] || null]
            )
            const qa = await client.query(
              `INSERT INTO po_import_qa_notes (source_system,source_po_number,issue_type,details)
               VALUES ($1,$2,'Missing artwork details',$3) ON CONFLICT DO NOTHING RETURNING id`,
              [SOURCE, sourcePo, `Artwork Details sheet has no rows; PO Summary total of ${number(row['Total Artworks']) || 0} was retained as a placeholder line.`]
            )
            stats.items++; stats.placeholders++; stats.qa += qa.rowCount
          }
        }
        const expectedFragments = number(row['Total Gangsheets']) || 0
        const fragmentCount = await client.query(`SELECT COUNT(*)::int AS count FROM po_gangsheet_fragments WHERE po_id=$1`, [exists.rows[0].id])
        for (let fragmentIndex = fragmentCount.rows[0].count; fragmentIndex < expectedFragments; fragmentIndex++) {
          await client.query(
            `INSERT INTO po_gangsheet_fragments (po_id,fragment_no,width_inches,length_inches,artworks_count,qty,sort_order)
             VALUES ($1,$2,NULL,NULL,0,1,$3)`,
            [exists.rows[0].id, String(fragmentIndex + 1).padStart(2, '0'), fragmentIndex]
          )
          stats.fragments++
        }
        if (fragmentCount.rows[0].count < expectedFragments) {
          const qa = await client.query(
            `INSERT INTO po_import_qa_notes (source_system,source_po_number,issue_type,details)
             VALUES ($1,$2,'Missing gangsheet dimensions',$3) ON CONFLICT DO NOTHING RETURNING id`,
            [SOURCE, sourcePo, `PO Summary lists ${expectedFragments} gangsheets, but only ${fragmentCount.rows[0].count} gangsheet length value(s) were provided. Missing fragment rows were retained with blank dimensions.`]
          )
          stats.qa += qa.rowCount
        }
        continue
      }

      const ship = (shippingQueues.get(sourcePo) || [])[index - 1] || {}
      const payment = money(row['Payment Received'])
      const shippingCharge = money(row['Shipping Charge'])
      const netProduct = money(row['Net Product Amount'])
      const isFree = payment == null
      const subtotal = isFree ? 0 : (netProduct == null ? payment : netProduct)
      const freight = isFree ? 0 : (shippingCharge || 0)
      const grandTotal = payment || 0
      const qaText = (qaByPo.get(sourcePo) || []).map(note => `${note['Issue / Check']}: ${note.Details}`)
      const notes = [row.Notes, ...qaText].filter(Boolean).join('\n') || null
      const internalPo = index === 1 ? sourcePo : `${sourcePo}-FREE`
      const orderDate = isoDate(row['PO Date'])
      const expectedDate = isoDate(row['Required Dispatch Date'])

      const po = (await client.query(
        `INSERT INTO purchase_orders
           (po_number,vendor_name,status,order_date,expected_date,subtotal,total,notes,created_by,
            supplier_id,supplier_reference,payment_terms,currency,priority,shipping_method,shipping_address,
            total_discount,total_tax,freight_charges,other_charges,grand_total,po_type,payment_status,
            customer_id,source_system,source_entry_key,source_po_number,source_entry_index,brand,
            production_priority,required_dispatch_text,print_type,total_gangsheets,total_artworks,
            gangsheet_width,gangsheet_lengths,payment_received,shipping_charge,net_product_amount,
            delivery_type,courier_account,shipping_labels,packages,source_payment_status,imported_at)
         VALUES ($1,$2,'Closed',$3,$4,$5,$6,$7,$8,$9,$10,$11,'USD','Medium',$12,$13,
                 0,0,$14,0,$15,'gangsheet','Paid',$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
                 $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,NOW()) RETURNING id`,
        [internalPo, row.Vendor || 'TEXSTONE INC', orderDate, expectedDate, subtotal, grandTotal, notes, user.id,
         supplier.id, sourcePo, row['Payment Terms'] || null, ship['Shipping Method'] || row['Shipping Method'] || null,
         row['Ship To Address'] || null, freight, grandTotal, customerByName.get(row['Client Name']), SOURCE,
         sourceKey, sourcePo, index, row.Brand || null, row['Production Priority'] || null,
         row['Required Dispatch Date'] || null, row['Print Type'] || null, number(row['Total Gangsheets']) || 0,
         number(row['Total Artworks']) || 0, row['Gangsheet Width'] || null, row['Gangsheet Length(s)'] || null,
         payment, shippingCharge, netProduct, ship['Delivery Type'] || null, ship['Courier Account'] || null,
         ship['Shipping Labels'] || null, number(ship.Packages), ship['Payment Status'] || (isFree ? 'Free/Reprint' : 'Paid')]
      )).rows[0]
      stats.pos++

      for (let itemIndex = 0; itemIndex < itemRows.length; itemIndex++) {
        const item = itemRows[itemIndex]
        await client.query(
          `INSERT INTO purchase_order_items
             (po_id,item_name,description,qty_ordered,unit_price,line_total,uom,required_by_date,remarks,
              sort_order,artwork_size,brand,source_artwork_no,image_file_ref,print_type,gangsheet_lengths)
           VALUES ($1,$2,$3,$4,0,0,'pcs',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [po.id, item['Artwork Name'] || item['AW #'] || 'DTF Artwork', `${item['AW #'] || ''} ${item['Image File'] || ''}`.trim() || null,
           number(item.Quantity) || 0, expectedDate, `Source artwork detail from ${SOURCE}`, itemIndex,
           item.Size || null, row.Brand || null, item['AW #'] || null, item['Image File'] || null,
           item['Print Type'] || null, item['Gangsheet Length(s)'] || null]
        )
        stats.items++
      }
      if (itemRows.length === 0) {
        await client.query(
          `INSERT INTO purchase_order_items
             (po_id,item_name,description,qty_ordered,unit_price,line_total,uom,required_by_date,remarks,sort_order,brand,print_type,gangsheet_lengths)
           VALUES ($1,'Artwork details not provided in source',$2,$3,0,0,'pcs',$4,$5,0,$6,$7,$8)`,
          [po.id, `PO Summary total retained: ${number(row['Total Artworks']) || 0} artworks`, number(row['Total Artworks']) || 0,
           expectedDate, `Generated placeholder because the workbook Artwork Details sheet has no rows for ${sourcePo}`,
           row.Brand || null, row['Print Type'] || null, row['Gangsheet Length(s)'] || null]
        )
        const qa = await client.query(
          `INSERT INTO po_import_qa_notes (source_system,source_po_number,issue_type,details)
           VALUES ($1,$2,'Missing artwork details',$3) ON CONFLICT DO NOTHING RETURNING id`,
          [SOURCE, sourcePo, `Artwork Details sheet has no rows; PO Summary total of ${number(row['Total Artworks']) || 0} was retained as a placeholder line.`]
        )
        stats.items++; stats.placeholders++; stats.qa += qa.rowCount
      }

      const sheetFragments = fragments(row['Gangsheet Length(s)'])
      const suppliedFragmentCount = sheetFragments.length
      const expectedFragmentCount = number(row['Total Gangsheets']) || 0
      while (sheetFragments.length < expectedFragmentCount) {
        sheetFragments.push({ no: String(sheetFragments.length + 1).padStart(2, '0'), width: null, length: null, raw: 'Dimensions not provided in source' })
      }
      for (let fragmentIndex = 0; fragmentIndex < sheetFragments.length; fragmentIndex++) {
        const fragment = sheetFragments[fragmentIndex]
        await client.query(
          `INSERT INTO po_gangsheet_fragments
             (po_id,fragment_no,width_inches,length_inches,artworks_count,qty,sort_order)
           VALUES ($1,$2,$3,$4,$5,1,$6)`,
          [po.id, fragment.no, fragment.width, fragment.length,
           sheetFragments.length === 1 ? number(row['Total Artworks']) || 0 : 0, fragmentIndex]
        )
        stats.fragments++
      }
      if (suppliedFragmentCount < expectedFragmentCount) {
        const qa = await client.query(
          `INSERT INTO po_import_qa_notes (source_system,source_po_number,issue_type,details)
           VALUES ($1,$2,'Missing gangsheet dimensions',$3) ON CONFLICT DO NOTHING RETURNING id`,
          [SOURCE, sourcePo, `PO Summary lists ${expectedFragmentCount} gangsheets, but only ${suppliedFragmentCount} gangsheet length value(s) were provided. Missing fragment rows were retained with blank dimensions.`]
        )
        stats.qa += qa.rowCount
      }
      await client.query(
        `INSERT INTO po_status_history (po_id,from_status,to_status,changed_by,comment)
         VALUES ($1,NULL,'Closed',$2,$3)`, [po.id, user.id, `Historical PO imported from ${SOURCE}`]
      )
    }

    await client.query(
      `UPDATE customers c SET
         total_orders = x.po_count,
         lifetime_value = x.revenue,
         last_order_at = x.last_order
       FROM (
         SELECT customer_id,COUNT(*)::int AS po_count,COALESCE(SUM(payment_received),0) AS revenue,MAX(order_date)::timestamptz AS last_order
         FROM purchase_orders WHERE source_system=$1 GROUP BY customer_id
       ) x WHERE c.id=x.customer_id`, [SOURCE]
    )

    const metrics = (await client.query(
      `SELECT COUNT(*)::int AS po_entries,COUNT(DISTINCT source_po_number)::int AS unique_pos,
              COALESCE(SUM(total_gangsheets),0)::int AS gangsheets,COALESCE(SUM(total_artworks),0)::int AS artworks,
              COALESCE(SUM(payment_received),0)::numeric(12,2) AS paid_revenue,
              COALESCE(SUM(shipping_charge),0)::numeric(12,2) AS shipping_collected,
              COALESCE(SUM(net_product_amount),0)::numeric(12,2) AS net_product_amount,
              COUNT(*) FILTER (WHERE source_payment_status='Free/Reprint')::int AS free_entries
         FROM purchase_orders WHERE source_system=$1`, [SOURCE]
    )).rows[0]
    const expected = data.expected_metrics || { po_entries:31, unique_pos:30, gangsheets:59, artworks:2520, paid_revenue:'3034.41', shipping_collected:'320.20', net_product_amount:'2164.21', free_entries:5 }
    for (const [key, value] of Object.entries(expected)) {
      if (Math.abs(Number(metrics[key]) - Number(value)) > 0.005) throw new Error(`Metric mismatch ${key}: got ${metrics[key]}, expected ${value}`)
    }
    const afterLeads = (await client.query(`SELECT COUNT(*)::int AS count, md5(string_agg(id::text, ',' ORDER BY id)) AS hash FROM leads`)).rows[0]
    if (beforeLeads.count !== afterLeads.count || beforeLeads.hash !== afterLeads.hash) throw new Error('Lead integrity check failed')

    if (dryRun) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'committed', stats, metrics, leads: afterLeads }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1) })
