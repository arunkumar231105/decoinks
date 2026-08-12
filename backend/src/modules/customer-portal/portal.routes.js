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
  // <img>/<a> cannot send an Authorization header, so image and file routes may
  // pass the same token as ?t=. It is verified identically — no weaker path in.
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.t || null)
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

/**
 * Artwork bytes, proxied from Nextcloud.
 *
 * The asset is looked up by id AND the caller's customer_id, so a customer can
 * only ever fetch their own files — the Nextcloud path is never accepted from
 * the request (the staff /api/nextcloud routes take a raw path and must stay
 * off-limits to customers).
 */
const streamAsset = (kind) => wrap(async (req, res) => {
  const asset = await svc.getAssetPath(req.portal.customerId, req.params.id)
  if (!asset) return res.status(404).json({ error: 'Not found' })

  const nc = require('../nextcloud/nextcloud.service')
  const ncRes = kind === 'preview'
    ? await nc.getPreview(asset.path, { width: Number(req.query.w) || 600, height: Number(req.query.h) || 600 })
    : await nc.downloadFile(asset.path)

  const raw = Buffer.from(await ncRes.arrayBuffer())

  if (kind === 'file') {
    res.setHeader('Content-Type', ncRes.headers.get('content-type') || asset.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${asset.file_name}"`)
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.send(raw)
  }

  // Nextcloud falls back to the original file when its preview generator is
  // unavailable, which meant a list of thumbnails pulled several MB each.
  // Resize here so a thumbnail costs kilobytes; on any failure serve what we got.
  const size = Math.min(Number(req.query.w) || 600, 1600)
  try {
    const thumb = await require('sharp')(raw)
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    return res.send(thumb)
  } catch {
    res.setHeader('Content-Type', ncRes.headers.get('content-type') || asset.mime_type || 'image/png')
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.send(raw)
  }
})

router.get('/artworks/:id/preview', streamAsset('preview'))
router.get('/artworks/:id/file',    streamAsset('file'))

router.get('/summary',  wrap(async (req, res) => res.json({ data: await svc.getSummary(req.portal.customerId) })))
router.get('/orders',   wrap(async (req, res) => res.json({ data: await svc.getOrders(req.portal.customerId) })))
router.get('/artworks', wrap(async (req, res) => res.json({ data: await svc.getArtworks(req.portal.customerId) })))
router.get('/profile',  wrap(async (req, res) => res.json({ data: await svc.getProfile(req.portal.customerId) })))

module.exports = router
