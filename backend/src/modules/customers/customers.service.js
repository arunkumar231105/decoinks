const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

async function list({ page = 1, limit = 20, search = '', status = '' }) {
  const offset = (page - 1) * limit
  const params = []
  const conditions = ['c.deleted_at IS NULL']

  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.company ILIKE $${params.length} OR c.phone ILIKE $${params.length})`)
  }
  if (status && status !== 'All') {
    params.push(status)
    conditions.push(`c.status = $${params.length}`)
  }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(`SELECT COUNT(*) FROM customers c ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT c.id, c.customer_number, c.name, c.email, c.phone, c.company,
            c.city, c.country, c.status, c.lead_id, c.created_at,
            0 AS quotes_count
     FROM customers c
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  // Guard against non-UUID ids causing PostgreSQL cast errors
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) {
    throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  }
  const { rows } = await query(
    `SELECT c.*, l.lead_number, l.source AS lead_source
     FROM customers c
     LEFT JOIN leads l ON l.id = c.lead_id
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })

  // Fetch linked quotes — column may not exist yet, so fall back gracefully
  let quotesRows = []
  try {
    const hasCol = await query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name='quotations' AND column_name='customer_id' LIMIT 1`
    )
    if (hasCol.rows.length > 0) {
      const qRes = await query(
        `SELECT id, quote_number, status, total, created_at FROM quotations
         WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
        [id]
      )
      quotesRows = qRes.rows
    }
  } catch (_) {}

  return { ...rows[0], quotes: quotesRows, quotes_count: quotesRows.length }
}

async function create({ lead_id, name, email, phone, whatsapp, company, website, facebook_id, instagram_id,
  address_line1, city, state, zip, country, billing_address, same_as_shipping,
  buyer_type, internal_notes, source, created_by }) {
  const customer_number = await getNextNumber('CUST', 'customers', 'customer_number')
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO customers
         (customer_number, lead_id, name, email, phone, whatsapp, company, website, facebook_id, instagram_id,
          address_line1, city, state, zip, country, billing_address, same_as_shipping,
          buyer_type, internal_notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        customer_number, lead_id || null, name,
        email || null, phone || null, whatsapp || null, company || null,
        website || null, facebook_id || null, instagram_id || null,
        address_line1 || null, city || null, state || null, zip || null,
        country || 'United States', billing_address || null, same_as_shipping || false,
        buyer_type || null, internal_notes || null, source || null, created_by,
      ]
    )
    const customer = rows[0]

    // Link lead to this customer
    if (lead_id) {
      await client.query(
        `UPDATE leads SET customer_id = $1, updated_at = NOW() WHERE id = $2`,
        [customer.id, lead_id]
      )
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'customer', $2, 'created', $3)`,
      [created_by, customer.id, `Customer ${customer_number} - ${name} created`]
    )
    await client.query('COMMIT')
    return customer
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields, actorId) {
  const allowed = [
    'name', 'email', 'phone', 'whatsapp', 'company', 'website', 'facebook_id', 'instagram_id',
    'address_line1', 'city', 'state', 'zip', 'country', 'billing_address', 'same_as_shipping',
    'buyer_type', 'internal_notes', 'status', 'source',
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
    `UPDATE customers SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE customers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
}

module.exports = { list, getById, create, update, remove }
