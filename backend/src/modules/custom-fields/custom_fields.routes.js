'use strict'

const { Router } = require('express')
const { z } = require('zod')
const { verifyToken, requireRole } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { success, created } = require('../../utils/response')
const service = require('./custom_fields.service')

const router = Router()
router.use(verifyToken)

// ── Validation constants ──────────────────────────────────────────────────────

const ENTITY_TYPES = ['lead', 'quotation', 'invoice', 'order', 'supplier', 'product']
const FIELD_TYPES  = ['text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'textarea']
const SELECT_TYPES = new Set(['select', 'multiselect'])

const fieldKeySchema = z
  .string()
  .min(1, 'field_key is required')
  .regex(/^[a-z][a-z0-9_]*$/, 'field_key must be lowercase letters, digits, or underscores and start with a letter')

const optionsSchema = z
  .array(z.string().min(1, 'option cannot be empty'))
  .min(1, 'options must have at least 1 item')

// ── Schemas ───────────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    entity_type:   z.enum(ENTITY_TYPES),
    field_key:     fieldKeySchema,
    field_label:   z.string().min(1, 'field_label is required').transform((s) => s.trim()),
    field_type:    z.enum(FIELD_TYPES),
    is_required:   z.boolean().optional().default(false),
    default_value: z.string().optional().nullable(),
    options:       optionsSchema.optional().nullable(),
    display_order: z.number().int().min(0).optional().default(0),
  })
  .superRefine((data, ctx) => {
    if (SELECT_TYPES.has(data.field_type)) {
      if (!data.options || data.options.length === 0) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ['options'],
          message: 'options must have at least 1 item for select / multiselect fields',
        })
      }
    }
  })

const updateSchema = z
  .object({
    field_label:   z.string().min(1).transform((s) => s.trim()).optional(),
    field_type:    z.enum(FIELD_TYPES).optional(),
    is_required:   z.boolean().optional(),
    default_value: z.string().optional().nullable(),
    options:       optionsSchema.optional().nullable(),
    display_order: z.number().int().min(0).optional(),
    is_active:     z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.field_type && SELECT_TYPES.has(data.field_type)) {
      if (!data.options || data.options.length === 0) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ['options'],
          message: 'options must have at least 1 item for select / multiselect fields',
        })
      }
    }
  })

// ── Routes ────────────────────────────────────────────────────────────────────

const ENTITY_TYPES_SET = new Set(ENTITY_TYPES)

router.get('/', async (req, res, next) => {
  try {
    const { entity_type } = req.query
    const fields = await service.list({ entity_type })
    return success(res, fields)
  } catch (err) { next(err) }
})

// ── Custom field value storage — must be declared BEFORE /:id ─────────────────

router.get('/values/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params
    if (!ENTITY_TYPES_SET.has(entityType)) {
      return res.status(400).json({ error: `Invalid entity type: ${entityType}` })
    }
    return success(res, await service.getValues(entityType, entityId))
  } catch (err) { next(err) }
})

router.patch('/values/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params
    if (!ENTITY_TYPES_SET.has(entityType)) {
      return res.status(400).json({ error: `Invalid entity type: ${entityType}` })
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Body must be a key-value object of field_key → value' })
    }
    return success(res, await service.setValues(entityType, entityId, req.body), 'Custom field values saved')
  } catch (err) { next(err) }
})

// ── CRUD for field definitions ─────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    return success(res, await service.getById(req.params.id))
  } catch (err) { next(err) }
})

router.post('/', requireRole('Admin', 'Manager'), validate(createSchema), async (req, res, next) => {
  try {
    return created(res, await service.create(req.body), 'Custom field created')
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('Admin', 'Manager'), validate(updateSchema), async (req, res, next) => {
  try {
    return success(res, await service.update(req.params.id, req.body), 'Custom field updated')
  } catch (err) { next(err) }
})

router.delete('/:id', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Custom field deactivated')
  } catch (err) { next(err) }
})

module.exports = router
