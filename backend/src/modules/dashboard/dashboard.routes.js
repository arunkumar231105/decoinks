const { Router } = require('express')
const { verifyToken } = require('../../middleware/auth')
const controller = require('./dashboard.controller')

const router = Router()
router.use(verifyToken)

router.get('/stats', controller.getStats)
router.get('/lead-pipeline', controller.getLeadPipeline)
router.get('/orders-by-status', controller.getOrdersByStatus)
router.get('/top-customers', controller.getTopCustomers)
router.get('/recent-activity', controller.getRecentActivity)

module.exports = router
