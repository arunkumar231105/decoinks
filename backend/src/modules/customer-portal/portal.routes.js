const { Router } = require('express')
const jwt = require('jsonwebtoken')
const svc = require('./portal.service')

const router = Router()

/**
 * Customer-portal auth.
 *
 * Deliberately NOT the staff `verifyToken`: a customer token is signed with its
 * own secret and must carry role 'customer', so a staff or supplier token can
 * never reach these routes (and a customer token can never reach staff routes).
 */
function requireCustomer(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET)
    if (decoded.role !== 'customer' || !decoded.customerId) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    req.portal = { customerId: decoded.customerId, portalUserId: decoded.portalUserId }
    next()
  } catch {
    return res.status(401).json({ error: 'Session expired' })
  }
}

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

// ── Public ───────────────────────────────────────────────────────────────────
router.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' })
  res.json(await svc.login(username, password))
}))

// ── Authenticated ────────────────────────────────────────────────────────────
router.use(requireCustomer)

router.patch('/me/password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' })
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' })
  await svc.changePassword(req.portal.portalUserId, currentPassword, newPassword)
  res.json({ success: true })
}))

router.get('/summary',  wrap(async (req, res) => res.json({ data: await svc.getSummary(req.portal.customerId) })))
router.get('/orders',   wrap(async (req, res) => res.json({ data: await svc.getOrders(req.portal.customerId) })))
router.get('/artworks', wrap(async (req, res) => res.json({ data: await svc.getArtworks(req.portal.customerId) })))
router.get('/profile',  wrap(async (req, res) => res.json({ data: await svc.getProfile(req.portal.customerId) })))

module.exports = router
