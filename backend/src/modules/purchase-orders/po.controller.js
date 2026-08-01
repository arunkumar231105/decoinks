const service = require('./po.service')
const { sendCsv } = require('../../utils/csvExport')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', supplier_id = '', search = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, supplier_id, search })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function summary(req, res, next) {
  try { return success(res, await service.getImportSummary()) } catch (err) { next(err) }
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

async function bulkRemove(req, res, next) {
  try {
    const ids = req.body.ids || []
    let deleted = 0; const errors = []
    for (const id of ids) {
      try { await service.remove(id); deleted++ }
      catch (e) { errors.push({ id, message: e.message }) }
    }
    return success(res, { deleted, errors }, `${deleted} purchase order(s) deleted`)
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

// GET /export — full filtered result set as CSV with readable headers.
async function exportCsv(req, res, next) {
  try {
    const { status = '', supplier_id = '', search = '' } = req.query
    const { rows } = await service.list({ page: 1, limit: 10000, status, supplier_id, search })
    const columns = [
    ['PO No', 'po_number'], ['PO Date', 'order_date'], ['Entry Date', 'entry_date'],
    ['Expected Date', 'expected_date'],
    ['Status', 'status'], ['PO Type', 'po_type'],
    ['Supplier / Vendor', 'display_vendor_name'], ['Contact Name', 'contact_name'],
    ['Contact Email', 'contact_email'], ['Contact Phone', 'contact_phone'],
    ['Order No', 'order_number'], ['Payment Status', 'payment_status'],
    ['Subtotal', 'subtotal'], ['Tax', 'tax_amt'], ['Total', 'total'], ['Currency', 'currency'],
    ['Shipping By', 'shipping_method'], ['Service Type', 'service_type'],
    ['Carrier', 'carrier'], ['Tracking No', 'tracking_number'],
    ['Ship Date', 'ship_date'], ['Estimated Delivery', 'estimated_delivery'],
    ['Terms', 'terms_conditions'], ['Notes', 'notes'],
    ]
    return sendCsv(res, 'purchase-orders', columns, rows)
  } catch (err) { next(err) }
}

module.exports = { list, exportCsv, summary, getOne, create, update, updateStatus, remove, bulkRemove, listAttachments, addAttachment, removeAttachment, getStatusHistory, sendToPortal }
