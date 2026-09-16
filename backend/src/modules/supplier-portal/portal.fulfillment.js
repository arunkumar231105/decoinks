/**
 * Supplier Order Management — the Fulfillment Portal's purchase-order grid.
 *
 * One row per purchase order shared with the signed-in supplier: the customer,
 * the sales order, the factory making it, the day it was pushed there, what is
 * being made and how many, and where it stands.
 *
 * Where it stands is worked out, not typed, as far as it can be:
 *
 *   1. the parcel's own tracking, once the PO carries a tracking number and the
 *      ten-minute courier sync has read it — Pre-Transit, In Transit, Delivered,
 *      or Exception when the courier reports a failure or a return;
 *   2. the shop closing the PO (Received / Closed) — Delivered;
 *   3. a tracking number not yet read by the sync, or a PO marked Shipped — Shipped;
 *   4. the stage the supplier set — To be Pushed, Factory Audit, In Production,
 *      Exception;
 *   5. otherwise the PO itself: In Production if it says so, else To be Pushed.
 *
 * Supplier stages, factories and push dates live on purchase_orders and
 * supplier_factories (migration 143). Nothing here shows the customer's prices
 * (see SUPPLIER_POS_FOR_ORDER in portal.service.js).
 */

const db = require('../../config/db')
const { validateTransition } = require('../../utils/stateMachine')
const { shopDate } = require('../../utils/shopTime')

const SUPPLIER_STAGES = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception']

// Display order of every stage the grid can show.
const STAGES = [
  'To be Pushed', 'Factory Audit', 'In Production', 'Exception',
  'Shipped', 'Pre-Transit', 'In Transit', 'Delivered', 'Cancelled',
]
const NOT_YET_SHIPPED = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception']

