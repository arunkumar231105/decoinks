const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { cacheDel } = require('../../config/redis')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

function calcTotals(items, orderType, rushServices, shippingCharges, discountPct) {
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
  const total = +(subtotal - discount_amt).toFixed(2)
  return { subtotal, discount_amt, tax_amt: 0, total, items_total: +itemsTotal.toFixed(2) }
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
        `INSERT INTO order_items_gangsheet (order_id, size, no_artworks, qty, price_per_sheet, amount, front_image, back_image, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, item.size, item.no_artworks || 1, item.qty, item.price_per_sheet, amount, item.front_image || null, item.back_image || null, i]
      )
    } else if (orderType === 'dtf') {
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, artwork_image, front_image, back_image, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, item.artwork_name, item.size || null, item.qty, item.unit_price, amount,
         item.artwork_image || item.front_image || null, item.front_image || null, item.back_image || null, i]
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

async function list({ page = 1, limit = 10, status = '', order_type = '', customer_id = '', supplier_id = '', date_from = '', date_to = '', search = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['o.deleted_at IS NULL']
  const params = []

  if (status) { params.push(status); conditions.push(`o.status = $${params.length}`) }
  if (order_type) { params.push(order_type); conditions.push(`o.order_type = $${params.length}`) }
  if (supplier_id) { params.push(supplier_id); conditions.push(`o.supplier_id = $${params.length}`) }
  if (customer_id) { params.push(customer_id); conditions.push(`o.customer_id = $${params.length}`) }
  if (date_from) { params.push(date_from); conditions.push(`o.order_date >= $${params.length}`) }
  if (date_to) { params.push(date_to); conditions.push(`o.order_date <= $${params.length}`) }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(o.order_number ILIKE $${params.length} OR o.source_po_number ILIKE $${params.length} OR o.contact_name ILIKE $${params.length} OR cust.name ILIKE $${params.length})`)
  }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(`SELECT COUNT(*) FROM orders o LEFT JOIN customers cust ON cust.id=o.customer_id ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT o.*, c.name AS supplier_name, cust.name AS customer_name, u.name AS agent_name
     FROM orders o
     LEFT JOIN suppliers c ON c.id = o.supplier_id
     LEFT JOIN customers cust ON cust.id = o.customer_id
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
    `SELECT o.*, c.name AS supplier_name, cust.name AS customer_name, u.name AS agent_name, i.invoice_number
     FROM orders o
     LEFT JOIN suppliers c  ON c.id = o.supplier_id
     LEFT JOIN customers cust ON cust.id = o.customer_id
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
    discount_pct = 0,
    notes, contact_name, contact_email, contact_phone,
    shipping_name, shipping_address,
    assigned_to, created_by,
    items = [],
  } = data

  const order_number = await getNextNumber('ORD', 'orders', 'order_number')
  let totals = calcTotals(items, order_type, rush_services, shipping_charges, discount_pct)
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
        0, 0, totals.total, notes || null,
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

    // Link quote artworks to this order
    if (quotation_id) {
      await query(
        `UPDATE artworks SET order_id = $1 WHERE quotation_id = $2 AND order_id IS NULL`,
        [order.id, quotation_id]
      ).catch(() => {}) // non-fatal: artworks table may not exist yet
    }

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
  // Recalculate only if items provided; otherwise preserve existing totals
  const totals = items.length
    ? calcTotals(items, order_type, rush, shipping, discPct)
    : { subtotal: existing.subtotal, discount_amt: existing.discount_amt, tax_amt: 0, total: +(Number(existing.subtotal) - Number(existing.discount_amt)).toFixed(2) }

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
        0, 0, totals.total,
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
  // Block if any purchase order is linked (ON DELETE RESTRICT on purchase_orders.order_id)
  const { rows: linkedPOs } = await query(
    `SELECT po_number FROM purchase_orders WHERE order_id = $1 LIMIT 1`, [id]
  )
  if (linkedPOs[0]) {
    throw Object.assign(
      new Error(`This order has a linked purchase order (${linkedPOs[0].po_number}) and cannot be deleted. Delete the purchase order first.`),
      { statusCode: 409 }
    )
  }

  // Block if any invoice is linked to this order
  const { rows: linkedInvoices } = await query(
    `SELECT id FROM invoices WHERE order_id = $1 LIMIT 1`, [id]
  )
  if (linkedInvoices[0]) {
    throw Object.assign(
      new Error('This order has a linked invoice and cannot be deleted. Delete the invoice first.'),
      { statusCode: 409 }
    )
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: ord } = await client.query(
      `SELECT id FROM orders WHERE id = $1`, [id]
    )
    if (!ord[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
    // Unlink artworks and shipments (no CASCADE on their order_id FK)
    await client.query(`UPDATE artworks  SET order_id = NULL WHERE order_id = $1`, [id])
    await client.query(`UPDATE shipments SET order_id = NULL WHERE order_id = $1`, [id])
    // order_items_apparel/gangsheet/dtf, portal_order_visibility, portal_status_updates all CASCADE
    await client.query(`DELETE FROM orders WHERE id = $1`, [id])
    await client.query('COMMIT')
    return { id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const BOARD_STATUSES = ['Confirmed', 'In Production', 'QC', 'Ready to Ship', 'Shipped', 'Delivered']

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

async function convertToPO(orderId, actorId) {
  // Multiple POs per order are allowed (e.g. different suppliers)
  const { rows: orderRows } = await query(
    `SELECT id, order_number, order_type, supplier_id, shipping_address, due_date
     FROM orders WHERE id = $1`,
    [orderId]
  )
  if (!orderRows[0]) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  const order = orderRows[0]

  const po_type = order.order_type === 'gangsheet' ? 'gangsheet' : 'apparel'

  // Apparel: pre-populate PO line items from the order's items, resolving
  // each artwork_no to its artworks row so previews join instead of copy.
  let items = []
  if (po_type === 'apparel') {
    const { rows: orderItems } = await query(
      `SELECT oi.item, oi.color, oi.size, oi.qty, oi.artwork_no, oi.artwork_size,
              oi.unit_price, oi.front_image, oi.back_image, oi.sort_order,
              a.id AS artwork_id
       FROM order_items_apparel oi
       LEFT JOIN artworks a ON a.artwork_no = oi.artwork_no
       WHERE oi.order_id = $1
       ORDER BY oi.sort_order`,
      [orderId]
    )
    items = orderItems.map((oi, i) => ({
      item_name:          oi.item,
      color:              oi.color || null,
      size:               oi.size || null,
      qty_ordered:        Number(oi.qty) || 1,
      unit_price:         Number(oi.unit_price) || 0,
      artwork_id:         oi.artwork_id || null,
      artwork_size_front: oi.artwork_size || null,
      artwork_size_back:  oi.artwork_size || null,
      front_image:        oi.front_image || null,
      back_image:         oi.back_image || null,
      sort_order:         oi.sort_order ?? i,
    }))
  }

  // Attach the order's artworks to the PO
  const { rows: artRows } = await query(
    `SELECT id FROM artworks WHERE order_id = $1 ORDER BY created_at`,
    [orderId]
  )

  const poSvc = require('../purchase-orders/po.service')
  const po = await poSvc.create({
    po_type,
    order_ids:        [orderId],
    supplier_id:      order.supplier_id || null,
    shipping_address: order.shipping_address || null,
    expected_date:    order.due_date || null,
    items,
    artwork_ids:      artRows.map(r => r.id),
    created_by:       actorId,
  })
  return { po }
}

// ── CSV Bulk Upload ───────────────────────────────────────────────────────────

function parseCsvOrders(buffer) {
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []
  function parseLine(line) {
    const fields = []; let i = 0
    while (i < line.length) {
      if (line[i] === '"') {
        let val = ''; i++
        while (i < line.length) {
          if (line[i] === '"' && line[i+1] === '"') { val += '"'; i += 2 }
          else if (line[i] === '"') { i++; break }
          else val += line[i++]
        }
        fields.push(val.trim()); if (line[i] === ',') i++
      } else {
        const end = line.indexOf(',', i)
        if (end === -1) { fields.push(line.slice(i).trim()); break }
        fields.push(line.slice(i, end).trim()); i = end + 1
      }
    }
    return fields
  }
  const headers = parseLine(lines[0])
  const result = []
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r].trim()
    if (!line) continue
    const values = parseLine(line)
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = values[idx] ?? '' })
    result.push(obj)
  }
  return result
}

