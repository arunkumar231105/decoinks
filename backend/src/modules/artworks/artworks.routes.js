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
})

router.get('/',             controller.list)
router.get('/board',        controller.getBoard)
router.get('/:id',          controller.getOne)
router.post('/',            uploadArtwork, validate(createSchema), controller.create)
router.post('/task',        validate(taskSchema), controller.createTask)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.delete('/:id',       controller.remove)

module.exports = router
