const { query } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { uploadFile, deleteFile } = require('../../config/storage')
const path = require('path')

async function list({ page = 1, limit = 10, search = '', status = '', supplier_id = '' }) {
  const offset = (page - 1) * limit
  const conditions = []
  const params = []

  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(a.name ILIKE $${params.length} OR a.artwork_no ILIKE $${params.length})`)
  }
  if (status) { params.push(status); conditions.push(`a.status = $${params.length}`) }
  if (supplier_id) { params.push(supplier_id); conditions.push(`a.supplier_id = $${params.length}`) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(`SELECT COUNT(*) FROM artworks a ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT a.*, c.name AS supplier_name, u.name AS uploader_name FROM artworks a
     LEFT JOIN suppliers c ON c.id = a.supplier_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     ${where} ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT a.*, c.name AS supplier_name, u.name AS uploader_name FROM artworks a
     LEFT JOIN suppliers c ON c.id = a.supplier_id
     LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Artwork not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ artwork_no: providedNo, name, supplier_id, order_id, quotation_id, status = 'Draft', tags, notes, uploaded_by, file }) {
  if (!file) throw Object.assign(new Error('Artwork file is required'), { statusCode: 400 })

  let artwork_no = providedNo || null
  if (artwork_no) {
    const { rows: dupe } = await query(`SELECT id FROM artworks WHERE artwork_no = $1`, [artwork_no])
    if (dupe.length) throw Object.assign(new Error(`Artwork number '${artwork_no}' is already in use`), { statusCode: 409 })
  } else {
    artwork_no = await getNextNumber('AW', 'artworks', 'artwork_no')
  }

  const file_type = path.extname(file.originalname).slice(1).toLowerCase()
  const file_url  = await uploadFile(file.buffer, file.originalname, file.mimetype, 'artworks')

  const tagsArr = tags
    ? (Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()).filter(Boolean))
    : []

  const { rows } = await query(
    `INSERT INTO artworks (artwork_no, name, supplier_id, order_id, quotation_id, status, file_url, file_type, tags, notes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [artwork_no, name, supplier_id || null, order_id || null, quotation_id || null, status,
     file_url, file_type, tagsArr, notes || null, uploaded_by]
  )
  return rows[0]
}

async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE artworks SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Artwork not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(`DELETE FROM artworks WHERE id=$1 RETURNING *`, [id])
  if (!rows[0]) throw Object.assign(new Error('Artwork not found'), { statusCode: 404 })
  await deleteFile(rows[0].file_url)
}

const DESIGN_STATUSES = ['Draft', 'Pending Approval', 'Changes Requested', 'Approved', 'Archived']

async function getBoard() {
  const { rows } = await query(
    `SELECT a.id, a.artwork_no, a.name, a.status, a.file_url, a.file_type, a.tags, a.created_at,
            c.name AS supplier_name
     FROM artworks a
     LEFT JOIN suppliers c ON c.id = a.supplier_id
     ORDER BY a.created_at DESC`
  )
  const grouped = {}
  for (const s of DESIGN_STATUSES) grouped[s] = []
  for (const row of rows) {
    if (grouped[row.status]) grouped[row.status].push(row)
  }
  return DESIGN_STATUSES.map(status => ({ status, tasks: grouped[status] }))
}

async function createTask({ name, supplier_id, order_id, notes, tags, uploaded_by }) {
  const artwork_no = await getNextNumber('AW', 'artworks', 'artwork_no')
  const tagsArr = tags
    ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean))
    : []
  const { rows } = await query(
    `INSERT INTO artworks (artwork_no, name, supplier_id, order_id, status, file_url, file_type, tags, notes, uploaded_by)
     VALUES ($1,$2,$3,$4,'Pending Review',NULL,NULL,$5,$6,$7) RETURNING *`,
    [artwork_no, name, supplier_id || null, order_id || null, tagsArr, notes || null, uploaded_by || null]
  )
  return rows[0]
}

module.exports = { list, getById, getBoard, create, createTask, updateStatus, remove }