function normH(h) { return h.toLowerCase().replace(/[\s_\-]+/g, '') }

const ORDER_HEADER_MAP = {
  ordertype: 'order_type', type: 'order_type',
  suppliername: 'supplier_name', supplier: 'supplier_name', vendor: 'supplier_name',
  orderdate: 'order_date', date: 'order_date',
  duedate: 'due_date', deliverydate: 'due_date',
  paymentterms: 'payment_terms', terms: 'payment_terms',
  paymentstatus: 'payment_status',
  notes: 'notes', internalnotes: 'notes',
  contactname: 'contact_name', contact: 'contact_name',
  customername: 'contact_name', customer: 'contact_name',   // shared master CSV
  contactemail: 'contact_email', email: 'contact_email', billingemail: 'contact_email',
  contactphone: 'contact_phone', phone: 'contact_phone',
  shippingname: 'shipping_name', shipname: 'shipping_name',
  shippingaddress: 'shipping_address', address: 'shipping_address',
  // item fields (prefix li_)
  item: 'li_item', product: 'li_item', artworkname: 'li_item', description: 'li_item',
  color: 'li_color', colour: 'li_color', colors: 'li_color',
  size: 'li_size', sizes: 'li_size', artworksize: 'li_size',
  qty: 'li_qty', quantity: 'li_qty',
  unitprice: 'li_unit_price', price: 'li_unit_price', rate: 'li_unit_price',
  pricepersheet: 'li_price_per_sheet', sheetprice: 'li_price_per_sheet',
  noartworks: 'li_no_artworks', artworks: 'li_no_artworks', artworkcount: 'li_no_artworks',
  // Quote/invoice-only columns (company, whatsapp, city, state, zip, estimate,
  // status...) are not listed, so they are ignored on an order import.
}

