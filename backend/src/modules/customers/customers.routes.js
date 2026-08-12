const { Router } = require('express')
const { z } = require('zod')
const bcrypt = require('bcryptjs')
const { verifyToken, requireRole } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const db = require('../../config/db')
const controller = require('./customers.controller')

const router = Router()
router.use(verifyToken)

// ── Field validators ─────────────────────────────────────────────────────────
// Strict formats, but every field stays optional/nullable and also tolerates an
// empty string, so the existing data flow (empty optional fields, empty address
// sub-fields) is never blocked. This mirrors the client-side rules.
const RE_NAME = /^[A-Za-z\s'.-]{1,50}$/
const RE_ZIP = /^\d{5}$/
const RE_PHONE = /^[\d\s()+-]+$/
const emptyable = (schema) => schema.or(z.literal('')).optional().nullable()
const nameField = emptyable(z.string().regex(RE_NAME, "Only letters, spaces, . - ' allowed (max 50)"))
const emailField = emptyable(z.string().email('Invalid email address'))
const phoneField = emptyable(
  z.string().regex(RE_PHONE, 'Invalid phone number').refine((s) => {
    const d = s.replace(/\D/g, '')
    return d.length >= 7 && d.length <= 15
  }, 'Phone must contain 7–15 digits'),
)
const zipField = emptyable(z.string().regex(RE_ZIP, 'ZIP code must be exactly 5 digits'))

const customerFields = {
  lead_id:          z.string().uuid().optional().nullable(),
  name:             z.string().min(1),
  email:            emailField,
  phone:            phoneField,
  whatsapp:         phoneField,
  company:          z.string().optional().nullable(),
  website:          z.string().optional().nullable(),
  facebook_id:      z.string().optional().nullable(),
  instagram_id:     z.string().optional().nullable(),
  address_line1:    emptyable(z.string().max(100)),
  city:             emptyable(z.string().max(100)),
  state:            emptyable(z.string().max(100)),
  zip:              zipField,
  country:          z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  same_as_shipping: z.boolean().optional(),
  buyer_type:       z.string().optional().nullable(),
  internal_notes:   z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  first_name:       nameField,
  middle_name:      nameField,
  last_name:        nameField,
  external_customer_number: emptyable(z.string().max(50)),
  company_name:     emptyable(z.string().min(2, 'Company name must be 2–100 characters').max(100, 'Company name must be 2–100 characters')),
  company_phone_number: phoneField,
  mobile_number:    phoneField,
  preferred_language: z.string().optional().nullable(),
  customer_segment: z.string().optional().nullable(),
  tier:             z.string().optional().nullable(),
  customer_type:    z.enum(['business', 'individual', 'non_profit']).optional().nullable(),
  job_title:        z.string().max(120).optional().nullable(),
  payment_terms:    z.enum(['Due on Receipt', 'Net 15', 'Net 30', 'Net 60']).optional().nullable(),
  credit_limit:     z.number().nonnegative().optional().nullable(),
  assigned_agent_id: z.string().uuid().optional().nullable(),
  addresses: z.array(z.object({
    address_type: z.enum(['billing', 'shipping']),
    line1: emptyable(z.string().max(100)), line2: emptyable(z.string().max(100)),
    city: emptyable(z.string().max(100)), state: emptyable(z.string().max(100)),
    zipcode: zipField, country: z.string().optional().nullable(),
    contact_person: emptyable(z.string().max(160)),
    is_default: z.boolean().optional(),
  })).optional(),
  contacts: z.array(z.object({
    first_name: nameField, middle_name: nameField, last_name: nameField,
    job_title: emptyable(z.string().max(120)),
    email: emailField, phone: phoneField, mobile_number: phoneField, whatsapp: phoneField,
    is_primary: z.boolean().optional(),
    notes: emptyable(z.string().max(2000)),
  })).optional(),
}

const STATUS_VALUES = [
  'prospect', 'active', 'inactive', 'blocked', 'archived',
  // legacy capitalised values still accepted; the service normalises them
  'Active', 'Inactive', 'Blocked',
]

const createSchema = z.object({
  ...customerFields,
  status: z.enum(STATUS_VALUES).optional(),
})
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(customerFields).map(([k, v]) => [k, v.optional()])),
  status: z.enum(STATUS_VALUES).optional(),
})  // no .strict() — unknown fields are safely stripped

router.get('/',        controller.list)
router.get('/stats',   controller.stats)
router.get('/filters', controller.filters)
router.get('/export',  controller.exportCsv)
// Must stay above '/:id' — otherwise Express reads "portal-accounts" as an id.
router.get('/portal-accounts', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT cpu.id, cpu.customer_id, cpu.username, cpu.email, cpu.is_active,
              cpu.last_login, cpu.created_at,
              c.name AS customer_name, c.customer_number
         FROM customer_portal_users cpu
         JOIN customers c ON c.id = cpu.customer_id
        WHERE c.deleted_at IS NULL
        ORDER BY cpu.is_active DESC, c.name`
    )
    res.json({ accounts: rows })
  } catch (e) { next(e) }
})

router.get('/:id',     controller.getOne)
router.post('/',   validate(createSchema), controller.create)
router.put('/:id', validate(updateSchema), controller.update)
router.post('/bulk-delete', validate(z.object({ ids: z.array(z.string().uuid()).min(1) })), controller.bulkRemove)
router.delete('/:id', controller.remove)

// ── Customer Portal Access Management ────────────────────────────────────────
// Staff create the customer's portal login here; the customer then signs in to
// the Customer Portal with it. Mirrors the supplier portal-access endpoints.

router.get('/:id/portal-access', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, email, is_active, last_login, must_change_pw, created_at
       FROM customer_portal_users WHERE customer_id = $1`,
      [req.params.id]
    )
    res.json({ portalAccess: rows[0] ?? null })
  } catch (e) { next(e) }
})

router.post('/:id/portal-access', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim()
    const email = String(req.body.email || '').trim() || null
    const { password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' })
    if (String(password).length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' })

    // The username is the login key across the whole portal, so reject one that
    // already belongs to a different customer instead of silently moving it.
    const { rows: taken } = await db.query(
      `SELECT 1 FROM customer_portal_users WHERE lower(username) = lower($1) AND customer_id <> $2`,
      [username, req.params.id]
    )
    if (taken.length) return res.status(409).json({ error: 'That username is already in use' })

    const hash = await bcrypt.hash(password, 12)
    await db.query(
      `INSERT INTO customer_portal_users (customer_id, username, email, password_hash, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (customer_id) DO UPDATE
         SET username = EXCLUDED.username,
             email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             is_active = TRUE,
             updated_at = NOW()`,
      [req.params.id, username, email, hash, req.user?.id]
    )
    res.json({ success: true })
  } catch (e) { next(e) }
})

router.patch('/:id/portal-access/enable', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE customer_portal_users SET is_active = TRUE, updated_at = NOW() WHERE customer_id = $1`,
      [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'No portal account for this customer' })
    res.json({ success: true })
  } catch (e) { next(e) }
})

router.delete('/:id/portal-access', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    await db.query(
      `UPDATE customer_portal_users SET is_active = FALSE, updated_at = NOW() WHERE customer_id = $1`,
      [req.params.id]
    )
    res.json({ success: true })
  } catch (e) { next(e) }
})

module.exports = router
