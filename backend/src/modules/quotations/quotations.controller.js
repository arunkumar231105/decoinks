const service = require('./quotations.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', customer_id = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, customer_id })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const q = await service.getById(req.params.id)
    return success(res, q)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const q = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, q, 'Quotation created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const q = await service.update(req.params.id, req.body, req.user.id)
    return success(res, q, 'Quotation updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    const q = await service.updateStatus(req.params.id, req.body.status, req.user)
    return success(res, q, 'Status updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Quotation deleted')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, updateStatus, remove }
