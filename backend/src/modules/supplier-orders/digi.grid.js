/**
 * Supplier Order Management — DIGI's orders as one grid (Printshop).
 *
 * Rows come from digi_orders (kept by digi.sync.js). Two statuses, kept apart
 * (the owner, 18 Sep 2026):
 *   - Status: where DIGI says the order is — To be Pushed (1 Store Audit,
 *     2 Pending Push), Factory Audit (4), In Production (5), Shipped (12),
 *     Rejected (3), Refunding (14), Cancelled (13 Closed, 15 Refunded);
 *   - Tracking: where the courier says the parcel is, in a word or two — Label
 *     created, In transit, Out for delivery, Delivered, Returned, Exception.
 *     The courier's full sentence stays available as tracking_detail.
 */
const db = require('../../config/db')
const { SHOP_TZ } = require('../../utils/shopTime')

const PROCESS = ['To be Pushed', 'Factory Audit', 'In Production', 'Shipped', 'Rejected', 'Refunding', 'Cancelled']
const TRACKING = ['Label created', 'Awaiting scan', 'In transit', 'Out for delivery', 'Ready for pickup', 'Delayed', 'Delivered', 'Returned', 'Exception', 'Label void']
const PENDING = ['To be Pushed', 'Factory Audit', 'In Production']
const MOVING = ['In transit', 'Out for delivery', 'Ready for pickup', 'Delayed']
const TROUBLE_PROCESS = ['Rejected', 'Refunding']
const TROUBLE_TRACKING = ['Returned', 'Exception']
const DIGI_STATUS = { 1: 'Store Audit', 2: 'Pending Push', 3: 'Rejected', 4: 'Factory Audit', 5: 'In Production', 12: 'Shipped', 13: 'Closed', 14: 'Refunding', 15: 'Refunded' }

function processOf(r) {
  switch (Number(r.order_status)) {
    case 13: case 15: return 'Cancelled'
    case 3: return 'Rejected'
    case 14: return 'Refunding'
    case 12: return 'Shipped'
    case 5: return 'In Production'
    case 4: return 'Factory Audit'
    default: return 'To be Pushed'
  }
}

function trackingOf(r) {
  const s = Number(r.order_status)
  if (!r.tracking_number) return null
  if (s === 13 || s === 15) return 'Label void'
  const code = String(r.courier_status || '').toUpperCase()
  const text = String(r.courier_status_text || '').toUpperCase()
  if (code === 'DELIVERED') return 'Delivered'
  if (code === 'RETURNED') return 'Returned'
  if (code === 'FAILURE') return 'Exception'
  if (code === 'TRANSIT') {
    if (/OUT FOR DELIVERY/.test(text)) return 'Out for delivery'
    if (/AVAILABLE FOR PICKUP|READY FOR PICKUP|HELD AT/.test(text)) return 'Ready for pickup'
    if (/DELAY/.test(text)) return 'Delayed'
    return 'In transit'
  }
  if (code === 'PRE_TRANSIT') return 'Label created'
  return s === 12 ? 'Awaiting scan' : 'Label created'
}

const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())

/**
 * An item's name for the grid, without where it is printed: "Custom Tshirt
 * Front & Back (Both)" → "Custom T-Shirt" (the owner, 18 Sep 2026). The drawer
 * and search keep the full title.
 */
function shortItem(title) {
  let s = String(title || '')
  s = s.replace(/\(\s*(both|only|front|back)\s*\)/gi, ' ')
  s = s.replace(/\b(front|back)\b(\s*(&|and|\+|\/)\s*(front|back)\b)?/gi, ' ')
  s = s.replace(/\bonly\b/gi, ' ')
  s = s.replace(/\bt\s*-?\s*(shirt|hsirt|shrit)s?\b/gi, 'T-Shirt')
  s = s.replace(/\(\s*\)/g, ' ')
  s = s.replace(/[\s&+,/-]+$/g, '').replace(/^[\s&+,/-]+/g, '').replace(/\s{2,}/g, ' ').trim()
  s = s.replace(/\b([a-z])([a-z]*)\b/g, (_m, a, b) => a.toUpperCase() + b)
  return s || String(title || '').trim()
}
// The shop's own address on a label it bought is not a factory.
const SHOP_CITIES = ['CORONA']

