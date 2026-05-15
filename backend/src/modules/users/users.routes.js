const { Router } = require('express')
const { z } = require('zod')
const { verifyToken, requireRole } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./users.controller')

const router = Router()
router.use(verifyToken)

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['Admin', 'Manager', 'Sales', 'Production', 'Viewer']),
  phone: z.string().optional(),
})

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['Admin', 'Manager', 'Sales', 'Production', 'Viewer']).optional(),
  phone: z.string().optional(),
  is_active: z.boolean().optional(),
}).strict()

const passwordSchema = z.object({
  password: z.string().min(8),
})

router.get('/', requireRole('Admin', 'Manager'), controller.list)
router.get('/:id', requireRole('Admin', 'Manager'), controller.getOne)
router.post('/', requireRole('Admin'), validate(createSchema), controller.create)
router.put('/:id', requireRole('Admin'), validate(updateSchema), controller.update)
router.delete('/:id', requireRole('Admin'), controller.deactivate)
router.post('/:id/reset-password', requireRole('Admin'), validate(passwordSchema), controller.resetPassword)

module.exports = router
