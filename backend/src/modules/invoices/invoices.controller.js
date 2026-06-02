const service = require('./invoices.service')
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
    return success(res, await service.getById(req.params.id))
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const inv = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, inv, 'Invoice created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    return success(res, await service.update(req.params.id, req.body), 'Invoice updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    return success(res, await service.updateStatus(req.params.id, req.body.status, req.user), 'Status updated')
  } catch (err) { next(err) }
}

async function recordPayment(req, res, next) {
  try {
    const { amount, payment_method, reference_no, notes } = req.body
    return success(res, await service.recordPayment(req.params.id, { amount, payment_method, reference_no, notes }, req.user.id), 'Payment recorded')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id, req.user.id)
    return success(res, null, 'Invoice voided')
  } catch (err) { next(err) }
}

async function convertToOrder(req, res, next) {
  try {
    const { order_type } = req.body
    const { order, alreadyExisted } = await service.convertToOrder(req.params.id, req.user.id, order_type)
    const message = alreadyExisted
      ? `Order ${order.order_number} already exists for this invoice`
      : `Order ${order.order_number} created`
    return alreadyExisted ? success(res, order, message) : created(res, order, message)
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, updateStatus, recordPayment, remove, convertToOrder }
