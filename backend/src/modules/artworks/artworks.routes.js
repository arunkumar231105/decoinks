const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { uploadArtwork } = require('../../middleware/upload')
const controller = require('./artworks.controller')

const router = Router()
router.use(verifyToken)

// Multer populates req.body with text fields before the next middleware runs,
// so standard zod validation works for multipart form submissions.
const createSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  artwork_no:  z.string().optional(),
  supplier_id: z.string().uuid().optional().nullable(),
  order_id:    z.string().uuid().optional().nullable(),
  status:      z.enum(['Draft', 'Pending Approval', 'Changes Requested', 'Approved', 'Archived']).optional(),
  tags:        z.string().optional(),   // comma-separated, parsed in service
  notes:       z.string().optional().nullable(),
  lead_id:     z.string().uuid().optional().nullable(),
  artwork_category: z.string().optional().nullable(),
  artwork_micro_niche: z.string().optional().nullable(),
  artwork_type: z.enum(['custom','template','logo','photo']).optional().nullable(),
})

const statusSchema = z.object({
  status: z.enum(['Draft', 'Pending Approval', 'Changes Requested', 'Approved', 'Archived']),
})

const taskSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  supplier_id: z.string().uuid().optional().nullable(),
  order_id:    z.string().uuid().optional().nullable(),
  notes:       z.string().optional().nullable(),
  tags:        z.string().optional(),
  lead_id:     z.string().uuid().optional().nullable(),
  artwork_category: z.string().optional().nullable(),
  artwork_micro_niche: z.string().optional().nullable(),
  artwork_type: z.enum(['custom','template','logo','photo']).optional().nullable(),
})

router.get('/',             controller.list)
router.get('/board',        controller.getBoard)
router.get('/vault/assets', controller.vaultList)
router.get('/vault/stats',  controller.vaultStats)
router.get('/vault/export', controller.vaultExport)
router.post('/vault/sync',  controller.vaultSync)
router.patch('/vault/assets/bulk', controller.vaultBulkUpdate)
router.get('/vault/assets/:id', controller.vaultDetail)
router.patch('/vault/assets/:id/cover', controller.vaultSetCover)
router.get('/:id',          controller.getOne)
router.post('/',            uploadArtwork, validate(createSchema), controller.create)
router.post('/task',        validate(taskSchema), controller.createTask)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.delete('/:id',       controller.remove)

module.exports = router
