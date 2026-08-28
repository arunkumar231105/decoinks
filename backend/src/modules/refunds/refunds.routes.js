const express = require('express')
const { z } = require('zod')
const controller = require('./refunds.controller')
const { validate } = require('../../middleware/validate')
const { verifyToken, requireRole } = require('../../middleware/auth')

const router = express.Router()
router.use(verifyToken)

const METHODS = ['Original Payment Method', 'Bank Transfer', 'PayPal', 'Zelle', 'Stripe', 'Store Credit', 'Cheque', 'Other']
const STATUSES = ['Pending', 'Processing', 'Completed', 'Failed', 'Cancelled']

const createSchema = z.object({
  amount:        z.coerce.number().positive().optional(),
  refund_method: z.enum(METHODS).optional().nullable(),
  status:        z.enum(STATUSES).optional(),
  reference_no:  z.string().max(120).optional().nullable(),
  notes:         z.string().optional().nullable(),
  payment_id:    z.string().uuid().optional().nullable(),
})

router.get('/', controller.list)
router.get('/:id', controller.getOne)

// Money leaving the business is an admin's decision, like the approval before it.
router.post('/claim/:claimId', requireRole('Admin'), validate(createSchema), controller.createFromClaim)
router.put('/:id', requireRole('Admin'), validate(createSchema.partial()), controller.update)
router.delete('/:id', requireRole('Admin'), controller.remove)

module.exports = router
