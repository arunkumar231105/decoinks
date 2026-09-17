/**
 * Bring digi_orders up to date from the DIGI API (migration 148).
 *
 * Which orders: every order pushed to DIGI that Printshop can name — the blank
 * orders placed through BlankTex (blanktex.purchases, DIGI supplier) and the
 * older ones whose DIGI number sits on a Printshop PO as supplier_reference.
 * DIGI has no "list my orders" endpoint, so an order neither of those knows is
 * out of reach.
 *
 * For each: queryOrderInfo (consignee, pieces, push time, warehouse, tracking),
 * queryOrderStatus (status, rejection reason, factory line messages) and
 * queryOrderDelivery (tracking, courier, label PDF, ship time). The parcel's
 * courier state comes from Printshop's own shipments when it carries the same
 * tracking number (kept fresh by sync-shipment-tracking.js), else from Shippo.
 *
 * Each DIGI order is tied to its Printshop PO where the data allows it:
 *   1. the PO carries the DIGI number as supplier_reference;
 *   2. BlankTex recorded the PO it raised (printshop_po_id);
 *   3. otherwise by recipient name, date and pieces — a DIGI order is one line of
 *      a sales order, so its pieces equal that line's quantity (or the order's
 *      total). Checked against the 27 POs that carry the number: 17 found, none
 *      wrong. No match or two equal ones: left untied.
 */
const db = require('../../config/db')
const digi = require('./digi.client')
const shippo = require('../../utils/shippo')

const BATCH = 50
const GAP_MS = 150
const SHIPPO_EVERY_MS = 55 * 60 * 1000   // Shippo is asked at most hourly per parcel
const SHIPPO_PER_RUN = 40
const DAY = 86400000

const sleep = ms => new Promise(r => setTimeout(r, ms))
const normName = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '')
const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
// DIGI sends 'YYYY-MM-DD HH:MM:SS' in UTC (it matches BlankTex's order_time).
const utc = v => (v ? new Date(`${String(v).replace(' ', 'T')}Z`) : null)
const validDate = d => (d && !Number.isNaN(d.getTime()) ? d : null)

/**
 * DIGI's tracking field as a courier number, or null. When the shop hands DIGI
 * its own UPS label, the field holds whatever the label was called — a customer
 * name, "UPS", a Shippo batch id — or the number with spaces ("1Z 24C 314 …").
 */
function cleanTracking(v) {
  const t = String(v || '').replace(/\s+/g, '').toUpperCase()
  return /^[0-9A-Z]{10,40}$/.test(t) && /\d{6}/.test(t) ? t : null
}

async function inBatches(endpoint, orderNos) {
  const out = []
  for (let i = 0; i < orderNos.length; i += BATCH) {
    const data = await digi.call(endpoint, { platformOidList: orderNos.slice(i, i + BATCH) })
    if (Array.isArray(data)) out.push(...data)
    await sleep(GAP_MS)
  }
  return new Map(out.map(d => [d.platformOid, d]))
}

async function loadUniverse() {
  let blanktex = []
  try {
    ;({ rows: blanktex } = await db.query(
      `SELECT b.order_no, b.recipient_name, b.order_time, b.printshop_po_id, b.external_sales_order_id,
              b.supplier_payload -> 'goodsList' AS goods
         FROM blanktex.purchases b
         JOIN blanktex.suppliers s ON s.supplier_id = b.supplier_id AND s.supplier_code = 'DIGI'
        WHERE NULLIF(BTRIM(b.order_no), '') IS NOT NULL`))
  } catch (err) {
    console.error('[digi-sync] BlankTex orders unavailable:', err.message)
  }
  const { rows: poRefs } = await db.query(
    `SELECT p.id, BTRIM(p.supplier_reference) AS order_no
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      WHERE s.name ~* '^digi' AND p.deleted_at IS NULL AND NULLIF(BTRIM(p.supplier_reference), '') IS NOT NULL`)
  const { rows: known } = await db.query(`SELECT order_no, courier_status, courier_synced_at FROM digi_orders`)
  return { blanktex, poRefs, known: new Map(known.map(k => [k.order_no, k])) }
}

/** DIGI's POs in Printshop with what the name/date/pieces match needs. */
async function loadDigiPOs() {
  const { rows } = await db.query(
    `SELECT p.id, p.po_number, p.order_id, NULLIF(BTRIM(p.supplier_reference), '') AS supplier_reference,
            p.created_at, o.order_date, NULLIF(BTRIM(c.name), '') AS customer_name,
            NULLIF(BTRIM(o.shipping_name), '') AS shipping_name, o.contact_name,
            ARRAY(SELECT COALESCE(i.qty, 0) FROM order_items_apparel i WHERE i.order_id = p.order_id) AS line_qtys
       FROM purchase_orders p
       JOIN suppliers s ON s.id = p.supplier_id AND s.name ~* '^digi'
       LEFT JOIN orders o ON o.id = p.order_id
       LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, p.customer_id)
      WHERE p.deleted_at IS NULL`)
  return rows
}

