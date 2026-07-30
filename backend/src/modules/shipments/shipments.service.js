const { query } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const shippo = require('../../utils/shippo')

async function list({ page = 1, limit = 10, status = '' }) {
  const offset = (page - 1) * limit
  const params = []
  const conditions = []
  if (status) { params.push(status); conditions.push(`s.status = $${params.length}`) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const countRes = await query(`SELECT COUNT(*) FROM shipments s ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT s.*, c.name AS supplier_name, o.order_number,
            po.po_number, po.shipping_address AS po_shipping_address,
            COALESCE(s.customer_name, cust.name, s.recipient_name) AS customer_name
     FROM shipments s
     LEFT JOIN suppliers c ON c.id = s.supplier_id
     LEFT JOIN orders o ON o.id = s.order_id
     LEFT JOIN purchase_orders po ON po.id = s.po_id
     LEFT JOIN customers cust ON cust.id = o.customer_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT s.*, c.name AS supplier_name, o.order_number,
            po.po_number, po.shipping_address AS po_shipping_address,
            COALESCE(s.customer_name, cust.name, s.recipient_name) AS customer_name
     FROM shipments s
     LEFT JOIN suppliers c ON c.id = s.supplier_id
     LEFT JOIN orders o ON o.id = s.order_id
     LEFT JOIN purchase_orders po ON po.id = s.po_id
     LEFT JOIN customers cust ON cust.id = o.customer_id
     WHERE s.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ order_id, supplier_id, po_id, ship_source, supplier_name_text, agent_name, carrier, tracking_number, ship_date, estimated_delivery, weight_lbs, shipping_cost, recipient_name, address, notes, created_by, status,
  customer_name, service_type, ship_to_city, ship_to_state, ship_to_postal_code, tracking_status, last_scan_city, last_scan_state, delivered_date }) {
  const shipment_number = await getNextNumber('SHP', 'shipments', 'shipment_number')
  // Use free-text customer name as recipient_name if no explicit recipient_name given
  const resolvedRecipient = recipient_name || supplier_name_text || null
  // Append agent_name to notes if provided
  const resolvedNotes = agent_name
    ? [notes, `Agent: ${agent_name}`].filter(Boolean).join(' | ')
    : (notes || null)
  const { rows } = await query(
    `INSERT INTO shipments (shipment_number, order_id, supplier_id, po_id, ship_source, carrier, tracking_number, ship_date, estimated_delivery, weight_lbs, shipping_cost, recipient_name, address, notes, created_by, status,
       customer_name, service_type, ship_to_city, ship_to_state, ship_to_postal_code, tracking_status, last_scan_city, last_scan_state, delivered_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'Pending')::shipment_status,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
    [shipment_number, order_id || null, supplier_id || null, po_id || null, ship_source || null, carrier || null, tracking_number || null,
     ship_date || null, estimated_delivery || null, weight_lbs || null, shipping_cost || null,
     resolvedRecipient, address || null, resolvedNotes, created_by, status || null,
     customer_name || null, service_type || null, ship_to_city || null, ship_to_state || null,
     ship_to_postal_code || null, tracking_status || null, last_scan_city || null, last_scan_state || null,
     delivered_date || null]
  )
  return rows[0]
}

async function updateStatus(id, status) {
  const updates = { status }
  if (status === 'Label Created') {
    const existing = await getById(id)
    if (!existing.ship_date) updates.ship_date = new Date().toISOString().split('T')[0]
  }
  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`)
  const params = [...Object.values(updates), id]
  const { rows } = await query(
    `UPDATE shipments SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  return rows[0]
}

async function update(id, fields) {
  const allowed = [
    'carrier', 'tracking_number', 'ship_date', 'estimated_delivery',
    'weight_lbs', 'shipping_cost', 'recipient_name', 'address', 'notes',
    'customer_name', 'service_type', 'ship_to_city', 'ship_to_state',
    'ship_to_postal_code', 'tracking_status', 'last_scan_city', 'last_scan_state',
    'delivered_date', 'po_id', 'ship_source',
  ]
  const sets = []
  const params = []

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })

  params.push(id)
  const { rows } = await query(
    `UPDATE shipments SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `DELETE FROM shipments WHERE id = $1 RETURNING id`, [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
}

// Columns that a Shippo tracking refresh is permitted to write, and which of
// them are JSONB (need an explicit ::jsonb cast on the bound text value).
const TRACKING_COLUMNS = new Set([
  'carrier', 'tracking_status', 'substatus', 'status_details', 'last_scan_city', 'last_scan_state',
  'estimated_delivery', 'original_eta', 'service_type',
  'address_from_city', 'address_from_state', 'address_from_postal_code',
  'ship_to_city', 'ship_to_state', 'ship_to_postal_code',
  'delivered_date', 'tracking_history', 'tracking_messages',
])
const JSONB_COLUMNS = new Set(['tracking_history', 'tracking_messages'])

// Pull the latest tracking from Shippo for this shipment and persist it.
// Only the fields Shippo returned are written (never clobbering manual data
// with blanks); tracking_synced_at is always stamped.
async function refreshTracking(id) {
  const existing = await getById(id)
  const mapped = await shippo.fetchTracking(existing.carrier, existing.tracking_number)

  const sets = ['tracking_synced_at = NOW()']
  const params = []
  for (const [key, value] of Object.entries(mapped)) {
    if (!TRACKING_COLUMNS.has(key)) continue          // allow-list guard
    if (JSONB_COLUMNS.has(key)) {
      params.push(JSON.stringify(value))              // arrays → JSON text for the ::jsonb cast
      sets.push(`${key} = $${params.length}::jsonb`)
    } else {
      params.push(value)
      sets.push(`${key} = $${params.length}`)
    }
  }

  params.push(id)
  const { rows } = await query(
    `UPDATE shipments SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  // Return the enriched row (with joins) so the UI gets po_number etc.
  return getById(id)
}

