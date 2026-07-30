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
  weight_lbs:         z.number().nonnegative().optional().nullable(),
  shipping_cost:      z.number().nonnegative().optional().nullable(),
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

const createSchema = z.object({
  ...bodyFields,
  supplier_name_text: z.string().optional().nullable(),
  agent_name:         z.string().optional().nullable(),
  status:             z.enum(STATUSES).optional(),
})

const updateSchema = z.object(bodyFields).strict()

const statusSchema = z.object({
  status: z.enum(STATUSES),
})

router.get('/',             controller.list)
router.get('/:id',          controller.getOne)
router.post('/',            validate(createSchema), controller.create)
router.put('/:id',          validate(updateSchema), controller.update)
const trackPreviewSchema = z.object({
  carrier:         z.string().optional().nullable(),   // auto-detected from tracking # when omitted
  tracking_number: z.string().min(1),
})

router.post('/import',        uploadCsv, controller.importCsv)
router.post('/track-preview', validate(trackPreviewSchema), controller.trackPreview)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.post('/:id/track',   controller.refreshTracking)
router.delete('/:id',       controller.remove)

module.exports = router
