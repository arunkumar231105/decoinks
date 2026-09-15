const express = require('express')
const { z } = require('zod')
const svc = require('./prompts.service')
const { validate } = require('../../middleware/validate')
const { serviceAuth } = require('../../middleware/serviceAuth')

/**
 * The runtime face of Prompt Management, for apps rather than people.
 *
 * Artwork Automation (and any later app) fetches the LIVE version of the
 * prompts it runs, and reports each run back so Decoinks can answer "which
 * version produced this, on which model, and did it work?". Callers are
 * servers, so they authenticate with the shared service secret
 * (x-decoinks-sso-secret), the same credential the CRM bridge uses.
 */
const router = express.Router()
router.use(serviceAuth)

const handle = fn => async (req, res, next) => {
  try { await fn(req, res) } catch (err) { next(err) }
}

router.get('/health', (req, res) => res.json({ success: true, data: { ok: true } }))

// ?keys=AIS.TEXT.COLLAGE,AIS.RATIO.PLAN  and/or  ?module=CONCEPT
router.get('/prompts', handle(async (req, res) => {
  const keys = String(req.query.keys || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
  res.json({ success: true, data: await svc.productionPrompts({ keys, module: req.query.module || '' }) })
}))

router.get('/prompts/:key', handle(async (req, res) => {
  const data = await svc.productionPrompts({ keys: [req.params.key] })
  if (!data.prompts.length) {
    return res.status(404).json({ success: false, message: `No live version of ${req.params.key}` })
  }
  res.json({ success: true, data: data.prompts[0] })
}))

const fileSchema = z.object({
  file_name:  z.string().max(255),
  file_url:   z.string().max(2000).optional().nullable(),
  mime_type:  z.string().max(120).optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
})

const runSchema = z.object({
  prompt_key:        z.string().min(1).max(120),
  prompt_version_id: z.string().uuid().optional().nullable(),
  source_app:        z.string().min(1).max(60),
  external_ref:      z.string().max(200).optional().nullable(),
  status:            z.enum(['running', 'success', 'failed', 'cancelled']).default('success'),
  prompt_source:     z.enum(['managed', 'edited', 'built_in']).optional().nullable(),
  input_variables:   z.record(z.any()).optional(),
  resolved_prompt:   z.string().max(200000).optional().nullable(),
  provider:          z.string().max(60).optional().nullable(),
  model:             z.string().max(120).optional().nullable(),
  model_parameters:  z.record(z.any()).optional(),
  input_tokens:      z.number().int().nonnegative().optional().nullable(),
  output_tokens:     z.number().int().nonnegative().optional().nullable(),
  cost_usd:          z.number().nonnegative().optional().nullable(),
  latency_ms:        z.number().int().nonnegative().optional().nullable(),
  error_message:     z.string().max(5000).optional().nullable(),
  output_reference:  z.string().max(2000).optional().nullable(),
  output_files:      z.array(fileSchema).max(100).optional(),
  completed_at:      z.string().optional().nullable(),
})

router.post('/generations', validate(z.object({ runs: z.array(runSchema).min(1).max(50) })),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await svc.logGenerations(req.body.runs) })
  }))

module.exports = router