const VALID_ORDER_TYPES = ['apparel', 'gangsheet', 'dtf']

async function bulkCreateOrdersFromCsv(csvBuffer, { dryRun = false, createdBy = null } = {}) {
  let rawRows
  try { rawRows = parseCsvOrders(Buffer.isBuffer(csvBuffer) ? csvBuffer : Buffer.from(csvBuffer)) }
  catch (e) { throw Object.assign(new Error(`CSV parse error: ${e.message}`), { statusCode: 422 }) }
  if (!rawRows || rawRows.length === 0) throw Object.assign(new Error('CSV has no data rows'), { statusCode: 422 })

  const rawHeaders = Object.keys(rawRows[0])
  const colToField = {}
  for (const h of rawHeaders) {
    const norm = normH(h)
    if (ORDER_HEADER_MAP[norm]) colToField[h] = ORDER_HEADER_MAP[norm]
  }

  const processed = []
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]; const rowNumber = i + 2; const errors = []
    const mapped = {}; const li = {}
    for (const [col, field] of Object.entries(colToField)) {
      const val = row[col] ?? ''
      if (field.startsWith('li_')) li[field.slice(3)] = val
      else mapped[field] = val
    }
    // order_type validation
    const ot = (mapped.order_type || '').toLowerCase().trim()
    if (!ot) errors.push('order_type is required (apparel / gangsheet / dtf)')
    else if (!VALID_ORDER_TYPES.includes(ot)) errors.push(`order_type "${ot}" invalid — must be apparel, gangsheet, or dtf`)
    else mapped.order_type = ot

    // numeric fields
    for (const k of ['li_qty','li_no_artworks']) {
      const key = k.replace('li_','')
      if (li[key] !== undefined && li[key] !== '') {
        const n = Number(li[key]); if (isNaN(n)) errors.push(`${key}: "${li[key]}" is not a number`); else li[key] = n
      } else li[key] = key === 'qty' ? 1 : (key === 'no_artworks' ? 1 : undefined)
    }
    for (const k of ['li_unit_price','li_price_per_sheet']) {
      const key = k.replace('li_','')
      if (li[key] !== undefined && li[key] !== '') {
        const n = Number(li[key]); if (isNaN(n)) errors.push(`${key}: "${li[key]}" is not a number`); else li[key] = n
      } else li[key] = 0
    }

    // Nullify empty strings
    for (const k of Object.keys(mapped)) if (mapped[k] === '') mapped[k] = null

    // Build item based on order type
    let item = null
    const hasItem = li.item || li.size || (li.qty && Number(li.qty) > 0)
    if (hasItem && mapped.order_type) {
      if (mapped.order_type === 'apparel') {
        item = { item: li.item || 'Item', color: li.color || 'Black', size: li.size || 'M', qty: Number(li.qty||1), artwork_size: li.size||null, unit_price: Number(li.unit_price||0) }
      } else if (mapped.order_type === 'gangsheet') {
        item = { size: li.size || '22" x 60"', no_artworks: Number(li.no_artworks||1), qty: Number(li.qty||1), price_per_sheet: Number(li.price_per_sheet||0) }
      } else if (mapped.order_type === 'dtf') {
        item = { artwork_name: li.item || 'Artwork', size: li.size || '', qty: Number(li.qty||1), unit_price: Number(li.unit_price||0) }
      }
    }
    processed.push({ rowNumber, mapped, item, errors })
  }

  const validRows = processed.filter(r => r.errors.length === 0)
  const skippedRows = processed.filter(r => r.errors.length > 0)

  if (dryRun) {
    return {
      totalRows: rawRows.length, validRows: validRows.length, skippedRows: skippedRows.length,
      headersDetected: rawHeaders, recognisedColumns: Object.keys(colToField),
      rows: processed.map(({ rowNumber, mapped, item, errors }) => ({ rowNumber, mapped, item, errors })),
    }
  }

  // Pre-resolve supplier IDs by name (batch, case-insensitive)
  const supplierNameMap = new Map()
  const uniqueSupplierNames = [...new Set(validRows.map(r => r.mapped.supplier_name).filter(Boolean))]
  for (const name of uniqueSupplierNames) {
    const { rows } = await query('SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1', [name])
    if (rows[0]) supplierNameMap.set(name.toLowerCase(), rows[0].id)
  }

  const created = []; const skipped = []
  for (const { rowNumber, mapped, item, errors } of processed) {
    if (errors.length > 0) { skipped.push({ rowNumber, errors }); continue }
    try {
      const items = item ? [item] : []
      const resolvedSupplierId = mapped.supplier_id || supplierNameMap.get((mapped.supplier_name || '').toLowerCase()) || null
      const order = await create({
        ...mapped,
        supplier_id:        resolvedSupplierId,
        supplier_name_text: mapped.supplier_name || null,
        items,
        created_by: createdBy,
      })
      created.push({ rowNumber, order_number: order.order_number, id: order.id })
    } catch (err) {
      skipped.push({ rowNumber, errors: [`DB error: ${err.message}`] })
    }
  }
  return { created: created.length, skipped: skipped.length, createdOrders: created, skippedRows: skipped }
}

