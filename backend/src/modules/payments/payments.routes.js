const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./payments.controller')

const router = Router()
router.use(verifyToken)

const STATUS = ['Completed', 'Pending', 'Failed', 'Refunded']

const paymentFields = {
  payment_date:   z.string().optional().nullable(),
  // Total money in from the customer. Shipping cost lives on the shipment now.
  amount:         z.coerce.number().positive('Amount must be greater than zero').optional(),
  // What the processor kept; net_amount is derived by the database.
  fee_amount:     z.coerce.number().min(0, 'Fee cannot be negative').optional(),
  payment_method: z.string().max(50).optional().nullable(),
  reference_no:   z.string().max(100).optional().nullable(),
  notes:          z.string().optional().nullable(),
  status:         z.enum(STATUS).optional(),
  customer_id:    z.string().uuid().optional().nullable(),
  order_id:       z.string().uuid().optional().nullable(),
  invoice_id:     z.string().uuid().optional().nullable(),
  customer_name:  z.string().max(255).optional().nullable(),
  received_from_name:       z.string().max(160).optional().nullable(),
  received_into_account_id: z.string().uuid().optional().nullable(),
  sender_bank_name:         z.string().max(120).optional().nullable(),
  sender_account_name:      z.string().max(160).optional().nullable(),
  sender_account_last4:     z.string().regex(/^[0-9]{1,4}$/, 'Last 4 digits only').optional().nullable(),
  sender_reference:         z.string().max(120).optional().nullable(),
  // A payment may cover several orders — e.g. combined billing.
  allocations: z.array(z.object({
    order_id:         z.string().uuid().optional().nullable(),
    invoice_id:       z.string().uuid().optional().nullable(),
    allocated_amount: z.coerce.number().positive('Allocated amount must be greater than zero'),
    notes:            z.string().optional().nullable(),
  })).optional(),
}

const createSchema = z.object(paymentFields)
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(paymentFields).map(([k, v]) => [k, v.optional()])),
})

router.get('/',        controller.list)
router.get('/stats',   controller.stats)
router.get('/filters', controller.filters)
router.get('/export',  controller.exportCsv)
router.get('/:id',     controller.getOne)

router.post('/',       validate(createSchema), controller.create)
router.put('/:id',     validate(updateSchema), controller.update)
router.delete('/:id',  controller.remove)

module.exports = router
