const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
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
router.get('/:id',     controller.getOne)
router.post('/',   validate(createSchema), controller.create)
router.put('/:id', validate(updateSchema), controller.update)
router.post('/bulk-delete', validate(z.object({ ids: z.array(z.string().uuid()).min(1) })), controller.bulkRemove)
router.delete('/:id', controller.remove)

module.exports = router
