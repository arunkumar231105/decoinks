const express = require('express')
const { z } = require('zod')
const controller = require('./prompts.controller')
const { validate } = require('../../middleware/validate')
const { verifyToken, requireRole } = require('../../middleware/auth')

const router = express.Router()
router.use(verifyToken)

// Prompts decide what the AI does to a customer's artwork, so editing them is
// an administrator's job. Everyone else who reaches the module can read.
const canEdit = requireRole('Admin', 'Manager')

const VARIABLE_TYPES = ['Text', 'Image', 'Boolean', 'Enum', 'Number', 'Ratio', 'Color', 'Asset', 'Array']
const VARIABLE_SOURCES = ['Job / CRM', 'Uploaded Asset', 'UI Selection', 'System', 'Previous Step', 'AI Output', 'Database']

const promptSchema = z.object({
  name:        z.string().min(1).max(160),
  // The key is how code asks for this prompt, so it may not carry spaces.
  // Left out, it is made from the module and the name (see createPrompt).
  prompt_key:  z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/,
                 'Use letters, numbers, dots, dashes or underscores').optional(),
  module_id:   z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  used_in:     z.string().max(200).optional().nullable(),
  status:      z.enum(['Active', 'Disabled', 'Archived']).optional(),
})

// The key is the contract with the code that calls it and never changes.
const promptUpdateSchema = promptSchema.omit({ prompt_key: true }).partial()

const versionSchema = z.object({
  from_version_id: z.string().uuid().optional().nullable(),
  change_summary:  z.string().max(300).optional().nullable(),
})

const modelSchema = z.object({
  provider:    z.string().max(60).optional(),
  model_name:  z.string().max(120).optional(),
  temperature: z.coerce.number().min(0).max(2).optional().nullable(),
  max_tokens:  z.coerce.number().int().positive().optional().nullable(),
  // Left open on purpose: a second provider brings parameters we have not met.
  settings:    z.record(z.any()).optional(),
})

const versionUpdateSchema = z.object({
  system_instruction: z.string().optional().nullable(),
  task_instruction:   z.string().optional().nullable(),
  dynamic_context:    z.string().optional().nullable(),
  restrictions:       z.string().optional().nullable(),
  change_summary:     z.string().max(300).optional().nullable(),
  notes:              z.string().optional().nullable(),
  model:              modelSchema.optional(),
})

const variableSchema = z.object({
  variable_name:    z.string().min(1).max(80).regex(/^[A-Za-z0-9_]+$/,
                      'A variable name is letters, numbers and underscores'),
  type:             z.enum(VARIABLE_TYPES).optional(),
  required:         z.coerce.boolean().optional(),
  default_value:    z.string().optional().nullable(),
  source:           z.enum(VARIABLE_SOURCES).optional(),
  description:      z.string().optional().nullable(),
  validation_rules: z.record(z.any()).optional(),
  sort_order:       z.coerce.number().int().optional(),
})

const runSchema = z.object({ values: z.record(z.any()).optional() })

// Modules
router.get('/modules', controller.listModules)
router.post('/modules', canEdit,
  validate(z.object({ name: z.string().min(1).max(120), key: z.string().min(1).max(80),
                      description: z.string().optional().nullable() })),
  controller.createModule)

// Versions — declared before /:id so "versions" is never read as a prompt id.
router.get('/versions/:id', controller.getVersion)
router.put('/versions/:id', canEdit, validate(versionUpdateSchema), controller.updateVersion)
router.delete('/versions/:id', canEdit, controller.deleteVersion)
router.post('/versions/:id/publish', canEdit, controller.publishVersion)
router.post('/versions/:id/rollback', canEdit, controller.rollbackVersion)
router.get('/versions/:id/variables', controller.listVariables)
router.post('/versions/:id/variables', canEdit, validate(variableSchema), controller.createVariable)
router.post('/versions/:id/preview', validate(runSchema), controller.preview)
router.post('/versions/:id/test', canEdit, validate(runSchema), controller.test)
router.get('/versions/:id/tests', controller.listTests)

router.put('/variables/:id', canEdit, validate(variableSchema.partial()), controller.updateVariable)
router.delete('/variables/:id', canEdit, controller.deleteVariable)

// Prompts
router.get('/', controller.list)
router.post('/', canEdit, validate(promptSchema), controller.create)
router.get('/:id', controller.getOne)
router.put('/:id', canEdit, validate(promptUpdateSchema), controller.update)
router.post('/:id/versions', canEdit, validate(versionSchema), controller.createVersion)

module.exports = router
