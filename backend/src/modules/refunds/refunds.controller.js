const svc = require('./refunds.service')
const { success, error } = require('../../utils/response')

const actor = req => req.user?.id ?? null

async function list(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    return success(res, await svc.list({ ...req.query, page: +page, limit: +limit }))
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const r = await svc.getById(req.params.id)
    if (!r) return error(res, 'Refund not found', 404)
    return success(res, r)
  } catch (err) { next(err) }
}

async function createFromClaim(req, res, next) {
  try { return success(res, await svc.createFromClaim(req.params.claimId, req.body, actor(req)), 'Refund raised', 201) }
  catch (err) { next(err) }
}

async function update(req, res, next) {
  try { return success(res, await svc.update(req.params.id, req.body, actor(req)), 'Refund updated') }
  catch (err) { next(err) }
}

async function remove(req, res, next) {
  try { await svc.remove(req.params.id); return success(res, null, 'Refund deleted') }
  catch (err) { next(err) }
}

module.exports = { list, getOne, createFromClaim, update, remove }
