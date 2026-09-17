/**
 * /api/supplier-orders — Printshop's Supplier Order Management (DIGI orders).
 * Read-only towards DIGI; "Sync now" asks DIGI's read endpoints again.
 */
const express = require('express')
const { verifyToken } = require('../../middleware/auth')
const grid = require('./digi.grid')
const { syncDigiOrders } = require('./digi.sync')

const router = express.Router()
router.use(verifyToken)

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

// One sync at a time, and not more often than once a minute.
let running = null
let lastRun = 0
router.post('/digi/sync', async (req, res) => {
  try {
    if (running) return res.status(409).json({ error: 'A sync is already running' })
    if (Date.now() - lastRun < 60 * 1000) return res.json({ skipped: true, message: 'Synced less than a minute ago' })
    running = syncDigiOrders({ apply: true, log: () => {} })
    const result = await running
    lastRun = Date.now()
    res.json({ success: true, ...result, rows: undefined })
  } catch (err) { fail(res, err) } finally { running = null }
})

module.exports = router
