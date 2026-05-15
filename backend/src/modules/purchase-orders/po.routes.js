const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./po.controller')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  description: z.string().min(1),
  qty:         z.number().int().positive(),
  unit_cost:   z.number().nonnegative(),
})

const createSchema = z.object({
  vendor_name:   z.string().min(1),
  order_date:    z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
  items:         z.array(itemSchema).min(1, 'At least one item required'),
})

const updateSchema = z.object({
  vendor_name:   z.string().min(1).optional(),
  order_date:    z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
  items:         z.array(itemSchema).min(1).optional(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Received', 'Partial', 'Cancelled']),
})

router.get('/',              controller.list)
router.get('/:id',           controller.getOne)
router.post('/',             validate(createSchema), controller.create)
router.put('/:id',           validate(updateSchema), controller.update)
router.patch('/:id/status',  validate(statusSchema), controller.updateStatus)
router.delete('/:id',        controller.remove)

module.exports = router
