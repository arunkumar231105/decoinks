const { query, pool } = require('../../config/db')

/**
 * Claims and refunds.
 *
 * Nothing here stores a customer's name, an order number or an invoice total —
 * those are read back through the keys every time, so a claim can never show a
 * figure the order itself has since changed.
 *
 * A claim is raised against a purchase order: that is the document the shop
 * works from. The sales order and invoice behind it are read off the PO on the
 * server, never taken from the form, so the three can never disagree.
 */

const STATUSES = ['Draft', 'Raised', 'Under Review', 'Need More Info', 'Approved', 'Rejected', 'Refunded', 'Closed']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (message, status = 400) => Object.assign(new Error(message), { status, statusCode: status })

// Reads the claim with the things around it named, never copied.
const CLAIM_SELECT = `
  SELECT cl.*,
         c.customer_number, COALESCE(NULLIF(c.company_name,''), c.name) AS customer_name,
         c.email AS customer_email, c.phone AS customer_phone,
         o.order_number, o.order_date, o.total AS order_total, o.order_type,
         i.invoice_number, i.total AS invoice_total, i.balance_due AS invoice_balance_due,
         po.po_number, po.order_date AS po_date, po.total AS po_total,
         po.status::text AS po_status, po.po_type,
         sup.name AS supplier_name,
         sh.shipment_number, sh.carrier, sh.tracking_number,
         sh.status::text AS shipment_status, sh.ship_date, sh.estimated_delivery, sh.delivered_date,
         u.name AS responsible_admin_name,
         cb.name AS created_by_name
    FROM claims cl
    LEFT JOIN customers c ON c.id = cl.customer_id
    LEFT JOIN orders    o ON o.id = cl.order_id
    LEFT JOIN invoices  i ON i.id = cl.invoice_id
    LEFT JOIN purchase_orders po ON po.id = cl.purchase_order_id
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    LEFT JOIN shipments sh ON sh.id = cl.shipment_id
    LEFT JOIN users     u ON u.id = cl.responsible_admin_id
    LEFT JOIN users    cb ON cb.id = cl.created_by`

// The parcels a PO went out in. A parcel's target is the sales order; the PO it
// was handed in on is kept in from_po_id (po_id on older rows). Parcels that name
// no PO at all belong to the whole order, so they are offered too.
const PO_SHIPMENTS = `
  SELECT sh.id, sh.shipment_number, sh.carrier, sh.tracking_number,
         sh.status::text AS status, sh.ship_date, sh.estimated_delivery, sh.delivered_date,
         COALESCE(sh.from_po_id, sh.po_id) AS po_id
    FROM shipments sh
   WHERE sh.deleted_at IS NULL
     AND (sh.from_po_id = $1 OR sh.po_id = $1
          OR ($2::uuid IS NOT NULL AND sh.order_id = $2 AND sh.from_po_id IS NULL AND sh.po_id IS NULL))
   ORDER BY sh.ship_date DESC NULLS LAST`

async function nextClaimNumber(client = null) {
  const run = client ? client.query.bind(client) : query
  // High-water mark, the same rule the other document series use, so a number
  // is never handed out twice even after a claim is deleted.
  const { rows } = await run(
    `SELECT 'CLM-2026-' || lpad(
       (COALESCE(MAX(NULLIF(split_part(claim_number,'-',3),'')::INT), 0) + 1)::text, 4, '0') AS n
       FROM claims WHERE claim_number LIKE 'CLM-2026-%'`)
  return rows[0].n
}

/**
 * Fills the sales order, invoice and customer in from the chosen purchase order,
 * and refuses a PO that belongs to someone else.
 */
