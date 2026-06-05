const { Router } = require('express')
const { z } = require('zod')
const multer = require('multer')
const os = require('os')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./quotations.controller')
const { uploadArtwork } = require('../../middleware/upload')
const artworksSvc = require('../artworks/artworks.service')

// CSV upload: store to OS temp dir, max 5 MB, .csv only
const uploadCsv = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `csv_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv' ||
                file.mimetype === 'application/vnd.ms-excel' ||
                file.originalname.toLowerCase().endsWith('.csv')
    ok ? cb(null, true) : cb(new Error('Only .csv files are allowed'), false)
  },
}).single('file')

const router = Router()
router.use(verifyToken)

const itemSchema = z.object({
  description:   z.string().min(1),
  qty:           z.number().int().positive(),
  unit_price:    z.number().nonnegative(),
  sizes:         z.string().optional().nullable(),
  colors:        z.string().optional().nullable(),
  artwork_count: z.number().int().min(0).optional().nullable(),
})

const ORDER_TYPES = ['apparel', 'gangsheet', 'dtf']

const intakeFields = {
  company_name:                 z.string().optional().nullable(),
  customer_name:                z.string().optional().nullable(),
  billing_email:                z.string().optional().nullable(),
  contact_number:               z.string().optional().nullable(),
  whatsapp:                     z.string().optional().nullable(),
  wechat:                       z.string().optional().nullable(),
  customer_category:            z.string().optional().nullable(),
  customer_source:              z.string().optional().nullable(),
  shipping_country:             z.string().optional().nullable(),
  shipping_state:               z.string().optional().nullable(),
  shipping_city:                z.string().optional().nullable(),
  zip_code:                     z.string().optional().nullable(),
  shipping_address:             z.string().optional().nullable(),
  billing_address:              z.string().optional().nullable(),
  due_date:                     z.string().optional().nullable(),
  sales_agent_id:               z.string().uuid().optional().nullable(),
  internal_notes:               z.string().optional().nullable(),
  customer_requirement_summary: z.string().optional().nullable(),
  quote_estimate:               z.number().nonnegative().optional().nullable(),
}

const createSchema = z.object({
  lead_id:      z.string().uuid().optional().nullable(),
  supplier_id:  z.string().uuid().optional().nullable(),
  order_type:   z.enum(ORDER_TYPES).optional().nullable(),
  valid_until:  z.string().optional().nullable(),
  discount_pct: z.number().min(0).max(100).default(0),
  tax_pct:      z.number().min(0).max(100).default(0),
  notes:        z.string().optional().nullable(),
  items:        z.array(itemSchema).optional().default([]),
  ...intakeFields,
})

const updateSchema = z.object({
  lead_id:      z.string().uuid().optional().nullable(),
  supplier_id:  z.string().uuid().optional().nullable(),
  order_type:   z.enum(ORDER_TYPES).optional().nullable(),
  valid_until:  z.string().optional().nullable(),
  discount_pct: z.number().min(0).max(100).optional(),
  tax_pct:      z.number().min(0).max(100).optional(),
  notes:        z.string().optional().nullable(),
  items:        z.array(itemSchema).optional(),
  ...intakeFields,
})

const statusSchema = z.object({
  status: z.enum(['Draft', 'Sent', 'Approved', 'Rejected', 'Expired']),
})

router.get('/',                       controller.list)
router.get('/csv-template',           controller.csvTemplate)
router.get('/:id',                    controller.getOne)
router.post('/',                      validate(createSchema),  controller.create)
router.post('/bulk-upload',           uploadCsv, controller.bulkUpload)
router.post('/:id/convert-to-invoice',             controller.convertToInvoice)
router.put('/:id',                    validate(updateSchema),  controller.update)
router.patch('/:id/status',           validate(statusSchema),  controller.updateStatus)
router.delete('/:id',                 controller.remove)

// ── Artwork attachments on a quote ────────────────────────────────────────────
router.get('/:id/artworks', async (req, res) => {
  try {
    const { rows } = await require('../../config/db').query(
      `SELECT id, artwork_no, name, file_url, file_type, status, created_at
       FROM artworks WHERE quotation_id = $1 ORDER BY created_at`,
      [req.params.id]
    )
    res.json({ artworks: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/:id/artworks', uploadArtwork, async (req, res) => {
  try {
    const artwork = await artworksSvc.create({
      name: req.body.name || req.file.originalname.replace(/\.[^.]+$/, ''),
      quotation_id: req.params.id,
      supplier_id:  null,
      order_id:     null,
      status:       'Pending Review',
      notes:        req.body.notes || null,
      uploaded_by:  req.user.id,
      file:         req.file,
    })
    res.status(201).json({ artwork })
  } catch (e) { res.status(e.statusCode ?? 400).json({ error: e.message }) }
})

router.delete('/:id/artworks/:artworkId', async (req, res) => {
  try {
    await artworksSvc.remove(req.params.artworkId)
    res.json({ success: true })
  } catch (e) { res.status(e.statusCode ?? 400).json({ error: e.message }) }
})

module.exports = router
