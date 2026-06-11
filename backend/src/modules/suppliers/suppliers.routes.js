const { Router } = require('express')
const { z } = require('zod')
const { verifyToken, requireRole } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./suppliers.controller')
const bcrypt = require('bcryptjs')
const db = require('../../config/db')

const router = Router()
router.use(verifyToken)

const supplierFields = {
  name:         z.string().min(2).optional(),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().optional().nullable(),
  company:      z.string().optional().nullable(),
  address_line1:z.string().optional().nullable(),
  address_line2:z.string().optional().nullable(),
  city:         z.string().optional().nullable(),
  state:        z.string().optional().nullable(),
  zip:          z.string().optional().nullable(),
  country:      z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
  website:       z.string().optional().nullable(),
  facebook_id:   z.string().optional().nullable(),
  instagram_id:  z.string().optional().nullable(),
}

const createSchema = z.object({
  ...supplierFields,
  name: z.string().min(2),
})

const updateSchema = z.object({
  ...supplierFields,
  status: z.enum(['Active', 'Inactive']).optional(),
}).strict()

router.get('/',           controller.list)
router.get('/:id',        controller.getOne)
router.get('/:id/orders', controller.getOrders)
router.post('/',          validate(createSchema), controller.create)
router.put('/:id',        validate(updateSchema), controller.update)
router.delete('/:id',     controller.remove)

// ── Supplier Portal Access Management ────────────────────────────────────────

router.get('/:id/portal-access', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, is_active, last_login, must_change_pw, created_at
       FROM supplier_portal_users WHERE supplier_id = $1`,
      [req.params.id]
    )
    res.json({ portalAccess: rows[0] ?? null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/portal-access', requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'username and password are required' })
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const hash = await bcrypt.hash(password, 12)
    await db.query(
      `INSERT INTO supplier_portal_users (supplier_id, username, password_hash, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = $3, is_active = TRUE, updated_at = NOW()`,
      [req.params.id, username, hash, req.user?.id]
    )
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/:id/portal-access', async (req, res) => {
  try {
    await db.query(
      'UPDATE supplier_portal_users SET is_active = FALSE, updated_at = NOW() WHERE supplier_id = $1',
      [req.params.id]
    )
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
