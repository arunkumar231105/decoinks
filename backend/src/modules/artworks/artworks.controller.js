const service = require('./artworks.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, search = '', status = '', customer_id = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, search, status, customer_id })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}
async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}
async function create(req, res, next) {
  try {
    const artwork = await service.create({ ...req.body, uploaded_by: req.user.id, file: req.file })
    return created(res, artwork, 'Artwork uploaded')
  } catch (err) { next(err) }
}
async function updateStatus(req, res, next) {
  try {
    return success(res, await service.updateStatus(req.params.id, req.body.status), 'Status updated')
  } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try { await service.remove(req.params.id); return success(res, null, 'Artwork deleted') } catch (err) { next(err) }
}
async function getBoard(req, res, next) {
  try { return success(res, await service.getBoard()) } catch (err) { next(err) }
}
async function createTask(req, res, next) {
  try {
    const task = await service.createTask({ ...req.body, uploaded_by: req.user.id })
    return created(res, task, 'Design task created')
  } catch (err) { next(err) }
}
module.exports = { list, getOne, getBoard, create, createTask, updateStatus, remove }