async function loadRows() {
  const { rows } = await db.query(
    `SELECT d.*, (d.order_time AT TIME ZONE '${SHOP_TZ}')::date::text AS push_date,
            (d.shipping_time AT TIME ZONE '${SHOP_TZ}')::date::text AS ship_date,
            d.courier_eta::text AS eta_text, d.courier_delivered::text AS delivered_text,
            p.po_number, o.order_number, o.id AS sales_order_id,
            COALESCE(NULLIF(BTRIM(c.name), ''), NULLIF(BTRIM(o.shipping_name), '')) AS printshop_customer,
            -- A sales order split into several DIGI POs: its PO numbers, when the
            -- DIGI order could be tied to the order but not to one PO.
            (SELECT string_agg(p2.po_number, ', ' ORDER BY p2.po_number)
               FROM purchase_orders p2 JOIN suppliers s2 ON s2.id = p2.supplier_id AND s2.name ~* '^digi'
              WHERE d.po_id IS NULL AND p2.order_id = d.order_id AND p2.deleted_at IS NULL) AS order_po_numbers,
            -- The first ship date Printshop's own shipment has, for a parcel DIGI gave no ship time.
            (SELECT MIN(s.ship_date)::text FROM shipments s
              WHERE s.deleted_at IS NULL AND d.tracking_number IS NOT NULL AND BTRIM(s.tracking_number) = d.tracking_number) AS shipment_ship_date,
            -- The state of the courier's first scan that names one: where the parcel entered the network.
            (SELECT UPPER(h.ev -> 'location' ->> 'state')
               FROM shipments s,
                    jsonb_array_elements(CASE WHEN jsonb_typeof(s.tracking_history) = 'array' THEN s.tracking_history ELSE '[]'::jsonb END)
                      WITH ORDINALITY AS h(ev, n)
              WHERE s.deleted_at IS NULL AND d.tracking_number IS NOT NULL AND BTRIM(s.tracking_number) = d.tracking_number
                AND NULLIF(h.ev -> 'location' ->> 'state', '') IS NOT NULL
              ORDER BY h.n LIMIT 1) AS first_scan_state
       FROM digi_orders d
       LEFT JOIN purchase_orders p ON p.id = d.po_id AND p.deleted_at IS NULL
       LEFT JOIN orders o ON o.id = COALESCE(d.order_id, p.order_id)
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE NOT (d.api_missing AND d.digi_id IS NULL AND d.order_status IS NULL)`)
  const shaped = rows.map(shape)
  // Last resort for the factory: the state the courier first scanned the parcel
  // in, when exactly one factory seen on other orders is in that state
  // (a UPS label that is only an image, with no warehouse from DIGI).
  const byState = new Map()
  for (const r of shaped) {
    const st = r.factory && /, ([A-Z]{2})$/.exec(r.factory)?.[1]
    if (!st) continue
    byState.set(st, byState.has(st) && byState.get(st) !== r.factory ? null : r.factory)
  }
  rows.forEach((raw, i) => {
    const r = shaped[i]
    if (r.factory || !raw.first_scan_state) return
    const f = byState.get(raw.first_scan_state)
    if (f) { r.factory = f; r.factory_source = 'first_scan' }
  })
  estimateDelivery(shaped)
  return shaped
}

const DAY_MS = 86400000
const dayNum = d => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
const isoOf = n => new Date(n * DAY_MS).toISOString().slice(0, 10)
const median = xs => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null }

/**
 * An expected delivery day for every live order the courier has not dated.
 * Couriers give an ETA only once a parcel moves, so for a label not yet
 * scanned, or an order still in production, it is estimated from DIGI's own
 * record here: the median days its parcels on that courier took from ship date
 * to delivery (or from push date, before shipping). Marked 'estimate'.
 */
