const { Router } = require('express')
const { z } = require('zod')
const { validate } = require('../../middleware/validate')
const controller = require('./design-tasks.controller')

const router = Router()

const uuid = z.string().uuid()
const createSchema = z.object({
  artwork_id: uuid,
  assigned_to: uuid.optional().nullable(),
  task_stage: z.enum(['Design', 'Internal Review', 'Customer Review', 'Revision', 'Completed']).optional(),
  task_status: z.enum(['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled']).optional(),
  priority: z.enum(['Normal', 'High', 'Rush']).optional(),
  current_artwork_version_id: uuid.optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const updateSchema = z.object({
  assigned_to: uuid.optional().nullable(),
  task_stage: z.enum(['Design', 'Internal Review', 'Customer Review', 'Revision', 'Completed']).optional(),
  task_status: z.enum(['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled']).optional(),
  priority: z.enum(['Normal', 'High', 'Rush']).optional(),
  current_artwork_version_id: uuid.optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
  started_at: z.string().datetime().optional().nullable(),
  completed_at: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
})

router.get('/', controller.list)
router.get('/:id', controller.getOne)
router.post('/', validate(createSchema), controller.create)
router.patch('/:id', validate(updateSchema), controller.update)

module.exports = router
