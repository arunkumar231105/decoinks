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

// ── Supplier Contacts (contact persons used on Purchase Orders) ──────────────

const contactSchema = z.object({
  name:       z.string().min(1),
  email:      z.string().email().optional().nullable(),
  phone:      z.string().optional().nullable(),
  wechat_id:  z.string().optional().nullable(),
  is_primary: z.boolean().optional(),
})

router.get('/:id/contacts', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, supplier_id, name, email, phone, wechat_id, is_primary, created_at
       FROM supplier_contacts WHERE supplier_id = $1
       ORDER BY is_primary DESC, name`,
      [req.params.id]
    )
    res.json({ success: true, data: rows })
  } catch (e) { next(e) }
})

router.post('/:id/contacts', validate(contactSchema), async (req, res, next) => {
  try {
    const { name, email, phone, wechat_id, is_primary } = req.body
    if (is_primary) {
      await db.query(
        `UPDATE supplier_contacts SET is_primary = FALSE WHERE supplier_id = $1`,
        [req.params.id]
      )
    }
    const { rows } = await db.query(
      `INSERT INTO supplier_contacts (supplier_id, name, email, phone, wechat_id, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, name, email || null, phone || null, wechat_id || null, !!is_primary]
    )
    res.status(201).json({ success: true, data: rows[0] })
  } catch (e) { next(e) }
})

router.put('/:id/contacts/:cid', validate(contactSchema.partial()), async (req, res, next) => {
  try {
    const { name, email, phone, wechat_id, is_primary } = req.body

    // Verify the contact exists and belongs to this supplier BEFORE touching
    // the existing primary flag — otherwise a wrong :cid would clear the real
    // primary and then 404, leaving the supplier with no primary contact.
    const { rows: existRows } = await db.query(
      `SELECT id FROM supplier_contacts WHERE id = $1 AND supplier_id = $2`,
      [req.params.cid, req.params.id]
    )
    if (!existRows[0]) return res.status(404).json({ success: false, message: 'Contact not found' })

    if (is_primary) {
      await db.query(
        `UPDATE supplier_contacts SET is_primary = FALSE WHERE supplier_id = $1`,
        [req.params.id]
      )
    }
    const { rows } = await db.query(
      `UPDATE supplier_contacts SET
         name       = COALESCE($1, name),
         email      = COALESCE($2, email),
         phone      = COALESCE($3, phone),
         wechat_id  = COALESCE($4, wechat_id),
         is_primary = COALESCE($5, is_primary),
         updated_at = NOW()
       WHERE id = $6 AND supplier_id = $7
       RETURNING *`,
      [name ?? null, email ?? null, phone ?? null, wechat_id ?? null,
       typeof is_primary === 'boolean' ? is_primary : null,
       req.params.cid, req.params.id]
    )
    res.json({ success: true, data: rows[0] })
  } catch (e) { next(e) }
})

router.delete('/:id/contacts/:cid', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `DELETE FROM supplier_contacts WHERE id = $1 AND supplier_id = $2 RETURNING id`,
      [req.params.cid, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Contact not found' })
    res.json({ success: true, data: null })
  } catch (e) { next(e) }
})

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
