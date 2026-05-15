const service = require('./products.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, search = '', product_type = '', active = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, search, product_type, active })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}
async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}
async function create(req, res, next) {
  try {
    const p = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, p, 'Product created')
  } catch (err) { next(err) }
}
async function update(req, res, next) {
  try { return success(res, await service.update(req.params.id, req.body), 'Product updated') } catch (err) { next(err) }
}
async function toggle(req, res, next) {
  try { return success(res, await service.toggle(req.params.id), 'Product toggled') } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try { await service.remove(req.params.id); return success(res, null, 'Product deleted') } catch (err) { next(err) }
}
module.exports = { list, getOne, create, update, toggle, remove }
