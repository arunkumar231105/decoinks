const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./invoices.controller')

const router = Router()
router.use(verifyToken)

const createSchema = z.object({
  quote_id:     z.string().uuid().optional().nullable(),
  order_id:     z.string().uuid().optional().nullable(),
  supplier_id:  z.string().uuid().optional().nullable(),
  issue_date:   z.string().optional().nullable(),
  due_date:     z.string().optional().nullable(),
  subtotal:     z.number().nonnegative().default(0),
  discount_amt: z.number().nonnegative().default(0),
  tax_amt:      z.number().nonnegative().default(0),
  notes:        z.string().optional().nullable(),
}).refine(
  (d) => d.quote_id || d.order_id || d.supplier_id,
  { message: 'At least one of quote_id, order_id, or supplier_id is required' }
)

const updateSchema = z.object({
  supplier_id:  z.string().uuid().optional().nullable(),
  issue_date:   z.string().optional().nullable(),
  due_date:     z.string().optional().nullable(),
  subtotal:     z.number().nonnegative().optional(),
  discount_amt: z.number().nonnegative().optional(),
  tax_amt:      z.number().nonnegative().optional(),
  notes:        z.string().optional().nullable(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void']),
})

const paymentSchema = z.object({
  amount:         z.number().positive(),
  payment_method: z.enum(['cash', 'bank_transfer', 'card', 'cashapp', 'zelle', 'paypal', 'check', 'other']),
  reference_no:   z.string().optional().nullable(),
  notes:          z.string().optional().nullable(),
})

router.get('/',                 controller.list)
router.get('/:id',              controller.getOne)
router.post('/',                validate(createSchema),  controller.create)
router.put('/:id',              validate(updateSchema),  controller.update)
router.patch('/:id/status',     validate(statusSchema),  controller.updateStatus)
router.patch('/:id/payment',    validate(paymentSchema), controller.recordPayment)
router.delete('/:id',           controller.remove)

module.exports = router