function matchPO(order, pos, claimedOrders) {
  const names = [order.consignee_name].map(normName).filter(n => n.length >= 4)
  if (!names.length || !order.order_time) return null
  const t = order.order_time.getTime()
  const qty = Number(order.goods_total_qty) || 0
  const sameName = p => [p.customer_name, p.shipping_name, p.contact_name].map(normName).filter(n => n.length >= 4)
    .some(m => names.some(n => m === n || (n.length > 5 && m.length > 5 && (m.startsWith(n) || n.startsWith(m)))))
  const bySalesOrder = new Map()
  for (const p of pos) {
    if (p.supplier_reference || !p.order_id) continue
    const from = new Date(p.order_date || p.created_at).getTime() - 5 * DAY
    const to = new Date(p.created_at).getTime() + 10 * DAY
    if (t < from || t > to || !sameName(p)) continue
    const lines = (p.line_qtys || []).map(Number).filter(q => q > 0)
    const total = lines.reduce((a, b) => a + b, 0)
    if (!qty || !(lines.includes(qty) || total === qty)) continue
    const g = bySalesOrder.get(p.order_id) || { order_id: p.order_id, pos: [], day: Math.abs(new Date(p.order_date || p.created_at).getTime() - t) }
    g.pos.push(p)
    bySalesOrder.set(p.order_id, g)
  }
  const groups = [...bySalesOrder.values()].sort((a, b) => a.day - b.day)
  if (!groups.length) return null
  if (groups.length > 1 && groups[0].day === groups[1].day) return null
  const g = groups[0]
  // A sales order split into several DIGI POs: which PO is which DIGI order is
  // not in the data, so the order is tied and the PO only when it is the only one.
  return { order_id: g.order_id, po_id: g.pos.length === 1 ? g.pos[0].id : null }
}

async function courierStates(rows, known, log) {
  const tracked = rows.filter(r => r.tracking_number && r.order_status === 12)
  if (!tracked.length) return
  const { rows: ships } = await db.query(
    `SELECT DISTINCT ON (BTRIM(s.tracking_number)) BTRIM(s.tracking_number) AS tn, s.tracking_status, s.status_details,
            s.estimated_delivery, s.delivered_date, s.tracking_synced_at, s.status::text AS status
       FROM shipments s
      WHERE s.deleted_at IS NULL AND BTRIM(s.tracking_number) = ANY($1::text[])
      ORDER BY BTRIM(s.tracking_number), s.tracking_synced_at DESC NULLS LAST`,
    [tracked.map(r => r.tracking_number)])
  const byTn = new Map(ships.map(s => [s.tn, s]))
  let asked = 0
  for (const r of tracked) {
    const s = byTn.get(r.tracking_number)
    if (s && (s.tracking_status || s.status === 'Delivered')) {
      r.courier_status = s.status === 'Delivered' ? 'DELIVERED' : String(s.tracking_status).toUpperCase()
      r.courier_status_text = s.status_details || null
      r.courier_eta = s.estimated_delivery || null
      r.courier_delivered = s.delivered_date || null
      r.courier_synced_at = s.tracking_synced_at || new Date()
      continue
    }
    const prev = known.get(r.order_no)
    const fresh = prev?.courier_synced_at && Date.now() - new Date(prev.courier_synced_at).getTime() < SHIPPO_EVERY_MS
    if (prev?.courier_status === 'DELIVERED' || fresh || asked >= SHIPPO_PER_RUN || !shippo.isConfigured()) {
      r.keep_courier = true
      continue
    }
    asked += 1
    try {
      const t = await shippo.fetchTracking(r.courier, r.tracking_number)
      r.courier_status = t.tracking_status ? String(t.tracking_status).toUpperCase() : null
      r.courier_status_text = t.status_details || null
      r.courier_eta = t.estimated_delivery || null
      r.courier_delivered = t.delivered_date || null
      r.courier_synced_at = new Date()
    } catch (err) {
      r.keep_courier = true
      if (err.statusCode !== 404) log(`  shippo ${r.tracking_number}: ${err.message}`)
    }
    await sleep(350)
  }
}

