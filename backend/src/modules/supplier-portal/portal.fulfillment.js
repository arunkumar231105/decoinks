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
const { PO_SCOPE } = require('./portal.scope')

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
    `SELECT 1 FROM ${PO_SCOPE(2)} ppv WHERE ppv.po_id = $1`,
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

/**
 * Every PO in scope, one row each, with its worked-out stage: those shared with
 * the supplier, or for the company login (supplierId null) every live PO.
 */
async function loadRows(supplierId) {
  const { rows } = await db.query(
    `SELECT po.id, po.po_number, po.status::text AS po_status,
            po.supplier_stage, po.supplier_stage_note, po.supplier_stage_updated_at,
            po.factory_status, po.pushed_at::text AS pushed_at,
            COALESCE(po.order_date, po.created_at::date)::text AS issue_date,
            po.tracking_number, po.carrier AS po_carrier,
            po.order_id, o.order_number, (o.deleted_at IS NOT NULL) AS order_archived,
            sup.id AS supplier_id, sup.name AS supplier_name,
            COALESCE(NULLIF(BTRIM(c.name), ''), NULLIF(BTRIM(o.shipping_name), ''), o.contact_name) AS customer_name,
            NULLIF(CONCAT_WS(', ', NULLIF(BTRIM(c.city), ''), NULLIF(BTRIM(c.state), ''), NULLIF(BTRIM(c.country), '')), '') AS customer_location,
            f.id AS factory_id, f.name AS factory_name, f.is_active AS factory_active,
            NULLIF(BTRIM(o.production_facility), '') AS order_facility,
            NULLIF(BTRIM(po.supplier_reference), '') AS supplier_reference,
            po.created_at::date::text AS po_created, o.order_date::text AS order_date,
            NULLIF(BTRIM(c.name), '') AS customer_only_name, NULLIF(BTRIM(o.shipping_name), '') AS shipping_name,
            ARRAY(SELECT COALESCE(i.qty, 0) FROM order_items_apparel i WHERE i.order_id = po.order_id
                   ORDER BY i.sort_order, i.id) AS order_line_qtys,
            sh.parcels,
            COALESCE(pl.qty, ol.qty) AS qty,
            COALESCE(pl.items, ol.items) AS items
       FROM ${PO_SCOPE(1)} ppv
       JOIN purchase_orders po ON po.id = ppv.po_id
       LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN orders o ON o.id = po.order_id
       LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, po.customer_id)
       LEFT JOIN supplier_factories f ON f.id = po.factory_id AND f.supplier_id = po.supplier_id
       -- The parcels this PO went out in, as the ten-minute courier sync last read
       -- them: the one carrying the PO's own tracking number (or handed in on the
       -- PO), else — most POs carry no number of their own — the parcels of the
       -- sales order it was raised from. No order here has POs to two suppliers,
       -- so an order's parcels are its PO's. A parcel the shop marked Delivered is
       -- delivered even if the courier could not read the number.
       LEFT JOIN LATERAL (
         SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'tracking_number', BTRIM(s.tracking_number),
                  'carrier', NULLIF(BTRIM(s.carrier), ''),
                  'code', CASE WHEN s.status::text = 'Delivered' THEN 'DELIVERED'
                               ELSE COALESCE(NULLIF(UPPER(BTRIM(s.tracking_status)), ''),
                                    CASE s.status::text WHEN 'In Transit' THEN 'TRANSIT' WHEN 'Picked Up' THEN 'TRANSIT'
                                                        WHEN 'Label Created' THEN 'PRE_TRANSIT' WHEN 'Exception' THEN 'FAILURE' END) END,
                  'details', NULLIF(BTRIM(s.status_details), ''),
                  'eta', s.estimated_delivery,
                  'delivered_date', s.delivered_date,
                  'synced_at', s.tracking_synced_at
                ) ORDER BY s.created_at DESC), '[]'::jsonb) AS parcels
           FROM shipments s
          WHERE s.deleted_at IS NULL
            AND NULLIF(BTRIM(s.tracking_number), '') IS NOT NULL
            AND CASE WHEN NULLIF(BTRIM(po.tracking_number), '') IS NOT NULL
                     THEN BTRIM(s.tracking_number) = BTRIM(po.tracking_number) OR s.from_po_id = po.id OR s.po_id = po.id
                     ELSE s.from_po_id = po.id OR s.po_id = po.id OR (po.order_id IS NOT NULL AND s.order_id = po.order_id)
                END
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
      WHERE po.deleted_at IS NULL`,
    [supplierId]
  )
  const shaped = rows.map(shapeRow)
  await attachSupplierOrderNumbers(shaped, rows)
  attachPushDates(shaped, rows)
  return shaped
}

