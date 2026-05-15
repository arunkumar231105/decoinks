const { query } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

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
    `SELECT s.*, c.name AS customer_name, o.order_number
     FROM shipments s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN orders o ON o.id = s.order_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT s.*, c.name AS customer_name, o.order_number
     FROM shipments s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ order_id, customer_id, customer_name_text, agent_name, carrier, tracking_number, ship_date, estimated_delivery, weight_lbs, shipping_cost, recipient_name, address, notes, created_by }) {
  const shipment_number = await getNextNumber('SHP', 'shipments', 'shipment_number')
  // Use free-text customer name as recipient_name if no explicit recipient_name given
  const resolvedRecipient = recipient_name || customer_name_text || null
  // Append agent_name to notes if provided
  const resolvedNotes = agent_name
    ? [notes, `Agent: ${agent_name}`].filter(Boolean).join(' | ')
    : (notes || null)
  const { rows } = await query(
    `INSERT INTO shipments (shipment_number, order_id, customer_id, carrier, tracking_number, ship_date, estimated_delivery, weight_lbs, shipping_cost, recipient_name, address, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [shipment_number, order_id || null, customer_id || null, carrier || null, tracking_number || null,
     ship_date || null, estimated_delivery || null, weight_lbs || null, shipping_cost || null,
     resolvedRecipient, address || null, resolvedNotes, created_by]
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

module.exports = { list, getById, create, update, updateStatus, remove }
