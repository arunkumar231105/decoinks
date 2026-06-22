const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./invoices.controller')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  description:   z.string().optional().nullable(),
  qty:           z.number().nonnegative().default(1),
  unit_price:    z.number().nonnegative().default(0),
  amount:        z.number().nonnegative().default(0),
  artwork_count: z.number().int().nonnegative().default(0),
  sort_order:    z.number().int().default(0),
})

const createSchema = z.object({
  quote_id:         z.string().uuid().optional().nullable(),
  order_id:         z.string().uuid().optional().nullable(),
  supplier_id:      z.string().uuid().optional().nullable(),
  issue_date:       z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  subtotal:         z.number().nonnegative().default(0),
  discount_amt:     z.number().nonnegative().default(0),
  tax_amt:          z.number().nonnegative().default(0),
  notes:            z.string().optional().nullable(),
  customer_name:    z.string().optional().nullable(),
  billing_email:    z.string().optional().nullable(),
  contact_number:   z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  order_type:       z.enum(['apparel', 'gangsheet', 'dtf']).optional().nullable(),
  items:            z.array(itemSchema).optional(),
  payment_terms:    z.string().optional().nullable(),
  payment_method:   z.string().optional().nullable(),
  currency:         z.string().optional().nullable(),
  rush_services:    z.number().nonnegative().default(0),
  shipping_charges: z.number().nonnegative().default(0),
}).refine(
  (d) => d.quote_id || d.order_id || d.supplier_id || d.customer_name,
  { message: 'At least one of quote_id, order_id, supplier_id, or customer_name is required' }
)

const updateSchema = z.object({
  supplier_id:      z.string().uuid().optional().nullable(),
  issue_date:       z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  subtotal:         z.number().nonnegative().optional(),
  discount_amt:     z.number().nonnegative().optional(),
  tax_amt:          z.number().nonnegative().optional(),
  notes:            z.string().optional().nullable(),
  payment_status:   z.enum(['Unpaid', 'Partial', 'Paid', 'Refunded']).optional(),
  customer_name:    z.string().optional().nullable(),
  billing_email:    z.string().optional().nullable(),
  contact_number:   z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  payment_terms:    z.string().optional().nullable(),
  payment_method:   z.string().optional().nullable(),
  currency:         z.string().optional().nullable(),
  rush_services:    z.number().nonnegative().optional(),
  shipping_charges: z.number().nonnegative().optional(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void']),
})

const paymentSchema = z.object({
  amount:         z.number().positive(),
  payment_method: z.enum(['cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other']),
  reference_no:   z.string().optional().nullable(),
  notes:          z.string().optional().nullable(),
})

router.get('/',                 controller.list)
router.get('/:id',              controller.getOne)
router.post('/',                validate(createSchema),  controller.create)
router.post('/:id/convert-to-order',
  validate(z.object({ order_type: z.enum(['apparel','gangsheet','dtf']) })),
  controller.convertToOrder)
router.put('/:id',              validate(updateSchema),  controller.update)
router.patch('/:id/status',     validate(statusSchema),  controller.updateStatus)
router.patch('/:id/payment',    validate(paymentSchema), controller.recordPayment)
router.delete('/:id',           controller.remove)

module.exports = router
