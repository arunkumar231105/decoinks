const express = require('express')
const { z } = require('zod')
const controller = require('./claims.controller')
const { STATUSES } = require('./claims.service')
const { validate } = require('../../middleware/validate')
const { verifyToken, requireRole } = require('../../middleware/auth')

const router = express.Router()
router.use(verifyToken)

const RESOLUTIONS = ['Full Refund', 'Partial Refund', 'Replacement', 'Credit Note']

const claimSchema = z.object({
  customer_id:      z.string().uuid(),
  // The claim is raised against the purchase order; the sales order and invoice
  // are read off it on the server. order_id is still accepted for claims made
  // before POs were the key.
  purchase_order_id: z.string().uuid().optional().nullable(),
  order_id:         z.string().uuid().optional().nullable(),
  invoice_id:       z.string().uuid().optional().nullable(),
  // A claim can be raised before anything ships.
  shipment_id:       z.string().uuid().optional().nullable(),
  claim_category:   z.string().min(1).max(80),
  sub_issue:        z.string().max(80).optional().nullable(),
  quantity_affected: z.coerce.number().nonnegative().optional().nullable(),
  claimed_amount:   z.coerce.number().nonnegative().optional().nullable(),
  reported_via:     z.string().max(40).optional().nullable(),
  description:      z.string().min(1),
  // More than one remedy can be asked for at once.
  preferred_resolution: z.array(z.enum(RESOLUTIONS)).default([]),
  requested_amount: z.coerce.number().nonnegative().optional().nullable(),
  urgency_by_date:  z.string().optional().nullable(),
  customer_comments: z.string().optional().nullable(),
  status:           z.enum(['Draft', 'Raised']).optional(),
  items:            z.array(z.object({}).passthrough()).optional(),
  attachments:      z.array(z.object({}).passthrough()).optional(),
})

const createSchema = claimSchema.refine(
  b => Boolean(b.purchase_order_id || b.order_id),
  { message: 'Choose the purchase order', path: ['purchase_order_id'] })

// An edit may move the claim along; the service lets only an admin go past Raised.
const updateSchema = claimSchema.partial().extend({ status: z.enum(STATUSES).optional() })

const reviewSchema = z.object({
  decision:        z.enum(['Approve', 'Reject', 'Need More Info']),
  review_notes:    z.string().optional().nullable(),
  resolution_type: z.enum(RESOLUTIONS).optional().nullable(),
  approved_amount: z.coerce.number().nonnegative().optional().nullable(),
})

router.get('/', controller.list)
router.get('/customer/:customerId/purchase-orders', controller.customerPurchaseOrders)
router.get('/purchase-order/:poId/chain', controller.purchaseOrderChain)
router.get('/customer/:customerId/orders', controller.customerOrders)
router.get('/order/:orderId/details', controller.orderDetails)
router.get('/order/:orderId/chain', controller.orderChain)
router.get('/:id', controller.getOne)

router.post('/', validate(createSchema), controller.create)
router.put('/:id', validate(updateSchema), controller.update)

// Internal review is the admin's alone. Everyone else sees the panel in the
// form but the server refuses to record a decision from them.
router.post('/:id/review', requireRole('Admin'), validate(reviewSchema), controller.review)

router.post('/:id/comments', validate(z.object({ comment: z.string().min(1) })), controller.comment)
router.post('/:id/attachments', controller.attach)
router.delete('/:id/attachments/:attachmentId', controller.detach)
router.delete('/:id', requireRole('Admin', 'Manager'), controller.remove)

module.exports = router
