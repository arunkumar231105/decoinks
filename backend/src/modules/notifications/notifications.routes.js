/**
 * /api/notifications — the header bell and phone push (migration 154).
 * Everything here is the signed-in person's own notifications and devices.
 */
const express = require('express')
const { verifyToken } = require('../../middleware/auth')
const svc = require('./notifications.service')

const router = express.Router()
router.use(verifyToken)
const fail = (res, err) => {
  const code = [400, 404].includes(err.status) ? err.status : 500
  if (code === 500) console.error('[notifications]', err.message)
  res.status(code).json({ error: code === 500 ? 'Something went wrong' : err.message })
}

router.get('/', async (req, res) => {
  try { res.json(await svc.list(req.user.id, Number(req.query.limit) || 30)) } catch (err) { fail(res, err) }
})
router.post('/read-all', async (req, res) => {
  try { await svc.markAllRead(req.user.id); res.json({ ok: true }) } catch (err) { fail(res, err) }
})
router.post('/:id/read', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Notification id is invalid' })
    await svc.markRead(req.user.id, req.params.id); res.json({ ok: true })
  } catch (err) { fail(res, err) }
})

// Phone / desktop push.
router.get('/push/key', (req, res) => {
  const key = svc.publicKey()
  if (!key) return res.status(404).json({ error: 'Push is not set up on this server' })
  res.json({ key })
})
router.post('/push/subscribe', express.json(), async (req, res) => {
  try { await svc.subscribe(req.user.id, req.body?.subscription, req.headers['user-agent']); res.json({ ok: true }) } catch (err) { fail(res, err) }
})
router.post('/push/unsubscribe', express.json(), async (req, res) => {
  try { await svc.unsubscribe(req.user.id, req.body?.endpoint); res.json({ ok: true }) } catch (err) { fail(res, err) }
})
router.post('/test', async (req, res) => {
  try { res.json({ delivered: await svc.test(req.user.id), push: svc.pushReady() }) } catch (err) { fail(res, err) }
})

module.exports = router
