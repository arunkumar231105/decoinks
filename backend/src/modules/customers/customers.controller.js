const svc = require('./customers.service')

async function list(req, res, next) {
  try {
    const { page = 1, limit = 20, search = '', status = '' } = req.query
    const result = await svc.list({ page: +page, limit: +limit, search, status })
    res.json({ success: true, ...result })
  } catch (err) { next(err) }
}

async function getOne(req, res, next) {
  try {
    const customer = await svc.getById(req.params.id)
    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const customer = await svc.create({ ...req.body, created_by: req.user.id })
    res.status(201).json({ success: true, data: customer })
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const customer = await svc.update(req.params.id, req.body, req.user.id)
    res.json({ success: true, data: customer })
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id)
    res.json({ success: true })
  } catch (err) { next(err) }
}

module.exports = { list, getOne, create, update, remove }
