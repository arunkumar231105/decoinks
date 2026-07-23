const service = require('./dashboard.service')
const { success } = require('../../utils/response')

async function getStats(req, res, next) {
  try { return success(res, await service.getStats()) } catch (err) { next(err) }
}
async function getLeadPipeline(req, res, next) {
  try { return success(res, await service.getLeadPipeline()) } catch (err) { next(err) }
}
async function getOrdersByStatus(req, res, next) {
  try { return success(res, await service.getOrdersByStatus()) } catch (err) { next(err) }
}
async function getTopSuppliers(req, res, next) {
  try { return success(res, await service.getTopSuppliers()) } catch (err) { next(err) }
}
async function getRecentActivity(req, res, next) {
  try { return success(res, await service.getRecentActivity()) } catch (err) { next(err) }
}
async function getOverview(req, res, next) {
  try {
    const { date_from, date_to } = req.query
    return success(res, await service.getOverview({ date_from, date_to }))
  } catch (err) { next(err) }
}

module.exports = { getStats, getLeadPipeline, getOrdersByStatus, getTopSuppliers, getRecentActivity, getOverview }
