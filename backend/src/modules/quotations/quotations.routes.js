const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./quotations.controller')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  description: z.string().min(1),
  qty:         z.number().int().positive(),
  unit_price:  z.number().nonnegative(),
})

const createSchema = z.object({
  lead_id:      z.string().uuid().optional().nullable(),
  customer_id:  z.string().uuid().optional().nullable(),
  valid_until:  z.string().optional().nullable(),
  discount_pct: z.number().min(0).max(100).default(0),
  tax_pct:      z.number().min(0).max(100).default(0),
  notes:        z.string().optional().nullable(),
  items:        z.array(itemSchema).min(1, 'At least one item is required'),
})

const updateSchema = createSchema.partial().extend({
  items: z.array(itemSchema).min(1).optional(),
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
