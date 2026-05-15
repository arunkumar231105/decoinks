const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./invoices.controller')

const router = Router()
router.use(verifyToken)

const createSchema = z.object({
  order_id:     z.string().uuid().optional().nullable(),
  customer_id:  z.string().uuid().optional().nullable(),
  issue_date:   z.string().optional().nullable(),
  due_date:     z.string().optional().nullable(),
  subtotal:     z.number().nonnegative().default(0),
  discount_amt: z.number().nonnegative().default(0),
  tax_amt:      z.number().nonnegative().default(0),
  notes:        z.string().optional().nullable(),
}).refine(
  (d) => d.order_id || d.customer_id,
  { message: 'Either order_id or customer_id is required' }
)

const updateSchema = z.object({
  customer_id:  z.string().uuid().optional().nullable(),
  issue_date:   z.string().optional().nullable(),
  due_date:     z.string().optional().nullable(),
  subtotal:     z.number().nonnegative().optional(),
  discount_amt: z.number().nonnegative().optional(),
  tax_amt:      z.number().nonnegative().optional(),
  notes:        z.string().optional().nullable(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Paid', 'Overdue', 'Void']),
})

const paymentSchema = z.object({
  amount_paid: z.number().min(0),
})

router.get('/',                 controller.list)
router.get('/:id',              controller.getOne)
router.post('/',                validate(createSchema),  controller.create)
router.put('/:id',              validate(updateSchema),  controller.update)
router.patch('/:id/status',     validate(statusSchema),  controller.updateStatus)
router.patch('/:id/payment',    validate(paymentSchema), controller.recordPayment)
router.delete('/:id',           controller.remove)

module.exports = router
