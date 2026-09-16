const svc = require('./portal.fulfillment')

// Errors carry their own status (404 not shared, 409 duplicate, 422 invalid);
// anything else is a server fault.
const send = (res, e) => {
  const code = [400, 403, 404, 409, 422].includes(e.status) ? e.status : 500
  if (code === 500) console.error('[portal fulfillment]', e)
  res.status(code).json({ error: code === 500 ? 'Something went wrong' : e.message })
}

exports.getOrderGrid = async (req, res) => {
  try { res.json(await svc.getOrderGrid(req.supplier.supplierId, req.query)) } catch (e) { send(res, e) }
}

exports.getProducts = async (req, res) => {
  try { res.json({ products: await svc.getProducts(req.supplier.supplierId) }) } catch (e) { send(res, e) }
}

exports.getOrderRow = async (req, res) => {
  try {
    const row = await svc.getOrderRow(req.supplier.supplierId, req.params.id)
    if (!row) return res.status(404).json({ error: 'Purchase order not found or not shared with you' })
    res.json({ row })
  } catch (e) { send(res, e) }
}

exports.updateOrderStage = async (req, res) => {
  try { res.json({ success: true, row: await svc.updateOrderStage(req.supplier.supplierId, req.params.id, req.body || {}) }) } catch (e) { send(res, e) }
}

exports.listFactories = async (req, res) => {
  try { res.json({ factories: await svc.listFactories(req.supplier.supplierId) }) } catch (e) { send(res, e) }
}

exports.createFactory = async (req, res) => {
  try { res.status(201).json({ factory: await svc.createFactory(req.supplier.supplierId, req.body || {}) }) } catch (e) { send(res, e) }
}

exports.updateFactory = async (req, res) => {
  try { res.json({ factory: await svc.updateFactory(req.supplier.supplierId, req.params.id, req.body || {}) }) } catch (e) { send(res, e) }
}
