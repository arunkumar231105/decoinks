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
  amount:         z.coerce.number().positive('Amount must be greater than zero'),
  payment_method: z.string().max(50).optional().nullable(),
  reference_no:   z.string().max(100).optional().nullable(),
  notes:          z.string().optional().nullable(),
  status:         z.enum(STATUS).optional(),
  customer_id:    z.string().uuid().optional().nullable(),
  order_id:       z.string().uuid().optional().nullable(),
  invoice_id:     z.string().uuid().optional().nullable(),
  customer_name:  z.string().max(255).optional().nullable(),
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
