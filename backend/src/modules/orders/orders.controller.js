const service = require('./orders.service')
const { sendCsv } = require('../../utils/csvExport')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', order_type = '', customer_id = '', date_from = '', date_to = '', search = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, order_type, customer_id, date_from, date_to, search })
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
    const order = await service.updateStatus(req.params.id, req.body.status, req.user)
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

async function bulkRemove(req, res, next) {
  try {
    const ids = req.body.ids || []
    let deleted = 0; const errors = []
    for (const id of ids) {
      try { await service.remove(id); deleted++ }
      catch (e) { errors.push({ id, message: e.message }) }
    }
    return success(res, { deleted, errors }, `${deleted} order(s) deleted`)
  } catch (err) { next(err) }
}

async function getBoard(req, res, next) {
  try {
    return success(res, await service.getBoard())
  } catch (err) { next(err) }
}

async function convertToPO(req, res, next) {
  try {
    const { po } = await service.convertToPO(req.params.id, req.user.id)
    return created(res, po, `Purchase Order ${po.po_number} created`)
  } catch (err) { next(err) }
}

async function bulkUpload(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' })
    const dryRun = req.query.preview === 'true'
    const useAi  = req.query.ai === 'true'
    const fs = require('fs')
    let buffer = fs.readFileSync(req.file.path)
    fs.unlink(req.file.path, () => {})

    // AI mode: normalise any layout into the order importer's canonical columns.
    if (useAi) {
      const { aiNormaliseCsv } = require('../../utils/aiCsv')
      const normalised = await aiNormaliseCsv(buffer.toString('utf8'), 'order')
      buffer = Buffer.from(normalised, 'utf8')
    }

    const result = await service.bulkCreateOrdersFromCsv(buffer, { dryRun, createdBy: req.user.id })
    return success(res, { ...result, ai: useAi }, dryRun ? 'Preview ready' : 'Import complete')
  } catch (err) { next(err) }
}

async function orderCsvTemplate(_req, res) {
  const csv = service.getOrderCsvTemplate()
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="orders_template.csv"')
  res.send(csv)
}

// GET /export — full filtered result set as CSV with readable headers.
async function exportCsv(req, res, next) {
  try {
    const { status = '', order_type = '', customer_id = '', date_from = '', date_to = '', search = '' } = req.query
    const { rows } = await service.list({ page: 1, limit: 10000, status, order_type, customer_id, date_from, date_to, search })
    const columns = [
    ['Order No', 'order_number'], ['Order Date', 'order_date'], ['Entry Date', 'entry_date'],
    ['Due Date', 'due_date'], ['Status', 'status'], ['Order Type', 'order_type'],
    ['Customer Name', 'customer_name'], ['Contact Name', 'contact_name'],
    ['Contact Email', 'contact_email'], ['Contact Phone', 'contact_phone'],
    ['Shipping Name', 'shipping_name'], ['Shipping Address', 'shipping_address'],
    ['Supplier', 'supplier_name'], ['Source PO No', 'source_po_number'],
    ['Subtotal', 'subtotal'], ['Discount', 'discount_amt'], ['Tax', 'tax_amt'],
    ['Rush Services', 'rush_services'], ['Shipping Charges', 'shipping_charges'],
    ['Total', 'total'], ['Amount Paid', 'amount_paid'], ['Payment Status', 'payment_status'],
    ['Payment Method', 'payment_method'], ['Payment Terms', 'payment_terms'],
    ['Courier', 'courier'], ['Tracking No', 'tracking_number'],
    ['Agent', 'agent_name'], ['Notes', 'notes'],
    ]
    return sendCsv(res, 'sales-orders', columns, rows)
  } catch (err) { next(err) }
}

module.exports = { list, exportCsv, getOne, getBoard, create, update, updateStatus, getInvoice, remove, bulkRemove, convertToPO, bulkUpload, orderCsvTemplate }
