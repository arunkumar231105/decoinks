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
// Queried per insert batch (cheap) rather than cached for the process lifetime,
// so a migration that adds columns is picked up without a restart.
async function getPoItemCols(client) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'purchase_order_items'
       AND column_name IN ('artwork_count','front_image','back_image','artwork_size',
                           'brand','color','size','artwork_id','artwork_size_front','artwork_size_back')`
  )
  const _poItemCols = new Set(rows.map(r => r.column_name))
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
    if (cols.has('artwork_size'))  { extraCols.push('artwork_size');  extraVals.push(item.artwork_size  || null) }
    if (cols.has('front_image'))   { extraCols.push('front_image');   extraVals.push(item.front_image || null) }
    if (cols.has('back_image'))    { extraCols.push('back_image');    extraVals.push(item.back_image  || null) }
    if (cols.has('brand'))              { extraCols.push('brand');              extraVals.push(item.brand || null) }
    if (cols.has('color'))              { extraCols.push('color');              extraVals.push(item.color || null) }
    if (cols.has('size'))               { extraCols.push('size');               extraVals.push(item.size  || null) }
    if (cols.has('artwork_id'))         { extraCols.push('artwork_id');         extraVals.push(item.artwork_id || null) }
    if (cols.has('artwork_size_front')) { extraCols.push('artwork_size_front'); extraVals.push(item.artwork_size_front || null) }
    if (cols.has('artwork_size_back'))  { extraCols.push('artwork_size_back');  extraVals.push(item.artwork_size_back  || null) }

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

// ── Junction-table helpers (replace-all semantics inside a transaction) ──────

// A gangsheet PO can cover many orders; an apparel PO covers exactly one.
function assertOrderCount(poType, orderIds) {
  if (poType === 'apparel' && orderIds.length > 1) {
    throw Object.assign(
      new Error('A Custom Printed Apparel PO can cover only one order'),
      { statusCode: 400 }
    )
  }
}

async function replaceOrders(client, poId, orderIds) {
  await client.query(`DELETE FROM po_orders WHERE po_id = $1`, [poId])
  for (let i = 0; i < orderIds.length; i++) {
    await client.query(
      `INSERT INTO po_orders (po_id, order_id, sort_order)
       VALUES ($1, $2, $3) ON CONFLICT (po_id, order_id) DO NOTHING`,
      [poId, orderIds[i], i]
    )
  }
  // Keep the legacy single-order FK pointing at the first covered order
  await client.query(
    `UPDATE purchase_orders SET order_id = $2 WHERE id = $1`,
    [poId, orderIds[0] || null]
  )
}

async function replaceFragments(client, poId, fragments) {
  // A fragment may only reference an order this PO actually covers; anything
  // else is stored with a NULL order link rather than a dangling reference.
  const { rows: coveredRows } = await client.query(
    `SELECT order_id FROM po_orders WHERE po_id = $1`, [poId]
  )
  const covered = new Set(coveredRows.map(r => r.order_id))

  await client.query(`DELETE FROM po_gangsheet_fragments WHERE po_id = $1`, [poId])
  const seenFragmentNos = new Set()
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i]
    // Guarantee a unique fragment_no within the PO (backstopped by 045 index).
    let fragmentNo = f.fragment_no || `GS-${String(i + 1).padStart(2, '0')}`
    while (seenFragmentNos.has(fragmentNo)) fragmentNo = `${fragmentNo}-${i + 1}`
    seenFragmentNos.add(fragmentNo)

    await client.query(
      `INSERT INTO po_gangsheet_fragments
         (po_id, fragment_no, order_id, width_inches, length_inches,
          artworks_count, qty, file_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        poId,
        fragmentNo,
        f.order_id && covered.has(f.order_id) ? f.order_id : null,
        f.width_inches ?? null,
        f.length_inches ?? null,
        Number(f.artworks_count) || 0,
        Number(f.qty) || 0,
        f.file_url || null,
        f.sort_order ?? i,
      ]
    )
  }
}

async function replaceArtworks(client, poId, artworkIds) {
  await client.query(`DELETE FROM po_artworks WHERE po_id = $1`, [poId])
  for (let i = 0; i < artworkIds.length; i++) {
    await client.query(
      `INSERT INTO po_artworks (po_id, artwork_id, sort_order)
       VALUES ($1, $2, $3) ON CONFLICT (po_id, artwork_id) DO NOTHING`,
      [poId, artworkIds[i], i]
    )
  }
}

// ── List / Get ────────────────────────────────────────────────────────────────

