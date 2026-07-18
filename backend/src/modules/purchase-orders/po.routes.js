const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./po.controller')

const router = Router()
router.use(verifyToken)

// ── Schemas ───────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  item_name:        z.string().min(1),
  description:      z.string().optional().nullable(),
  hsn_code:         z.string().optional().nullable(),
  uom:              z.string().optional().default('pcs'),
  qty_ordered:      z.number().int().positive(),
  unit_price:       z.number().nonnegative(),
  discount_pct:     z.number().min(0).max(100).default(0),
  tax_pct:          z.number().min(0).max(100).default(0),
  required_by_date: z.string().optional().nullable(),
  remarks:          z.string().optional().nullable(),
  sort_order:       z.number().int().min(0).optional(),
  product_id:       z.string().uuid().optional().nullable(),
  artwork_count:    z.number().int().min(0).optional().nullable(),
  artwork_size:     z.string().optional().nullable(),
  front_image:      z.string().optional().nullable(),
  back_image:       z.string().optional().nullable(),
  // Apparel PO grid fields
  brand:              z.string().optional().nullable(),
  color:              z.string().optional().nullable(),
  size:               z.string().optional().nullable(),
  artwork_id:         z.string().uuid().optional().nullable(),
  artwork_size_front: z.string().optional().nullable(),
  artwork_size_back:  z.string().optional().nullable(),
  artwork_no:         z.string().optional().nullable(),
  catalog_style_id:   z.string().uuid().optional().nullable(),
  catalog_color_id:   z.string().uuid().optional().nullable(),
  catalog_size_id:    z.string().uuid().optional().nullable(),
  catalog_sku:        z.string().optional().nullable(),
  product_image:      z.string().optional().nullable(),
  style_description:  z.string().optional().nullable(),
})

const fragmentSchema = z.object({
  fragment_no:    z.string().optional().nullable(),
  order_id:       z.string().uuid().optional().nullable(),
  width_inches:   z.number().nonnegative().optional().nullable(),
  length_inches:  z.number().nonnegative().optional().nullable(),
  artworks_count: z.number().int().min(0).optional().default(0),
  qty:            z.number().int().min(0).optional().default(0),
  file_url:       z.string().optional().nullable(),
  sort_order:     z.number().int().min(0).optional(),
})

const createSchema = z.object({
  po_type:            z.enum(['gangsheet', 'apparel']).optional().default('apparel'),
  vendor_name:        z.string().optional().nullable(),
  vendor_id:          z.string().uuid().optional().nullable(),
  supplier_id:        z.string().uuid().optional().nullable(),
  supplier_contact_id: z.string().uuid().optional().nullable(),
  communication_method: z.enum(['email', 'wechat']).optional().default('email'),
  payment_status:     z.enum(['Unpaid', 'Partial', 'Paid']).optional().default('Unpaid'),
  supplier_reference: z.string().optional().nullable(),
  payment_terms:      z.string().optional().nullable(),
  currency:           z.string().max(3).optional().default('USD'),
  exchange_rate:      z.number().positive().optional().default(1),
  buyer_id:           z.string().uuid().optional().nullable(),
  department:         z.string().optional().nullable(),
  priority:           z.enum(['Low', 'Medium', 'High', 'Urgent']).optional().default('Medium'),
  shipping_method:    z.string().optional().nullable(),
  shipping_address:   z.string().optional().nullable(),
  billing_address:    z.string().optional().nullable(),
  terms_conditions:   z.string().optional().nullable(),
  order_date:         z.string().optional().nullable(),
  expected_date:      z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
  freight_charges:    z.number().nonnegative().optional().default(0),
  other_charges:      z.number().nonnegative().optional().default(0),
  order_id:           z.string().uuid().optional().nullable(),
  order_ids:          z.array(z.string().uuid()).optional(),
  fragments:          z.array(fragmentSchema).optional(),
  artwork_ids:        z.array(z.string().uuid()).optional(),
  items:              z.array(itemSchema).optional().default([]),
})

const updateSchema = createSchema.partial().extend({
  items:       z.array(itemSchema).optional(),
  order_ids:   z.array(z.string().uuid()).optional(),
  fragments:   z.array(fragmentSchema).optional(),
  artwork_ids: z.array(z.string().uuid()).optional(),
})

const statusSchema = z.object({
  status:  z.enum([
    'Draft', 'Pending Approval', 'Approved', 'Sent',
    'Accepted', 'In Production', 'Shipped',
    'Partially Received', 'Received', 'Closed', 'Cancelled',
  ]),
  comment: z.string().optional().nullable(),
})

const sendToPortalSchema = z.object({
  supplier_id: z.string().uuid().optional().nullable(),
})

const attachmentSchema = z.object({
  filename:  z.string().min(1).max(255),
  // Only http(s) links are stored — blocks javascript:/data:/file: URIs that
  // would otherwise execute or exfiltrate when opened from the PO view.
  file_url:  z.string().url().refine(
    (u) => /^https?:\/\//i.test(u),
    'file_url must be an http(s) URL'
  ),
  file_size: z.number().int().nonnegative().optional().nullable(),
  mime_type: z.string().max(100).optional().nullable(),
})

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/',                           controller.list)
router.get('/summary',                    controller.summary)
router.get('/:id',                        controller.getOne)
router.post('/',                          validate(createSchema),     controller.create)
router.put('/:id',                        validate(updateSchema),     controller.update)
router.patch('/:id/status',               validate(statusSchema),     controller.updateStatus)
router.delete('/:id',                     controller.remove)

router.get('/:id/attachments',            controller.listAttachments)
router.post('/:id/attachments',           validate(attachmentSchema), controller.addAttachment)
router.delete('/:id/attachments/:aid',    controller.removeAttachment)

router.get('/:id/history',               controller.getStatusHistory)

router.post('/:id/send-to-portal',       validate(sendToPortalSchema), controller.sendToPortal)

module.exports = router
