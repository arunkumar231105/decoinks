const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./shipments.controller')

const router = Router()
router.use(verifyToken)

const STATUSES = ['Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception']

const bodyFields = {
  order_id:           z.string().uuid().optional().nullable(),
  customer_id:        z.string().uuid().optional().nullable(),
  carrier:            z.string().optional().nullable(),
  tracking_number:    z.string().optional().nullable(),
  ship_date:          z.string().optional().nullable(),
  estimated_delivery: z.string().optional().nullable(),
  weight_lbs:         z.number().nonnegative().optional().nullable(),
  shipping_cost:      z.number().nonnegative().optional().nullable(),
  recipient_name:     z.string().optional().nullable(),
  address:            z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
}

const createSchema = z.object({
  ...bodyFields,
  customer_name_text: z.string().optional().nullable(),
  agent_name:         z.string().optional().nullable(),
  status:             z.enum(STATUSES).optional(),
})

const updateSchema = z.object(bodyFields).strict()

const statusSchema = z.object({
  status: z.enum(STATUSES),
})

router.get('/',             controller.list)
router.get('/:id',          controller.getOne)
router.post('/',            validate(createSchema), controller.create)
router.put('/:id',          validate(updateSchema), controller.update)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.delete('/:id',       controller.remove)

module.exports = router
