const { query } = require('../../config/db')

const SOURCE = 'integration.blanktex_decoinks_products'
const managedInBlankTex = (message = 'Products are managed in BlankTex and appear here automatically') => {
  throw Object.assign(new Error(message), { statusCode: 409 })
}

async function list({ page = 1, limit = 10, search = '', product_type = '', active = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['deleted_at IS NULL']
  const params = []
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length} OR brand ILIKE $${params.length} OR model_number ILIKE $${params.length})`)
  }
  if (product_type) { params.push(product_type); conditions.push(`product_type = $${params.length}`) }
  if (active !== '') { params.push(active === 'true'); conditions.push(`is_active = $${params.length}`) }
  const where = `WHERE ${conditions.join(' AND ')}`
  const total = Number((await query(`SELECT COUNT(*) FROM ${SOURCE} ${where}`, params)).rows[0].count)
  params.push(limit, offset)
  const { rows } = await query(
    `SELECT * FROM ${SOURCE} ${where} ORDER BY brand,model_number,color,size
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(`SELECT * FROM ${SOURCE} WHERE id=$1 AND deleted_at IS NULL`, [id])
  if (!rows[0]) throw Object.assign(new Error('Product not found'), { statusCode: 404 })
  return rows[0]
}

async function create() { return managedInBlankTex() }
async function update() { return managedInBlankTex() }
async function toggle() { return managedInBlankTex('Product status is managed in BlankTex') }
async function remove() { return managedInBlankTex('Products cannot be deleted from Decoinks; manage the style in BlankTex') }
async function bulkImport() { return managedInBlankTex('Import products in BlankTex; they appear here automatically') }

module.exports = { list, getById, create, update, toggle, remove, bulkImport }
