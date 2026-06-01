const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { cacheDel } = require('../../config/redis')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

function calcTotals(items, orderType, rushServices, shippingCharges, discountPct, taxPct) {
  let itemsTotal = 0
  for (const item of items) {
    if (orderType === 'apparel' || orderType === 'dtf') {
      itemsTotal += Number(item.unit_price) * Number(item.qty)
    } else if (orderType === 'gangsheet') {
      itemsTotal += Number(item.price_per_sheet) * Number(item.qty)
    }
  }
  const subtotal = +(itemsTotal + Number(rushServices) + Number(shippingCharges)).toFixed(2)
  const discount_amt = +(subtotal * (discountPct / 100)).toFixed(2)
  const tax_amt = +((subtotal - discount_amt) * (taxPct / 100)).toFixed(2)
  const total = +(subtotal - discount_amt + tax_amt).toFixed(2)
  return { subtotal, discount_amt, tax_amt, total, items_total: +itemsTotal.toFixed(2) }
}

async function insertItems(client, orderId, orderType, items) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (orderType === 'apparel') {
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO order_items_apparel (order_id, item, color, size, qty, artwork_no, artwork_size, unit_price, amount, front_image, back_image, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [orderId, item.item, item.color || null, item.size || null, item.qty,
         item.artwork_no || null, item.artwork_size || null, item.unit_price, amount,
         item.front_image || null, item.back_image || null, i]
      )
    } else if (orderType === 'gangsheet') {
      const amount = +(Number(item.price_per_sheet) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO order_items_gangsheet (order_id, size, no_artworks, qty, price_per_sheet, amount, front_image, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orderId, item.size, item.no_artworks || 1, item.qty, item.price_per_sheet, amount, item.front_image || null, i]
      )
    } else if (orderType === 'dtf') {
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, artwork_image, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orderId, item.artwork_name, item.size || null, item.qty, item.unit_price, amount, item.artwork_image || null, i]
      )
    }
  }
}

async function getItemsForOrder(orderId, orderType) {
  let table
  if (orderType === 'apparel') table = 'order_items_apparel'
  else if (orderType === 'gangsheet') table = 'order_items_gangsheet'
  else table = 'order_items_dtf'

  const { rows } = await query(
    `SELECT * FROM ${table} WHERE order_id = $1 ORDER BY sort_order`, [orderId]
  )
  return rows
}

