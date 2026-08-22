const { Router } = require('express')
const multer = require('multer')
const os = require('os')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./shipments.controller')

const router = Router()
router.use(verifyToken)

// CSV upload for bulk shipment import (Shippo "Shipping Fee" export).
const uploadCsv = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, os.tmpdir()),
    filename: (_r, file, cb) => cb(null, `shipimport_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => {
    const ok = file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv')
    ok ? cb(null, true) : cb(new Error('Only .csv files are allowed'), false)
  },
}).single('file')

const STATUSES = ['Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception']

const bodyFields = {
  order_id:           z.string().uuid().optional().nullable(),
  supplier_id:        z.string().uuid().optional().nullable(),
  carrier:            z.string().optional().nullable(),
  tracking_number:    z.string().optional().nullable(),
  ship_date:          z.string().optional().nullable(),
  estimated_delivery: z.string().optional().nullable(),
  weight_lbs:         z.coerce.number().nonnegative().optional().nullable(),
  shipping_cost:      z.coerce.number().nonnegative().optional().nullable(),
  // Return / mistaken labels stay in the system, marked, rather than deleted.
  is_return:          z.boolean().optional(),
  // A parcel can cover several orders (combined billing). If order_id is set
  // it becomes the primary; every id lands in the shipment_orders join.
  order_ids:          z.array(z.string().uuid()).optional(),
  recipient_name:     z.string().optional().nullable(),
  address:            z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
  // Purchase-order linkage (075_po_shipment_fulfillment.sql)
  po_id:              z.string().uuid().optional().nullable(),
  ship_source:        z.enum(['vendor', 'self']).optional().nullable(),
  // Shippo tracking fields (074_shipment_tracking_fields.sql)
  customer_name:       z.string().optional().nullable(),
  service_type:        z.string().optional().nullable(),
  ship_to_city:        z.string().optional().nullable(),
  ship_to_state:       z.string().optional().nullable(),
  ship_to_postal_code: z.string().optional().nullable(),
  tracking_status:     z.string().optional().nullable(),
  last_scan_city:      z.string().optional().nullable(),
  last_scan_state:     z.string().optional().nullable(),
  delivered_date:      z.string().optional().nullable(),
}

// Every field above is optional on its own, which meant an empty body passed
// validation and created a blank parcel — no carrier, no tracking, nothing to
// ship and nobody to ship it to. A shipment has to say at least one of those
// things: what it belongs to, how it is tracked, or who it is going to. That
// admits every real path (the form, the CSV import, a bought label, and the
// Shippo labels that arrive with tracking before an order is linked) and
// rejects an empty POST.
const IDENTIFYING = ['order_id', 'po_id', 'order_ids', 'tracking_number', 'recipient_name', 'customer_name']
const createSchema = z.object({
  ...bodyFields,
  supplier_name_text: z.string().optional().nullable(),
  agent_name:         z.string().optional().nullable(),
  status:             z.enum(STATUSES).optional(),
}).refine(
  (body) => IDENTIFYING.some((k) => {
    const v = body[k]
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== ''
  }),
  { message: `A shipment needs at least one of: ${IDENTIFYING.join(', ')}` }
)

const updateSchema = z.object(bodyFields).strict()

const statusSchema = z.object({
  status: z.enum(STATUSES),
})

router.get('/',             controller.list)
router.get('/stats',        controller.stats)
// /export must stay above /:id — otherwise the id route matches "export".
router.get('/export',       controller.exportCsv)
router.get('/:id',          controller.getOne)
router.post('/',            validate(createSchema), controller.create)
router.put('/:id',          validate(updateSchema), controller.update)
const trackPreviewSchema = z.object({
  carrier:         z.string().optional().nullable(),   // auto-detected from tracking # when omitted
  tracking_number: z.string().min(1),
})

const addressSchema = z.object({
  name:    z.string().optional().nullable(),
  street1: z.string().min(1),
  city:    z.string().min(1),
  state:   z.string().min(1),
  zip:     z.string().min(1),
  country: z.string().optional().default('US'),
  phone:   z.string().optional().nullable(),
  email:   z.string().optional().nullable(),
})
const parcelSchema = z.object({
  length: z.coerce.number().positive(),
  width:  z.coerce.number().positive(),
  height: z.coerce.number().positive(),
  weight: z.coerce.number().positive(),
})
const ratesSchema = z.object({
  from:   addressSchema,
  to:     addressSchema,
  parcel: parcelSchema,
})
const labelSchema = z.object({
  rate_id:   z.string().min(1),
  carrier:   z.string().optional().nullable(),
  service:   z.string().optional().nullable(),
  amount:    z.union([z.string(), z.number()]).optional().nullable(),
  to_name:   z.string().optional().nullable(),
  to_street: z.string().optional().nullable(),
  to_city:   z.string().optional().nullable(),
  to_state:  z.string().optional().nullable(),
  to_zip:    z.string().optional().nullable(),
  order_id:  z.string().uuid().optional().nullable(),
  po_id:     z.string().uuid().optional().nullable(),
})

router.post('/import',        uploadCsv, controller.importCsv)
router.post('/track-preview', validate(trackPreviewSchema), controller.trackPreview)
router.post('/rates',         validate(ratesSchema), controller.getRates)
router.post('/label',         validate(labelSchema), controller.buyLabel)
router.post('/:id/void-label', controller.voidLabel)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.post('/:id/track',   controller.refreshTracking)
router.delete('/:id',       controller.remove)

module.exports = router
