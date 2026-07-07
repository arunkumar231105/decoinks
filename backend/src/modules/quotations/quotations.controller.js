const service = require('./quotations.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '', customer_id = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status, customer_id })
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

module.exports = { list, getOne, getRevisions, create, update, updateStatus, remove, convertToInvoice, bulkUpload, csvTemplate }
