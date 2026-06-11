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
const STATUSES = [
  'New', 'Quotation', 'Pending', 'Payment Sent', 'Partial', 'Confirmed',
  'Quotation Generated', 'Quotation Sent', 'Quotation Approved',
]

const productInterestItemSchema = z.object({
  product_type:  z.string().optional().nullable(),
  qty:           z.number().int().positive().optional().nullable(),
  sizes:         z.string().optional().nullable(),
  colors:        z.string().optional().nullable(),
  artwork_count: z.number().int().min(0).optional().nullable(),
  notes:         z.string().optional().nullable(),
  sort_order:    z.number().int().min(0).optional().nullable(),
})

const contactFields = {
  company_name:     z.string().optional().nullable(),
  email:            z.string().optional().nullable(),
  phone:            z.string().optional().nullable(),
  whatsapp:         z.string().optional().nullable(),
  country:          z.string().optional().nullable(),
  state:            z.string().optional().nullable(),
  city:             z.string().optional().nullable(),
  zip:              z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  buyer_type:       z.string().optional().nullable(),
  internal_notes:   z.string().optional().nullable(),
  productInterest:  z.array(productInterestItemSchema).optional(),
}

const createSchema = z.object({
  supplier_name: z.string().optional().nullable(),
  supplier_id:   z.string().uuid().optional().nullable(),
  source:        z.enum(SOURCES),
  description:   z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
  ...contactFields,
})

const updateSchema = z.object({
  supplier_name: z.string().min(1).optional(),
  supplier_id:   z.string().uuid().optional().nullable(),
  source:        z.enum(SOURCES).optional(),
  description:   z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
  status:        z.enum(STATUSES).optional(),
  has_artwork:   z.boolean().optional(),
  ...contactFields,
})

const moveSchema = z.object({
  stage:    z.enum(STAGES),
  position: z.number().int().min(0).optional(),
})

const statusSchema = z.object({
  status: z.enum(STATUSES),
})

const commentSchema = z.object({
  body: z.string().min(1),
})

router.get('/',         controller.getKanban)
router.get('/list',     controller.list)
router.get('/:id',      controller.getOne)
router.post('/',        validate(createSchema), controller.create)
router.post('/:id/convert-to-quote', controller.convertToQuote)
router.put('/:id',      validate(updateSchema), controller.update)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.patch('/:id/move',   validate(moveSchema),   controller.move)
router.delete('/:id',   controller.remove)

router.get('/:id/comments',           controller.getComments)
router.post('/:id/comments',          validate(commentSchema), controller.addComment)
router.delete('/:id/comments/:cid',   controller.deleteComment)

router.post('/:id/attachments',       uploadAttachment, controller.addAttachment)
router.delete('/:id/attachments/:aid',controller.deleteAttachment)

module.exports = router