// Live-fetch tracking from Shippo WITHOUT saving — used by the New Shipment
// form so the user can enter a tracking id and instantly see the details.
async function previewTracking(carrier, tracking_number) {
  return shippo.fetchTracking(carrier, tracking_number)
}

// Map the Shippo "Shipping Fee" CSV export onto shipment rows.
// The export lists one row per billing line, so a tracking number can repeat
// (base charge + corrections + refunds). We collapse to one shipment per unique
// tracking number: earliest ship date, summed net cost, carrier + service level.
// The file carries no PO / customer / address — those come from Shippo on refresh.
function aggregateCsvRows(records) {
  const byTracking = new Map()
  for (const r of records) {
    const tn = String(r['Tracking Number'] || '').trim()
    if (!tn) continue                                   // skip totals / blank rows
    const amount = parseFloat(r['Amount']) || 0
    const shipDate = String(r['Transaction Creation Date'] || '').slice(0, 10) || null
    if (!byTracking.has(tn)) {
      byTracking.set(tn, {
        tracking_number: tn,
        carrier:      String(r['Carrier'] || '').trim() || null,
        service_type: String(r['Service Level'] || '').trim() || null,
        ship_date:    shipDate,
        shipping_cost: 0,
        invoice:      String(r['Invoice Number'] || '').trim() || null,
      })
    }
    const agg = byTracking.get(tn)
    agg.shipping_cost += amount
    if (shipDate && (!agg.ship_date || shipDate < agg.ship_date)) agg.ship_date = shipDate
  }
  return [...byTracking.values()]
}

// Import shipments from parsed CSV records. Idempotent: tracking numbers that
// already exist are skipped, so re-importing the same file is safe.
// previewOnly returns the counts without writing anything.
async function importFromCsv(records, created_by, { previewOnly = false } = {}) {
  const unique = aggregateCsvRows(records)
  const tns = unique.map(u => u.tracking_number)

  let existing = new Set()
  if (tns.length) {
    const { rows } = await query(
      `SELECT tracking_number FROM shipments WHERE tracking_number = ANY($1::text[])`,
      [tns]
    )
    existing = new Set(rows.map(r => r.tracking_number))
  }

  const toInsert = unique.filter(u => !existing.has(u.tracking_number))
  if (previewOnly) {
    return { total: unique.length, willImport: toInsert.length, willSkip: unique.length - toInsert.length }
  }

  let imported = 0, skipped = unique.length - toInsert.length
  for (const u of toInsert) {
    try {
      await create({
        carrier:        u.carrier,
        tracking_number: u.tracking_number,
        service_type:   u.service_type,
        ship_date:      u.ship_date,
        shipping_cost:  Math.max(0, Math.round(u.shipping_cost * 100) / 100),
        status:         'In Transit',
        notes:          u.invoice ? `Shippo Invoice: ${u.invoice}` : null,
        created_by,
      })
      imported++
    } catch (e) { skipped++ }
  }
  return { total: unique.length, imported, skipped }
}

module.exports = { list, getById, create, update, updateStatus, remove, refreshTracking, previewTracking, importFromCsv }
