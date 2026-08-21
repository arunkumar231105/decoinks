const service = require('./invoices.service')
const { sendCsv } = require('../../utils/csvExport')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', customer_id = '', search = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, customer_id, search })
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
    return created(res, inv, inv?._action === 'updated' ? 'Invoice updated' : 'Invoice created')
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

async function bulkRemove(req, res, next) {
  try {
    const ids = req.body.ids || []
    let deleted = 0; const errors = []
    for (const id of ids) {
      try { await service.remove(id, req.user.id); deleted++ }
      catch (e) { errors.push({ id, message: e.message }) }
    }
    return success(res, { deleted, errors }, `${deleted} invoice(s) deleted`)
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

// GET /export — full filtered result set as CSV with readable headers.
async function exportCsv(req, res, next) {
  try {
    const { status = '', customer_id = '', search = '' } = req.query
    const { rows } = await service.list({ page: 1, limit: 10000, status, customer_id, search })
    const columns = [
    ['Invoice No', 'invoice_number'], ['Issue Date', 'issue_date'], ['Entry Date', 'export_entry_date'], ['Due Date', 'export_due_date'],
    ['Status', 'export_status'], ['Customer Name', 'customer_display_name'], ['Email', 'billing_email'],
    ['Contact Number', 'contact_number'], ['Order No', 'order_number'], ['Quote No', 'quote_number'],
    ['Billing Address', 'billing_address'], ['Shipping Address', 'shipping_address'],
    ['Subtotal', 'subtotal'], ['Discount', 'discount_amt'], ['Tax', 'tax_amt'],
    ['Shipping Charges', 'shipping_charges'], ['Total Qty', 'export_total_qty'], ['Total', 'total'],
    ['Amount Paid', 'export_amount_paid'], ['Balance Due', 'export_balance_due'], ['Currency', 'currency'],
    ['Payment Terms', 'payment_terms'], ['Payment Method', 'payment_method'],
    ['Sales Agent', 'sales_agent_display_name'], ['Notes', 'notes'],
    ]
    return sendCsv(res, 'invoices', columns, rows)
  } catch (err) { next(err) }
}

module.exports = { list, exportCsv, getOne, create, update, updateStatus, recordPayment, remove, bulkRemove, convertToOrder }