async function list({ page = 1, limit = 10, status = '', order_type = '', customer_id = '', supplier_id = '', date_from = '', date_to = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['o.deleted_at IS NULL']
  const params = []

  if (status) { params.push(status); conditions.push(`o.status = $${params.length}`) }
  if (order_type) { params.push(order_type); conditions.push(`o.order_type = $${params.length}`) }
  const sid = supplier_id || customer_id
  if (sid) { params.push(sid); conditions.push(`o.supplier_id = $${params.length}`) }
  if (date_from) { params.push(date_from); conditions.push(`o.order_date >= $${params.length}`) }
  if (date_to) { params.push(date_to); conditions.push(`o.order_date <= $${params.length}`) }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(`SELECT COUNT(*) FROM orders o ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT o.*, c.name AS supplier_name, u.name AS agent_name
     FROM orders o
     LEFT JOIN suppliers c ON c.id = o.supplier_id
     LEFT JOIN users u ON u.id = o.assigned_to
     ${where}
     ORDER BY o.order_date DESC, o.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT o.*, c.name AS supplier_name, u.name AS agent_name, i.invoice_number
     FROM orders o
     LEFT JOIN suppliers c  ON c.id = o.supplier_id
     LEFT JOIN users u      ON u.id = o.assigned_to
     LEFT JOIN invoices i   ON i.id = o.invoice_id
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  const items = await getItemsForOrder(id, rows[0].order_type)
  return { ...rows[0], items }
}

async function create(data) {
  const {
    supplier_id, supplier_name_text, quotation_id, invoice_id, order_type, order_date, due_date,
    payment_terms, payment_method, payment_status = 'Unpaid', currency = 'USD',
    rush_services = 0, shipping_charges = 0,
    discount_pct = 0, tax_pct = 7,
    notes, contact_name, contact_email, contact_phone,
    shipping_name, shipping_address,
    assigned_to, created_by,
    items = [],
  } = data

  const order_number = await getNextNumber('ORD', 'orders', 'order_number')
  let totals = calcTotals(items, order_type, rush_services, shipping_charges, discount_pct, tax_pct)
  let resolvedSupplierId = supplier_id || null

  // Pull totals from invoice when converting invoice → order
  if (invoice_id && items.length === 0) {
    const { rows: invRows } = await query(
      `SELECT subtotal, discount_amt, tax_amt, total, supplier_id FROM invoices WHERE id = $1`,
      [invoice_id]
    )
    if (!invRows[0]) throw Object.assign(new Error('Linked invoice not found'), { statusCode: 404 })
    const inv = invRows[0]
    totals = {
      subtotal:     Number(inv.subtotal),
      discount_amt: Number(inv.discount_amt),
      tax_amt:      Number(inv.tax_amt),
      total:        Number(inv.total),
      items_total:  Number(inv.subtotal),
    }
    if (!resolvedSupplierId) resolvedSupplierId = inv.supplier_id
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO orders (
         order_number, quotation_id, invoice_id, supplier_id, order_type, order_date, due_date,
         payment_terms, payment_method, payment_status, currency,
         rush_services, shipping_charges, subtotal, discount_pct, discount_amt,
         tax_pct, tax_amt, total, notes,
         contact_name, contact_email, contact_phone,
         shipping_name, shipping_address,
         assigned_to, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        order_number, quotation_id || null, invoice_id || null, resolvedSupplierId, order_type,
        order_date || new Date().toISOString().split('T')[0], due_date || null,
        payment_terms || 'Due on Receipt', payment_method || null, payment_status, currency,
        rush_services, shipping_charges, totals.subtotal, discount_pct, totals.discount_amt,
        tax_pct, totals.tax_amt, totals.total, notes || null,
        contact_name || supplier_name_text || null, contact_email || null, contact_phone || null,
        shipping_name  || supplier_name_text || null, shipping_address || null,
        assigned_to || null, created_by,
      ]
    )
    const order = rows[0]
    await insertItems(client, order.id, order_type, items)
    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'order', $2, 'created', $3)`,
      [created_by, order.id, `Order ${order_number} created (${order_type}, ${items.length} item${items.length !== 1 ? 's' : ''})`]
    )
    await client.query('COMMIT')

    if (invoice_id) {
      await logPipelineEvent({
        event_type: 'order_created_from_invoice',
        source_table: 'invoices',
        source_id: invoice_id,
        target_table: 'orders',
        target_id: order.id,
        triggered_by: created_by,
      })
    }

    await cacheDel('dashboard:stats', 'dashboard:orders-by-status')
    return getById(order.id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, data, actorId) {
  const existing = await getById(id)
  const items     = data.items || []
  const order_type  = existing.order_type   // order_type is immutable after creation
  const rush        = data.rush_services    ?? existing.rush_services
  const shipping    = data.shipping_charges ?? existing.shipping_charges
  const discPct     = data.discount_pct     ?? existing.discount_pct
  const taxPct      = data.tax_pct          ?? existing.tax_pct
  // Recalculate only if items provided; otherwise preserve existing totals
  const totals = items.length
    ? calcTotals(items, order_type, rush, shipping, discPct, taxPct)
    : { subtotal: existing.subtotal, discount_amt: existing.discount_amt, tax_amt: existing.tax_amt, total: existing.total }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: updated } = await client.query(
      `UPDATE orders SET
         order_date       = COALESCE($1,  order_date),
         due_date         = COALESCE($2,  due_date),
         payment_terms    = COALESCE($3,  payment_terms),
         payment_method   = COALESCE($4,  payment_method),
         payment_status   = COALESCE($5,  payment_status),
         rush_services    = $6,
         shipping_charges = $7,
         subtotal         = $8,
         discount_pct     = $9,
         discount_amt     = $10,
         tax_pct          = $11,
         tax_amt          = $12,
         total            = $13,
         notes            = COALESCE($14, notes),
         contact_name     = COALESCE($15, contact_name),
         contact_email    = COALESCE($16, contact_email),
         contact_phone    = COALESCE($17, contact_phone),
         shipping_name    = COALESCE($18, shipping_name),
         shipping_address = COALESCE($19, shipping_address),
         assigned_to      = COALESCE($20, assigned_to),
         updated_at       = NOW()
       WHERE id = $21 AND deleted_at IS NULL
       RETURNING id`,
      [
        data.order_date, data.due_date, data.payment_terms, data.payment_method,
        data.payment_status ?? null,
        rush, shipping,
        totals.subtotal, discPct, totals.discount_amt,
        taxPct, totals.tax_amt, totals.total,
        data.notes, data.contact_name, data.contact_email, data.contact_phone,
        data.shipping_name, data.shipping_address, data.assigned_to,
        id,
      ]
    )
    if (!updated[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })

    if (items.length) {
      const tableMap = { apparel: 'order_items_apparel', gangsheet: 'order_items_gangsheet', dtf: 'order_items_dtf' }
      await client.query(`DELETE FROM ${tableMap[order_type]} WHERE order_id = $1`, [id])
      await insertItems(client, id, order_type, items)
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

async function updateStatus(id, status, actor) {
  const actorId   = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  const { rows: cur } = await query(
    `SELECT status FROM orders WHERE id = $1 AND deleted_at IS NULL`, [id]
  )
  if (!cur[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  if (actorUser) validateTransition('order', cur[0].status, status, actorUser)

  const { rows } = await query(
    `UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *`,
    [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })

  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'order', $2, 'status_changed', $3)`,
    [actorId, id, `Order ${rows[0].order_number} status changed to ${status}`]
  ).catch(() => {})

  await cacheDel('dashboard:stats', 'dashboard:orders-by-status')
  return rows[0]
}

async function getInvoice(orderId) {
  const { rows } = await query(
    `SELECT i.*, c.name AS supplier_name
     FROM orders o
     JOIN invoices i ON i.id = o.invoice_id
     LEFT JOIN suppliers c ON c.id = i.supplier_id
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [orderId]
  )
  if (!rows[0]) throw Object.assign(new Error('No invoice found for this order'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE orders SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
}

const BOARD_STATUSES = ['Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered']

async function getBoard() {
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.status, o.order_type, o.due_date, o.total, o.created_at,
            c.name AS supplier_name
     FROM orders o
     LEFT JOIN suppliers c ON c.id = o.supplier_id
     WHERE o.deleted_at IS NULL AND o.status = ANY($1::text[])
     ORDER BY o.due_date ASC NULLS LAST, o.created_at DESC`,
    [BOARD_STATUSES]
  )
  const grouped = {}
  for (const s of BOARD_STATUSES) grouped[s] = []
  for (const row of rows) grouped[row.status].push(row)
  return BOARD_STATUSES.map(status => ({ status, orders: grouped[status] }))
}

module.exports = { list, getById, getBoard, create, update, updateStatus, getInvoice, remove }
