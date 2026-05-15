const service = require('./customers.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, search = '', status = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, search, status })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const customer = await service.getById(req.params.id)
    return success(res, customer)
  } catch (err) { next(err) }
}

async function getOrders(req, res, next) {
  try {
    const { page = 1, limit = 10 } = req.query
    const { rows, total } = await service.getOrders(req.params.id, { page: +page, limit: +limit })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const customer = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, customer, 'Customer created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const customer = await service.update(req.params.id, req.body, req.user.id)
    return success(res, customer, 'Customer updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Customer deleted')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, getOrders, create, update, remove }
