const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { uploadAttachment } = require('../../middleware/upload')
const controller = require('./leads.controller')

const router = Router()
router.use(verifyToken)

const SOURCES  = ['Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone']
const STAGES   = ['initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed']
const STATUSES = ['New', 'Quotation', 'Pending', 'Payment Sent', 'Partial', 'Confirmed']

const createSchema = z.object({
  customer_name: z.string().min(1),
  customer_id:   z.string().uuid().optional().nullable(),
  source:        z.enum(SOURCES),
  description:   z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
})

const updateSchema = z.object({
  customer_name: z.string().min(1).optional(),
  customer_id:   z.string().uuid().optional().nullable(),
  source:        z.enum(SOURCES).optional(),
  description:   z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
  status:        z.enum(STATUSES).optional(),
  has_artwork:   z.boolean().optional(),
}).strict()

const moveSchema = z.object({
  stage:    z.enum(STAGES),
  position: z.number().int().min(0).optional(),
})

const commentSchema = z.object({
  body: z.string().min(1),
})

router.get('/',         controller.getKanban)
router.get('/list',     controller.list)
router.get('/:id',      controller.getOne)
router.post('/',        validate(createSchema), controller.create)
router.put('/:id',      validate(updateSchema), controller.update)
router.patch('/:id/move', validate(moveSchema), controller.move)
router.delete('/:id',   controller.remove)

router.get('/:id/comments',           controller.getComments)
router.post('/:id/comments',          validate(commentSchema), controller.addComment)
router.delete('/:id/comments/:cid',   controller.deleteComment)

router.post('/:id/attachments',       uploadAttachment, controller.addAttachment)
router.delete('/:id/attachments/:aid',controller.deleteAttachment)

module.exports = router
