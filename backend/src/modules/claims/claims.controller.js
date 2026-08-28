const svc = require('./claims.service')
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
    const claim = await svc.getById(req.params.id)
    if (!claim) return error(res, 'Claim not found', 404)
    return success(res, claim)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try { return success(res, await svc.create(req.body, actor(req)), 'Claim created', 201) }
  catch (err) { next(err) }
}

async function update(req, res, next) {
  try { return success(res, await svc.update(req.params.id, req.body, actor(req)), 'Claim updated') }
  catch (err) { next(err) }
}

async function review(req, res, next) {
  try { return success(res, await svc.review(req.params.id, req.body, actor(req)), 'Review recorded') }
  catch (err) { next(err) }
}

async function comment(req, res, next) {
  try { return success(res, await svc.addComment(req.params.id, req.body.comment, actor(req)), 'Comment added') }
  catch (err) { next(err) }
}

async function attach(req, res, next) {
  try { return success(res, await svc.addAttachment(req.params.id, req.body, actor(req)), 'Attachment added') }
  catch (err) { next(err) }
}

async function detach(req, res, next) {
  try { return success(res, await svc.removeAttachment(req.params.id, req.params.attachmentId), 'Attachment removed') }
  catch (err) { next(err) }
}

async function remove(req, res, next) {
  try { await svc.remove(req.params.id, actor(req)); return success(res, null, 'Claim deleted') }
  catch (err) { next(err) }
}

async function customerOrders(req, res, next) {
  try { return success(res, await svc.ordersForCustomer(req.params.customerId)) }
  catch (err) { next(err) }
}

async function orderChain(req, res, next) {
  try { return success(res, await svc.chainForOrder(req.params.orderId)) }
  catch (err) { next(err) }
}

async function orderDetails(req, res, next) {
  try {
    const detail = await svc.orderDetails(req.params.orderId)
    if (!detail) return error(res, 'Order not found', 404)
    return success(res, detail)
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, review, comment, attach, detach, remove,
                   customerOrders, orderDetails, orderChain }
