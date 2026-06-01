const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./po.controller')

const router = Router()
router.use(verifyToken)

// ── Schemas ───────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  item_name:        z.string().min(1),
  description:      z.string().optional().nullable(),
  hsn_code:         z.string().optional().nullable(),
  uom:              z.string().optional().default('pcs'),
  qty_ordered:      z.number().int().positive(),
  unit_price:       z.number().nonnegative(),
  discount_pct:     z.number().min(0).max(100).default(0),
  tax_pct:          z.number().min(0).max(100).default(0),
  required_by_date: z.string().optional().nullable(),
  remarks:          z.string().optional().nullable(),
  sort_order:       z.number().int().min(0).optional(),
  product_id:       z.string().uuid().optional().nullable(),
})

const createSchema = z.object({
  vendor_name:        z.string().optional().nullable(),
  vendor_id:          z.string().uuid().optional().nullable(),
  supplier_id:        z.string().uuid().optional().nullable(),
  supplier_reference: z.string().optional().nullable(),
  payment_terms:      z.string().optional().nullable(),
  currency:           z.string().max(3).optional().default('USD'),
  exchange_rate:      z.number().positive().optional().default(1),
  buyer_id:           z.string().uuid().optional().nullable(),
  department:         z.string().optional().nullable(),
  priority:           z.enum(['Low', 'Medium', 'High', 'Urgent']).optional().default('Medium'),
  shipping_method:    z.string().optional().nullable(),
  shipping_address:   z.string().optional().nullable(),
  billing_address:    z.string().optional().nullable(),
  terms_conditions:   z.string().optional().nullable(),
  order_date:         z.string().optional().nullable(),
  expected_date:      z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
  freight_charges:    z.number().nonnegative().optional().default(0),
  other_charges:      z.number().nonnegative().optional().default(0),
  order_id:           z.string().uuid().optional().nullable(),
  items:              z.array(itemSchema).min(1, 'At least one item required'),
})

const updateSchema = createSchema.partial().extend({
  items: z.array(itemSchema).min(1).optional(),
})

const statusSchema = z.object({
  status:  z.enum([
    'Draft', 'Pending Approval', 'Approved', 'Sent',
    'Accepted', 'In Production', 'Shipped',
    'Partially Received', 'Received', 'Closed', 'Cancelled',
  ]),
  comment: z.string().optional().nullable(),
})

const sendToPortalSchema = z.object({
  supplier_id: z.string().uuid().optional().nullable(),
})

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/',                           controller.list)
router.get('/:id',                        controller.getOne)
router.post('/',                          validate(createSchema),     controller.create)
router.put('/:id',                        validate(updateSchema),     controller.update)
router.patch('/:id/status',               validate(statusSchema),     controller.updateStatus)
router.delete('/:id',                     controller.remove)

router.get('/:id/attachments',            controller.listAttachments)
router.post('/:id/attachments',           controller.addAttachment)
router.delete('/:id/attachments/:aid',    controller.removeAttachment)

router.get('/:id/history',               controller.getStatusHistory)

router.post('/:id/send-to-portal',       validate(sendToPortalSchema), controller.sendToPortal)

module.exports = router
