const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { validateTransition } = require('../../utils/stateMachine')

// ── Calculations ──────────────────────────────────────────────────────────────

function calcLineTotal(item) {
  const base         = +(Number(item.qty_ordered) * Number(item.unit_price)).toFixed(2)
  const discount_amt = +(base * (Number(item.discount_pct || 0) / 100)).toFixed(2)
  const afterDisc    = +(base - discount_amt).toFixed(2)
  const tax_amt      = +(afterDisc * (Number(item.tax_pct || 0) / 100)).toFixed(2)
  const line_total   = +(afterDisc + tax_amt).toFixed(2)
  return { line_total, discount_amt, tax_amt }
}

function calcTotals(items, freightCharges = 0, otherCharges = 0) {
  let subtotal      = 0
  let total_discount = 0
  let total_tax     = 0
  for (const item of items) {
    const { line_total, discount_amt, tax_amt } = calcLineTotal(item)
    subtotal      += Number(item.qty_ordered) * Number(item.unit_price)
    total_discount += discount_amt
    total_tax      += tax_amt
  }
  subtotal = +subtotal.toFixed(2)
  total_discount = +total_discount.toFixed(2)
  total_tax = +total_tax.toFixed(2)
  const grand_total = +(subtotal - total_discount + total_tax + Number(freightCharges) + Number(otherCharges)).toFixed(2)
  return { subtotal, total_discount, total_tax, grand_total }
}

// ── Item insertion ────────────────────────────────────────────────────────────

