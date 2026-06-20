const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./customers.controller')

const router = Router()
router.use(verifyToken)

const customerFields = {
  lead_id:          z.string().uuid().optional().nullable(),
  name:             z.string().min(1),
  email:            z.string().optional().nullable(),   // no .email() — front-end shows UX hint
  phone:            z.string().optional().nullable(),
  whatsapp:         z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  website:          z.string().optional().nullable(),
  facebook_id:      z.string().optional().nullable(),
  instagram_id:     z.string().optional().nullable(),
  address_line1:    z.string().optional().nullable(),
  city:             z.string().optional().nullable(),
  state:            z.string().optional().nullable(),
  zip:              z.string().optional().nullable(),
  country:          z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  same_as_shipping: z.boolean().optional(),
  buyer_type:       z.string().optional().nullable(),
  internal_notes:   z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
}

const createSchema = z.object(customerFields)
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(customerFields).map(([k, v]) => [k, v.optional()])),
  status: z.enum(['Active', 'Inactive', 'Blocked']).optional(),
})  // no .strict() — unknown fields are safely stripped

router.get('/',    controller.list)
router.get('/:id', controller.getOne)
router.post('/',   validate(createSchema), controller.create)
router.put('/:id', validate(updateSchema), controller.update)
router.delete('/:id', controller.remove)

module.exports = router
