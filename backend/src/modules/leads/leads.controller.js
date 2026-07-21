const service = require('./leads.service')
const { success, created, paginated } = require('../../utils/response')

async function getKanban(req, res, next) {
  try {
    const data = await service.getKanban()
    return success(res, data)
  } catch (err) { next(err) }
}

async function list(req, res, next) {
  try {
    const { page = 1, limit = 10 } = req.query
    const { rows, total } = await service.list({ ...req.query, page: +page, limit: +limit })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function stats(req, res, next) {
  try { return success(res, await service.getStats()) } catch (err) { next(err) }
}

async function filters(req, res, next) {
  try { return success(res, await service.getFilterOptions()) } catch (err) { next(err) }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

async function exportCsv(req, res, next) {
  try {
    const { rows } = await service.list({ ...req.query, page: 1, limit: 10000 })
    const columns = [
      ['Lead No', 'display_number'], ['Source ID', 'lead_number'], ['Created', 'created_at'],
      ['Customer', 'display_name'], ['Company', 'company_name'], ['Email', 'email'], ['Phone', 'phone'],
      ['Source', 'source'], ['Stage', 'stage'], ['Status', 'status'], ['Qualification Score', 'conversion_score'],
      ['Temperature', 'urgency'], ['Purchase Intent', 'customer_intent'], ['Product Interest', 'product_interest_display'],
      ['Estimated Value', 'estimated_value'], ['Assigned Agent', 'agent_name'], ['Last Activity', 'last_activity_at'],
      ['Next Action', 'next_action_display'], ['Next Action At', 'next_action_at'],
    ]
    const csv = [
      columns.map(([label]) => csvCell(label)).join(','),
      ...rows.map(row => columns.map(([, key]) => csvCell(row[key])).join(',')),
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
    return res.send(csv)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const lead = await service.getById(req.params.id)
    return success(res, lead)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const lead = await service.create({ ...req.body, created_by: req.user.id })
    return created(res, lead, 'Lead created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const lead = await service.update(req.params.id, req.body, req.user.id)
    return success(res, lead, 'Lead updated')
  } catch (err) { next(err) }
}

async function move(req, res, next) {
  try {
    const lead = await service.move(req.params.id, { ...req.body, user_id: req.user.id })
    return success(res, lead, 'Lead moved')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id)
    return success(res, null, 'Lead deleted')
  } catch (err) { next(err) }
}

async function getComments(req, res, next) {
  try {
    const comments = await service.getComments(req.params.id)
    return success(res, comments)
  } catch (err) { next(err) }
}

async function addComment(req, res, next) {
  try {
    const comment = await service.addComment(req.params.id, req.user.id, req.body.body)
    return created(res, comment, 'Comment added')
  } catch (err) { next(err) }
}

async function deleteComment(req, res, next) {
  try {
    await service.deleteComment(req.params.id, req.params.cid)
    return success(res, null, 'Comment deleted')
  } catch (err) { next(err) }
}

async function addAttachment(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' })
    const attachment = await service.addAttachment(req.params.id, req.user.id, {
      filename: req.file.originalname,
      storage_path: req.file.path,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
    })
    return created(res, attachment, 'Attachment uploaded')
  } catch (err) { next(err) }
}

async function deleteAttachment(req, res, next) {
  try {
    const att = await service.deleteAttachment(req.params.id, req.params.aid)
    // optionally remove physical file here
    return success(res, null, 'Attachment deleted')
  } catch (err) { next(err) }
}

async function updateStatus(req, res, next) {
  try {
    const lead = await service.updateStatus(req.params.id, req.body.status, req.user)
    return success(res, lead, 'Status updated')
  } catch (err) { next(err) }
}

async function convertToQuote(req, res, next) {
  try {
    const quotation = await service.convertToQuote(req.params.id, req.user.id)
    return created(res, quotation, 'Lead converted to quotation')
  } catch (err) { next(err) }
}

module.exports = { getKanban, list, stats, filters, exportCsv, getOne, create, update, updateStatus, convertToQuote, move, remove, getComments, addComment, deleteComment, addAttachment, deleteAttachment }