// Check once which optional columns exist so inserts don't crash before migrations run
let _poItemCols = null
async function getPoItemCols(client) {
  if (_poItemCols) return _poItemCols
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'purchase_order_items'
       AND column_name IN ('artwork_count','front_image','back_image')`
  )
  _poItemCols = new Set(rows.map(r => r.column_name))
  return _poItemCols
}

async function insertItems(client, poId, items) {
  const cols = await getPoItemCols(client)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const { line_total, discount_amt, tax_amt } = calcLineTotal(item)

    const extraCols = []
    const extraVals = []
    if (cols.has('artwork_count')) { extraCols.push('artwork_count'); extraVals.push(Number(item.artwork_count) || 0) }
    if (cols.has('front_image'))   { extraCols.push('front_image');   extraVals.push(item.front_image || null) }
    if (cols.has('back_image'))    { extraCols.push('back_image');    extraVals.push(item.back_image  || null) }

    const baseCols = ['po_id','item_name','description','qty_ordered','unit_price',
                      'discount_pct','discount_amt','tax_pct','tax_amt','line_total',
                      'hsn_code','uom','product_id','required_by_date','remarks','sort_order']
    const baseVals = [poId, item.item_name, item.description || null, item.qty_ordered, item.unit_price,
                      item.discount_pct || 0, discount_amt, item.tax_pct || 0, tax_amt, line_total,
                      item.hsn_code || null, item.uom || 'pcs', item.product_id || null,
                      item.required_by_date || null, item.remarks || null, item.sort_order ?? i]

    const allCols = [...baseCols, ...extraCols]
    const allVals = [...baseVals, ...extraVals]
    const placeholders = allVals.map((_, idx) => `$${idx + 1}`).join(',')

    await client.query(
      `INSERT INTO purchase_order_items (${allCols.join(',')}) VALUES (${placeholders})`,
      allVals
    )
  }
}

// ── List / Get ────────────────────────────────────────────────────────────────

async function list({ page = 1, limit = 10, status = '', supplier_id = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['po.deleted_at IS NULL']
  const params = []

  if (status)      { params.push(status);      conditions.push(`po.status = $${params.length}`) }
  if (supplier_id) { params.push(supplier_id); conditions.push(`po.supplier_id = $${params.length}`) }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(`SELECT COUNT(*) FROM purchase_orders po ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT po.*,
            COALESCE(po.vendor_name, s.name, o.supplier_name, o.contact_name) AS display_vendor_name,
            s.name      AS supplier_name,
            o.order_number,
            u.name      AS created_by_name
     FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN orders   o ON o.id = po.order_id
     LEFT JOIN users    u ON u.id = po.created_by
     ${where}
     ORDER BY po.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email,
            s.phone AS supplier_phone, s.city AS supplier_city,
            s.company AS supplier_company,
            u.name AS created_by_name, b.name AS buyer_name,
            o.order_number AS order_number
     FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users u ON u.id = po.created_by
     LEFT JOIN users b ON b.id = po.buyer_id
     LEFT JOIN orders o ON o.id = po.order_id
     WHERE po.id = $1 AND po.deleted_at IS NULL`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
  const po = rows[0]

  const items = await query(
    `SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY sort_order, created_at`, [id]
  )

  // Compute total artwork count from linked order's items (fallback when artwork_count column not yet migrated)
  let order_total_artworks = 0
  if (po.order_id) {
    try {
      // Try gangsheet first
      const gsRes = await query(
        `SELECT COALESCE(SUM(no_artworks),0) AS total FROM order_items_gangsheet WHERE order_id = $1`, [po.order_id]
      )
      const gsCount = parseInt(gsRes.rows[0]?.total ?? 0, 10)
      // DTF
      const dtfRes = await query(
        `SELECT COUNT(*) AS total FROM order_items_dtf WHERE order_id = $1`, [po.order_id]
      )
      const dtfCount = parseInt(dtfRes.rows[0]?.total ?? 0, 10)
      // Apparel
      const appRes = await query(
        `SELECT COUNT(*) AS total FROM order_items_apparel WHERE order_id = $1`, [po.order_id]
      )
      const appCount = parseInt(appRes.rows[0]?.total ?? 0, 10)
      order_total_artworks = gsCount || dtfCount || appCount || 0
    } catch (_) {}
  }

  return { ...po, items: items.rows, order_total_artworks }
}

// ── Create ────────────────────────────────────────────────────────────────────

async function create(data) {
  const {
    vendor_id, supplier_reference, payment_terms, currency = 'USD', exchange_rate = 1,
    buyer_id, department, priority = 'Medium', shipping_method, shipping_address,
    billing_address, terms_conditions, order_date, expected_date, notes,
    freight_charges = 0, other_charges = 0, order_id,
    items = [], created_by,
  } = data
  const supplier_id = data.supplier_id || vendor_id || null

  const po_number = await getNextNumber('PO', 'purchase_orders', 'po_number')
  const { subtotal, total_discount, total_tax, grand_total } = calcTotals(items, freight_charges, other_charges)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO purchase_orders
         (po_number, vendor_name, order_date, expected_date, subtotal, total, notes, created_by,
          supplier_id, supplier_reference, payment_terms, currency, exchange_rate,
          buyer_id, department, priority, shipping_method, shipping_address,
          billing_address, terms_conditions,
          total_discount, total_tax, freight_charges, other_charges, grand_total, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING *`,
      [
        po_number,
        data.vendor_name || null,
        order_date || null,
        expected_date || null,
        subtotal,
        grand_total,
        notes || null,
        created_by,
        supplier_id || null,
        supplier_reference || null,
        payment_terms || null,
        currency,
        exchange_rate,
        buyer_id || null,
        department || null,
        priority,
        shipping_method || null,
        shipping_address || null,
        billing_address || null,
        terms_conditions || null,
        total_discount,
        total_tax,
        freight_charges,
        other_charges,
        grand_total,
        order_id || null,
      ]
    )
    const po = rows[0]
    await insertItems(client, po.id, items)

    await client.query(
      `INSERT INTO po_status_history (po_id, from_status, to_status, changed_by, comment)
       VALUES ($1, NULL, $2, $3, $4)`,
      [po.id, 'Draft', created_by, 'PO created']
    )

    await client.query('COMMIT')
    return getById(po.id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

async function update(id, data) {
  const existing = await getById(id)
  const items = data.items || existing.items
  const freight = data.freight_charges ?? existing.freight_charges ?? 0
  const other   = data.other_charges   ?? existing.other_charges   ?? 0
  const { subtotal, total_discount, total_tax, grand_total } = calcTotals(items, freight, other)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE purchase_orders SET
         vendor_name       = COALESCE($1,  vendor_name),
         order_date        = COALESCE($2,  order_date),
         expected_date     = COALESCE($3,  expected_date),
         subtotal          = $4,
         total             = $5,
         notes             = COALESCE($6,  notes),
         supplier_id       = COALESCE($7,  supplier_id),
         supplier_reference= COALESCE($8,  supplier_reference),
         payment_terms     = COALESCE($9,  payment_terms),
         currency          = COALESCE($10, currency),
         exchange_rate     = COALESCE($11, exchange_rate),
         buyer_id          = COALESCE($12, buyer_id),
         department        = COALESCE($13, department),
         priority          = COALESCE($14, priority),
         shipping_method   = COALESCE($15, shipping_method),
         shipping_address  = COALESCE($16, shipping_address),
         billing_address   = COALESCE($17, billing_address),
         terms_conditions  = COALESCE($18, terms_conditions),
         total_discount    = $19,
         total_tax         = $20,
         freight_charges   = $21,
         other_charges     = $22,
         grand_total       = $23,
         updated_at        = NOW()
       WHERE id = $24 AND deleted_at IS NULL
       RETURNING *`,
      [
        data.vendor_name, data.order_date, data.expected_date,
        subtotal, grand_total, data.notes,
        data.supplier_id, data.supplier_reference, data.payment_terms,
        data.currency, data.exchange_rate, data.buyer_id, data.department, data.priority,
        data.shipping_method, data.shipping_address, data.billing_address, data.terms_conditions,
        total_discount, total_tax, freight, other, grand_total,
        id,
      ]
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

// ── Status update ─────────────────────────────────────────────────────────────

async function updateStatus(id, status, actor, comment) {
  const changedBy = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: current } = await client.query(
      `SELECT status FROM purchase_orders WHERE id = $1 AND deleted_at IS NULL`, [id]
    )
    if (!current[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
    if (actorUser) validateTransition('po', current[0].status, status, actorUser)

    const { rows } = await client.query(
      `UPDATE purchase_orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, id]
    )

    await client.query(
      `INSERT INTO po_status_history (po_id, from_status, to_status, changed_by, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, current[0].status, status, changedBy, comment || null]
    )

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Soft delete ───────────────────────────────────────────────────────────────

async function remove(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: po } = await client.query(
      `SELECT id FROM purchase_orders WHERE id = $1`, [id]
    )
    if (!po[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
    // purchase_order_items, po_attachments, po_status_history, portal_po_visibility all ON DELETE CASCADE
    await client.query(`DELETE FROM purchase_orders WHERE id = $1`, [id])
    await client.query('COMMIT')
    return { id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Attachments ───────────────────────────────────────────────────────────────

async function listAttachments(poId) {
  const { rows } = await query(
    `SELECT pa.*, u.name AS uploaded_by_name FROM po_attachments pa
     LEFT JOIN users u ON u.id = pa.uploaded_by
     WHERE pa.po_id = $1 ORDER BY pa.created_at DESC`,
    [poId]
  )
  return rows
}

async function addAttachment(poId, uploadedBy, { filename, file_url, file_size, mime_type }) {
  const { rows } = await query(
    `INSERT INTO po_attachments (po_id, filename, file_url, file_size, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [poId, filename, file_url, file_size || null, mime_type || null, uploadedBy]
  )
  return rows[0]
}