/**
 * The day the order went to the supplier, where the data says it.
 *
 * The date set in the portal wins. Otherwise the supplier's own order number
 * carries it: TSI's "TSI 260818-89" and "TS-PA-260501-03" (yymmdd), and DIGI's
 * "ORD-260820210740" (yymmddHHMMSS, placed in Pakistan time — it matches
 * BlankTex's order_time in Asia/Karachi). Checked against the sales order date
 * on all 115 stored numbers: every one falls 1 day before to 3 days after it.
 * With no such number the push date stays empty.
 */
function attachPushDates(shaped, raw) {
  const fromNumber = (n) => {
    const m = /^(?:TSI |TS-PA-)(\d{2})(\d{2})(\d{2})-/.exec(n || '') || /^ORD-(\d{2})(\d{2})(\d{2})\d{6}$/.exec(n || '')
    if (!m) return null
    const iso = `20${m[1]}-${m[2]}-${m[3]}`
    const t = Date.parse(`${iso}T00:00:00Z`)
    return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso
  }
  shaped.forEach((r, i) => {
    r.push_date_source = r.push_date ? 'portal' : null
    if (r.push_date) return
    const numbers = [raw[i].supplier_reference, ...(r.supplier_order_numbers || [])].filter(Boolean)
    const dates = numbers.map(fromNumber).filter(Boolean).sort()
    if (dates.length) { r.push_date = dates[0]; r.push_date_source = 'supplier_order' }
  })
}

