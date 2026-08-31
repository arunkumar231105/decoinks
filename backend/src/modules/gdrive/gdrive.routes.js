const { Router } = require('express')
const { verifyToken } = require('../../middleware/auth')
const controller = require('./gdrive.controller')

const router = Router()

// Staff-only, like every other integration browser. Read-only against Drive:
// nothing here writes to, moves, or deletes anything in the customer folders.
router.use(verifyToken)

router.get('/status',     controller.status)     // connection health
router.get('/customers',  controller.customers)  // folders under DECOINKS_ORDERS
router.get('/files',      controller.files)      // one customer's pictures + folder tabs
router.get('/thumb',      controller.thumb)      // proxy Drive thumbnail
router.get('/download',   controller.download)   // proxy file bytes
router.post('/attach',    controller.attach)     // copy a Drive picture onto an order line
router.post('/refresh',   controller.refresh)    // drop the listing cache

module.exports = router
