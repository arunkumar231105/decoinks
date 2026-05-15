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
async function getTopCustomers(req, res, next) {
  try { return success(res, await service.getTopCustomers()) } catch (err) { next(err) }
}
async function getRecentActivity(req, res, next) {
  try { return success(res, await service.getRecentActivity()) } catch (err) { next(err) }
}

module.exports = { getStats, getLeadPipeline, getOrdersByStatus, getTopCustomers, getRecentActivity }
