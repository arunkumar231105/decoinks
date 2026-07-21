const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./customers.controller')

const router = Router()
router.use(verifyToken)

const customerFields = {
  lead_id:          z.string().uuid().optional().nullable(),
  name:             z.string().min(1),
  email:            z.string().optional().nullable(),   // no .email() — front-end shows UX hint
  phone:            z.string().optional().nullable(),
  whatsapp:         z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  website:          z.string().optional().nullable(),
  facebook_id:      z.string().optional().nullable(),
  instagram_id:     z.string().optional().nullable(),
  address_line1:    z.string().optional().nullable(),
  city:             z.string().optional().nullable(),
  state:            z.string().optional().nullable(),
  zip:              z.string().optional().nullable(),
  country:          z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  same_as_shipping: z.boolean().optional(),
  buyer_type:       z.string().optional().nullable(),
  internal_notes:   z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  first_name:       z.string().min(1).optional(),
  last_name:        z.string().optional().nullable(),
  company_name:     z.string().optional().nullable(),
  company_phone_number: z.string().optional().nullable(),
  mobile_number:    z.string().optional().nullable(),
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
    line1: z.string().optional().nullable(), line2: z.string().optional().nullable(),
    city: z.string().optional().nullable(), state: z.string().optional().nullable(),
    zipcode: z.string().optional().nullable(), country: z.string().optional().nullable(),
    is_default: z.boolean().optional(),
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
router.delete('/:id', controller.remove)

module.exports = router
