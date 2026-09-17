/**
 * Supplier Order Management — DIGI's orders as one grid (Printshop).
 *
 * Rows come from digi_orders (kept by digi.sync.js). Where an order stands is
 * read from DIGI and then the courier:
 *   DIGI 1 Store Audit / 2 Pending Push → To be Pushed; 4 → Factory Audit;
 *   5 → In Production; 3 Rejected / 14 Refunding → Exception;
 *   13 Closed / 15 Refunded → Cancelled;
 *   12 Shipped → the courier's word: Pre-Transit, In Transit, Delivered, or
 *   Exception on a failure or return; Shipped until the courier has one.
 */
const db = require('../../config/db')
const { SHOP_TZ } = require('../../utils/shopTime')

const STAGES = ['To be Pushed', 'Factory Audit', 'In Production', 'Exception', 'Shipped', 'Pre-Transit', 'In Transit', 'Delivered', 'Cancelled']
const PENDING = ['To be Pushed', 'Factory Audit', 'In Production']
const DIGI_STATUS = { 1: 'Store Audit', 2: 'Pending Push', 3: 'Rejected', 4: 'Factory Audit', 5: 'In Production', 12: 'Shipped', 13: 'Closed', 14: 'Refunding', 15: 'Refunded' }

function stageOf(r) {
  const s = Number(r.order_status)
  if (s === 13 || s === 15) return 'Cancelled'
  if (s === 3 || s === 14) return 'Exception'
  if (s === 12) {
    const c = String(r.courier_status || '').toUpperCase()
    if (c === 'DELIVERED') return 'Delivered'
    if (c === 'TRANSIT') return 'In Transit'
    if (c === 'PRE_TRANSIT') return 'Pre-Transit'
    if (c === 'FAILURE' || c === 'RETURNED') return 'Exception'
    return 'Shipped'
  }
  if (s === 5) return 'In Production'
  if (s === 4) return 'Factory Audit'
  return 'To be Pushed'
}

const HUMAN_COURIER = { PRE_TRANSIT: 'Label created', TRANSIT: 'In transit', DELIVERED: 'Delivered', FAILURE: 'Delivery problem', RETURNED: 'Returned to sender' }

async function loadRows() {
  const { rows } = await db.query(
    `SELECT d.*, (d.order_time AT TIME ZONE '${SHOP_TZ}')::date::text AS push_date,
            p.po_number, o.order_number, o.id AS sales_order_id,
            COALESCE(NULLIF(BTRIM(c.name), ''), NULLIF(BTRIM(o.shipping_name), '')) AS printshop_customer,
            -- A sales order split into several DIGI POs: its PO numbers, when the
            -- DIGI order could be tied to the order but not to one PO.
            (SELECT string_agg(p2.po_number, ', ' ORDER BY p2.po_number)
               FROM purchase_orders p2 JOIN suppliers s2 ON s2.id = p2.supplier_id AND s2.name ~* '^digi'
              WHERE d.po_id IS NULL AND p2.order_id = d.order_id AND p2.deleted_at IS NULL) AS order_po_numbers
       FROM digi_orders d
       LEFT JOIN purchase_orders p ON p.id = d.po_id AND p.deleted_at IS NULL
       LEFT JOIN orders o ON o.id = COALESCE(d.order_id, p.order_id)
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE NOT (d.api_missing AND d.digi_id IS NULL AND d.order_status IS NULL)`)
  return rows.map(shape)
}

function shape(r) {
  const stage = stageOf(r)
  const shipped = Number(r.order_status) === 12
  const reason = [r.status_reason, r.line_messages].filter(Boolean).join(' · ') || null
  const trackingText = stage === 'Exception'
    ? (reason || r.courier_status_text || HUMAN_COURIER[String(r.courier_status || '').toUpperCase()] || DIGI_STATUS[r.order_status] || 'Exception')
    : shipped
      ? (r.courier_status_text || HUMAN_COURIER[String(r.courier_status || '').toUpperCase()] || 'Shipped by DIGI')
      : null
  const items = Array.isArray(r.items) ? r.items : []
  const itemTitles = [...new Set(items.map(i => i.title).filter(Boolean))]
  const location = [r.receiver_city, r.receiver_province, r.receiver_country].filter(Boolean).join(', ') || null
  return {
    order_no: r.order_no,
    po_id: r.po_id,
    po_number: r.po_number || null,
    po_numbers: r.po_number ? [r.po_number] : (r.order_po_numbers ? r.order_po_numbers.split(', ') : []),
    po_match: r.po_match,
    sales_order_id: r.sales_order_id,
    sales_order_number: r.order_number,
    customer_name: r.consignee_name || r.printshop_customer || null,
    customer_location: location,
    factory: r.factory_name,
    push_date: r.push_date,
    order_time: r.order_time,
    stage,
    digi_status: r.order_status,
    digi_status_label: DIGI_STATUS[r.order_status] || null,
    items: itemTitles.join(', ') || null,
    item_lines: items,
    qty: r.goods_total_qty,
    // Before DIGI ships, the label it has already bought is not a shipment yet.
    courier: shipped ? r.courier : null,
    tracking_number: shipped ? r.tracking_number : null,
    tracking_text: trackingText,
    courier_status: shipped ? r.courier_status : null,
    courier_eta: r.courier_eta,
    delivered_date: r.courier_delivered,
    shipping_time: r.shipping_time,
    label_url: r.label_url,
    label_tracking_number: r.tracking_number,
    label_courier: r.courier,
    reason,
    source: r.source,
    synced_at: r.synced_at,
    courier_synced_at: r.courier_synced_at,
  }
}