async function resolvePurchaseOrder(run, data, currentCustomerId = null) {
  if (!data.purchase_order_id) return data
  if (!UUID_RE.test(String(data.purchase_order_id))) throw fail('Choose a valid purchase order')
  const po = (await run(
    `SELECT p.id, COALESCE(p.customer_id, o.customer_id) AS customer_id, p.order_id, o.invoice_id
       FROM purchase_orders p LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`, [data.purchase_order_id])).rows[0]
  if (!po) throw fail('That purchase order no longer exists')
  const wanted = data.customer_id ?? currentCustomerId
  if (wanted && po.customer_id && wanted !== po.customer_id) {
    throw fail('That purchase order belongs to a different customer')
  }
  return {
    ...data,
    customer_id: wanted ?? po.customer_id,
    order_id: po.order_id ?? null,
    invoice_id: po.invoice_id ?? null,
  }
}

async function list({ page = 1, limit = 20, search = '', status = '', customer_id = '' } = {}) {
  const where = ['cl.deleted_at IS NULL']
  const params = []
  if (search) {
    params.push(`%${search}%`)
    where.push(`(cl.claim_number ILIKE $${params.length} OR o.order_number ILIKE $${params.length}
                 OR po.po_number ILIKE $${params.length}
                 OR c.name ILIKE $${params.length} OR c.company_name ILIKE $${params.length})`)
  }
  if (status) { params.push(status); where.push(`cl.status = $${params.length}`) }
  if (customer_id) { params.push(customer_id); where.push(`cl.customer_id = $${params.length}`) }

  const total = (await query(
    `SELECT COUNT(*)::INT AS n FROM claims cl
       LEFT JOIN customers c ON c.id = cl.customer_id
       LEFT JOIN orders o ON o.id = cl.order_id
       LEFT JOIN purchase_orders po ON po.id = cl.purchase_order_id
      WHERE ${where.join(' AND ')}`, params)).rows[0].n

  params.push(limit, (page - 1) * limit)
  const { rows } = await query(
    `${CLAIM_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY cl.created_at DESC, cl.claim_number DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
  return { rows, total }
}

async function getById(id) {
  if (!UUID_RE.test(String(id))) return null
  const claim = (await query(`${CLAIM_SELECT} WHERE cl.id = $1 AND cl.deleted_at IS NULL`, [id])).rows[0]
  if (!claim) return null
  const [items, attachments, history, reviews, comments] = await Promise.all([
    query(`SELECT * FROM claim_items WHERE claim_id = $1 ORDER BY created_at`, [id]),
    query(`SELECT a.*, u.name AS uploaded_by_name FROM claim_attachments a
             LEFT JOIN users u ON u.id = a.uploaded_by
            WHERE a.claim_id = $1 ORDER BY a.uploaded_at`, [id]),
    query(`SELECT h.*, u.name AS changed_by_name FROM claim_status_history h
             LEFT JOIN users u ON u.id = h.changed_by
            WHERE h.claim_id = $1 ORDER BY h.changed_at`, [id]),
    query(`SELECT r.*, u.name AS reviewer_name FROM claim_reviews r
             LEFT JOIN users u ON u.id = r.reviewer_id
            WHERE r.claim_id = $1 ORDER BY r.reviewed_at DESC`, [id]),
    query(`SELECT cm.*, u.name AS user_name FROM claim_comments cm
             LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.claim_id = $1 ORDER BY cm.created_at`, [id]),
  ])
  return { ...claim, items: items.rows, attachments: attachments.rows,
           status_history: history.rows, reviews: reviews.rows, comments: comments.rows }
}

const CREATE_FIELDS = ['customer_id', 'order_id', 'invoice_id', 'purchase_order_id', 'shipment_id',
  'claim_category', 'sub_issue',
  'quantity_affected', 'claimed_amount', 'reported_via', 'description', 'preferred_resolution',
  'requested_amount', 'urgency_by_date', 'customer_comments', 'status']

const asList = v => (Array.isArray(v) ? v : [v].filter(Boolean))

async function insertAttachment(run, claimId, a, userId) {
  await run(
    `INSERT INTO claim_attachments (claim_id, file_name, file_url, file_type, mime_type, file_size, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [claimId, a.file_name, a.file_url, a.file_type ?? null, a.mime_type ?? null,
     a.file_size ?? null, a.description ?? null, userId])
}

async function create(input, actorId = null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const run = client.query.bind(client)
    const data = await resolvePurchaseOrder(run, input)
    if (!data.purchase_order_id && !data.order_id) throw fail('Choose the purchase order')

    const number = await nextClaimNumber(client)
    const status = data.status === 'Draft' ? 'Draft' : 'Raised'

    const cols = ['claim_number', 'created_by', 'status']
    const vals = [number, actorId, status]
    for (const f of CREATE_FIELDS) {
      if (f === 'status' || data[f] === undefined) continue
      cols.push(f)
      vals.push(f === 'preferred_resolution' ? asList(data[f]) : data[f])
    }
    // A claim raised the old way, against a sales order alone: the invoice is
    // worth resolving now, since the summary shows its total.
    if (!cols.includes('invoice_id') && data.order_id) {
      const inv = (await run(`SELECT invoice_id FROM orders WHERE id = $1`, [data.order_id])).rows[0]
      if (inv?.invoice_id) { cols.push('invoice_id'); vals.push(inv.invoice_id) }
    }
    if (!data.purchase_order_id && data.order_id) {
      const po = (await run(
        `SELECT id FROM purchase_orders WHERE order_id = $1 AND deleted_at IS NULL`, [data.order_id])).rows
      if (po.length === 1) { cols.push('purchase_order_id'); vals.push(po[0].id); data.purchase_order_id = po[0].id }
    }
    // One parcel needs no choosing.
    if (!data.shipment_id && data.purchase_order_id) {
      const sh = (await run(PO_SHIPMENTS, [data.purchase_order_id, data.order_id ?? null])).rows
      if (sh.length === 1) {
        const at = cols.indexOf('shipment_id')
        if (at >= 0) vals[at] = sh[0].id
        else { cols.push('shipment_id'); vals.push(sh[0].id) }
      }
    }

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')
    const { rows } = await run(
      `INSERT INTO claims (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`, vals)
    const id = rows[0].id

    for (const it of data.items ?? []) {
      await run(
        `INSERT INTO claim_items (claim_id, order_item_table, order_item_id, invoice_item_id,
                                  purchase_order_item_table, purchase_order_item_id,
                                  quantity_affected, reason, claimed_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, it.order_item_table ?? null, it.order_item_id ?? null, it.invoice_item_id ?? null,
         it.purchase_order_item_table ?? null, it.purchase_order_item_id ?? null,
         it.quantity_affected ?? null, it.reason ?? null, it.claimed_amount ?? null])
    }
    for (const a of data.attachments ?? []) await insertAttachment(run, id, a, actorId)
    await run(
      `INSERT INTO claim_status_history (claim_id, status, changed_by, notes)
       VALUES ($1,$2,$3,$4)`, [id, status, actorId, 'Claim created'])

    await client.query('COMMIT')
    return getById(id)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

const UPDATE_FIELDS = [...CREATE_FIELDS]

async function update(id, input, actorId = null, role = null) {
  if (!UUID_RE.test(String(id))) throw fail('Claim not found', 404)
  const current = (await query(
    `SELECT status, customer_id FROM claims WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0]
  if (!current) throw fail('Claim not found', 404)

  // Draft and Raised are the author's to choose; every later state is a decision,
  // and a decision is the admin's.
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw fail('Unknown claim status')
    if (input.status !== current.status && !['Draft', 'Raised'].includes(input.status) && role !== 'Admin') {
      throw fail('Only an admin can move a claim past Raised', 403)
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const run = client.query.bind(client)
    const data = await resolvePurchaseOrder(run, input, current.customer_id)
    // Choosing another PO means its parcel may not be this one any more.
    if (input.purchase_order_id && input.shipment_id === undefined) data.shipment_id = null

    const sets = []
    const params = []
    for (const f of UPDATE_FIELDS) {
      if (data[f] === undefined) continue
      params.push(f === 'preferred_resolution' ? asList(data[f]) : data[f])
      sets.push(`${f} = $${params.length}`)
    }
    if (sets.length) {
      params.push(id)
      await run(`UPDATE claims SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params)
    }

    // The form sends the evidence as it now stands: what was removed goes, what
    // is new (no id yet) is added, what was already there is left alone.
    if (Array.isArray(data.attachments)) {
      const keep = data.attachments.map(a => a.id).filter(v => UUID_RE.test(String(v)))
      await run(`DELETE FROM claim_attachments WHERE claim_id = $1 AND NOT (id = ANY($2::uuid[]))`, [id, keep])
      for (const a of data.attachments.filter(a => !a.id)) await insertAttachment(run, id, a, actorId)
    }

    if (data.status && data.status !== current.status) {
      await run(`INSERT INTO claim_status_history (claim_id, status, changed_by, notes) VALUES ($1,$2,$3,$4)`,
        [id, data.status, actorId, data.status_note ?? null])
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return getById(id)
}

/**
 * The admin decision. Only an Admin reaches this — the route enforces it — so
 * the form can show the panel to everyone and let nobody but an admin save it.
 */
async function review(id, data, reviewerId) {
  if (!UUID_RE.test(String(id))) throw fail('Claim not found', 404)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const exists = (await client.query(
      `SELECT 1 FROM claims WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0]
    if (!exists) throw fail('Claim not found', 404)

    await client.query(
      `INSERT INTO claim_reviews (claim_id, reviewer_id, decision, review_notes, resolution_type, approved_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, reviewerId, data.decision, data.review_notes ?? null,
       data.resolution_type ?? null, data.approved_amount ?? null])

    // A decision moves the claim: approved, refused, or sent back for detail —
    // and "Need More Info" is a state the claim waits in, not "Under Review".
    const status = data.decision === 'Approve' ? 'Approved'
                 : data.decision === 'Reject'  ? 'Rejected'
                 : 'Need More Info'
    await client.query(
      // $2 is read as a decision and again as a text comparison, so it is cast
      // once here rather than left for Postgres to guess at twice.
      `UPDATE claims SET decision = $2::text, review_notes = $3, resolution_type = $4,
              approved_amount = $5, responsible_admin_id = $6,
              approval_date = CASE WHEN $2::text = 'Approve' THEN NOW() ELSE approval_date END,
              status = $7, updated_at = NOW()
        WHERE id = $1`,
      [id, data.decision, data.review_notes ?? null, data.resolution_type ?? null,
       data.approved_amount ?? null, reviewerId, status])
    await client.query(
      `INSERT INTO claim_status_history (claim_id, status, changed_by, notes) VALUES ($1,$2,$3,$4)`,
      [id, status, reviewerId, data.review_notes ?? null])
    await client.query('COMMIT')
    return getById(id)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function addComment(id, comment, userId) {
  await query(`INSERT INTO claim_comments (claim_id, user_id, comment) VALUES ($1,$2,$3)`, [id, userId, comment])
  return getById(id)
}

async function addAttachment(id, a, userId) {
  await insertAttachment(query, id, a, userId)
  return getById(id)
}

async function removeAttachment(claimId, attachmentId) {
  await query(`DELETE FROM claim_attachments WHERE id = $1 AND claim_id = $2`, [attachmentId, claimId])
  return getById(claimId)
}

async function remove(id, actorId = null) {
  await query(`UPDATE claims SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id])
  await query(`INSERT INTO claim_status_history (claim_id, status, changed_by, notes) VALUES ($1,'Closed',$2,'Claim deleted')`,
    [id, actorId])
  return true
}

/** The purchase orders a claim can be raised against, for the second dropdown. */
async function purchaseOrdersForCustomer(customerId) {
  if (!UUID_RE.test(String(customerId))) return []
  const { rows } = await query(
    `SELECT p.id, p.po_number, p.order_date, p.total, p.status::text AS status, p.po_type,
            s.name AS supplier_name,
            p.order_id, o.order_number, o.invoice_id, i.invoice_number, i.total AS invoice_total
       FROM purchase_orders p
       LEFT JOIN orders o    ON o.id = p.order_id AND o.deleted_at IS NULL
       LEFT JOIN invoices i  ON i.id = o.invoice_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.deleted_at IS NULL AND COALESCE(p.customer_id, o.customer_id) = $1
      ORDER BY p.order_date DESC NULLS LAST, p.po_number DESC`, [customerId])
  return rows
}

/** One purchase order with the sales order, invoice and parcels behind it. */
async function chainForPurchaseOrder(poId) {
  if (!UUID_RE.test(String(poId))) return null
  const po = (await query(
    `SELECT p.id, p.po_number, p.order_date, p.total, p.status::text AS status, p.po_type,
            s.name AS supplier_name, COALESCE(p.customer_id, o.customer_id) AS customer_id,
            p.order_id, o.order_number, o.order_date AS sales_order_date, o.total AS order_total,
            o.invoice_id, i.invoice_number, i.total AS invoice_total, i.balance_due
       FROM purchase_orders p
       LEFT JOIN orders o    ON o.id = p.order_id AND o.deleted_at IS NULL
       LEFT JOIN invoices i  ON i.id = o.invoice_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`, [poId])).rows[0]
  if (!po) return null
  const ships = await query(PO_SHIPMENTS, [poId, po.order_id])
  return { purchase_order: po, shipments: ships.rows }
}

/** The sales orders of a customer — kept for claims raised before POs were the key. */
async function ordersForCustomer(customerId) {
  if (!UUID_RE.test(String(customerId))) return []
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.order_date, o.total, o.order_type, o.status::text AS status,
            o.invoice_id, i.invoice_number, i.total AS invoice_total
       FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.customer_id = $1 AND o.deleted_at IS NULL
      ORDER BY o.order_date DESC, o.order_number DESC`, [customerId])
  return rows
}

/** The POs and shipments behind one order. */
async function chainForOrder(orderId) {
  if (!UUID_RE.test(String(orderId))) return { purchase_orders: [], shipments: [] }
  const [pos, ships] = await Promise.all([
    query(`SELECT p.id, p.po_number, p.order_date, p.total, p.status::text AS status,
                  s.name AS supplier_name
             FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.order_id = $1 AND p.deleted_at IS NULL
            ORDER BY p.order_date DESC, p.po_number DESC`, [orderId]),
    query(`SELECT sh.id, sh.shipment_number, sh.carrier, sh.tracking_number,
                  sh.status::text AS status, sh.ship_date, sh.estimated_delivery, sh.delivered_date,
                  sh.po_id
             FROM shipments sh
            WHERE sh.order_id = $1 AND sh.deleted_at IS NULL
            ORDER BY sh.ship_date DESC NULLS LAST`, [orderId]),
  ])
  return { purchase_orders: pos.rows, shipments: ships.rows }
}

/** Everything the details panel shows about the order behind a PO, in one call. */
async function orderDetails(orderId) {
  if (!UUID_RE.test(String(orderId))) return null
  const order = (await query(
    `SELECT o.*, COALESCE(NULLIF(c.company_name,''), c.name) AS customer_name, c.customer_number,
            i.invoice_number, i.total AS invoice_total, i.balance_due
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.id = $1 AND o.deleted_at IS NULL`, [orderId])).rows[0]
  if (!order) return null
  const items = (await query(
    `SELECT 'order_items_apparel' AS source_table, id, item AS description, qty, unit_price, amount, color, size
       FROM order_items_apparel WHERE order_id = $1
     UNION ALL
     SELECT 'order_items_dtf', id, artwork_name, qty, unit_price, amount, NULL, size
       FROM order_items_dtf WHERE order_id = $1
     UNION ALL
     SELECT 'order_items_gangsheet', id, 'Gang sheet ' || COALESCE(size,''), qty, price_per_sheet, amount, NULL, size
       FROM order_items_gangsheet WHERE order_id = $1`, [orderId])).rows
  return { ...order, items }
}

module.exports = { list, getById, create, update, review, addComment, addAttachment,
                   removeAttachment, remove, purchaseOrdersForCustomer, chainForPurchaseOrder,
                   ordersForCustomer, orderDetails, chainForOrder, nextClaimNumber, STATUSES }
