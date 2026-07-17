/* Convert Custom T-shirt Order Summary CSV to the audited historical importer format. */
const fs = require('fs')
const { parse } = require('csv-parse/sync')
const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) throw new Error('Usage: node scripts/convert-custom-apparel-csv.js <input.csv> <output.json>')
const all = parse(fs.readFileSync(input, 'utf8'), { columns: true, skip_empty_lines: true, trim: true })
const rows = all.filter(row => /^TS-/i.test(row['Order ID'] || ''))
const cash = value => Number(String(value || 0).replace(/[$,]/g, '').trim())
const sourceDate = value => {
  const match = String(value || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    return `${String(match[1]).padStart(2, '0')}-${match[2]}-${year}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-')
}
const customerName = row => row['Customer Name'] || `Unknown Customer – ${row['Order ID']}`
const po_summary = rows.map(row => ({
  'PO Number': row['Order ID'], 'PO Date': sourceDate(row['Order Date']), 'Required Dispatch Date': null,
  'Client Name': customerName(row), 'Ship To Address': row['Shipping Address'] || null,
  Brand: row.Brand, Vendor: 'TEXSTONE INC', 'Production Priority': row['Production Priority'] || null,
  'Print Type': row['Printing Method'], 'Total Gangsheets': 0, 'Total Artworks': 0,
  'Gangsheet Width': null, 'Gangsheet Length(s)': null, 'Payment Received': cash(row['Total Amount']),
  'Shipping Charge': cash(row.Shipping), 'Net Product Amount': cash(row['Order Amount']),
  'Payment Terms': 'Paid', Notes: [
    row.Notes, row['Special Instructions'] && `Special instructions: ${row['Special Instructions']}`,
    row['Estimated Production Time'] && `Estimated production time: ${row['Estimated Production Time']}`,
    row['Data Check'] && row['Data Check'] !== 'OK' && `Data check: ${row['Data Check']}`,
  ].filter(Boolean).join('\n'),
}))
const artwork_details = rows.map(row => ({
  'PO Number': row['Order ID'], 'PO Date': sourceDate(row['Order Date']), 'Client Name': customerName(row),
  'AW #': 'APPAREL', 'Artwork Name': `${row['Product Type']} — ${row['Shirt Brand']}`,
  'Image File': null, Size: null, Quantity: Number(row['Total Quantity']), 'Print Type': row['Printing Method'],
  'Gangsheet Length(s)': null,
}))
const shipping_payments = rows.map(row => ({
  'PO Number': row['Order ID'], 'Shipping Method': row['Shipping Method'] || null,
  'Courier Account': null, Packages: 1, 'Payment Status': 'Paid',
}))
const qa_notes = rows.filter(row => row['Data Check'] && row['Data Check'] !== 'OK').map(row => ({
  'PO Number': row['Order ID'], 'Issue / Check': row['Data Check'], Details: row.Notes || `Source flagged: ${row['Data Check']}`,
}))
const sum = key => rows.reduce((total, row) => total + cash(row[key]), 0)
fs.writeFileSync(output, JSON.stringify({
  po_summary, artwork_details, shipping_payments, dashboard: [], qa_notes,
  expected_metrics: {
    po_entries: rows.length, unique_pos: new Set(rows.map(row => row['Order ID'])).size,
    gangsheets: 0, artworks: 0, paid_revenue: sum('Total Amount').toFixed(2),
    shipping_collected: sum('Shipping').toFixed(2), net_product_amount: sum('Order Amount').toFixed(2), free_entries: 0,
  },
}, null, 2))
console.log(JSON.stringify({ rows: rows.length, shirts: sum('Total Quantity'), order_amount: sum('Order Amount'), shipping: sum('Shipping'), total: sum('Total Amount') }, null, 2))
