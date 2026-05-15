const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

async function list({ page = 1, limit = 10, status = '' }) {
  const offset = (page - 1) * limit
  const params = []
  const conditions = []
  if (status) { params.push(status); conditions.push(`status = $${params.length}`) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const countRes = await query(`SELECT COUNT(*) FROM purchase_orders ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT po.*, u.name AS created_by_name
     FROM purchase_orders po LEFT JOIN users u ON u.id = po.created_by
     ${where} ORDER BY po.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT po.*, u.name AS created_by_name FROM purchase_orders po
     LEFT JOIN users u ON u.id = po.created_by WHERE po.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
  const items = await query(`SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id`, [id])
  return { ...rows[0], items: items.rows }
}

function calcTotal(items) {
  const subtotal = +items.reduce((s, i) => s + Number(i.unit_cost) * Number(i.qty), 0).toFixed(2)
  return { subtotal, total: subtotal }  // no tax/discount on POs
}

async function insertItems(client, poId, items) {
  for (const item of items) {
    const amount = +(Number(item.unit_cost) * Number(item.qty)).toFixed(2)
    await client.query(
      `INSERT INTO purchase_order_items (po_id, description, qty, unit_cost, amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [poId, item.description, item.qty, item.unit_cost, amount]
    )
  }
}

async function create({ vendor_name, order_date, expected_date, notes, items = [], created_by }) {
  const po_number = await getNextNumber('PO', 'purchase_orders', 'po_number')
  const { subtotal, total } = calcTotal(items)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO purchase_orders
         (po_number, vendor_name, order_date, expected_date, subtotal, total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [po_number, vendor_name || null,
       order_date || null, expected_date || null,
       subtotal, total, notes || null, created_by]
    )
    await insertItems(client, rows[0].id, items)
    await client.query('COMMIT')
    return getById(rows[0].id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, data) {
  const existing = await getById(id)
  const items = data.items || existing.items
  const { subtotal, total } = calcTotal(items)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE purchase_orders
       SET vendor_name   = COALESCE($1, vendor_name),
           order_date    = COALESCE($2, order_date),
           expected_date = COALESCE($3, expected_date),
           subtotal      = $4,
           total         = $5,
           notes         = COALESCE($6, notes),
           updated_at    = NOW()
       WHERE id = $7
       RETURNING *`,
      [data.vendor_name, data.order_date, data.expected_date,
       subtotal, total, data.notes, id]
    )
    if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })

    if (data.items) {
      await client.query(`DELETE FROM purchase_order_items WHERE po_id = $1`, [id])
      await insertItems(client, id, data.items)
    }
    await client.query('COMMIT')
    return getById(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE purchase_orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  // purchase_order_items has ON DELETE CASCADE, so items are removed automatically
  const { rows } = await query(
    `DELETE FROM purchase_orders WHERE id = $1 RETURNING id`, [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
}

module.exports = { list, getById, create, update, updateStatus, remove }
