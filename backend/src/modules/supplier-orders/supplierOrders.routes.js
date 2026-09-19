/**
 * /api/supplier-orders — Printshop's Supplier Order Management (DIGI orders).
 * Read-only towards DIGI; "Sync now" asks DIGI's read endpoints again.
 */
const express = require('express')
const { verifyToken } = require('../../middleware/auth')
const grid = require('./digi.grid')
const { syncDigiOrders } = require('./digi.sync')
const digi = require('./digi.client')

const router = express.Router()
router.use(verifyToken)

// One sync at a time.
let running = null
let lastRun = 0

const fail = (res, err) => {
  const code = [400, 404, 409, 503].includes(err.status) ? err.status : err.status === 502 ? 502 : 500
  if (code >= 500) console.error('[supplier-orders]', err.message)
  res.status(code).json({ error: code === 500 ? 'Something went wrong' : err.message })
}

// ── New Order (BlankTex's screen, in Printshop) — read-only for now ─────────
const newOrder = require('./digi.newOrder')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.get('/new-order/catalog', async (req, res) => {
  try { res.json(await newOrder.catalog()) } catch (err) { fail(res, err) }
})
// Every picker below is for one supplier (?supplier=DIGI, BlankTex's supplier code).
const SUPPLIER_CODE = /^[A-Za-z0-9_-]{2,20}$/
const supplierOf = (req, res) => {
  const code = String(req.query.supplier || '')
  if (!SUPPLIER_CODE.test(code)) { res.status(400).json({ error: 'Select a fulfillment supplier first' }); return null }
  return code
}
router.get('/new-order/sales-orders', async (req, res) => {
  try {
    const code = supplierOf(req, res); if (!code) return
    res.json({ data: await newOrder.salesOrders(code) })
  } catch (err) { fail(res, err) }
})
router.get('/new-order/sales-orders/:id/purchase-orders', async (req, res) => {
  try {
    const code = supplierOf(req, res); if (!code) return
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Sales order id is invalid' })
    res.json({ data: await newOrder.orderPurchaseOrders(req.params.id, code, req.user.id) })
  } catch (err) { fail(res, err) }
})
router.get('/new-order/sales-orders/:id/purchase-orders/:poId', async (req, res) => {
  try {
    const code = supplierOf(req, res); if (!code) return
    if (!UUID.test(req.params.id) || !UUID.test(req.params.poId)) return res.status(400).json({ error: 'Purchase order id is invalid' })
    const po = await newOrder.purchaseOrder(req.params.id, req.params.poId, code)
    if (!po) return res.status(404).json({ error: 'That purchase order is not open for this sales order and supplier — it may already be on the supplier' })
    // Opening it holds it for this agent, so nobody else orders it meanwhile.
    const holder = await newOrder.claim(po.id, req.user.id)
    if (holder) return res.status(409).json({ error: `${po.po_number} is being ordered by ${holder.name} — pick it again once they are done` })
    res.json({ data: { ...po, claim_minutes: newOrder.CLAIM_MINUTES } })
  } catch (err) { fail(res, err) }
})

// Renew / let go of the hold on a PO (the page renews it while it is open).
router.post('/new-order/claims/:poId', async (req, res) => {
  try {
    if (!UUID.test(req.params.poId)) return res.status(400).json({ error: 'Purchase order id is invalid' })
    const holder = await newOrder.claim(req.params.poId, req.user.id)
    if (holder) return res.status(409).json({ error: `${holder.name} is ordering this PO now` })
    res.json({ ok: true })
  } catch (err) { fail(res, err) }
})
router.delete('/new-order/claims/:poId', async (req, res) => {
  try {
    if (!UUID.test(req.params.poId)) return res.status(400).json({ error: 'Purchase order id is invalid' })
    await newOrder.release(req.params.poId, req.user.id)
    res.json({ ok: true })
  } catch (err) { fail(res, err) }
})
// An image added on New Order, kept on the PO line (or sales-order line) it belongs to.
router.put('/new-order/sales-orders/:id/purchase-orders/:poId/lines/:lineId/image', express.json(), async (req, res) => {
  try {
    const code = supplierOf(req, res); if (!code) return
    const { id, poId, lineId } = req.params
    if (![id, poId, lineId].every(v => UUID.test(v))) return res.status(400).json({ error: 'Line id is invalid' })
    const out = await newOrder.saveLineImage({
      orderId: id, poId, lineId, lineSource: req.body?.line_source, role: req.body?.role, url: req.body?.url,
      supplierCode: code, userId: req.user.id,
    })
    res.json(out)
  } catch (err) { fail(res, err) }
})

router.get('/digi', async (req, res) => {
  try { res.json(await grid.getGrid(req.query)) } catch (err) { fail(res, err) }
})

router.get('/digi/:orderNo', async (req, res) => {
  try {
    const row = await grid.getOrder(String(req.params.orderNo))
    if (!row) return res.status(404).json({ error: 'DIGI order not found' })
    res.json({ row })
  } catch (err) { fail(res, err) }
})

// DIGI order numbers pasted on the page (orders placed straight on DIGI's
// site, which nothing else in Printshop knows). Each is checked against DIGI;
// the ones DIGI knows are kept and synced at once.
const ORDER_NO = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/
router.post('/digi/numbers', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.numbers) ? req.body.numbers : String(req.body?.numbers || '').split(/[\s,;]+/)
    const numbers = [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))]
    if (!numbers.length) return res.status(400).json({ error: 'Paste at least one DIGI order number' })
    if (numbers.length > 200) return res.status(400).json({ error: 'At most 200 numbers at a time' })
    const invalid = numbers.filter(n => !ORDER_NO.test(n))
    const valid = numbers.filter(n => ORDER_NO.test(n))
    const found = new Set()
    for (let i = 0; i < valid.length; i += 50) {
      const data = await digi.call('queryOrderStatus', { platformOidList: valid.slice(i, i + 50) })
      for (const d of Array.isArray(data) ? data : []) if (d.platformOid) found.add(d.platformOid)
    }
    const db = require('../../config/db')
    const { rows: existing } = await db.query(`SELECT order_no FROM digi_orders WHERE order_no = ANY($1::text[])`, [valid])
    const already = new Set(existing.map(r => r.order_no))
    const added = [...found].filter(n => !already.has(n))
    for (const n of found) {
      await db.query(
        `INSERT INTO digi_order_numbers (order_no, found_on_api, added_by) VALUES ($1, TRUE, $2)
         ON CONFLICT (order_no) DO UPDATE SET found_on_api = TRUE`, [n, req.user?.id || null])
    }
    if (added.length && !running) {
      running = syncDigiOrders({ apply: true, log: () => {}, trigger: 'manual' })
      try { await running; lastRun = Date.now() } finally { running = null }
    }
    res.json({
      added,
      already_there: valid.filter(n => already.has(n)),
      not_found_on_digi: valid.filter(n => !found.has(n)),
      invalid,
    })
  } catch (err) { fail(res, err) }
})

// One sync at a time, and not more often than once a minute.
router.post('/digi/sync', async (req, res) => {
  try {
    if (running) return res.status(409).json({ error: 'A sync is already running' })
    if (Date.now() - lastRun < 60 * 1000) return res.json({ skipped: true, message: 'Synced less than a minute ago' })
    running = syncDigiOrders({ apply: true, log: () => {}, trigger: 'manual' })
    const result = await running
    lastRun = Date.now()
    res.json({ success: true, ...result, rows: undefined })
  } catch (err) { fail(res, err) } finally { running = null }
})

module.exports = router
