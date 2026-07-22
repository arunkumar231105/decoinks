const service = require('./artworks.service')
const vault = require('./artwork-vault.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10, search = '', status = '', supplier_id = '' } = req.query
    const { rows, total } = await service.list({ page: +page, limit: +limit, search, status, supplier_id })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}
async function getOne(req, res, next) {
  try { return success(res, await service.getById(req.params.id)) } catch (err) { next(err) }
}
async function create(req, res, next) {
  try {
    const artwork = await service.create({ ...req.body, uploaded_by: req.user.id, file: req.file })
    return created(res, artwork, 'Artwork uploaded')
  } catch (err) { next(err) }
}
async function updateStatus(req, res, next) {
  try {
    return success(res, await service.updateStatus(req.params.id, req.body.status), 'Status updated')
  } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try { await service.remove(req.params.id); return success(res, null, 'Artwork deleted') } catch (err) { next(err) }
}
async function getBoard(req, res, next) {
  try { return success(res, await service.getBoard()) } catch (err) { next(err) }
}
async function createTask(req, res, next) {
  try {
    const task = await service.createTask({ ...req.body, uploaded_by: req.user.id })
    return created(res, task, 'Design task created')
  } catch (err) { next(err) }
}
async function vaultList(req, res, next) {
  try { const result = await vault.list(req.query); return paginated(res, result.rows, result.total, result.page, result.limit) }
  catch (err) { next(err) }
}
async function vaultStats(req, res, next) {
  try { return success(res, await vault.stats(req.query)) } catch (err) { next(err) }
}
async function vaultDetail(req, res, next) {
  try { return success(res, await vault.detail(req.params.id)) } catch (err) { next(err) }
}
async function vaultSync(req, res, next) {
  try { return success(res, await vault.sync({ force: true }), 'Artwork Vault synchronized') } catch (err) { next(err) }
}
async function vaultSetCover(req, res, next) {
  try { return success(res, await vault.setCover(req.params.id), 'Cover updated') } catch (err) { next(err) }
}
async function vaultBulkUpdate(req, res, next) {
  try { return success(res, await vault.bulkUpdate(req.body.ids, req.body), 'Artwork assets updated') } catch (err) { next(err) }
}
function csvCell(value) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
async function vaultExport(req, res, next) {
  try {
    const result = await vault.list({ ...req.query, page: 1, limit: 10000, export: true })
    const headers = ['Date Created','Lead / Customer','Artwork ID','Lifecycle','Lead ID','Order Type','Type','File Name','Sender','Sales Agent','Designer','Status','Version','QA Approved','Production Ready']
    const lines = [headers, ...result.rows.map(a => [a.source_modified_at || a.created_at,a.entity_name,a.artwork_code ? `${a.artwork_code}-${a.lifecycle_code}` : `ART-${String(a.asset_number).padStart(6,'0')}`,a.lifecycle_code,a.lead_number,a.order_type,a.asset_type,a.file_name,a.sender_name,a.sales_agent_name,a.designer_name,a.status,`V${a.version_no}`,a.qa_approved ? 'Yes' : 'No',a.production_ready ? 'Yes' : 'No'])]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="artwork-vault-${new Date().toISOString().slice(0,10)}.csv"`)
    return res.send('\ufeff' + lines.map(row => row.map(csvCell).join(',')).join('\n'))
  } catch (err) { next(err) }
}
module.exports = { list, getOne, getBoard, create, createTask, updateStatus, remove, vaultList, vaultStats, vaultDetail, vaultSync, vaultSetCover, vaultBulkUpdate, vaultExport }