function estimateDelivery(rows) {
  const delivered = rows.filter(r => r.delivered_on)
  const byCourier = (field) => {
    const out = new Map()
    for (const r of delivered) {
      if (!r[field]) continue
      const days = dayNum(r.delivered_on) - dayNum(r[field])
      if (days < 0 || days > 60) continue
      const k = String(r.courier || '').toUpperCase()
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(days)
      if (!out.has('*')) out.set('*', [])
      out.get('*').push(days)
    }
    return new Map([...out].map(([k, v]) => [k, median(v)]))
  }
  const transit = byCourier('ship_date')
  const total = byCourier('push_date')
  const today = dayNum(new Date().toISOString().slice(0, 10))
  for (const r of rows) {
    // A delivered parcel the courier never dated keeps what was to be expected
    // of it (its own ship date plus the median), so the column reads through.
    if (r.est_delivery || r.process_status === 'Cancelled' || TROUBLE_PROCESS.includes(r.process_status)) continue
    const k = String(r.courier || '').toUpperCase()
    const t = transit.get(k) ?? transit.get('*')
    const all = total.get(k) ?? total.get('*')
    if (t == null) continue
    let est
    if (r.ship_date && r.delivered_on) est = dayNum(r.ship_date) + t
    else if (r.ship_date) est = Math.max(dayNum(r.ship_date) + t, today)
    else if (r.push_date && all != null) est = Math.max(dayNum(r.push_date) + all, today + t)
    else est = today + t
    r.est_delivery = isoOf(est)
    r.est_delivery_source = 'estimate'
    r.est_delivery_basis = r.ship_date
      ? `Estimated: ship date + ${t} days (median of DIGI's delivered ${k || 'parcels'})`
      : `Estimated: push date + ${all} days (median of DIGI's delivered orders); not shipped yet`
  }
}

function shape(r) {
  const process = processOf(r)
  const tracking = trackingOf(r)
  const reason = [r.status_reason, r.line_messages].filter(Boolean).join(' · ') || null
  const items = Array.isArray(r.items) ? r.items : []
  const itemTitles = [...new Set(items.map(i => i.title).filter(Boolean))]
  const shortTitles = [...new Set(itemTitles.map(shortItem).filter(Boolean))]
  const location = [r.receiver_city, r.receiver_province, r.receiver_country].filter(Boolean).join(', ') || null
  // DIGI's warehouse where it names one; otherwise the sender printed on the label.
  const labelFactory = r.label_from_city && r.label_from_state && !SHOP_CITIES.includes(String(r.label_from_city).toUpperCase())
    ? `${titleCase(r.label_from_city)}, ${String(r.label_from_state).toUpperCase()}` : null
  const shipped = Number(r.order_status) === 12
  const trackingDetail = reason && (TROUBLE_PROCESS.includes(process))
    ? reason
    : r.courier_status_text || (tracking === 'Awaiting scan' ? 'Shipped by DIGI — no courier scan yet' : null)
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
    factory: r.factory_name || labelFactory,
    factory_source: r.factory_name ? 'digi' : labelFactory ? 'label' : null,
    factory_detail: [r.label_from_name, r.label_from_address, labelFactory].filter(Boolean).join(', ') || null,
    push_date: r.push_date,
    order_time: r.order_time,
    process_status: process,
    tracking_status: tracking,
    tracking_detail: trackingDetail,
    // Kept for the drawer's pill: trouble on either side shows first.
    stage: TROUBLE_PROCESS.includes(process) || TROUBLE_TRACKING.includes(tracking) ? 'Exception'
      : process === 'Cancelled' ? 'Cancelled'
      : tracking === 'Delivered' ? 'Delivered' : MOVING.includes(tracking) ? 'In Transit' : process,
    digi_status: r.order_status,
    digi_status_label: DIGI_STATUS[r.order_status] || null,
    items: shortTitles.join(', ') || null,
    items_full: itemTitles.join(', ') || null,
    item_lines: items,
    qty: r.goods_total_qty,
    shipped_by: r.shipped_by || null,
    courier: r.courier || null,
    tracking_number: r.tracking_number || null,
    ship_date: r.ship_date || (shipped ? r.shipment_ship_date : null) || null,
    est_delivery: r.eta_text || null,
    est_delivery_source: r.eta_text ? 'courier' : null,
    delivered_on: r.delivered_text || null,
    courier_status: r.courier_status || null,
    shipping_time: r.shipping_time,
    label_url: r.label_url,
    label_created_on: r.label_created_on,
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
  process_status: r => PROCESS.indexOf(r.process_status),
  items: r => (r.items || '').toLowerCase(),
  qty: r => r.qty ?? -1,
  shipped_by: r => r.shipped_by || '',
  courier: r => (r.courier || '').toLowerCase(),
  tracking_number: r => r.tracking_number || '',
  tracking_status: r => (r.tracking_status ? TRACKING.indexOf(r.tracking_status) : 99),
  ship_date: r => r.ship_date || '',
  est_delivery: r => r.est_delivery || '',
  delivered_on: r => r.delivered_on || '',
}

