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
  const product = rows[0]
  const [colors, sizes, variants, images, decorations] = await Promise.all([
    query(`SELECT style_color_id,color_name,display_name,hex_color,color_family,
                  supplier_color_code,internal_color_code,is_popular,is_default,active,discontinued
             FROM blanktex.style_colors WHERE style_id=$1
            ORDER BY sort_order,display_name`, [product.style_id]),
    query(`SELECT z.style_size_id,z.size_code,z.size_name,z.size_group,z.display_order,
                  z.is_default,z.active,z.discontinued,to_jsonb(sp) size_spec
             FROM blanktex.style_sizes z
             LEFT JOIN blanktex.style_size_specs sp ON sp.style_size_id=z.style_size_id
            WHERE z.style_id=$1 ORDER BY z.display_order,z.size_name`, [product.style_id]),
    query(`SELECT sku_id,sku_code,supplier_sku,barcode,weight_lbs,style_color_id,style_size_id,
                  active,discontinued FROM blanktex.style_color_sizes
            WHERE style_id=$1 ORDER BY sku_code`, [product.style_id]),
    query(`SELECT style_image_id,
                  CASE WHEN image_url ~ '^https?://' THEN image_url
                       ELSE 'https://blanktex.decoinkssuite.com/' || ltrim(image_url,'/') END image_url,
                  alt_text,is_primary,sort_order
             FROM blanktex.style_images WHERE style_id=$1
            ORDER BY is_primary DESC,sort_order,created_at`, [product.style_id]),
    query(`SELECT process_type,supplier_color_code,size_range,notes
             FROM blanktex.style_decorations WHERE style_id=$1 ORDER BY process_type`, [product.style_id]),
  ])
  return {
    ...product,
    colors: colors.rows,
    sizes: sizes.rows,
    variants: variants.rows,
    images: images.rows,
    decorations: decorations.rows,
    total_colors: colors.rows.length,
    total_sizes: sizes.rows.length,
    total_skus: variants.rows.length,
  }
}

async function create() { return managedInBlankTex() }
async function update() { return managedInBlankTex() }
async function toggle() { return managedInBlankTex('Product status is managed in BlankTex') }
async function remove() { return managedInBlankTex('Products cannot be deleted from Decoinks; manage the style in BlankTex') }
async function bulkImport() { return managedInBlankTex('Import products in BlankTex; they appear here automatically') }

module.exports = { list, getById, create, update, toggle, remove, bulkImport }
