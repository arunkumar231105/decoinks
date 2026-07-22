const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./invoices.controller')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  category: z.string().max(100).optional().nullable(),
  description:   z.string().optional().nullable(),
  qty:           z.number().nonnegative().default(1),
  unit_price:    z.number().nonnegative().default(0),
  amount:        z.number().nonnegative().default(0),
  artwork_count: z.number().int().nonnegative().default(0),
  sort_order:    z.number().int().default(0),
  sizes:         z.string().optional().nullable(),
  colors:        z.string().optional().nullable(),
  front_image:   z.string().optional().nullable(),
  back_image:    z.string().optional().nullable(),
  artwork_image: z.string().optional().nullable(),
  catalog_style_id: z.string().uuid().optional().nullable(),
  catalog_color_id: z.string().uuid().optional().nullable(),
  catalog_size_id: z.string().uuid().optional().nullable(),
  catalog_sku: z.string().max(100).optional().nullable(),
  brand: z.string().max(100).optional().nullable(),
  model: z.string().max(100).optional().nullable(),
  product_image: z.string().optional().nullable(),
  style_description: z.string().optional().nullable(),
  artwork_no: z.string().max(100).optional().nullable(),
  line_discount: z.number().nonnegative().optional().default(0),
  tax_code: z.string().max(40).optional().nullable(),
})

const createSchema = z.object({
  quote_id:         z.string().uuid().optional().nullable(),
  order_id:         z.string().uuid().optional().nullable(),
  supplier_id:      z.string().uuid().optional().nullable(),
  customer_id:      z.string().uuid().optional().nullable(),
  issue_date:       z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  subtotal:         z.number().nonnegative().optional(),
  discount_amt:     z.number().nonnegative().optional(),
  discount_pct:     z.number().nonnegative().optional(),
  tax_amt:          z.number().nonnegative().optional(),
  tax_pct:          z.number().nonnegative().optional(),
  notes:            z.string().optional().nullable(),
  customer_notes:   z.string().optional().nullable(),
  sales_agent_name: z.string().optional().nullable(),
  customer_name:    z.string().optional().nullable(),
  billing_email:    z.string().optional().nullable(),
  contact_number:   z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  order_type:       z.enum(['apparel', 'gangsheet', 'dtf']).optional().nullable(),
  items:            z.array(itemSchema).optional(),
  payment_terms:    z.string().optional().nullable(),
  payment_method:   z.string().optional().nullable(),
  mark_paid:        z.boolean().optional(),
  currency:         z.string().optional().nullable(),
  rush_services:    z.number().nonnegative().optional(),
  rush_charges:     z.number().nonnegative().optional(),
  shipping_charges: z.number().nonnegative().optional(),
  discount_type:    z.enum(['percentage', 'fixed']).optional(),
  discount_value:   z.number().nonnegative().optional(),
}).refine(
  (d) => d.quote_id || d.order_id || d.customer_id || d.supplier_id || d.customer_name,
  { message: 'A quote, order, or customer is required' }
)

const updateSchema = z.object({
  supplier_id:      z.string().uuid().optional().nullable(),
  issue_date:       z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  subtotal:         z.number().nonnegative().optional(),
  discount_amt:     z.number().nonnegative().optional(),
  discount_pct:     z.number().nonnegative().optional(),
  tax_amt:          z.number().nonnegative().optional(),
  tax_pct:          z.number().nonnegative().optional(),
  notes:            z.string().optional().nullable(),
  customer_notes:   z.string().optional().nullable(),
  sales_agent_name: z.string().optional().nullable(),
  payment_status:   z.enum(['Unpaid', 'Partial', 'Paid', 'Refunded']).optional(),
  customer_name:    z.string().optional().nullable(),
  billing_email:    z.string().optional().nullable(),
  contact_number:   z.string().optional().nullable(),
  billing_address:  z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
  payment_terms:    z.string().optional().nullable(),
  payment_method:   z.string().optional().nullable(),
  currency:         z.string().optional().nullable(),
  rush_services:    z.number().nonnegative().optional(),
  rush_charges:     z.number().nonnegative().optional(),
  shipping_charges: z.number().nonnegative().optional(),
  discount_type:    z.enum(['percentage', 'fixed']).optional(),
  discount_value:   z.number().nonnegative().optional(),
}).strict()

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void']),
})

const paymentSchema = z.object({
  amount:         z.number().positive(),
  payment_method: z.enum(['cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other']),
  reference_no:   z.string().optional().nullable(),
  notes:          z.string().optional().nullable(),
})

router.get('/',                 controller.list)

// ── Artworks for an invoice (union of quote + order artworks) ─────────────────
router.get('/:id/artworks', async (req, res) => {
  try {
    const db = require('../../config/db')
    const inv = await db.query('SELECT quote_id, order_id FROM invoices WHERE id=$1', [req.params.id])
    if (!inv.rows[0]) return res.json({ artworks: [] })
    const { quote_id, order_id } = inv.rows[0]
    const conditions = []
    const params = []
    if (quote_id) { params.push(quote_id); conditions.push(`quotation_id = $${params.length}`) }
    if (order_id) { params.push(order_id); conditions.push(`order_id = $${params.length}`) }
    if (!conditions.length) return res.json({ artworks: [] })
    const { rows } = await db.query(
      `SELECT id, artwork_no, name, file_url, file_type, status, created_at
       FROM artworks WHERE (${conditions.join(' OR ')}) ORDER BY created_at`,
      params
    )
    res.json({ artworks: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/:id',              controller.getOne)
router.post('/',                validate(createSchema),  controller.create)
router.post('/:id/convert-to-order',
  validate(z.object({ order_type: z.enum(['apparel','gangsheet','dtf']) })),
  controller.convertToOrder)
router.put('/:id',              validate(updateSchema),  controller.update)
router.patch('/:id/status',     validate(statusSchema),  controller.updateStatus)
router.patch('/:id/payment',    validate(paymentSchema), controller.recordPayment)
router.delete('/:id',           controller.remove)

module.exports = router
