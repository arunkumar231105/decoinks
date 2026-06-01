const { query, getClient } = require('../../config/db')

async function list({ page = 1, limit = 10, search = '', status = '' }) {
  const offset = (page - 1) * limit
  const params = []
  const conditions = ['c.deleted_at IS NULL']

  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.city ILIKE $${params.length})`)
  }
  if (status && status !== 'All') {
    params.push(status)
    conditions.push(`c.status = $${params.length}`)
  }

  const where = 'WHERE ' + conditions.join(' AND ')

  const countRes = await query(`SELECT COUNT(*) FROM suppliers c ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT
       c.id, c.name, c.email, c.phone, c.company, c.city, c.state,
       c.country, c.status, c.created_at,
       COUNT(o.id) AS orders_count,
       COALESCE(SUM(o.total), 0) AS total_spent,
       CASE WHEN pu.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_portal_access
     FROM suppliers c
     LEFT JOIN orders o ON o.supplier_id = c.id AND o.deleted_at IS NULL
     LEFT JOIN supplier_portal_users pu ON pu.supplier_id = c.id
     ${where}
     GROUP BY c.id, pu.id
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT
       c.*,
       COUNT(o.id) AS orders_count,
       COALESCE(SUM(o.total), 0) AS total_spent
     FROM suppliers c
     LEFT JOIN orders o ON o.supplier_id = c.id AND o.deleted_at IS NULL
     WHERE c.id = $1 AND c.deleted_at IS NULL
     GROUP BY c.id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Supplier not found'), { statusCode: 404 })
  return rows[0]
}

async function getOrders(supplierId, { page = 1, limit = 10 }) {
  const offset = (page - 1) * limit
  const countRes = await query(
    `SELECT COUNT(*) FROM orders WHERE supplier_id = $1 AND deleted_at IS NULL`,
    [supplierId]
  )
  const total = parseInt(countRes.rows[0].count, 10)

  const { rows } = await query(
    `SELECT id, order_number, order_type, status, payment_status, total, order_date
     FROM orders
     WHERE supplier_id = $1 AND deleted_at IS NULL
     ORDER BY order_date DESC
     LIMIT $2 OFFSET $3`,
    [supplierId, limit, offset]
  )
  return { rows, total }
}

async function create({ name, email, phone, company, address_line1, address_line2, city, state, zip, country, notes, created_by }) {
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO suppliers (name, email, phone, company, address_line1, address_line2, city, state, zip, country, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [name, email || null, phone || null, company || null,
       address_line1 || null, address_line2 || null,
       city || null, state || null, zip || null,
       country || 'United States', notes || null, created_by]
    )
    const supplier = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'supplier', $2, 'created', $3)`,
      [created_by, supplier.id, `Created supplier ${supplier.name}`]
    )

    await client.query('COMMIT')
    return supplier
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields, actorId) {
  const allowed = ['name','email','phone','company','address_line1','address_line2','city','state','zip','country','status','notes']
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
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE suppliers SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params
    )
    if (!rows[0]) throw Object.assign(new Error('Supplier not found'), { statusCode: 404 })
    const supplier = rows[0]

    const action = fields.status !== undefined ? 'status_changed' : 'updated'
    const description = fields.status !== undefined
      ? `Supplier ${supplier.name} status changed to ${supplier.status}`
      : `Updated supplier ${supplier.name}`

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'supplier', $2, $3, $4)`,
      [actorId, supplier.id, action, description]
    )

    await client.query('COMMIT')
    return supplier
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE suppliers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Supplier not found'), { statusCode: 404 })
}

module.exports = { list, getById, getOrders, create, update, remove }
