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
const SHIPPO_EVERY_MS = 10 * 60 * 1000   // Shippo is asked at most every ten minutes per parcel
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

const intOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * An order's lines: DIGI's per-line status (queryOrderStatus.childOrderStatus)
 * joined on platformOllId to the line as it was placed (BlankTex's goodsList).
 */
function linesOf(orderNo, goods, childStatus) {
  const byId = new Map()
  const lineNo = id => { const m = /(\d{3})$/.exec(String(id || '')); return m ? Number(m[1]) : null }
  ;(Array.isArray(goods) ? goods : []).forEach((g, idx) => {
    const id = g.platformOllId || `${orderNo}${String(idx + 1).padStart(3, '0')}`
    byId.set(id, { line_id: id, placed: g })
  })
  for (const c of Array.isArray(childStatus) ? childStatus : []) {
    if (!c.platformOllId) continue
    const cur = byId.get(c.platformOllId) || { line_id: c.platformOllId }
    cur.api_status = c
    byId.set(c.platformOllId, cur)
  }
  return [...byId.values()].map(l => {
    const g = l.placed || {}, c = l.api_status || {}
    return {
      line_id: l.line_id,
      line_no: lineNo(l.line_id),
      goods_status: c.goodsStatus || null,
      goods_status_text: c.goodsStatusStr || null,
      product_message: c.productMessage || null,
      refund_status: g.refundStatus || null,
      title: g.title || null,
      style_code: g.styleCode || null,
      style_name: g.styleName || null,
      color_code: g.colorCode || null,
      color_name: g.colorName || null,
      size_code: g.sizeCode || null,
      size_name: g.sizeName || null,
      qty: intOrNull(g.num),
      craft_type: intOrNull(g.craftType),
      goods_type: intOrNull(g.goodsType),
      print_position: g.printPosition != null ? String(g.printPosition) : null,
      images: Array.isArray(g.imageList) ? g.imageList : [],
      api_status: l.api_status || null,
      placed: l.placed || null,
    }
  })
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
  // DIGI numbers on Printshop POs — a merged or deleted PO's order is still a
  // real DIGI order, so those count too (tied to a PO only while it is live) —
  // and on sales orders imported from DIGI's sheet (source_po_number).
  const { rows: poRefs } = await db.query(
    `SELECT CASE WHEN p.deleted_at IS NULL THEN p.id END AS id, BTRIM(p.supplier_reference) AS order_no
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      WHERE s.name ~* '^digi' AND NULLIF(BTRIM(p.supplier_reference), '') IS NOT NULL
     UNION
     SELECT NULL, BTRIM(o.source_po_number)
       FROM orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE s.name ~* '^digi' AND BTRIM(o.source_po_number) ~ '^(ORD-[0-9]{12}|SG[0-9]{19})$'`)
  // Numbers a person added on the page (migration 150).
  let manual = []
  try {
    ;({ rows: manual } = await db.query(`SELECT order_no FROM digi_order_numbers`))
  } catch (err) {
    console.error('[digi-sync] digi_order_numbers unavailable:', err.message)
  }
  const { rows: known } = await db.query(
    `SELECT order_no, courier_status, courier_synced_at, courier_delivered_at, label_parsed_url, label_from_name, label_from_address,
            label_from_city, label_from_state, label_from_zip, label_created_on, label_text
       FROM digi_orders`)
  return { blanktex, poRefs, manual, known: new Map(known.map(k => [k.order_no, k])) }
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

const LABELS_PER_RUN = 40
const pdfText = (() => { let parse = null; return async (buf) => { parse = parse || require('pdf-parse/lib/pdf-parse.js'); return (await parse(buf)).text } })()

/**
 * The sender printed on a shipping label: name, street, "CITY ST 12345", and the
 * day it was created. USPS labels carry text; some UPS labels are only an image,
 * and give nothing.
 */
function parseLabel(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  const c = /Created (\d{2})\/(\d{2})\/(\d{4})/.exec(text || '')
  const out = { created: c ? `${c[3]}-${c[1]}-${c[2]}` : null }
  const i = lines.findIndex(l => /^[A-Z][A-Z .'-]* [A-Z]{2} \d{5}(-\d{4})?$/.test(l))
  if (i < 1) return out
  const m = /^(.*) ([A-Z]{2}) (\d{5})(?:-\d{4})?$/.exec(lines[i])
  return { ...out, name: i >= 2 ? lines[i - 2] : null, address: lines[i - 1], city: m[1], state: m[2], zip: m[3] }
}

/** Read each new label once; a label already read keeps what it said. */
async function readLabels(rows, known, log) {
  let read = 0
  for (const r of rows) {
    // DIGI buys its own labels through its goodFast service; any other label
    // was bought by the shop and handed to DIGI.
    r.shipped_by = r.label_url ? (/\/waybill\/goodFast\//.test(r.label_url) ? 'Factory' : 'Self') : null
    if (!r.label_url) continue
    const prev = known.get(r.order_no)
    if (prev?.label_parsed_url === r.label_url) {
      Object.assign(r, { label_from_name: prev.label_from_name, label_from_address: prev.label_from_address,
        label_from_city: prev.label_from_city, label_from_state: prev.label_from_state, label_from_zip: prev.label_from_zip,
        label_created_on: prev.label_created_on, label_text: prev.label_text, label_parsed_url: prev.label_parsed_url })
      continue
    }
    if (read >= LABELS_PER_RUN) continue
    read += 1
    try {
      const res = await fetch(r.label_url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 5 * 1024 * 1024) throw new Error('label larger than 5 MB')
      const text = await pdfText(buf)
      const l = parseLabel(text)
      Object.assign(r, { label_from_name: l.name || null, label_from_address: l.address || null, label_from_city: l.city || null,
        label_from_state: l.state || null, label_from_zip: l.zip || null, label_created_on: l.created || null,
        label_text: String(text || '').trim().slice(0, 4000) || null, label_parsed_url: r.label_url })
    } catch (err) {
      log(`  label ${r.order_no}: ${err.message}`)
    }
  }
}

async function courierStates(rows, known, log) {
  // Every parcel with a number, shipped or not yet: DIGI buys the label before it
  // prints, and a parcel can be scanned before DIGI marks the order shipped.
  const tracked = rows.filter(r => r.tracking_number && r.order_status !== 13 && r.order_status !== 15)
  if (!tracked.length) return
  const { rows: ships } = await db.query(
    `SELECT DISTINCT ON (BTRIM(s.tracking_number)) BTRIM(s.tracking_number) AS tn, s.tracking_status, s.status_details,
            s.estimated_delivery, s.delivered_date, s.tracking_synced_at, s.status::text AS status,
            (SELECT MAX((h ->> 'status_date')::timestamptz)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.tracking_history) = 'array' THEN s.tracking_history ELSE '[]'::jsonb END) h
              WHERE UPPER(h ->> 'status') = 'DELIVERED' AND (h ->> 'status_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}') AS delivered_at
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
      r.courier_delivered_at = s.delivered_at || null
      r.courier_synced_at = s.tracking_synced_at || new Date()
      continue
    }
    const prev = known.get(r.order_no)
    const fresh = prev?.courier_synced_at && Date.now() - new Date(prev.courier_synced_at).getTime() < SHIPPO_EVERY_MS
    // A delivered parcel is asked no more — once its delivered time is known.
    if ((prev?.courier_status === 'DELIVERED' && prev?.courier_delivered_at) || fresh || asked >= SHIPPO_PER_RUN || !shippo.isConfigured()) {
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
      const scan = (Array.isArray(t.tracking_history) ? t.tracking_history : []).filter(h => String(h.status || '').toUpperCase() === 'DELIVERED' && h.status_date).pop()
      r.courier_delivered_at = scan ? new Date(scan.status_date) : null
      r.courier_synced_at = new Date()
    } catch (err) {
      r.keep_courier = true
      if (err.statusCode !== 404) log(`  shippo ${r.tracking_number}: ${err.message}`)
    }
    await sleep(350)
  }
}

/** Sync every DIGI order. Dry run unless apply; returns a short summary. */
async function syncDigiOrders({ apply = false, log = console.log, trigger = 'cron' } = {}) {
  if (!digi.isConfigured()) throw Object.assign(new Error('DIGI API is not configured (DIGI_API_SECRET_KEY)'), { status: 503 })
  // Every applied sync leaves a row in digi_sync_runs, with its counts or its error.
  let runId = null
  if (apply) {
    const { rows } = await db.query(`INSERT INTO digi_sync_runs (trigger) VALUES ($1) RETURNING id`, [trigger])
    runId = rows[0].id
  }
  try {
    const counts = await runSync({ apply, log })
    if (runId) {
      await db.query(
        `UPDATE digi_sync_runs SET finished_at = NOW(), orders = $2, on_api = $3, tracked = $4, po_linked = $5, lines = $6, warehouses = $7 WHERE id = $1`,
        [runId, counts.orders, counts.on_api ?? null, counts.tracked ?? null, counts.po_linked ?? null, counts.lines ?? null, counts.warehouses ?? null])
    }
    // Two-minute runs add up; a fortnight of them is plenty to look back on.
    if (runId) await db.query(`DELETE FROM digi_sync_runs WHERE started_at < NOW() - INTERVAL '14 days'`).catch(() => {})
    return counts
  } catch (err) {
    if (runId) await db.query(`UPDATE digi_sync_runs SET finished_at = NOW(), error = $2 WHERE id = $1`, [runId, String(err.message).slice(0, 2000)]).catch(() => {})
    throw err
  }
}

async function runSync({ apply, log }) {
  const { blanktex, poRefs, manual, known } = await loadUniverse()

  const orders = new Map()
  for (const b of blanktex) orders.set(b.order_no, { order_no: b.order_no, source: 'blanktex', bt: b })
  for (const p of poRefs) {
    const o = orders.get(p.order_no) || { order_no: p.order_no, source: 'po_reference' }
    if (p.id) o.ref_po_id = p.id
    orders.set(p.order_no, o)
  }
  for (const m of manual) if (!orders.has(m.order_no)) orders.set(m.order_no, { order_no: m.order_no, source: 'manual' })
  const orderNos = [...orders.keys()]
  log(`[digi-sync] ${orderNos.length} DIGI orders known (${blanktex.length} from BlankTex, ${poRefs.length} on POs / orders, ${manual.length} added by hand)`)
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
      // The rest of what DIGI says about the order (migration 149).
      receiver_phone: i.phone || null,
      receiver_address: i.address || null,
      receiver_address2: i.addressOptional || null,
      receiver_post_code: i.postCode != null && i.postCode !== '' ? String(i.postCode) : null,
      platform_order_status: i.platformOrderStatus || null,
      platform_refund_status: i.platformRefundStatus || null,
      order_state_text: s.orderStateStr || null,
      express_code: i.expressCode != null && i.expressCode !== '' ? String(i.expressCode) : null,
      pre_shipping_time: validDate(utc(i.preShippingTime)),
      platform_shop_code: i.platformShopCode || null,
      platform_shop_name: i.platformShopName || null,
      platform_type: Number.isFinite(Number(i.platformType)) && i.platformType !== null ? Number(i.platformType) : null,
      delivery_shipping_time: validDate(utc(d.shippingTime)),
      api_info: info.has(o.order_no) ? info.get(o.order_no) : null,
      api_status: status.has(o.order_no) ? status.get(o.order_no) : null,
      api_delivery: delivery.has(o.order_no) ? delivery.get(o.order_no) : null,
      lines: linesOf(o.order_no, goods, s.childOrderStatus),
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

  // Still nothing: the parcel Printshop recorded for the same recipient, on the
  // same courier, shipped within a few days of DIGI's ship time — when exactly
  // one such parcel exists and no other DIGI order already carries it.
  const taken = new Set(rows.map(r => r.tracking_number).filter(Boolean))
  for (const r of rows.filter(x => !x.tracking_number && x.raw_tracking && x.consignee_name)) {
    const at = r.shipping_time || r.order_time
    if (!at) continue
    const { rows: cands } = await db.query(
      `SELECT DISTINCT BTRIM(s.tracking_number) AS tn, s.carrier
         FROM shipments s
        WHERE s.deleted_at IS NULL AND NULLIF(BTRIM(s.tracking_number), '') IS NOT NULL
          AND (LOWER(REGEXP_REPLACE(COALESCE(s.recipient_name, ''), '[^a-zA-Z]', '', 'g')) = $1
               OR LOWER(REGEXP_REPLACE(COALESCE(s.customer_name, ''), '[^a-zA-Z]', '', 'g')) = $1)
          AND ($2::text IS NULL OR UPPER(COALESCE(s.carrier, '')) = UPPER($2))
          AND COALESCE(s.ship_date, s.created_at::date) BETWEEN ($3::timestamptz - INTERVAL '4 days')::date AND ($3::timestamptz + INTERVAL '3 days')::date`,
      [normName(r.consignee_name), r.courier, at])
    const free = cands.filter(c => !taken.has(c.tn))
    if (free.length === 1) { r.tracking_number = free[0].tn; r.courier = r.courier || free[0].carrier; taken.add(free[0].tn) }
  }

  await readLabels(rows, known, log)
  await courierStates(rows, known, log)

  const counts = { orders: rows.length, on_api: rows.filter(r => !r.api_missing).length, tracked: rows.filter(r => r.tracking_number).length,
    po_linked: rows.filter(r => r.po_id).length, order_linked: rows.filter(r => r.order_id).length }
  log(`[digi-sync] ${JSON.stringify(counts)}${apply ? '' : ' (dry run)'}`)
  counts.lines = rows.reduce((a, r) => a + r.lines.length, 0)
  counts.warehouses = Array.isArray(addresses) ? addresses.length : 0
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

    // Everything else DIGI returned. A field DIGI leaves out this time keeps
    // what it said before; the raw replies are replaced whenever DIGI answers.
    await db.query(
      `UPDATE digi_orders SET
         receiver_phone = COALESCE($2, receiver_phone), receiver_address = COALESCE($3, receiver_address),
         receiver_address2 = COALESCE($4, receiver_address2), receiver_post_code = COALESCE($5, receiver_post_code),
         platform_order_status = COALESCE($6, platform_order_status), platform_refund_status = COALESCE($7, platform_refund_status),
         order_state_text = COALESCE($8, order_state_text), express_code = COALESCE($9, express_code),
         pre_shipping_time = COALESCE($10, pre_shipping_time), platform_shop_code = COALESCE($11, platform_shop_code),
         platform_shop_name = COALESCE($12, platform_shop_name), platform_type = COALESCE($13, platform_type),
         delivery_shipping_time = COALESCE($14, delivery_shipping_time),
         api_info = COALESCE($15::jsonb, api_info), api_status = COALESCE($16::jsonb, api_status),
         api_delivery = COALESCE($17::jsonb, api_delivery),
         shipped_by = COALESCE($18, shipped_by),
         label_from_name = CASE WHEN $19::text IS NULL THEN label_from_name ELSE $20 END,
         label_from_address = CASE WHEN $19::text IS NULL THEN label_from_address ELSE $21 END,
         label_from_city = CASE WHEN $19::text IS NULL THEN label_from_city ELSE $22 END,
         label_from_state = CASE WHEN $19::text IS NULL THEN label_from_state ELSE $23 END,
         label_from_zip = CASE WHEN $19::text IS NULL THEN label_from_zip ELSE $24 END,
         label_created_on = CASE WHEN $19::text IS NULL THEN label_created_on ELSE $25::date END,
         label_text = CASE WHEN $19::text IS NULL THEN label_text ELSE $26 END,
         label_parsed_url = COALESCE($19, label_parsed_url),
         courier_delivered_at = CASE WHEN $27 THEN courier_delivered_at ELSE COALESCE($28::timestamptz, courier_delivered_at) END
       WHERE order_no = $1`,
      [r.order_no, r.receiver_phone, r.receiver_address, r.receiver_address2, r.receiver_post_code,
       r.platform_order_status, r.platform_refund_status, r.order_state_text, r.express_code, r.pre_shipping_time,
       r.platform_shop_code, r.platform_shop_name, r.platform_type, r.delivery_shipping_time,
       r.api_info ? JSON.stringify(r.api_info) : null, r.api_status ? JSON.stringify(r.api_status) : null,
       r.api_delivery ? JSON.stringify(r.api_delivery) : null,
       r.shipped_by || null, r.label_parsed_url || null, r.label_from_name || null, r.label_from_address || null,
       r.label_from_city || null, r.label_from_state || null, r.label_from_zip || null, r.label_created_on || null,
       r.label_text || null, Boolean(r.keep_courier), r.courier_delivered_at || null])

    for (const l of r.lines) {
      await db.query(
        `INSERT INTO digi_order_lines (line_id, order_no, line_no, goods_status, goods_status_text, product_message, refund_status,
           title, style_code, style_name, color_code, color_name, size_code, size_name, qty, craft_type, goods_type,
           print_position, images, api_status, placed, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,NOW())
         ON CONFLICT (line_id) DO UPDATE SET
           order_no = EXCLUDED.order_no, line_no = COALESCE(EXCLUDED.line_no, digi_order_lines.line_no),
           goods_status = COALESCE(EXCLUDED.goods_status, digi_order_lines.goods_status),
           goods_status_text = COALESCE(EXCLUDED.goods_status_text, digi_order_lines.goods_status_text),
           product_message = EXCLUDED.product_message,
           refund_status = COALESCE(EXCLUDED.refund_status, digi_order_lines.refund_status),
           title = COALESCE(EXCLUDED.title, digi_order_lines.title), style_code = COALESCE(EXCLUDED.style_code, digi_order_lines.style_code),
           style_name = COALESCE(EXCLUDED.style_name, digi_order_lines.style_name), color_code = COALESCE(EXCLUDED.color_code, digi_order_lines.color_code),
           color_name = COALESCE(EXCLUDED.color_name, digi_order_lines.color_name), size_code = COALESCE(EXCLUDED.size_code, digi_order_lines.size_code),
           size_name = COALESCE(EXCLUDED.size_name, digi_order_lines.size_name), qty = COALESCE(EXCLUDED.qty, digi_order_lines.qty),
           craft_type = COALESCE(EXCLUDED.craft_type, digi_order_lines.craft_type), goods_type = COALESCE(EXCLUDED.goods_type, digi_order_lines.goods_type),
           print_position = COALESCE(EXCLUDED.print_position, digi_order_lines.print_position),
           images = CASE WHEN jsonb_array_length(EXCLUDED.images) > 0 THEN EXCLUDED.images ELSE digi_order_lines.images END,
           api_status = COALESCE(EXCLUDED.api_status, digi_order_lines.api_status),
           placed = COALESCE(EXCLUDED.placed, digi_order_lines.placed), synced_at = NOW()`,
        [l.line_id, r.order_no, l.line_no, l.goods_status, l.goods_status_text, l.product_message, l.refund_status,
         l.title, l.style_code, l.style_name, l.color_code, l.color_name, l.size_code, l.size_name, l.qty, l.craft_type, l.goods_type,
         l.print_position, JSON.stringify(l.images), l.api_status ? JSON.stringify(l.api_status) : null, l.placed ? JSON.stringify(l.placed) : null])
    }
  }

  for (const a of Array.isArray(addresses) ? addresses : []) {
    if (!a.id || !a.addressId) continue
    await db.query(
      `INSERT INTO digi_warehouses (id, address_id, alias, country, province, city, address, enabled, api_row, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
       ON CONFLICT (id) DO UPDATE SET address_id = EXCLUDED.address_id, alias = EXCLUDED.alias, country = EXCLUDED.country,
         province = EXCLUDED.province, city = EXCLUDED.city, address = EXCLUDED.address, enabled = EXCLUDED.enabled,
         api_row = EXCLUDED.api_row, synced_at = NOW()`,
      [String(a.id), a.addressId, a.addressAlias || null, a.country || null, a.province || null, a.city || null,
       a.address || null, a.enabled ?? null, JSON.stringify(a)])
  }
  return counts
}

module.exports = { syncDigiOrders, matchPO }
