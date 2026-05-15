const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./orders.controller')

const router = Router()
router.use(verifyToken)

// ── Item schemas (per type) ───────────────────────────────────────────────────
const apparelItemSchema = z.object({
  item:         z.string().min(1),
  color:        z.string().optional().nullable(),
  size:         z.string().optional().nullable(),
  qty:          z.number().int().positive(),
  artwork_no:   z.string().optional().nullable(),
  artwork_size: z.string().optional().nullable(),
  unit_price:   z.number().nonnegative(),
  front_image:  z.string().optional().nullable(),
  back_image:   z.string().optional().nullable(),
})

const gangsheetItemSchema = z.object({
  size:            z.string().min(1),
  no_artworks:     z.number().int().positive().default(1),
  qty:             z.number().int().positive(),
  price_per_sheet: z.number().nonnegative(),
  front_image:     z.string().optional().nullable(),
})

const dtfItemSchema = z.object({
  artwork_name:  z.string().min(1),
  size:          z.string().optional().nullable(),
  qty:           z.number().int().positive(),
  unit_price:    z.number().nonnegative(),
  artwork_image: z.string().optional().nullable(),
})

const ITEM_SCHEMAS = { apparel: apparelItemSchema, gangsheet: gangsheetItemSchema, dtf: dtfItemSchema }

// ── Shared header fields ──────────────────────────────────────────────────────
const headerFields = {
  customer_id:      z.string().uuid().optional().nullable(),
  customer_name_text: z.string().optional().nullable(),
  quotation_id:     z.string().uuid().optional().nullable(),
  order_date:       z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  payment_terms:    z.enum(['Due on Receipt', 'Net 15', 'Net 30', 'Net 60']).optional(),
  payment_method:   z.enum(['cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other']).optional().nullable(),
  payment_status:   z.enum(['Unpaid', 'Partial', 'Paid', 'Refunded']).optional(),
  currency:         z.string().max(3).optional(),
  rush_services:    z.number().nonnegative().default(0),
  shipping_charges: z.number().nonnegative().default(0),
  discount_pct:     z.number().min(0).max(100).default(0),
  tax_pct:          z.number().min(0).max(100).default(7),
  notes:            z.string().optional().nullable(),
  contact_name:     z.string().optional().nullable(),
  contact_email:    z.string().email().optional().nullable(),
  contact_phone:    z.string().optional().nullable(),
  shipping_name:    z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  assigned_to:      z.string().uuid().optional().nullable(),
}

// Validates items array against the schema for the given order_type
function validateItems(data, ctx) {
  const schema = ITEM_SCHEMAS[data.order_type]
  if (!schema) return
  ;(data.items || []).forEach((item, i) => {
    const result = schema.safeParse(item)
    if (!result.success) {
      result.error.errors.forEach((e) => {
        ctx.addIssue({ ...e, path: ['items', i, ...e.path] })
      })
    }
  })
}

const createSchema = z.object({
  order_type: z.enum(['apparel', 'gangsheet', 'dtf']),
  ...headerFields,
  items: z.array(z.object({}).passthrough()).min(1, 'At least one item required'),
}).superRefine(validateItems)

// On update, all header fields are optional; items optional but if present must be non-empty.
// order_type cannot change — not included so it can't be overwritten.
const updateSchema = z.object({
  ...Object.fromEntries(
    Object.entries(headerFields).map(([k, v]) => [k, v.optional()])
  ),
  items: z.array(z.object({}).passthrough()).min(1).optional(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled']),
})

router.get('/',              controller.list)
router.get('/board',         controller.getBoard)
router.get('/:id',           controller.getOne)
router.get('/:id/invoice',   controller.getInvoice)
router.post('/',             validate(createSchema), controller.create)
router.put('/:id',           validate(updateSchema), controller.update)
router.patch('/:id/status',  validate(statusSchema), controller.updateStatus)
router.delete('/:id',        controller.remove)

module.exports = router
