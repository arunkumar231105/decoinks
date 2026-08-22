const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { uploadArtwork, uploadStudioArtwork } = require('../../middleware/upload')
const controller = require('./artworks.controller')
const designTasksRoutes = require('./design-tasks.routes')
const productionArtworkRoutes = require('./production-artwork.routes')

const router = Router()

// ── Design Studio round-trip (artwork-token auth, no Bearer session) ─────────
// The Design Studio bridge (api/central-artwork.php) calls these server-to-server
// with a short-lived artwork token, so they must sit ahead of verifyToken.
router.get('/studio/asset',           controller.studioAsset)
router.get('/studio/content',         controller.studioContent)
router.get('/studio/vault',           controller.studioVault)          // one filtered page
router.get('/studio/vault/facets',    controller.studioVaultFacets)    // customer + folder tabs
router.get('/studio/vault/revision',  controller.studioVaultRevision)  // live change cursor
router.get('/studio/thumb',           controller.studioPreview)        // Nextcloud thumbnail
router.get('/studio/handoff',         controller.studioHandoff)        // vault token → asset token
router.post('/studio/save',           uploadStudioArtwork, controller.studioSave)
// Resized copy of a stored image, so a print layout does not embed the
// full-resolution original. Reads only paths MinIO already serves publicly.
router.get('/storage-thumb',          controller.storageThumb)

router.use(verifyToken)

router.use('/design-tasks', designTasksRoutes)
router.use('/', productionArtworkRoutes)

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

const vaultLinkSchema = z.object({
  artwork_id: z.string().uuid().optional().nullable(),
  artwork_version_id: z.string().uuid().optional().nullable(),
}).refine(value => value.artwork_id || value.artwork_version_id, {
  message: 'artwork_id or artwork_version_id is required',
})

router.get('/',             controller.list)
router.get('/board',        controller.getBoard)
router.get('/vault/assets', controller.vaultList)
router.get('/vault/stats',  controller.vaultStats)
router.get('/vault/facets', controller.vaultFacets)
router.get('/vault/revision', controller.vaultRevision)
router.get('/vault/export', controller.vaultExport)
router.post('/vault/sync',  controller.vaultSync)
router.patch('/vault/assets/bulk', controller.vaultBulkUpdate)
router.patch('/vault/assets/:id/link', validate(vaultLinkSchema), controller.vaultLinkAsset)
router.get('/vault/assets/:id', controller.vaultDetail)
router.patch('/vault/assets/:id/cover', controller.vaultSetCover)
router.post('/vault/assets/:id/studio-token', controller.studioToken)
router.get('/:id',          controller.getOne)
router.post('/',            uploadArtwork, validate(createSchema), controller.create)
router.post('/task',        validate(taskSchema), controller.createTask)
router.patch('/:id/status', validate(statusSchema), controller.updateStatus)
router.delete('/:id',       controller.remove)

module.exports = router