/** Sync every DIGI order. Dry run unless apply; returns a short summary. */
async function syncDigiOrders({ apply = false, log = console.log } = {}) {
  if (!digi.isConfigured()) throw Object.assign(new Error('DIGI API is not configured (DIGI_API_SECRET_KEY)'), { status: 503 })
  const { blanktex, poRefs, known } = await loadUniverse()

  const orders = new Map()
  for (const b of blanktex) orders.set(b.order_no, { order_no: b.order_no, source: 'blanktex', bt: b })
  for (const p of poRefs) {
    const o = orders.get(p.order_no) || { order_no: p.order_no, source: 'po_reference' }
    o.ref_po_id = p.id
    orders.set(p.order_no, o)
  }
  const orderNos = [...orders.keys()]
  log(`[digi-sync] ${orderNos.length} DIGI orders known (${blanktex.length} from BlankTex, ${poRefs.length} on POs)`)
  if (!orderNos.length) return { orders: 0 }

  const [info, status, delivery, addresses] = await Promise.all([
    inBatches('queryOrderInfo', orderNos),
    inBatches('queryOrderStatus', orderNos),
    inBatches('queryOrderDelivery', orderNos),
    digi.call('queryShipAddress', {}),
  ])
  // A warehouse has several address rows, some of them DIGI's own test entries
  // ("1", "vwe"); the first real US city and state names it.
  const warehouse = new Map()
  for (const a of Array.isArray(addresses) ? addresses : []) {
    if (!a.addressId || warehouse.has(a.addressId)) continue
    const city = String(a.city || '').replace(/\s+/g, ' ').trim()   // DIGI's names can carry odd spaces
    const state = String(a.province || '').trim().toUpperCase()
    if (/[A-Za-z]{3}/.test(city) && !/\d/.test(city) && /^[A-Z]{2}$/.test(state)) warehouse.set(a.addressId, `${titleCase(city)}, ${state}`)
  }

  const pos = await loadDigiPOs()
  const rows = []
  for (const o of orders.values()) {
    const i = info.get(o.order_no) || {}
    const s = status.get(o.order_no) || {}
    const d = delivery.get(o.order_no) || {}
    const onApi = Boolean(info.has(o.order_no) || status.has(o.order_no) || delivery.has(o.order_no))
    const goods = Array.isArray(o.bt?.goods) ? o.bt.goods : []
    const row = {
      order_no: o.order_no,
      digi_id: i.id || null,
      order_status: Number.isFinite(Number(s.orderStatus ?? i.orderStatus)) ? Number(s.orderStatus ?? i.orderStatus) : null,
      status_reason: s.reason || null,
      line_messages: [...new Set((s.childOrderStatus || []).map(c => c.productMessage).filter(Boolean))].join(' · ') || null,
      goods_total_qty: i.goodsTotalQty ?? (goods.reduce((a, g) => a + (Number(g.num) || 0), 0) || null),
      consignee_name: i.consigneeName || o.bt?.recipient_name || null,
      receiver_city: i.receiverCity || null,
      receiver_province: i.receiverProvince || null,
      receiver_country: i.receiverCountry || null,
      order_time: validDate(utc(i.orderTime)) || (o.bt?.order_time ? new Date(o.bt.order_time) : null),
      shipping_time: validDate(utc(d.shippingTime || i.shippingTime)),
      factory_address_id: i.addressId || null,
      factory_name: (i.addressId && warehouse.get(i.addressId)) || null,
      courier: d.express || i.deliveryCourier || null,
      tracking_number: cleanTracking(d.trackingNumber) || cleanTracking(i.courierNumber),
      raw_tracking: String(d.trackingNumber || i.courierNumber || '').trim() || null,
      label_url: d.waybillDataPath || null,
      items: goods.map(g => ({ title: g.title || null, color: g.colorName || null, size: g.sizeName || null, qty: Number(g.num) || 0 })),
      source: o.source,
      api_missing: !onApi,
      po_id: null, po_match: null, order_id: null,
      courier_status: null, courier_status_text: null, courier_eta: null, courier_delivered: null, courier_synced_at: null,
    }
    if (o.ref_po_id) { row.po_id = o.ref_po_id; row.po_match = 'supplier_reference' }
    else if (o.bt?.printshop_po_id) { row.po_id = o.bt.printshop_po_id; row.po_match = 'blanktex' }
    if (row.po_id) row.order_id = pos.find(p => p.id === row.po_id)?.order_id || null
    else if (o.bt?.external_sales_order_id) { row.order_id = o.bt.external_sales_order_id; row.po_match = 'blanktex' }
    rows.push(row)
  }

  // Name/date/pieces ties, oldest DIGI orders first.
  for (const row of rows.filter(r => !r.po_id && !r.order_id).sort((a, b) => (a.order_time || 0) - (b.order_time || 0))) {
    const m = matchPO(row, pos)
    if (m) { row.order_id = m.order_id; row.po_id = m.po_id; row.po_match = 'name_date_qty' }
  }

  // A label DIGI only knows by name: the parcel Printshop recorded on the sales
  // order, when that order has exactly one.
  const loose = rows.filter(r => !r.tracking_number && r.raw_tracking && r.order_id)
  if (loose.length) {
    const { rows: parcels } = await db.query(
      `SELECT s.order_id, MIN(BTRIM(s.tracking_number)) AS tn, MIN(s.carrier) AS carrier, COUNT(DISTINCT BTRIM(s.tracking_number)) AS n
         FROM shipments s
        WHERE s.deleted_at IS NULL AND NULLIF(BTRIM(s.tracking_number), '') IS NOT NULL AND s.order_id = ANY($1::uuid[])
        GROUP BY s.order_id`, [loose.map(r => r.order_id)])
    const one = new Map(parcels.filter(p => Number(p.n) === 1).map(p => [p.order_id, p]))
    for (const r of loose) {
      const p = one.get(r.order_id)
      if (p) { r.tracking_number = p.tn; r.courier = r.courier || p.carrier }
    }
  }

  await courierStates(rows, known, log)

  const counts = { orders: rows.length, on_api: rows.filter(r => !r.api_missing).length, tracked: rows.filter(r => r.tracking_number).length,
    po_linked: rows.filter(r => r.po_id).length, order_linked: rows.filter(r => r.order_id).length }
  log(`[digi-sync] ${JSON.stringify(counts)}${apply ? '' : ' (dry run)'}`)
  if (!apply) return { ...counts, rows }

  for (const r of rows) {
    await db.query(
      `INSERT INTO digi_orders (order_no, digi_id, order_status, status_reason, line_messages, goods_total_qty,
         consignee_name, receiver_city, receiver_province, receiver_country, order_time, shipping_time,
         factory_address_id, factory_name, courier, tracking_number, label_url, items,
         courier_status, courier_status_text, courier_eta, courier_delivered, courier_synced_at,
         po_id, po_match, order_id, source, api_missing, synced_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NOW(),NOW())
       ON CONFLICT (order_no) DO UPDATE SET
         digi_id = COALESCE(EXCLUDED.digi_id, digi_orders.digi_id),
         order_status = COALESCE(EXCLUDED.order_status, digi_orders.order_status),
         status_reason = EXCLUDED.status_reason, line_messages = EXCLUDED.line_messages,
         goods_total_qty = COALESCE(EXCLUDED.goods_total_qty, digi_orders.goods_total_qty),
         consignee_name = COALESCE(EXCLUDED.consignee_name, digi_orders.consignee_name),
         receiver_city = COALESCE(EXCLUDED.receiver_city, digi_orders.receiver_city),
         receiver_province = COALESCE(EXCLUDED.receiver_province, digi_orders.receiver_province),
         receiver_country = COALESCE(EXCLUDED.receiver_country, digi_orders.receiver_country),
         order_time = COALESCE(EXCLUDED.order_time, digi_orders.order_time),
         shipping_time = COALESCE(EXCLUDED.shipping_time, digi_orders.shipping_time),
         factory_address_id = COALESCE(EXCLUDED.factory_address_id, digi_orders.factory_address_id),
         factory_name = COALESCE(EXCLUDED.factory_name, digi_orders.factory_name),
         courier = COALESCE(EXCLUDED.courier, digi_orders.courier),
         tracking_number = EXCLUDED.tracking_number,
         label_url = COALESCE(EXCLUDED.label_url, digi_orders.label_url),
         items = CASE WHEN jsonb_array_length(EXCLUDED.items) > 0 THEN EXCLUDED.items ELSE digi_orders.items END,
         courier_status = CASE WHEN $29 THEN digi_orders.courier_status ELSE EXCLUDED.courier_status END,
         courier_status_text = CASE WHEN $29 THEN digi_orders.courier_status_text ELSE EXCLUDED.courier_status_text END,
         courier_eta = CASE WHEN $29 THEN digi_orders.courier_eta ELSE EXCLUDED.courier_eta END,
         courier_delivered = CASE WHEN $29 THEN digi_orders.courier_delivered ELSE EXCLUDED.courier_delivered END,
         courier_synced_at = CASE WHEN $29 THEN digi_orders.courier_synced_at ELSE EXCLUDED.courier_synced_at END,
         po_id = EXCLUDED.po_id, po_match = EXCLUDED.po_match, order_id = EXCLUDED.order_id,
         source = EXCLUDED.source, api_missing = EXCLUDED.api_missing,
         synced_at = NOW(), updated_at = NOW()`,
      [r.order_no, r.digi_id, r.order_status, r.status_reason, r.line_messages, r.goods_total_qty,
       r.consignee_name, r.receiver_city, r.receiver_province, r.receiver_country, r.order_time, r.shipping_time,
       r.factory_address_id, r.factory_name, r.courier, r.tracking_number, r.label_url, JSON.stringify(r.items),
       r.courier_status, r.courier_status_text, r.courier_eta, r.courier_delivered, r.courier_synced_at,
       r.po_id, r.po_match, r.order_id, r.source, r.api_missing, Boolean(r.keep_courier)])
  }
  return counts
}

module.exports = { syncDigiOrders, matchPO }