async function list({ page = 1, limit = 10, status = '', supplier_id = '', search = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['po.deleted_at IS NULL']
  const params = []

  if (status)      { params.push(status);      conditions.push(`po.status = $${params.length}`) }
  if (supplier_id) { params.push(supplier_id); conditions.push(`po.supplier_id = $${params.length}`) }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(
      po.po_number ILIKE $${params.length}
      OR po.source_po_number ILIKE $${params.length}
      OR po.vendor_name ILIKE $${params.length}
      OR cust.name ILIKE $${params.length}
      OR po.shipping_address ILIKE $${params.length}
    )`)
  }

  const where = 'WHERE ' + conditions.join(' AND ')
  const countRes = await query(
    `SELECT COUNT(*)
     FROM purchase_orders po
     LEFT JOIN customers cust ON cust.id = po.customer_id
     ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT po.*,
            COALESCE(po.vendor_name, s.name, os.name, o.contact_name) AS display_vendor_name,
            s.name      AS supplier_name,
            cust.name   AS customer_name,
            o.order_number,
            u.name      AS created_by_name
     FROM purchase_orders po
     LEFT JOIN suppliers s  ON s.id  = po.supplier_id
     LEFT JOIN customers cust ON cust.id = po.customer_id
     LEFT JOIN orders   o  ON o.id  = po.order_id
     LEFT JOIN suppliers os ON os.id = o.supplier_id
     LEFT JOIN users    u  ON u.id  = po.created_by
     ${where}
     ORDER BY po.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getImportSummary() {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS po_entries,
       COUNT(DISTINCT source_po_number)::int AS unique_po_numbers,
       COUNT(DISTINCT customer_id)::int AS customers,
       COALESCE(SUM(total_gangsheets), 0)::int AS gangsheets,
       COALESCE(SUM(total_artworks), 0)::int AS artworks,
       COALESCE(SUM(payment_received), 0)::numeric(12,2) AS paid_revenue,
       COALESCE(SUM(shipping_charge), 0)::numeric(12,2) AS shipping_collected,
       COALESCE(SUM(net_product_amount), 0)::numeric(12,2) AS net_product_amount,
       COUNT(*) FILTER (WHERE source_payment_status = 'Free/Reprint')::int AS free_reprints
     FROM purchase_orders
     WHERE deleted_at IS NULL AND source_system = 'decoinks_dtf_po_master_apr_jun_2026'`
  )
  const qa = await query(
    `SELECT COUNT(*)::int AS qa_notes
     FROM po_import_qa_notes
     WHERE source_system = 'decoinks_dtf_po_master_apr_jun_2026'`
  )
  return { ...rows[0], qa_notes: qa.rows[0].qa_notes }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email,
            s.phone AS supplier_phone, s.city AS supplier_city,
            s.company AS supplier_company,
            sc.name AS contact_name, sc.email AS contact_email,
            sc.phone AS contact_phone, sc.wechat_id AS contact_wechat,
            u.name AS created_by_name, b.name AS buyer_name,
            o.order_number AS order_number,
            cust.name AS customer_name, cust.email AS customer_email,
            cust.phone AS customer_phone
     FROM purchase_orders po
     LEFT JOIN suppliers s          ON s.id  = po.supplier_id
     LEFT JOIN supplier_contacts sc ON sc.id = po.supplier_contact_id
     LEFT JOIN users u ON u.id = po.created_by
     LEFT JOIN users b ON b.id = po.buyer_id
     LEFT JOIN orders o ON o.id = po.order_id
     LEFT JOIN customers cust ON cust.id = po.customer_id
     WHERE po.id = $1 AND po.deleted_at IS NULL`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })
  const po = rows[0]

  // Apparel items — artwork preview joined from artworks, never copied
  const items = await query(
    `SELECT poi.*,
            a.artwork_no    AS artwork_no_ref,
            a.name          AS artwork_name,
            a.file_url      AS artwork_file_url,
            a.thumbnail_url AS artwork_thumbnail_url
     FROM purchase_order_items poi
     LEFT JOIN artworks a ON a.id = poi.artwork_id
     WHERE poi.po_id = $1
     ORDER BY poi.sort_order, poi.created_at`,
    [id]
  )

  // Orders this PO covers — all display data joined live from orders
  const orders = await query(
    `SELECT o.id, o.order_number, o.status, o.order_type, o.order_date, o.due_date,
            ag.name AS agent_name,
            COALESCE(gs.no_artworks, 0)::int AS no_artworks,
            COALESCE(gs.qty, 0)::int         AS qty,
            gs.sizes                          AS gangsheet_sizes
     FROM po_orders poo
     JOIN orders o ON o.id = poo.order_id
     LEFT JOIN users ag ON ag.id = COALESCE(o.assigned_to, o.created_by)
     LEFT JOIN LATERAL (
       SELECT SUM(no_artworks) AS no_artworks,
              SUM(qty)         AS qty,
              STRING_AGG(DISTINCT size, ', ') AS sizes
       FROM order_items_gangsheet g WHERE g.order_id = o.id
     ) gs ON TRUE
     WHERE poo.po_id = $1
     ORDER BY poo.sort_order, poo.created_at`,
    [id]
  )

  // Master gangsheet fragments
  const fragments = await query(
    `SELECT f.*, o.order_number AS covers_order_number
     FROM po_gangsheet_fragments f
     LEFT JOIN orders o ON o.id = f.order_id
     WHERE f.po_id = $1
     ORDER BY f.sort_order, f.created_at`,
    [id]
  )

  // Attached artworks — thumbnail/link joined from artworks
  const artworks = await query(
    `SELECT a.id, a.artwork_no, a.name, a.file_url, a.thumbnail_url, a.file_type
     FROM po_artworks pa
     JOIN artworks a ON a.id = pa.artwork_id
     WHERE pa.po_id = $1
     ORDER BY pa.sort_order, pa.created_at`,
    [id]
  )

  const order_total_artworks = orders.rows.reduce((sum, r) => sum + (r.no_artworks || 0), 0)
  let qaNotes = []
  if (po.source_system && po.source_po_number) {
    const qa = await query(
      `SELECT id, issue_type, details, created_at
       FROM po_import_qa_notes
       WHERE source_system = $1 AND source_po_number = $2
       ORDER BY created_at, issue_type`,
      [po.source_system, po.source_po_number]
    )
    qaNotes = qa.rows
  }

  return {
    ...po,
    items: items.rows,
    orders: orders.rows,
    fragments: fragments.rows,
    artworks: artworks.rows,
    qa_notes: qaNotes,
    order_total_artworks,
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

async function create(data) {
  const {
    vendor_id, supplier_reference, payment_terms, currency = 'USD', exchange_rate = 1,
    buyer_id, department, priority = 'Medium', shipping_method, shipping_address,
    billing_address, terms_conditions, order_date, expected_date, notes,
    freight_charges = 0, other_charges = 0, order_id,
    po_type = 'apparel', supplier_contact_id = null,
    communication_method = 'email', payment_status = 'Unpaid',
    fragments = [], artwork_ids = [],
    items = [], created_by,
  } = data
  const supplier_id = data.supplier_id || vendor_id || null
  const order_ids = data.order_ids || (order_id ? [order_id] : [])
  assertOrderCount(po_type, order_ids)

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
          total_discount, total_tax, freight_charges, other_charges, grand_total, order_id,
          po_type, supplier_contact_id, communication_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
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
        order_ids[0] || null,
        po_type,
        supplier_contact_id,
        communication_method,
        payment_status,
      ]
    )
    const po = rows[0]
    await insertItems(client, po.id, items)
    if (order_ids.length)   await replaceOrders(client, po.id, order_ids)
    if (fragments.length)   await replaceFragments(client, po.id, fragments)
    if (artwork_ids.length) await replaceArtworks(client, po.id, artwork_ids)

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

  // Enforce the apparel = one-order rule on EVERY update path, using the
  // effective type after this update and the effective covered-order set
  // (whether the caller resent order_ids or not).
  const effectiveType = data.po_type || existing.po_type
  const effectiveOrderIds = data.order_ids !== undefined
    ? data.order_ids
    : (existing.orders || []).map(o => o.id)
  assertOrderCount(effectiveType, effectiveOrderIds)

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
         po_type              = COALESCE($24, po_type),
         supplier_contact_id  = COALESCE($25, supplier_contact_id),
         communication_method = COALESCE($26, communication_method),
         payment_status       = COALESCE($27, payment_status),
         updated_at        = NOW()
       WHERE id = $28 AND deleted_at IS NULL
       RETURNING *`,
      [
        data.vendor_name, data.order_date, data.expected_date,
        subtotal, grand_total, data.notes,
        data.supplier_id, data.supplier_reference, data.payment_terms,
        data.currency, data.exchange_rate, data.buyer_id, data.department, data.priority,
        data.shipping_method, data.shipping_address, data.billing_address, data.terms_conditions,
        total_discount, total_tax, freight, other, grand_total,
        data.po_type, data.supplier_contact_id, data.communication_method, data.payment_status,
        id,
      ]
    )
    if (!rows[0]) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 })

    if (data.items) {
      await client.query(`DELETE FROM purchase_order_items WHERE po_id = $1`, [id])
      await insertItems(client, id, data.items)
    }
    // `!== undefined` so an explicit empty array clears the relation (matches
    // "user removed everything"); an omitted key leaves it untouched.
    if (data.order_ids   !== undefined) await replaceOrders(client, id, data.order_ids)
    if (data.fragments   !== undefined) await replaceFragments(client, id, data.fragments)
    if (data.artwork_ids !== undefined) await replaceArtworks(client, id, data.artwork_ids)

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
  list, getImportSummary, getById, create, update, updateStatus, remove,
  listAttachments, addAttachment, removeAttachment,
  getStatusHistory, sendToPortal,
}
