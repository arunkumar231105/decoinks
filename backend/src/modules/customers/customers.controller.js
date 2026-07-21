const svc = require('./customers.service')
const { success, created, paginated } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const { rows, total } = await svc.list({ ...req.query, page: +page, limit: +limit })
    return paginated(res, rows, total, +page, +limit)
  } catch (err) { next(err) }
}

async function stats(req, res, next) {
  try { return success(res, await svc.getStats()) } catch (err) { next(err) }
}

async function filters(req, res, next) {
  try { return success(res, await svc.getFilterOptions()) } catch (err) { next(err) }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

async function exportCsv(req, res, next) {
  try {
    const { rows } = await svc.list({ ...req.query, page: 1, limit: 10000 })
    const columns = [
      ['Customer No', 'customer_number'], ['Customer', 'display_name'], ['Contact Person', 'contact_person'],
      ['Job Title', 'job_title'], ['Email', 'email'], ['Phone', 'primary_phone'], ['WhatsApp', 'whatsapp'],
      ['Type', 'customer_type'], ['Segment', 'segment'], ['Status', 'status'],
      ['City', 'city'], ['State', 'state'], ['Country', 'country'],
      ['Payment Terms', 'payment_terms'], ['Assigned Agent', 'agent_name'],
      ['Total Orders', 'total_orders'], ['Total Spent', 'total_spent'],
      ['Outstanding Balance', 'outstanding_balance'], ['Overdue Balance', 'overdue_balance'],
      ['Last Order Date', 'last_order_date'], ['Last Order No', 'last_order_number'],
      ['Customer Since', 'created_at'],
    ]
    const csv = [
      columns.map(([label]) => csvCell(label)).join(','),
      ...rows.map(row => columns.map(([, key]) => csvCell(row[key])).join(',')),
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`)
    return res.send(csv)
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const customer = await svc.getById(req.params.id)
    return success(res, customer)
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const customer = await svc.create({ ...req.body, created_by: req.user.id })
    return created(res, customer, 'Customer created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const customer = await svc.update(req.params.id, req.body, req.user.id)
    return success(res, customer, 'Customer updated')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id)
    return success(res, null, 'Customer deleted')
  } catch (err) { next(err) }
}

module.exports = { list, stats, filters, exportCsv, getOne, create, update, remove }
