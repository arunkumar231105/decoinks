const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { uploadArtwork } = require('../../middleware/upload')
const controller = require('./orders.controller')
const portalSvc = require('../supplier-portal/portal.service')
const gangsheetSvc = require('../artworks/gangsheet.service')
const artworksSvc  = require('../artworks/artworks.service')

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
  supplier_id:        z.string().uuid().optional().nullable(),
  supplier_name_text: z.string().optional().nullable(),
  quotation_id:       z.string().uuid().optional().nullable(),
  invoice_id:         z.string().uuid().optional().nullable(),
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

// ── Customer Portal Integration ───────────────────────────────────────────────
router.post('/:id/send-to-portal', async (req, res) => {
  try {
    const result = await portalSvc.sendOrderToPortal(req.params.id, req.user?.id)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.get('/:id/portal-status', async (req, res) => {
  try {
    const db = require('../../config/db')
    const { rows } = await db.query(
      'SELECT sent_at, is_visible FROM portal_order_visibility WHERE order_id = $1',
      [req.params.id]
    )
    res.json({ sentToPortal: rows.length > 0 && rows[0].is_visible, sentAt: rows[0]?.sent_at ?? null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Order-scoped artworks ─────────────────────────────────────────────────────

const artworkUploadSchema = z.object({
  name:             z.string().min(1, 'Name is required'),
  location_on_product: z.string().optional().nullable(),
  width_inches:     z.string().optional().nullable(),   // sent as string from multipart
  height_inches:    z.string().optional().nullable(),
  notes:            z.string().optional().nullable(),
})

router.get('/:id/artworks', async (req, res) => {
  try {
    const { rows } = await require('../../config/db').query(
      `SELECT id, artwork_no, name, file_url, file_type, status,
              width_inches, height_inches, location_on_product, created_at
       FROM artworks WHERE order_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json({ artworks: rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/artworks', uploadArtwork, validate(artworkUploadSchema), async (req, res) => {
  try {
    const { name, location_on_product, width_inches, height_inches, notes } = req.body
    const artwork = await artworksSvc.create({
      name,
      order_id:    req.params.id,
      supplier_id: null,
      status:      'Pending Review',
      notes,
      uploaded_by: req.user.id,
      file:        req.file,
    })

    // Patch in the extra columns not handled by the base create()
    if (location_on_product || width_inches || height_inches) {
      await require('../../config/db').query(
        `UPDATE artworks SET
           location_on_product = COALESCE($1, location_on_product),
           width_inches  = COALESCE($2::numeric, width_inches),
           height_inches = COALESCE($3::numeric, height_inches)
         WHERE id = $4`,
        [
          location_on_product || null,
          width_inches  ? parseFloat(width_inches)  : null,
          height_inches ? parseFloat(height_inches) : null,
          artwork.id,
        ]
      )
      artwork.location_on_product = location_on_product || null
      artwork.width_inches  = width_inches  ? parseFloat(width_inches)  : null
      artwork.height_inches = height_inches ? parseFloat(height_inches) : null
    }

    res.status(201).json({ artwork })
  } catch (e) {
    res.status(e.statusCode ?? 400).json({ error: e.message })
  }
})

router.delete('/:id/artworks/:artworkId', async (req, res) => {
  try {
    await artworksSvc.remove(req.params.artworkId)
    res.json({ success: true })
  } catch (e) {
    res.status(e.statusCode ?? 400).json({ error: e.message })
  }
})

// ── Gangsheet generation ──────────────────────────────────────────────────────

router.post('/:id/gangsheet', async (req, res) => {
  try {
    const result = await gangsheetSvc.generateGangsheet(req.params.id, req.user?.id)
    res.status(202).json(result)
  } catch (e) {
    res.status(e.statusCode ?? 500).json({ error: e.message })
  }
})

router.get('/:id/gangsheet/status', async (req, res) => {
  try {
    const status = await gangsheetSvc.getGangsheetStatus(req.params.id)
    res.json(status)
  } catch (e) {
    res.status(e.statusCode ?? 500).json({ error: e.message })
  }
})

module.exports = router
