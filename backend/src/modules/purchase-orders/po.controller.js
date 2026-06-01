const service = require('./po.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', supplier_id = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, supplier_id })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const po = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, po, 'Purchase order created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    return success(res, await service.update(req.params.id, req.body), 'Purchase order updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    const { status, comment } = req.body
    return success(res, await service.updateStatus(req.params.id, status, req.user, comment), 'Status updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Purchase order deleted')
  } catch (err) { next(err) }
}

async function listAttachments(req, res, next) {
  try {
    const attachments = await service.listAttachments(req.params.id)
    return success(res, attachments)
  } catch (err) { next(err) }
}

async function addAttachment(req, res, next) {
  try {
    const { filename, file_url, file_size, mime_type } = req.body
    if (!filename || !file_url)
      return res.status(400).json({ error: 'filename and file_url are required' })
    const attachment = await service.addAttachment(req.params.id, req.user.id, { filename, file_url, file_size, mime_type })
    return created(res, attachment, 'Attachment added')
  } catch (err) { next(err) }
}

async function removeAttachment(req, res, next) {
  try {
    await service.removeAttachment(req.params.id, req.params.aid)
    return success(res, null, 'Attachment removed')
  } catch (err) { next(err) }
}

async function getStatusHistory(req, res, next) {
  try {
    const history = await service.getStatusHistory(req.params.id)
    return success(res, history)
  } catch (err) { next(err) }
}

async function sendToPortal(req, res, next) {
  try {
    const result = await service.sendToPortal(req.params.id, req.user.id, req.body.supplier_id)
    return success(res, result, 'PO sent to supplier portal')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, updateStatus, remove, listAttachments, addAttachment, removeAttachment, getStatusHistory, sendToPortal }
