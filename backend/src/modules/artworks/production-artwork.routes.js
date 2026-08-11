const { Router } = require('express')
const { z } = require('zod')
const { validate } = require('../../middleware/validate')
const controller = require('./production-artwork.controller')

const router = Router()
const uuid = z.string().uuid()
const mockupSchema = z.object({ artwork_id: uuid, artwork_version_id: uuid, mockup_no: z.string().optional(), apparel_type: z.string().optional().nullable(), apparel_color: z.string().optional().nullable(), apparel_size: z.string().optional().nullable(), artwork_width_in: z.number().optional().nullable(), artwork_height_in: z.number().optional().nullable(), mockup_type: z.enum(['Single','Group']).optional(), file_name: z.string().min(1), storage_provider: z.string().optional(), relative_path: z.string().min(1), nextcloud_file_id: z.string().optional().nullable(), thumbnail_path: z.string().optional().nullable(), file_format: z.string().optional().nullable(), file_size_bytes: z.number().int().nonnegative().optional(), production_ready: z.boolean().optional(), customer_approval_status: z.string().optional(), notes: z.string().optional().nullable() })
const masterSchema = z.object({ master_gangsheet_no: z.string().min(1), sales_order_id: uuid.optional().nullable(), purchase_order_id: uuid.optional().nullable(), status: z.string().optional(), total_unique_artworks: z.number().int().nonnegative().optional(), total_quantity: z.number().int().nonnegative().optional(), number_of_child_gangsheets: z.number().int().nonnegative().optional(), file_name: z.string().optional().nullable(), storage_provider: z.string().optional(), relative_path: z.string().optional().nullable(), nextcloud_file_id: z.string().optional().nullable(), width_in: z.number().optional().nullable(), length_in: z.number().optional().nullable(), notes: z.string().optional().nullable() })
const childSchema = z.object({ master_gangsheet_id: uuid, child_no: z.number().int().positive(), version_no: z.number().int().positive().optional(), version_type: z.string().optional(), file_name: z.string().min(1), storage_provider: z.string().optional(), relative_path: z.string().min(1), nextcloud_file_id: z.string().optional().nullable(), thumbnail_path: z.string().optional().nullable(), file_format: z.string().optional().nullable(), width_in: z.number(), length_in: z.number(), width_px: z.number().int().optional().nullable(), height_px: z.number().int().optional().nullable(), dpi: z.number().int().optional().nullable(), file_size_bytes: z.number().int().nonnegative().optional(), notes: z.string().optional().nullable() })
const detailSchema = z.object({ artwork_version_id: uuid, sales_order_item_id: uuid.optional().nullable(), purchase_order_item_id: uuid.optional().nullable(), quantity: z.number().int().positive(), print_width_in: z.number().optional().nullable(), print_height_in: z.number().optional().nullable() })

router.get('/mockups', controller.mockups)
router.post('/mockups', validate(mockupSchema), controller.createMockup)
router.post('/master-gangsheets', validate(masterSchema), controller.createMaster)
router.get('/master-gangsheets/:id', controller.getMaster)
router.get('/master-gangsheets/:id/validate', controller.validateMaster)
router.post('/child-gangsheets', validate(childSchema), controller.createChild)
router.post('/child-gangsheets/:id/artworks', validate(detailSchema), controller.addArtwork)

module.exports = router
