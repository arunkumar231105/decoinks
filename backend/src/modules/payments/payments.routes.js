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
  // The total is derived from these two, never sent by the client.
  item_amount:     z.coerce.number().min(0, 'Item amount cannot be negative').optional(),
  shipping_amount: z.coerce.number().min(0, 'Shipping amount cannot be negative').optional(),
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
