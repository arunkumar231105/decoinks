const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./customers.controller')

const router = Router()
router.use(verifyToken)

const customerFields = {
  name:         z.string().min(2).optional(),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().optional().nullable(),
  company:      z.string().optional().nullable(),
  address_line1:z.string().optional().nullable(),
  address_line2:z.string().optional().nullable(),
  city:         z.string().optional().nullable(),
  state:        z.string().optional().nullable(),
  zip:          z.string().optional().nullable(),
  country:      z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
}

const createSchema = z.object({
  ...customerFields,
  name: z.string().min(2),   // required on create
})

const updateSchema = z.object({
  ...customerFields,
  status: z.enum(['Active', 'Inactive']).optional(),
}).strict()

router.get('/',           controller.list)
router.get('/:id',        controller.getOne)
router.get('/:id/orders', controller.getOrders)
router.post('/',          validate(createSchema), controller.create)
router.put('/:id',        validate(updateSchema), controller.update)
router.delete('/:id',     controller.remove)

module.exports = router
