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
  shipping_address: z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  buyer_type:       z.string().optional().nullable(),
  internal_notes:   z.string().optional().nullable(),
  productInterest:  z.array(productInterestItemSchema).optional(),
  instagram_id: z.string().optional().nullable(),
  facebook_id: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  source_campaign: z.string().optional().nullable(),
  next_followup_date: z.string().optional().nullable(),
  last_contact_at: z.string().optional().nullable(),
  qualification: z.object({
    sizes_received: z.boolean().optional(), artwork_received: z.boolean().optional(),
    delivery_date_confirmed: z.boolean().optional(), shipping_address_confirmed: z.boolean().optional(),
    budget_confirmed: z.boolean().optional(), payment_method_pref: z.string().optional().nullable(),
    info_completeness_score: z.number().int().min(0).max(100).optional(),
  }).optional(),
}

const createSchema = z.object({
  customer_name: z.string().min(1),
  supplier_id:   z.string().uuid().optional().nullable(),
  source:        z.enum(SOURCES),
  description:   z.string().optional().nullable(),
  assigned_to:   z.string().uuid().optional().nullable(),
  ...contactFields,
})

const updateSchema = z.object({
  customer_name: z.string().min(1).optional(),
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
router.post('/:id/convert-to-customer', async (req, res, next) => {
  try {
    const db = require('../../config/db')
    const { rows } = await db.query(
      `SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Lead not found' })
    const lead = rows[0]

    // Check if already converted — but verify the customer still exists (not soft-deleted)
    if (lead.customer_id) {
      const { rows: existingRows } = await db.query(
        `SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL`, [lead.customer_id]
      )
      if (existingRows[0]) {
        return res.json({ success: true, message: 'Already converted', data: { id: existingRows[0].id } })
      }
      // Customer was deleted — clear the stale reference and re-create below
      await db.query(`UPDATE leads SET customer_id = NULL WHERE id = $1`, [lead.id])
    }

    const custSvc = require('../customers/customers.service')
    const customer = await custSvc.create({
      lead_id:        lead.id,
      name:           lead.customer_name || lead.supplier_name || lead.company_name || lead.email || 'Unknown',
      email:          lead.email          || null,
      phone:          lead.phone          || null,
      whatsapp:       lead.whatsapp       || null,
      company:        lead.company_name   || null,
      address_line1:  lead.shipping_address || null,
      buyer_type:     lead.buyer_type     || null,
      internal_notes: lead.internal_notes || null,
      source:         lead.source         || null,
      created_by:     req.user.id,
    })
    res.status(201).json({ success: true, data: customer })
  } catch (err) { next(err) }
})
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
