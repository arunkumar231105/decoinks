const service = require('./orders.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', order_type = '', customer_id = '', date_from = '', date_to = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, order_type, customer_id, date_from, date_to })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const order = await service.getById(req.params.id)
    return success(res, order)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const order = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, order, 'Order created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const order = await service.update(req.params.id, req.body, req.user.id)
    return success(res, order, 'Order updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    const order = await service.updateStatus(req.params.id, req.body.status, req.user.id)
    return success(res, order, 'Status updated')
  } catch (err) { next(err) }
}

async function getInvoice(req, res, next) {
  try {
    const invoice = await service.getInvoice(req.params.id)
    return success(res, invoice)
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Order deleted')
  } catch (err) { next(err) }
}

async function getBoard(req, res, next) {
  try {
    return success(res, await service.getBoard())
  } catch (err) { next(err) }
}

module.exports = { list, getOne, getBoard, create, update, updateStatus, getInvoice, remove }