const SORTS = {
  po_number: r => r.po_numbers[0] || '',
  customer: r => (r.customer_name || '').toLowerCase(),
  order_no: r => r.order_no,
  factory: r => (r.factory || '').toLowerCase(),
  push_date: r => r.order_time ? new Date(r.order_time).getTime() : 0,
  stage: r => STAGES.indexOf(r.stage),
  items: r => (r.items || '').toLowerCase(),
  qty: r => r.qty ?? -1,
  courier: r => (r.courier || '').toLowerCase(),
  tracking_number: r => r.tracking_number || '',
  tracking_text: r => (r.tracking_text || '').toLowerCase(),
}

async function getGrid(query = {}) {
  const all = await loadRows()
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 8))
  const search = String(query.search || '').trim().toLowerCase()
  const stage = String(query.stage || '').trim()
  const factory = String(query.factory || '').trim()
  const courier = String(query.courier || '').trim().toLowerCase()
  const DATE = /^\d{4}-\d{2}-\d{2}$/
  const from = DATE.test(String(query.push_from || '')) ? query.push_from : null
  const to = DATE.test(String(query.push_to || '')) ? query.push_to : null
  // Newest push first unless a column is picked.
  const sortKey = SORTS[query.sort] ? query.sort : 'push_date'
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 1 : -1

  let rows = all
  if (search) {
    rows = rows.filter(r => [r.order_no, ...r.po_numbers, r.sales_order_number, r.customer_name, r.customer_location,
      r.tracking_number, r.label_tracking_number, r.factory, r.items].some(v => String(v || '').toLowerCase().includes(search)))
  }
  if (stage === 'Pending') rows = rows.filter(r => PENDING.includes(r.stage))
  else if (stage === 'Issued') rows = rows.filter(r => r.stage !== 'Cancelled')
  else if (stage) rows = rows.filter(r => r.stage === stage)
  if (factory === 'none') rows = rows.filter(r => !r.factory)
  else if (factory) rows = rows.filter(r => r.factory === factory)
  if (courier === 'none') rows = rows.filter(r => !r.courier)
  else if (courier) rows = rows.filter(r => String(r.courier || '').toLowerCase() === courier)
  if (from) rows = rows.filter(r => r.push_date && r.push_date >= from)
  if (to) rows = rows.filter(r => r.push_date && r.push_date <= to)

  const key = SORTS[sortKey]
  rows = [...rows].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x < y) return -1 * dir
    if (x > y) return 1 * dir
    return String(b.order_no).localeCompare(String(a.order_no))
  })

  const counts = Object.fromEntries(STAGES.map(s => [s, 0]))
  for (const r of all) counts[r.stage] += 1
  const lastSync = all.map(r => r.synced_at).filter(Boolean).sort().pop() || null

  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    summary: {
      total: all.length,
      issued: all.filter(r => r.stage !== 'Cancelled').length,
      pending: all.filter(r => PENDING.includes(r.stage)).length,
      stages: counts,
    },
    filters: {
      stages: STAGES,
      factories: [...new Set(all.map(r => r.factory).filter(Boolean))].sort(),
      couriers: [...new Set(all.map(r => r.courier).filter(Boolean).map(c => String(c).toUpperCase()))].sort(),
    },
    synced_at: lastSync,
  }
}

async function getOrder(orderNo) {
  const rows = await loadRows()
  return rows.find(r => r.order_no === orderNo) || null
}

module.exports = { getGrid, getOrder, stageOf, STAGES }
