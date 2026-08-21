const service = require('./quotations.service')
const { sendCsv } = require('../../utils/csvExport')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', customer_id = '', supplier_id = '', search = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, supplier_id: supplier_id || customer_id, search })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const q = await service.getById(req.params.id)
    return success(res, q)
  } catch (err) { next(err) }
}

async function getRevisions(req, res, next) {
  try {
    const rows = await service.getRevisions(req.params.id)
    return success(res, rows)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const q = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, q, 'Quotation created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const q = await service.update(req.params.id, req.body, req.user.id)
    return success(res, q, 'Quotation updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    const q = await service.updateStatus(req.params.id, req.body.status, req.user)
    return success(res, q, 'Status updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Quotation deleted')
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
    return success(res, { deleted, errors }, `${deleted} quotation(s) deleted`)
  } catch (err) { next(err) }
}

async function convertToInvoice(req, res, next) {
  try {
    const { invoice, alreadyExisted } = await service.convertToInvoice(req.params.id, req.user.id)
    const message = alreadyExisted
      ? `Invoice ${invoice.invoice_number} already exists for this quote`
      : `Invoice ${invoice.invoice_number} created`
    return alreadyExisted
      ? success(res, invoice, message)
      : created(res, invoice, message)
  } catch (err) { next(err) }
}

async function bulkUpload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CSV file uploaded' })
    }
    const dryRun = req.query.preview === 'true'
    const useAi  = req.query.ai === 'true'
    const fs = require('fs')
    let buffer = fs.readFileSync(req.file.path)
    // Clean up temp file
    fs.unlink(req.file.path, () => {})

    // AI mode: let Grok normalise any layout into our canonical columns first,
    // then the same deterministic parser/validator/preview handles the rest.
    if (useAi) {
      const { aiNormaliseCsv } = require('../../utils/aiCsv')
      const normalised = await aiNormaliseCsv(buffer.toString('utf8'), 'quote')
      buffer = Buffer.from(normalised, 'utf8')
    }

    const result = await service.bulkParseAndProcess(buffer, {
      dryRun,
      createdBy: req.user.id,
    })
    return success(res, { ...result, ai: useAi }, dryRun ? 'Preview ready' : `Import complete`)
  } catch (err) { next(err) }
}

async function csvTemplate(_req, res) {
  const csv = service.getCsvTemplate()
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="quotations_template.csv"')
  res.send(csv)
}

// GET /export — full filtered result set as CSV with readable headers.
async function exportCsv(req, res, next) {
  try {
    const { status = '', customer_id = '', supplier_id = '', search = '' } = req.query
    const { rows } = await service.list({ page: 1, limit: 10000, status, supplier_id: supplier_id || customer_id, search })
    const columns = [
    ['Quotation No', 'quote_number'], ['Revision', 'revision'], ['Quote Date', 'export_quote_date'],
    ['Entry Date', 'entry_date'], ['Valid Until', 'export_valid_until'], ['Status', 'export_status'],
    ['Customer Name', 'customer_name'], ['Company', 'company_name'], ['Supplier', 'supplier_name'],
    ['Email', 'billing_email'], ['Contact Number', 'contact_number'],
    ['Shipping Address', 'shipping_address'], ['Billing Address', 'billing_address'],
    ['Total Qty', 'total_qty'], ['Subtotal', 'subtotal'], ['Discount', 'discount_amt'],
    ['Tax', 'tax_amt'], ['Total', 'total'], ['Currency', 'currency'],
    ['Payment Terms', 'payment_terms'], ['Sales Agent', 'created_by_name'], ['Notes', 'notes'],
    ]
    return sendCsv(res, 'quotations', columns, rows)
  } catch (err) { next(err) }
}

module.exports = { list, exportCsv, getOne, getRevisions, create, update, updateStatus, remove, bulkRemove, convertToInvoice, bulkUpload, csvTemplate }
