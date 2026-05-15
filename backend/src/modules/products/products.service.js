const { query } = require('../../config/db')

const TYPE_PREFIXES = { Apparel: 'APP', DTF: 'DTF', Gangsheet: 'GNG', Embroidery: 'EMB', Other: 'OTH' }

async function list({ page = 1, limit = 10, search = '', product_type = '', active = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['deleted_at IS NULL']
  const params = []

  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`)
  }
  if (product_type) { params.push(product_type); conditions.push(`product_type = $${params.length}`) }
  if (active !== '') { params.push(active === 'true'); conditions.push(`is_active = $${params.length}`) }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(`SELECT COUNT(*) FROM products ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT * FROM products ${where} ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [id])
  if (!rows[0]) throw Object.assign(new Error('Product not found'), { statusCode: 404 })
  return rows[0]
}

async function generateUniqueSku(product_type) {
  const typePrefix = TYPE_PREFIXES[product_type] || 'OTH'
  let sku, exists
  do {
    const digits = String(Math.floor(1000 + Math.random() * 9000))  // always 4 digits
    sku = `PRD-${typePrefix}-${digits}`
    const { rows } = await query(`SELECT id FROM products WHERE sku = $1`, [sku])
    exists = rows.length > 0
  } while (exists)
  return sku
}

async function create({ sku, name, product_type, description, base_price, cost_price, stock_qty, image_url, created_by }) {
  // Validate provided SKU uniqueness before hitting DB constraint
  if (sku) {
    const { rows: dupe } = await query(`SELECT id FROM products WHERE sku = $1`, [sku])
    if (dupe.length) throw Object.assign(new Error(`SKU '${sku}' is already in use`), { statusCode: 409 })
  }

  const finalSku = sku || await generateUniqueSku(product_type)

  const { rows } = await query(
    `INSERT INTO products (sku, name, product_type, description, base_price, cost_price, stock_qty, image_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [finalSku, name, product_type, description || null,
     base_price, cost_price || 0, stock_qty || 0, image_url || null, created_by]
  )
  return rows[0]
}

async function update(id, { name, description, base_price, cost_price, stock_qty, image_url, is_active }) {
  const { rows } = await query(
    `UPDATE products SET
       name        = COALESCE($1, name),
       description = COALESCE($2, description),
       base_price  = COALESCE($3, base_price),
       cost_price  = COALESCE($4, cost_price),
       stock_qty   = COALESCE($5, stock_qty),
       image_url   = COALESCE($6, image_url),
       is_active   = COALESCE($7, is_active),
       updated_at  = NOW()
     WHERE id = $8 AND deleted_at IS NULL
     RETURNING *`,
    [name, description, base_price, cost_price, stock_qty, image_url, is_active, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Product not found'), { statusCode: 404 })
  return rows[0]
}

async function toggle(id) {
  const { rows } = await query(
    `UPDATE products SET is_active = NOT is_active, updated_at=NOW()
     WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Product not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE products SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Product not found'), { statusCode: 404 })
}

module.exports = { list, getById, create, update, toggle, remove }
