const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

function calcTotals(items, discountPct, taxPct) {
  const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0)
  const discount_amt = +(subtotal * (discountPct / 100)).toFixed(2)
  const tax_amt = +((subtotal - discount_amt) * (taxPct / 100)).toFixed(2)
  const total = +(subtotal - discount_amt + tax_amt).toFixed(2)
  return { subtotal: +subtotal.toFixed(2), discount_amt, tax_amt, total }
}

async function list({ page = 1, limit = 10, status = '', customer_id = '' }) {
  const offset = (page - 1) * limit
  const conditions = []
  const params = []

  if (status)      { params.push(status);      conditions.push(`q.status = $${params.length}`) }
  if (customer_id) { params.push(customer_id); conditions.push(`q.customer_id = $${params.length}`) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(`SELECT COUNT(*) FROM quotations q ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT q.*, c.name AS customer_name, u.name AS created_by_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN users u ON u.id = q.created_by
     ${where}
     ORDER BY q.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT q.*, c.name AS customer_name FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     WHERE q.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

  const items = await query(
    `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order`, [id]
  )
  return { ...rows[0], items: items.rows }
}

async function create({ lead_id, customer_id, valid_until, discount_pct = 0, tax_pct = 0, notes, items = [], created_by }) {
  const quote_number = await getNextNumber('QT', 'quotations', 'quote_number')
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(items, discount_pct, tax_pct)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO quotations (quote_number, lead_id, customer_id, valid_until, subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [quote_number, lead_id || null, customer_id || null, valid_until || null,
       subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes || null, created_by]
    )
    const qId = rows[0].id
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [qId, item.description, item.qty, item.unit_price, amount, i]
      )
    }
    await client.query('COMMIT')
    return getById(qId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, { lead_id, customer_id, valid_until, discount_pct = 0, tax_pct = 0, notes, items = [] }, actorId) {
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(items, discount_pct, tax_pct)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: updated } = await client.query(
      `UPDATE quotations
       SET lead_id=$1, customer_id=$2, valid_until=$3, subtotal=$4, discount_pct=$5,
           discount_amt=$6, tax_pct=$7, tax_amt=$8, total=$9, notes=$10, updated_at=NOW()
       WHERE id=$11
       RETURNING id`,
      [lead_id || null, customer_id || null, valid_until || null,
       subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes || null, id]
    )
    if (!updated[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

    await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id])
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, item.description, item.qty, item.unit_price, amount, i]
      )
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

async function updateStatus(id, status, actorId) {
  const { rows } = await query(
    `UPDATE quotations SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'quotation', $2, 'status_changed', $3)`,
    [actorId, id, `Quotation ${rows[0].quote_number} status changed to ${status}`]
  ).catch(() => {})

  return rows[0]
}

async function remove(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, quote_number FROM quotations WHERE id = $1`, [id]
    )
    if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

    await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id])
    await client.query(`DELETE FROM quotations WHERE id = $1`, [id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { list, getById, create, update, updateStatus, remove }
