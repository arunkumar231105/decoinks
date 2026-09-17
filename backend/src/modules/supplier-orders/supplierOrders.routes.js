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
