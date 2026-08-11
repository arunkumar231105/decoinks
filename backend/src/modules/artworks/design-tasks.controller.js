const service = require('./design-tasks.service')
const { success, created } = require('../../utils/response')

async function list(req, res, next) {
  try { return success(res, await service.list(req.query)) } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}

async function create(req, res, next) {
  try { return created(res, await service.create({ ...req.body, created_by: req.user.id }), 'Design task created') } catch (err) { next(err) }
}

async function update(req, res, next) {
  try { return success(res, await service.update(req.params.id, req.body), 'Design task updated') } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update }
