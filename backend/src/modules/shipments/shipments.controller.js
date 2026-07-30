const fs = require('fs')
const { parse } = require('csv-parse/sync')
const service = require('./shipments.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, status = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, status })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}
async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}
async function stats(req, res, next) {
  try { return success(res, await service.stats()) } catch (err) { next(err) }
}
async function create(req, res, next) {
  try {
    const s = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, s, 'Shipment created')
  } catch (err) { next(err) }
}
async function update(req, res, next) {
  try {
    return success(res, await service.update(req.params.id, req.body), 'Shipment updated')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    return success(res, await service.updateStatus(req.params.id, req.body.status), 'Status updated')
  } catch (err) { next(err) }
}

async function refreshTracking(req, res, next) {
  try {
    return success(res, await service.refreshTracking(req.params.id), 'Tracking refreshed')
  } catch (err) { next(err) }
}

// Live-fetch tracking from Shippo without saving (New Shipment form preview).
async function trackPreview(req, res, next) {
  try {
    const { carrier, tracking_number } = req.body
    return success(res, await service.previewTracking(carrier, tracking_number))
  } catch (err) { next(err) }
}

// Bulk import shipments from a Shippo "Shipping Fee" CSV export.
async function importCsv(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' })
    const text = fs.readFileSync(req.file.path, 'utf8')
    fs.unlink(req.file.path, () => {})
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
    const previewOnly = req.query.preview === 'true'
    const result = await service.importFromCsv(records, req.user.id, { previewOnly })
    return success(res, result, previewOnly ? 'Preview ready' : 'Import complete')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Shipment deleted')
  } catch (err) { next(err) }
}

async function getRates(req, res, next) {
  try {
    return success(res, await service.getRates(req.body))
  } catch (err) { next(err) }
}

async function buyLabel(req, res, next) {
  try {
    return created(res, await service.buyLabel({ ...req.body, created_by: req.user.id }), 'Label purchased')
  } catch (err) { next(err) }
}

async function voidLabel(req, res, next) {
  try {
    return success(res, await service.voidLabel(req.params.id), 'Label void requested')
  } catch (err) { next(err) }
}

module.exports = { list, getOne, stats, create, update, updateStatus, refreshTracking, trackPreview, importCsv, getRates, buyLabel, voidLabel, remove }