const httpError = (status, message) => Object.assign(new Error(message), { status })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function assertVisible(supplierId, poId) {
  if (!UUID.test(String(poId || ''))) throw httpError(404, 'Purchase order not found or not shared with you')
  const { rows } = await db.query(
    `SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [poId, supplierId]
  )
  if (!rows.length) throw httpError(404, 'Purchase order not found or not shared with you')
}

const humanTracking = (code) => {
  switch (String(code || '').toUpperCase()) {
    case 'PRE_TRANSIT': return 'Label created'
    case 'TRANSIT':     return 'In transit'
    case 'DELIVERED':   return 'Delivered'
    case 'RETURNED':    return 'Returned to sender'
    case 'FAILURE':     return 'Delivery problem'
    default:            return null
  }
}

/** Every PO shared with this supplier, one row each, with its worked-out stage. */
async function loadRows(supplierId) {
  const { rows } = await db.query(
    `SELECT po.id, po.po_number, po.status::text AS po_status,
            po.supplier_stage, po.supplier_stage_note, po.supplier_stage_updated_at,
            po.factory_status, po.pushed_at::text AS pushed_at,
            COALESCE(po.order_date, po.created_at::date)::text AS issue_date,
            po.tracking_number, po.carrier AS po_carrier,
            po.order_id, o.order_number, (o.deleted_at IS NOT NULL) AS order_archived,
            COALESCE(NULLIF(BTRIM(c.name), ''), NULLIF(BTRIM(o.shipping_name), ''), o.contact_name) AS customer_name,
            NULLIF(CONCAT_WS(', ', NULLIF(BTRIM(c.city), ''), NULLIF(BTRIM(c.state), ''), NULLIF(BTRIM(c.country), '')), '') AS customer_location,
            f.id AS factory_id, f.name AS factory_name, f.is_active AS factory_active,
            sh.tracking_status, sh.status_details AS tracking_details, sh.carrier AS sh_carrier,
            sh.tracking_synced_at,
            COALESCE(pl.qty, ol.qty) AS qty,
            COALESCE(pl.items, ol.items) AS items
       FROM portal_po_visibility ppv
       JOIN purchase_orders po ON po.id = ppv.po_id
       LEFT JOIN orders o ON o.id = po.order_id
       LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, po.customer_id)
       LEFT JOIN supplier_factories f ON f.id = po.factory_id AND f.supplier_id = ppv.supplier_id
       -- The parcel carrying this PO's tracking number, as the courier sync last read it.
       LEFT JOIN LATERAL (
         SELECT s.tracking_status, s.status_details, s.carrier, s.tracking_synced_at
           FROM shipments s
          WHERE s.deleted_at IS NULL
            AND NULLIF(BTRIM(po.tracking_number), '') IS NOT NULL
            AND s.tracking_number = BTRIM(po.tracking_number)
          ORDER BY s.tracking_synced_at DESC NULLS LAST, s.updated_at DESC
          LIMIT 1
       ) sh ON TRUE
       -- What is being made: the PO's own lines where it has them…
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT NULLIF(BTRIM(x.name), ''), ', ') AS items,
                NULLIF(SUM(COALESCE(x.q, 0)), 0)::int AS qty
           FROM (SELECT item_name AS name, qty_ordered AS q FROM purchase_order_items WHERE po_id = po.id
                 UNION ALL
                 SELECT COALESCE(item_name, item_description), quantity FROM po_apparel_items WHERE purchase_order_id = po.id) x
       ) pl ON TRUE
       -- …else the sales order's, which is what most POs here were raised from.
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT NULLIF(BTRIM(y.name), ''), ', ') AS items,
                NULLIF(SUM(COALESCE(y.q, 0)), 0)::int AS qty
           FROM (SELECT COALESCE(NULLIF(BTRIM(i.item), ''), 'Apparel') AS name, i.qty AS q
                   FROM order_items_apparel i WHERE i.order_id = po.order_id
                 UNION ALL
                 SELECT 'DTF Transfers', i.qty FROM order_items_dtf i WHERE i.order_id = po.order_id
                 UNION ALL
                 SELECT 'Gangsheets', g.qty FROM order_items_gangsheet g WHERE g.order_id = po.order_id) y
       ) ol ON TRUE
      WHERE ppv.supplier_id = $1 AND ppv.is_visible = TRUE AND po.deleted_at IS NULL`,
    [supplierId]
  )
  return rows.map(shapeRow)
}

function stageOf(r) {
  const courier = String(r.tracking_status || '').toUpperCase()
  if (r.po_status === 'Cancelled') return 'Cancelled'
  if (courier === 'DELIVERED') return 'Delivered'
  if (courier === 'TRANSIT') return 'In Transit'
  if (courier === 'PRE_TRANSIT') return 'Pre-Transit'
  if (courier === 'FAILURE' || courier === 'RETURNED') return 'Exception'
  if (['Received', 'Partially Received', 'Closed'].includes(r.po_status)) return 'Delivered'
  if (String(r.tracking_number || '').trim() || r.po_status === 'Shipped') return 'Shipped'
  if (r.supplier_stage) return r.supplier_stage
  if (r.po_status === 'In Production') return 'In Production'
  if (r.factory_status === 'Factory Audit') return 'Factory Audit'
  return 'To be Pushed'
}

function shapeRow(r) {
  const stage = stageOf(r)
  const trackingText =
    (r.tracking_status && (r.tracking_details || humanTracking(r.tracking_status))) ||
    (stage === 'Exception' && r.supplier_stage === 'Exception' ? (r.supplier_stage_note || 'Exception') : null) ||
    (stage === 'Shipped' && r.tracking_number ? 'Awaiting first scan' : null)
  return {
    id: r.id,
    po_number: r.po_number,
    customer_name: r.customer_name,
    customer_location: r.customer_location,
    order_id: r.order_id,
    order_number: r.order_number,
    order_archived: r.order_archived,
    factory: r.factory_id ? { id: r.factory_id, name: r.factory_name, is_active: r.factory_active } : null,
    push_date: r.pushed_at,
    issue_date: r.issue_date,
    stage,
    // Whether the supplier's own stage is still the one showing (the courier and
    // the shop take over once the PO has shipped or closed).
    stage_editable: NOT_YET_SHIPPED.includes(stage),
    supplier_stage: r.supplier_stage,
    stage_note: r.supplier_stage_note,
    items: r.items,
    qty: r.qty,
    courier: r.sh_carrier || r.po_carrier || null,
    tracking_number: String(r.tracking_number || '').trim() || null,
    tracking_status: r.tracking_status || null,
    tracking_text: trackingText,
    tracking_synced_at: r.tracking_synced_at,
    po_status: r.po_status,
  }
}

const SORTS = {
  po_number: r => r.po_number,
  customer: r => (r.customer_name || '').toLowerCase(),
  order_number: r => r.order_number || '',
  factory: r => (r.factory?.name || '').toLowerCase(),
  push_date: r => r.push_date || '',
  issue_date: r => r.issue_date || '',
  stage: r => STAGES.indexOf(r.stage),
  items: r => (r.items || '').toLowerCase(),
  qty: r => r.qty ?? -1,
  courier: r => (r.courier || '').toLowerCase(),
  tracking_number: r => r.tracking_number || '',
  tracking_text: r => (r.tracking_text || '').toLowerCase(),
}

/**
 * The grid: filtered, sorted and paged, with the stage counts for the cards and
 * the options for the Factory and Courier filters (both over everything shared,
 * so the cards do not change as the supplier filters).
 */
async function getOrderGrid(supplierId, query = {}) {
  const all = await loadRows(supplierId)

  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25))
  const search = String(query.search || '').trim().toLowerCase()
  const stage = String(query.stage || '').trim()
  const factory = String(query.factory || '').trim()
  const courier = String(query.courier || '').trim().toLowerCase()
  const DATE = /^\d{4}-\d{2}-\d{2}$/
  const pushFrom = DATE.test(String(query.push_from || '')) ? query.push_from : null
  const pushTo = DATE.test(String(query.push_to || '')) ? query.push_to : null
  const sortKey = SORTS[query.sort] ? query.sort : 'issue_date'
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 1 : -1

  let rows = all
  if (search) {
    rows = rows.filter(r => [r.po_number, r.order_number, r.customer_name, r.tracking_number, r.factory?.name, r.items]
      .some(v => String(v || '').toLowerCase().includes(search)))
  }
  if (stage === 'Pending') rows = rows.filter(r => NOT_YET_SHIPPED.includes(r.stage))
  else if (stage === 'Issued') rows = rows.filter(r => r.stage !== 'Cancelled')
  else if (stage) rows = rows.filter(r => r.stage === stage)
  if (factory === 'none') rows = rows.filter(r => !r.factory)
  else if (factory) rows = rows.filter(r => r.factory?.id === factory)
  if (courier === 'none') rows = rows.filter(r => !r.courier)
  else if (courier) rows = rows.filter(r => String(r.courier || '').toLowerCase() === courier)
  if (pushFrom) rows = rows.filter(r => r.push_date && r.push_date >= pushFrom)
  if (pushTo) rows = rows.filter(r => r.push_date && r.push_date <= pushTo)

  const key = SORTS[sortKey]
  rows = [...rows].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x < y) return -1 * dir
    if (x > y) return 1 * dir
    return String(b.po_number).localeCompare(String(a.po_number))
  })

  const counts = Object.fromEntries(STAGES.map(s => [s, 0]))
  for (const r of all) counts[r.stage] = (counts[r.stage] || 0) + 1

  const factories = new Map()
  for (const r of all) if (r.factory) factories.set(r.factory.id, r.factory.name)
  const { rows: listed } = await db.query(
    `SELECT id, name FROM supplier_factories WHERE supplier_id = $1 ORDER BY LOWER(name)`, [supplierId])
  for (const f of listed) factories.set(f.id, f.name)

  const couriers = [...new Set(all.map(r => r.courier).filter(Boolean).map(c => String(c).toUpperCase()))].sort()

  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    summary: {
      total: all.length,
      issued: all.filter(r => r.stage !== 'Cancelled').length,
      pending: all.filter(r => NOT_YET_SHIPPED.includes(r.stage)).length,
      stages: counts,
    },
    filters: {
      stages: STAGES,
      factories: [...factories].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      couriers,
    },
  }
}

/**
 * The supplier moves a PO along: its stage, the factory, the push date, a note.
 * Any of them may be sent alone. The shop's own fields follow where they mean
 * the same thing, so the shop's PO list agrees with the portal.
 */
async function updateOrderStage(supplierId, poId, body = {}) {
  await assertVisible(supplierId, poId)

  const has = k => Object.prototype.hasOwnProperty.call(body, k)
  const stage = has('stage') ? body.stage : undefined
  if (stage !== undefined && stage !== null && !SUPPLIER_STAGES.includes(stage)) {
    throw httpError(422, `Stage must be one of: ${SUPPLIER_STAGES.join(', ')}`)
  }
  let note = has('note') ? (body.note == null ? null : String(body.note).trim()) : undefined
  if (note === '') note = null
  if (note && note.length > 500) throw httpError(422, 'The note can be at most 500 characters')

  let factoryId = has('factory_id') ? (body.factory_id || null) : undefined
  if (factoryId && !UUID.test(String(factoryId))) throw httpError(422, 'That factory is not one of yours')
  if (factoryId) {
    const { rows } = await db.query(
      `SELECT id, is_active FROM supplier_factories WHERE id = $1 AND supplier_id = $2`, [factoryId, supplierId])
    if (!rows.length) throw httpError(422, 'That factory is not one of yours')
    if (!rows[0].is_active) throw httpError(422, 'That factory is switched off — switch it on first')
  }

  let pushedAt = has('push_date') ? (body.push_date || null) : undefined
  if (pushedAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pushedAt) || Number.isNaN(Date.parse(`${pushedAt}T00:00:00Z`))) {
      throw httpError(422, 'Push date must be a date (YYYY-MM-DD)')
    }
    if (pushedAt > shopDate(Date.now() + 86400000)) throw httpError(422, 'Push date cannot be in the future')
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows: cur } = await client.query(
      `SELECT id, status::text AS status, supplier_stage, pushed_at FROM purchase_orders
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [poId])
    if (!cur.length) throw httpError(404, 'Purchase order not found')
    const po = cur[0]

    // Pushing to a factory (or starting production) dates the push, unless the
    // supplier gave the date.
    if (pushedAt === undefined && ['Factory Audit', 'In Production'].includes(stage) && !po.pushed_at) {
      pushedAt = shopDate()
    }

    const sets = []
    const params = [poId]
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`) }
    if (stage !== undefined) {
      set('supplier_stage', stage)
      sets.push('supplier_stage_updated_at = NOW()')
      // The shop's factory_status (migration 133) says the same where it can.
      const mirror = { 'To be Pushed': 'To be Pushed', 'Factory Audit': 'Factory Audit', 'In Production': 'Pushed' }[stage]
      if (mirror) set('factory_status', mirror)
    }
    if (note !== undefined) set('supplier_stage_note', note)
    if (factoryId !== undefined) set('factory_id', factoryId)
    if (pushedAt !== undefined) set('pushed_at', pushedAt)
    if (!sets.length) throw httpError(400, 'Nothing to update')

    await client.query(`UPDATE purchase_orders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params)

    // In Production is also the PO's own status. Walk it there through the
    // supplier's allowed steps (Sent → Accepted → In Production); if the PO is
    // anywhere else the shop owns its status and it is left alone.
    if (stage === 'In Production' && ['Sent', 'Accepted'].includes(po.status)) {
      const path = po.status === 'Sent' ? ['Accepted', 'In Production'] : ['In Production']
      let from = po.status
      for (const to of path) {
        validateTransition('po', from, to, { id: supplierId, role: 'supplier' })
        await client.query(`UPDATE purchase_orders SET status = $2, updated_at = NOW() WHERE id = $1`, [poId, to])
        await client.query(
          `INSERT INTO po_status_history (po_id, from_status, to_status, comment)
           VALUES ($1, $2, $3, 'Updated by supplier via portal (stage: In Production)')`,
          [poId, from, to])
        from = to
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  const rows = await loadRows(supplierId)
  return rows.find(r => r.id === poId)
}

/** One PO's grid row, for its detail page. */
async function getOrderRow(supplierId, poId) {
  await assertVisible(supplierId, poId)
  const rows = await loadRows(supplierId)
  return rows.find(r => r.id === poId) || null
}

// ── Factories ────────────────────────────────────────────────────────────────

async function listFactories(supplierId) {
  const { rows } = await db.query(
    `SELECT f.id, f.name, f.city, f.country, f.is_active, f.created_at,
            (SELECT COUNT(*)::int FROM purchase_orders po
              WHERE po.factory_id = f.id AND po.deleted_at IS NULL) AS po_count
       FROM supplier_factories f
      WHERE f.supplier_id = $1
      ORDER BY f.is_active DESC, LOWER(f.name)`,
    [supplierId]
  )
  return rows
}

function cleanFactory(body, { partial }) {
  const out = {}
  for (const k of ['name', 'city', 'country']) {
    if (body[k] === undefined) continue
    const v = body[k] == null ? null : String(body[k]).trim()
    if (k === 'name') {
      if (!v) throw httpError(422, 'Factory name is required')
      if (v.length > 120) throw httpError(422, 'Factory name can be at most 120 characters')
    } else if (v && v.length > 80) {
      throw httpError(422, `${k === 'city' ? 'City' : 'Country'} can be at most 80 characters`)
    }
    out[k] = v || null
  }
  if (body.is_active !== undefined) out.is_active = Boolean(body.is_active)
  if (!partial && !out.name) throw httpError(422, 'Factory name is required')
  return out
}

const duplicate = (err) => {
  if (err.code === '23505') throw httpError(409, 'You already have a factory with that name')
  throw err
}

async function createFactory(supplierId, body = {}) {
  const f = cleanFactory(body, { partial: false })
  try {
    const { rows } = await db.query(
      `INSERT INTO supplier_factories (supplier_id, name, city, country)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, city, country, is_active, created_at, 0 AS po_count`,
      [supplierId, f.name, f.city ?? null, f.country ?? null]
    )
    return rows[0]
  } catch (err) { return duplicate(err) }
}

async function updateFactory(supplierId, factoryId, body = {}) {
  if (!UUID.test(String(factoryId || ''))) throw httpError(404, 'Factory not found')
  const f = cleanFactory(body, { partial: true })
  const cols = Object.keys(f)
  if (!cols.length) throw httpError(400, 'Nothing to update')
  const params = [factoryId, supplierId, ...cols.map(c => f[c])]
  try {
    const { rows } = await db.query(
      `UPDATE supplier_factories SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
        WHERE id = $1 AND supplier_id = $2
        RETURNING id, name, city, country, is_active, created_at`,
      params
    )
    if (!rows.length) throw httpError(404, 'Factory not found')
    return rows[0]
  } catch (err) { return duplicate(err) }
}

module.exports = {
  SUPPLIER_STAGES, STAGES,
  stageOf, getOrderGrid, getOrderRow, updateOrderStage,
  listFactories, createFactory, updateFactory,
}
