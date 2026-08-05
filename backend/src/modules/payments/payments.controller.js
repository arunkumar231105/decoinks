const service = require('./payments.service')
const { sendCsv } = require('../../utils/csvExport')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10 } = req.query
    const { rows, total } = await service.list({ ...req.query, page: +page, limit: +limit })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function stats(req, res, next) {
  try { return success(res, await service.getStats(req.query)) } catch (err) { next(err) }
}

async function filters(_req, res, next) {
  try { return success(res, await service.getFilterOptions()) } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const payment = await service.create({ ...req.body, recorded_by: req.user?.id })
    return created(res, payment)
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try { return success(res, await service.update(req.params.id, req.body)) } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try { return success(res, await service.remove(req.params.id)) } catch (err) { next(err) }
}

// GET /export — full filtered result set as CSV with readable headers.
async function exportCsv(req, res, next) {
  try {
    const { rows } = await service.list({ ...req.query, page: 1, limit: 10000 })
    const columns = [
      ['Payment ID', 'payment_number'], ['Payment Date', 'payment_date'],
      ['Customer Name', 'customer_name'], ['Received From', 'received_from_name'],
      ['Amount', 'amount'],
      ['Processor Fee', 'fee_amount'], ['Net Received', 'net_amount'],
      ['Allocated To (orders)', 'allocated_count'], ['Allocated Amount', 'allocated_total'],
      ['Payment Method', 'payment_method'], ['Status', 'status'],
      ['Received Into Account', 'received_into_account'],
      ['Sender Bank', 'sender_bank_name'], ['Sender Account Name', 'sender_account_name'],
      ['Sender Acct Last4', 'sender_account_last4'], ['Sender Reference', 'sender_reference'],
      ['Reference No', 'reference_no'], ['Order No', 'order_number'],
      ['Invoice No', 'invoice_number'], ['Recorded By', 'recorded_by_name'],
      ['Notes', 'notes'], ['Created At', 'created_at'],
    ]
    return sendCsv(res, 'payments', columns, rows)
  } catch (err) { next(err) }
}

module.exports = { list, stats, filters, getOne, create, update, remove, exportCsv }
