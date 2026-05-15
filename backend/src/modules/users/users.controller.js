const service = require('./users.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, search = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, search })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const user = await service.getById(req.params.id)
    return success(res, user)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const user = await service.create(req.body, req.user.id)
    return created(res, user, 'User created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const user = await service.update(req.params.id, req.body, req.user.id)
    return success(res, user, 'User updated')
  } catch (err) { next(err) }
}

async function deactivate(req, res, next) {
  try {
    await service.deactivate(req.params.id)
    return success(res, null, 'User deactivated')
  } catch (err) { next(err) }
}

async function resetPassword(req, res, next) {
  try {
    await service.resetPassword(req.params.id, req.body.password)
    return success(res, null, 'Password reset successfully')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, deactivate, resetPassword }