/**
 * One filter for both statuses: 'Pending', 'Issued', 'Exception', 'p:<status>',
 * 't:<tracking>', or 't:moving' for every parcel on its way.
 */
function statusFilter(value) {
  if (!value) return () => true
  if (value === 'Pending') return r => PENDING.includes(r.process_status)
  if (value === 'Issued') return r => r.process_status !== 'Cancelled'
  if (value === 'Exception') return r => TROUBLE_PROCESS.includes(r.process_status) || TROUBLE_TRACKING.includes(r.tracking_status)
  if (value === 't:moving') return r => MOVING.includes(r.tracking_status)
  if (value.startsWith('p:')) return r => r.process_status === value.slice(2)
  if (value.startsWith('t:')) return r => r.tracking_status === value.slice(2)
  return () => true
}

async function getGrid(query = {}) {
  const all = await loadRows()
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 8))
  const search = String(query.search || '').trim().toLowerCase()
  const status = String(query.stage || '').trim()
  const factory = String(query.factory || '').trim()
  const courier = String(query.courier || '').trim().toLowerCase()
  const shippedBy = String(query.shipped_by || '').trim()
  const DATE = /^\d{4}-\d{2}-\d{2}$/
  const from = DATE.test(String(query.push_from || '')) ? query.push_from : null
  const to = DATE.test(String(query.push_to || '')) ? query.push_to : null
  // Newest push first unless a column is picked.
  const sortKey = SORTS[query.sort] ? query.sort : 'push_date'
  const dir = String(query.dir || '').toLowerCase() === 'asc' ? 1 : -1

  let rows = all
  if (search) {
    rows = rows.filter(r => [r.order_no, ...r.po_numbers, r.sales_order_number, r.customer_name, r.customer_location,
      r.tracking_number, r.factory, r.items, r.items_full].some(v => String(v || '').toLowerCase().includes(search)))
  }
  rows = rows.filter(statusFilter(status))
  if (factory === 'none') rows = rows.filter(r => !r.factory)
  else if (factory) rows = rows.filter(r => r.factory === factory)
  if (courier === 'none') rows = rows.filter(r => !r.courier)
  else if (courier) rows = rows.filter(r => String(r.courier || '').toLowerCase() === courier)
  if (shippedBy) rows = rows.filter(r => r.shipped_by === shippedBy)
  if (from) rows = rows.filter(r => r.push_date && r.push_date >= from)
  if (to) rows = rows.filter(r => r.push_date && r.push_date <= to)

  const key = SORTS[sortKey]
  rows = [...rows].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x < y) return -1 * dir
    if (x > y) return 1 * dir
    return String(b.order_no).localeCompare(String(a.order_no))
  })

  const count = f => all.filter(f).length
  const processCounts = Object.fromEntries(PROCESS.map(s => [s, count(r => r.process_status === s)]))
  const trackingCounts = Object.fromEntries(TRACKING.map(s => [s, count(r => r.tracking_status === s)]))
  const lastSync = all.map(r => r.synced_at).filter(Boolean).sort().pop() || null

  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    summary: {
      total: all.length,
      issued: count(statusFilter('Issued')),
      pending: count(statusFilter('Pending')),
      exceptions: count(statusFilter('Exception')),
      moving: count(statusFilter('t:moving')),
      process: processCounts,
      tracking: trackingCounts,
    },
    filters: {
      process: PROCESS,
      tracking: TRACKING,
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

module.exports = { getGrid, getOrder, processOf, trackingOf, PROCESS, TRACKING }
