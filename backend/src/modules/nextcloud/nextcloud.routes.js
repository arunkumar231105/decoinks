const { Router } = require('express')
const { verifyToken, requireRole } = require('../../middleware/auth')
const controller = require('./nextcloud.controller')
const { uploadArtwork } = require('../../middleware/upload')

const router = Router()

// Webhook is called by Nextcloud (server-to-server), so it is authenticated by
// the shared secret inside the controller — NOT by a user JWT. It must be
// registered before the verifyToken guard below.
router.post('/webhook', controller.webhook)

// Everything else is staff-only.
router.use(verifyToken)

router.get('/status',   controller.status)              // connection health
router.get('/files',    controller.listFolder)          // list one folder
router.get('/scan',     controller.scan)                // walk watched folders
router.get('/download', controller.download)            // proxy file bytes
router.get('/preview',  controller.preview)             // proxy thumbnail
router.post('/upload',  uploadArtwork, controller.upload) // import into watched root

module.exports = router
