/* Convert the aggregate June/July tracker CSV to the audited PO importer format. */
const fs = require('fs')
const { parse } = require('csv-parse/sync')

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) throw new Error('Usage: node scripts/convert-dtf-tracker-csv.js <input.csv> <output.json>')

const rows = parse(fs.readFileSync(input, 'utf8'), { columns: true, skip_empty_lines: true, trim: true })
const cash = value => Number(String(value || '0').replace(/[$,]/g, ''))
const date = value => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-')
}
const po_summary = rows.map(row => {
  const sheets = Number(row['Total Gangsheets'] || 0)
  const totalLength = Number(row['Total Gangsheet Length (in)'] || 0)
  const sourceNotes = [
    row.Notes,
    row['Special Instructions'] && `Special instructions: ${row['Special Instructions']}`,
    `Aggregate gangsheet length: ${totalLength} in across ${sheets} gangsheets; individual artwork sizes were not supplied in this tracker.`,
    row['Data Check'] && row['Data Check'] !== 'OK' && `Data check: ${row['Data Check']}`,
  ].filter(Boolean).join('\n')
  return {
    'PO Number': row['PO Number'], 'PO Date': date(row['PO Date']), 'Client Name': row['Customer Name'],
    'Ship To Address': row['Shipping Address'], Brand: row.Brand, Vendor: row['Vendor Name'],
    'Production Priority': row['Production Priority'], 'Required Dispatch Date': date(row['Required Dispatch Date']),
    'Print Type': row['Print Type'], 'Total Gangsheets': sheets, 'Total Artworks': Number(row['Total Artworks'] || 0),
    'Gangsheet Width': row['Gangsheet Width (in)'] ? `${row['Gangsheet Width (in)']}\"` : null,
    'Gangsheet Length(s)': sheets === 1 && totalLength ? `01 W${row['Gangsheet Width (in)']}/H${totalLength}` : null,
    'Payment Received': cash(row['Total Amount']), 'Shipping Charge': cash(row.Shipping),
    'Net Product Amount': cash(row['Order Amount']), 'Payment Terms': row['Payment Terms'], Notes: sourceNotes,
    '_source': row,
  }
})
const shipping_payments = rows.map(row => ({
  'PO Number': row['PO Number'], 'Shipping Method': row['Shipper Name'], 'Courier Account': row['Courier Account'],
  Packages: Number(row.Packages || 0), 'Payment Status': cash(row['Total Amount']) > 0 ? 'Paid' : 'Free/Reprint',
}))
const artwork_details = rows.map(row => ({
  'PO Number': row['PO Number'], 'PO Date': date(row['PO Date']), 'Client Name': row['Customer Name'],
  'AW #': 'AGGREGATE', 'Artwork Name': 'DTF Transfers (aggregate)', 'Image File': null, Size: null,
  Quantity: Number(row['Total Artworks'] || 0), 'Print Type': row['Print Type'],
  'Gangsheet Length(s)': `Total ${row['Total Gangsheet Length (in)']} in across ${row['Total Gangsheets']} gangsheets`,
}))
const qa_notes = rows.filter(row => row['Data Check'] && row['Data Check'] !== 'OK' && row['Data Check'] !== 'Free order').map(row => ({
  'PO Number': row['PO Number'], 'Issue / Check': row['Data Check'], Details: row.Notes || `Source tracker flagged: ${row['Data Check']}`,
}))
const sum = key => rows.reduce((total, row) => total + cash(row[key]), 0)
const payload = {
  po_summary, artwork_details, shipping_payments, dashboard: [], qa_notes,
  expected_metrics: {
    po_entries: rows.length, unique_pos: new Set(rows.map(row => row['PO Number'])).size,
    gangsheets: sum('Total Gangsheets'), artworks: sum('Total Artworks'), paid_revenue: sum('Total Amount').toFixed(2),
    shipping_collected: sum('Shipping').toFixed(2), net_product_amount: sum('Order Amount').toFixed(2), free_entries: 0,
  },
}
fs.writeFileSync(output, JSON.stringify(payload, null, 2))
console.log(JSON.stringify({ rows: rows.length, ...payload.expected_metrics }, null, 2))
