const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./quotations.controller')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  description:   z.string().min(1),
  qty:           z.number().int().positive(),
  unit_price:    z.number().nonnegative(),
  sizes:         z.string().optional().nullable(),
  colors:        z.string().optional().nullable(),
  artwork_count: z.number().int().min(0).optional().nullable(),
})

const ORDER_TYPES = ['apparel', 'gangsheet', 'dtf']

const intakeFields = {
  company_name:                 z.string().optional().nullable(),
  customer_name:                z.string().optional().nullable(),
  billing_email:                z.string().optional().nullable(),
  contact_number:               z.string().optional().nullable(),
  whatsapp:                     z.string().optional().nullable(),
  wechat:                       z.string().optional().nullable(),
  customer_category:            z.string().optional().nullable(),
  customer_source:              z.string().optional().nullable(),
  shipping_country:             z.string().optional().nullable(),
  shipping_state:               z.string().optional().nullable(),
  shipping_city:                z.string().optional().nullable(),
  zip_code:                     z.string().optional().nullable(),
  shipping_address:             z.string().optional().nullable(),
  billing_address:              z.string().optional().nullable(),
  due_date:                     z.string().optional().nullable(),
  sales_agent_id:               z.string().uuid().optional().nullable(),
  internal_notes:               z.string().optional().nullable(),
  customer_requirement_summary: z.string().optional().nullable(),
  quote_estimate:               z.number().nonnegative().optional().nullable(),
}

const createSchema = z.object({
  lead_id:      z.string().uuid().optional().nullable(),
  supplier_id:  z.string().uuid().optional().nullable(),
  order_type:   z.enum(ORDER_TYPES).optional().nullable(),
  valid_until:  z.string().optional().nullable(),
  discount_pct: z.number().min(0).max(100).default(0),
  tax_pct:      z.number().min(0).max(100).default(0),
  notes:        z.string().optional().nullable(),
  items:        z.array(itemSchema).min(1, 'At least one item is required'),
  ...intakeFields,
})

const updateSchema = z.object({
  lead_id:      z.string().uuid().optional().nullable(),
  supplier_id:  z.string().uuid().optional().nullable(),
  order_type:   z.enum(ORDER_TYPES).optional().nullable(),
  valid_until:  z.string().optional().nullable(),
  discount_pct: z.number().min(0).max(100).optional(),
  tax_pct:      z.number().min(0).max(100).optional(),
  notes:        z.string().optional().nullable(),
  items:        z.array(itemSchema).optional(),
  ...intakeFields,
})

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Approved', 'Rejected', 'Expired']),
})

router.get('/',              controller.list)
router.get('/:id',           controller.getOne)
router.post('/',             validate(createSchema),  controller.create)
router.put('/:id',           validate(updateSchema),  controller.update)
router.patch('/:id/status',  validate(statusSchema),  controller.updateStatus)
router.delete('/:id',        controller.remove)

module.exports = router