const normName = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '')
const DAY = 86400000
const dayOf = v => (v ? Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`) : NaN)

/**
 * DIGI's own order number for each DIGI purchase order — the number DIGI gave
 * the blank order placed through BlankTex — shown instead of our sales order
 * number (the owner, 17 Sep 2026).
 *
 * A PO carrying supplier_reference (27 older POs) keeps it. The rest are matched
 * to BlankTex's DIGI orders (blanktex.purchases), which record neither our order
 * nor our PO, the way the shop places them: one DIGI order per sales-order line,
 * to the same recipient, within days. A sales order's lines are matched by
 * recipient name, date and quantity (line pieces = the DIGI order's pieces);
 * a one-line order may also match on its total. Nothing is guessed: no match,
 * or two equally good ones, leaves our own number. The POs of one sales order
 * carry nothing that tells them apart, so each shows all of that order's DIGI
 * numbers. Read live on every load, so a new BlankTex order appears at once.
 */
async function attachSupplierOrderNumbers(shaped, raw) {
  for (const r of shaped) r.supplier_order_numbers = []
  const digi = raw.map((row, i) => ({ row, out: shaped[i] })).filter(x => /^digi\b/i.test(x.row.supplier_name || ''))
  if (!digi.length) return

  const claimed = new Set()
  for (const { row, out } of digi) {
    if (row.supplier_reference) { out.supplier_order_numbers = [row.supplier_reference]; claimed.add(row.supplier_reference) }
  }

  let purchases = []
  try {
    const { rows } = await db.query(
      `SELECT b.order_no, b.recipient_name, COALESCE(b.order_time, b.created_at) AS placed_at,
              COALESCE((SELECT SUM(i.quantity) FROM blanktex.purchase_items i WHERE i.purchase_id = b.purchase_id), 0)::int AS qty
         FROM blanktex.purchases b
         JOIN blanktex.suppliers bs ON bs.supplier_id = b.supplier_id AND bs.supplier_code = 'DIGI'
        WHERE NULLIF(BTRIM(b.order_no), '') IS NOT NULL
          AND COALESCE(b.status, '') !~* 'cancel'`)
    purchases = rows.map(p => ({ ...p, name: normName(p.recipient_name), day: dayOf(new Date(p.placed_at).toISOString()) }))
      .filter(p => !claimed.has(p.order_no))
  } catch (err) {
    // BlankTex's schema is another app's; without it the grid keeps our numbers.
    console.error('[portal] BlankTex orders unavailable:', err.message)
    return
  }

  // Sales orders whose DIGI POs have no stored number, oldest first.
  const byOrder = new Map()
  for (const x of digi) {
    if (x.row.supplier_reference || !x.row.order_id) continue
    const g = byOrder.get(x.row.order_id) || { items: [], row: x.row, created: 0 }
    g.items.push(x)
    g.created = Math.max(g.created, dayOf(x.row.po_created))
    byOrder.set(x.row.order_id, g)
  }
  const orders = [...byOrder.values()].sort((a, b) => dayOf(a.row.order_date || a.row.po_created) - dayOf(b.row.order_date || b.row.po_created))

  const taken = new Set()
  for (const g of orders) {
    const names = [g.row.customer_only_name, g.row.shipping_name, g.row.customer_name].map(normName).filter(n => n.length >= 4)
    const start = dayOf(g.row.order_date || g.row.po_created) - 5 * DAY
    const end = (g.created || start) + 10 * DAY
    const sameName = n => names.some(m => m === n || (n.length > 5 && m.length > 5 && (m.startsWith(n) || n.startsWith(m))))
    const orderDay = dayOf(g.row.order_date || g.row.po_created)
    const cands = purchases.filter(p => !taken.has(p.order_no) && p.day >= start && p.day <= end && sameName(p.name))
    if (!cands.length) continue

    // The k closest candidates with exactly this many pieces — none if there are
    // fewer than k, or the k-th ties with the next.
    const closestK = (qty, k, pool) => {
      const hits = pool.filter(p => p.qty === qty).sort((a, b) => Math.abs(a.day - orderDay) - Math.abs(b.day - orderDay))
      if (hits.length < k) return null
      if (hits.length > k && Math.abs(hits[k - 1].day - orderDay) === Math.abs(hits[k].day - orderDay)) return null
      return hits.slice(0, k)
    }

    const lines = (g.row.order_line_qtys || []).map(Number).filter(q => q > 0)
    let picked = []
    if (lines.length > 1) {
      const need = new Map()
      for (const q of lines) need.set(q, (need.get(q) || 0) + 1)
      for (const [q, k] of need) {
        const hit = closestK(q, k, cands)
        if (!hit) { picked = []; break }
        picked.push(...hit)
      }
    }
    if (!picked.length) {
      const total = lines.reduce((a, b) => a + b, 0)
      picked = (total && closestK(total, 1, cands)) || []
    }
    if (!picked.length) continue
    for (const p of picked) taken.add(p.order_no)
    const numbers = picked.map(p => p.order_no)
    for (const { out } of g.items) out.supplier_order_numbers = numbers
  }
}

/**
 * One courier state for all of a PO's parcels. A label printed but never used
 * does not hold back a parcel that has moved; one parcel still travelling keeps
 * the PO in transit; a failed parcel counts only if nothing was delivered.
 */
function courierStateOf(parcels) {
  const codes = parcels.map(p => p.code).filter(Boolean)
  if (!codes.length) return null
  if (codes.includes('TRANSIT')) return 'TRANSIT'
  const moved = codes.filter(c => c !== 'PRE_TRANSIT')
  if (!moved.length) return 'PRE_TRANSIT'
  if (moved.includes('DELIVERED')) return 'DELIVERED'
  return moved.includes('RETURNED') ? 'RETURNED' : 'FAILURE'
}

function parcelsOf(r) {
  const seen = new Set()
  const out = []
  for (const p of Array.isArray(r.parcels) ? r.parcels : []) {
    if (!p.tracking_number || seen.has(p.tracking_number)) continue
    seen.add(p.tracking_number)
    out.push({ ...p, text: p.details || humanTracking(p.code) })
  }
  // A number handed in on the PO that no shipment row carries yet.
  const own = String(r.tracking_number || '').trim()
  if (own && !seen.has(own)) out.unshift({ tracking_number: own, carrier: r.po_carrier || null, code: null, text: null })
  return out
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
  const parcels = parcelsOf(r)
  const courierState = courierStateOf(parcels)
  const lead = parcels.find(p => p.code === courierState) || parcels[0] || null
  r = { ...r, tracking_status: courierState, tracking_number: lead?.tracking_number || null }
  const stage = stageOf(r)
  const trackingText =
    (courierState && (lead?.text || humanTracking(courierState))) ||
    (stage === 'Exception' && r.supplier_stage === 'Exception' ? (r.supplier_stage_note || 'Exception') : null) ||
    (stage === 'Shipped' && r.tracking_number ? 'Awaiting first scan' : null)
  return {
    id: r.id,
    po_number: r.po_number,
    supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier_name } : null,
    customer_name: r.customer_name,
    customer_location: r.customer_location,
    order_id: r.order_id,
    order_number: r.order_number,
    order_archived: r.order_archived,
    // The factory set in the portal, else the production facility on the sales order.
    factory: r.factory_id
      ? { id: r.factory_id, name: r.factory_name, is_active: r.factory_active }
      : r.order_facility ? { id: null, name: r.order_facility, is_active: true, from_order: true } : null,
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
    courier: [...new Set(parcels.map(p => p.carrier).filter(Boolean).map(c => String(c).toUpperCase()))].join(', ') || null,
    tracking_number: r.tracking_number,
    tracking_status: courierState,
    tracking_text: trackingText,
    tracking_synced_at: parcels.map(p => p.synced_at).filter(Boolean).sort().pop() || null,
    parcels: parcels.map(p => ({ tracking_number: p.tracking_number, carrier: p.carrier, code: p.code, text: p.text, eta: p.eta || null, delivered_date: p.delivered_date || null })),
    po_status: r.po_status,
  }
}

const SORTS = {
  po_number: r => r.po_number,
  supplier: r => (r.supplier?.name || '').toLowerCase(),
  customer: r => (r.customer_name || '').toLowerCase(),
  order_number: r => r.supplier_order_numbers?.[0] || r.order_number || '',
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
  const supplier = String(query.supplier || '').trim()
  const courier = String(query.courier || '').trim().toLowerCase()
  const DATE = /^\d{4}-\d{2}-\d{2}$/
  const pushFrom = DATE.test(String(query.push_from || '')) ? query.push_from : null
  const pushTo = DATE.test(String(query.push_to || '')) ? query.push_to : null
  // PO number, newest first, unless a column is picked.
  const sortKey = SORTS[query.sort] ? query.sort : 'po_number'
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 1 : -1

  let rows = all
  if (search) {
    rows = rows.filter(r => [r.po_number, r.supplier?.name, r.order_number, ...(r.supplier_order_numbers || []), r.customer_name, r.factory?.name, r.items, ...r.parcels.map(p => p.tracking_number)]
      .some(v => String(v || '').toLowerCase().includes(search)))
  }
  if (stage === 'Pending') rows = rows.filter(r => NOT_YET_SHIPPED.includes(r.stage))
  else if (stage === 'Issued') rows = rows.filter(r => r.stage !== 'Cancelled')
  else if (stage) rows = rows.filter(r => r.stage === stage)
  if (supplier === 'none') rows = rows.filter(r => !r.supplier)
  else if (supplier) rows = rows.filter(r => r.supplier?.id === supplier)
  if (factory === 'none') rows = rows.filter(r => !r.factory)
  else if (factory.startsWith('order:')) rows = rows.filter(r => r.factory && !r.factory.id && r.factory.name === factory.slice(6))
  else if (factory) rows = rows.filter(r => r.factory?.id === factory)
  if (courier === 'none') rows = rows.filter(r => !r.courier)
  else if (courier) rows = rows.filter(r => r.parcels.some(p => String(p.carrier || '').toLowerCase() === courier))
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

  // Factories are each supplier's own; the company login sees whose each is.
  const factories = new Map()
  const { rows: listed } = await db.query(
    `SELECT f.id, f.name, s.name AS supplier_name FROM supplier_factories f JOIN suppliers s ON s.id = f.supplier_id
      WHERE ($1::uuid IS NULL OR f.supplier_id = $1) ORDER BY LOWER(f.name)`, [supplierId])
  for (const f of listed) factories.set(f.id, supplierId === null ? `${f.name} (${f.supplier_name})` : f.name)
  for (const r of all) {
    if (r.factory?.id && !factories.has(r.factory.id)) factories.set(r.factory.id, r.factory.name)
    // A production facility named on the sales order.
    if (r.factory && !r.factory.id) factories.set(`order:${r.factory.name}`, r.factory.name)
  }

  const suppliers = new Map()
  for (const r of all) if (r.supplier) suppliers.set(r.supplier.id, r.supplier.name)

  const couriers = [...new Set(all.flatMap(r => r.parcels.map(p => p.carrier)).filter(Boolean).map(c => String(c).toUpperCase()))].sort()

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
      suppliers: [...suppliers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
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
  if (factoryId && !UUID.test(String(factoryId))) throw httpError(422, "That factory is not this PO's supplier's")
  if (factoryId) {
    // A PO can only go to a factory of the supplier it was issued to.
    const { rows } = await db.query(
      `SELECT f.id, f.is_active FROM supplier_factories f
         JOIN purchase_orders po ON po.id = $2 AND po.supplier_id = f.supplier_id
        WHERE f.id = $1`, [factoryId, poId])
    if (!rows.length) throw httpError(422, "That factory is not this PO's supplier's")
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
            f.supplier_id, s.name AS supplier_name,
            (SELECT COUNT(*)::int FROM purchase_orders po
              WHERE po.factory_id = f.id AND po.deleted_at IS NULL) AS po_count
       FROM supplier_factories f
       JOIN suppliers s ON s.id = f.supplier_id
      WHERE ($1::uuid IS NULL OR f.supplier_id = $1)
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

/** The suppliers the company login can add a factory for: those with live POs, then the rest. */
async function listSuppliers() {
  const { rows } = await db.query(
    `SELECT s.id, s.name FROM suppliers s
      WHERE EXISTS (SELECT 1 FROM purchase_orders p WHERE p.supplier_id = s.id AND p.deleted_at IS NULL)
      ORDER BY LOWER(s.name)`)
  return rows
}

async function createFactory(supplierId, body = {}) {
  const f = cleanFactory(body, { partial: false })
  if (supplierId === null) {
    // The company login says whose factory it is.
    const chosen = String(body.supplier_id || '')
    if (!UUID.test(chosen)) throw httpError(422, 'Pick the supplier this factory belongs to')
    const { rows } = await db.query(`SELECT 1 FROM suppliers WHERE id = $1`, [chosen])
    if (!rows.length) throw httpError(422, 'Pick the supplier this factory belongs to')
    supplierId = chosen
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO supplier_factories (supplier_id, name, city, country)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, city, country, is_active, created_at, supplier_id, 0 AS po_count`,
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
        WHERE id = $1 AND ($2::uuid IS NULL OR supplier_id = $2)
        RETURNING id, name, city, country, is_active, created_at, supplier_id`,
      params
    )
    if (!rows.length) throw httpError(404, 'Factory not found')
    return rows[0]
  } catch (err) { return duplicate(err) }
}

/**
 * Products and where their pieces stand, for the portal's Products and
 * Inventory pages. One entry per product (name, colour, size) across every PO
 * shared with this supplier: taken from the PO's own lines where it has them,
 * else from the sales order it was raised from — the same rule as the grid's
 * Items column. Quantities are split by the PO's stage: still with the
 * factory, on the way, delivered. Cancelled POs are left out. No prices.
 */
async function getProducts(supplierId) {
  const grid = await loadRows(supplierId)
  const stageById = new Map(grid.map(r => [r.id, r]))
  const { rows } = await db.query(
    `WITH shared AS (
       SELECT po.id, po.order_id FROM ${PO_SCOPE(1)} ppv
         JOIN purchase_orders po ON po.id = ppv.po_id
        WHERE po.deleted_at IS NULL
     ), po_lines AS (
       SELECT s.id AS po_id, NULL::uuid AS order_id, i.item_name AS name, i.category, i.color, i.size, i.qty_ordered AS qty
         FROM shared s JOIN purchase_order_items i ON i.po_id = s.id
       UNION ALL
       SELECT s.id, NULL::uuid, COALESCE(a.item_name, a.item_description), a.category, a.color, a.size, a.quantity
         FROM shared s JOIN po_apparel_items a ON a.purchase_order_id = s.id
     ), order_lines AS (
       SELECT s.id AS po_id, s.order_id, COALESCE(NULLIF(BTRIM(i.item), ''), 'Apparel') AS name, i.category, i.color, i.size, i.qty
         FROM shared s JOIN order_items_apparel i ON i.order_id = s.order_id
        WHERE NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = s.id)
       UNION ALL
       SELECT s.id, s.order_id, 'DTF Transfers', 'DTF', NULL, i.size, i.qty
         FROM shared s JOIN order_items_dtf i ON i.order_id = s.order_id
        WHERE NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = s.id)
       UNION ALL
       SELECT s.id, s.order_id, 'Gangsheets', 'Gangsheet', NULL, g.size, g.qty
         FROM shared s JOIN order_items_gangsheet g ON g.order_id = s.order_id
        WHERE NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = s.id)
     )
     SELECT po_id, order_id, NULLIF(BTRIM(name), '') AS name, NULLIF(BTRIM(category), '') AS category,
            NULLIF(BTRIM(color), '') AS color, NULLIF(BTRIM(size), '') AS size, COALESCE(qty, 0)::int AS qty
       FROM (SELECT * FROM po_lines UNION ALL SELECT * FROM order_lines) x`,
    [supplierId]
  )

  const WITH_FACTORY = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception']
  const ON_THE_WAY = ['Shipped', 'Pre-Transit', 'In Transit']
  // A sales order split over several POs lends each of them all its lines;
  // count those lines once, on the order's newest live PO.
  const orderOwner = new Map()
  for (const l of rows) {
    const po = stageById.get(l.po_id)
    if (!l.order_id || !po || po.stage === 'Cancelled') continue
    const cur = orderOwner.get(l.order_id)
    if (!cur || String(po.po_number) > String(stageById.get(cur).po_number)) orderOwner.set(l.order_id, l.po_id)
  }
  const products = new Map()
  for (const l of rows) {
    const po = stageById.get(l.po_id)
    if (!po || po.stage === 'Cancelled') continue
    if (l.order_id && orderOwner.get(l.order_id) !== l.po_id) continue
    const name = l.name || 'Unnamed item'
    const key = [name, l.color, l.size].map(v => String(v || '').toLowerCase()).join('|')
    let p = products.get(key)
    if (!p) {
      p = { key, name, category: l.category, color: l.color, size: l.size, qty: 0,
            with_factory: 0, on_the_way: 0, delivered: 0, pos: new Set(), customers: new Set(), last_ordered: null }
      products.set(key, p)
    }
    p.qty += l.qty
    if (WITH_FACTORY.includes(po.stage)) p.with_factory += l.qty
    else if (ON_THE_WAY.includes(po.stage)) p.on_the_way += l.qty
    else if (po.stage === 'Delivered') p.delivered += l.qty
    p.pos.add(po.po_number)
    if (po.customer_name) p.customers.add(po.customer_name)
    if (po.issue_date && (!p.last_ordered || po.issue_date > p.last_ordered)) p.last_ordered = po.issue_date
    if (!p.category && l.category) p.category = l.category
  }
  return [...products.values()]
    .map(p => ({ ...p, po_count: p.pos.size, customer_count: p.customers.size, po_numbers: [...p.pos].sort().reverse(), pos: undefined, customers: undefined }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
}

module.exports = {
  SUPPLIER_STAGES, STAGES,
  stageOf, getOrderGrid, getOrderRow, updateOrderStage, getProducts,
  listFactories, listSuppliers, createFactory, updateFactory,
}