async function removeAttachment(poId, attachId) {
  const { rows } = await query(
    `DELETE FROM po_attachments WHERE id = $1 AND po_id = $2 RETURNING id`,
    [attachId, poId]
  )
  if (!rows[0]) throw Object.assign(new Error('Attachment not found'), { statusCode: 404 })
}

// ── Status history ────────────────────────────────────────────────────────────

async function getStatusHistory(poId) {
  const { rows } = await query(
    `SELECT psh.*, u.name AS changed_by_name FROM po_status_history psh
     LEFT JOIN users u ON u.id = psh.changed_by
     WHERE psh.po_id = $1 ORDER BY psh.created_at ASC`,
    [poId]
  )
  return rows
}

// ── Send to portal ────────────────────────────────────────────────────────────

async function sendToPortal(poId, sentByUserId, overrideSupplierId) {
  const po = await getById(poId)
  const supplierId = overrideSupplierId || po.supplier_id
  if (!supplierId) throw new Error('No supplier linked to this PO')

  await query(
    `INSERT INTO portal_po_visibility (po_id, supplier_id, sent_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (po_id, supplier_id) DO UPDATE SET is_visible = TRUE, sent_at = NOW()`,
    [poId, supplierId, sentByUserId]
  )

  await query(
    `INSERT INTO portal_notifications (supplier_id, type, title, message, reference_id)
     VALUES ($1, 'new_po', 'New Purchase Order', $2, $3)`,
    [supplierId, `Purchase Order ${po.po_number} is now available in your portal`, poId]
  )

  return { success: true }
}

module.exports = {
  list, getById, create, update, updateStatus, remove,
  listAttachments, addAttachment, removeAttachment,
  getStatusHistory, sendToPortal,
}
