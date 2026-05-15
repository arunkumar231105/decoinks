const service = require('./shipments.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}
async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}
async function create(req, res, next) {
  try {
    const s = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, s, 'Shipment created')
  } catch (err) { next(err) }
}
async function update(req, res, next) {
  try {
    return success(res, await service.update(req.params.id, req.body), 'Shipment updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    return success(res, await service.updateStatus(req.params.id, req.body.status), 'Status updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Shipment deleted')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, updateStatus, remove }