function getOrderCsvTemplate() {
  const headers = ['order_type','supplier_name','order_date','due_date','payment_terms','payment_status','notes','contact_name','contact_email','contact_phone','shipping_address','item','color','size','qty','unit_price','price_per_sheet','no_artworks']
  const ex1 = ['apparel','ABC Supplier','2026-06-10','2026-06-20','Net 30','Unpaid','Rush order','John Smith','john@abc.com','+1-555-1234','123 Main St, Dallas TX','T-Shirt Premium','Black','XL','50','5.00','','']
  const ex2 = ['dtf','XYZ Vendor','2026-06-10','2026-06-18','Due on Receipt','Unpaid','','Mike Ross','mike@xyz.com','+1-555-5678','','Custom Transfer','','10x12 in','100','1.50','','']
  const ex3 = ['gangsheet','Print Co','2026-06-10','2026-06-25','Net 15','Unpaid','Gangsheet job','Chris Tan','chris@pm.com','+1-555-9012','','','','22" x 60"','5','','18.00','12']
  return [headers, ex1, ex2, ex3].map(r => r.join(',')).join('\n') + '\n'
}

module.exports = { list, getById, getBoard, create, update, updateStatus, getInvoice, remove, convertToPO, bulkCreateOrdersFromCsv, getOrderCsvTemplate }
