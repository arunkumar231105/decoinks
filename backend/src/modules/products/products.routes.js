const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./products.controller')

const router = Router()
router.use(verifyToken)

const PRODUCT_TYPES = ['Apparel', 'DTF', 'Gangsheet', 'Embroidery', 'Other']

const createSchema = z.object({
  sku:          z.string().min(1).max(50).optional(),
  name:         z.string().min(1).max(200),
  product_type: z.enum(PRODUCT_TYPES),
  description:  z.string().optional().nullable(),
  base_price:   z.number().nonnegative(),
  cost_price:   z.number().nonnegative().optional().default(0),
  stock_qty:    z.number().int().nonnegative().optional().default(0),
  image_url:    z.string().url().optional().nullable(),
})

const updateSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  description:  z.string().optional().nullable(),
  base_price:   z.number().nonnegative().optional(),
  cost_price:   z.number().nonnegative().optional(),
  stock_qty:    z.number().int().nonnegative().optional(),
  image_url:    z.string().url().optional().nullable(),
  is_active:    z.boolean().optional(),
}).strict()

router.get('/',             controller.list)
router.get('/:id',          controller.getOne)
router.post('/',            validate(createSchema), controller.create)
router.put('/:id',          validate(updateSchema), controller.update)
router.patch('/:id/toggle', controller.toggle)
router.delete('/:id',       controller.remove)

module.exports = router
