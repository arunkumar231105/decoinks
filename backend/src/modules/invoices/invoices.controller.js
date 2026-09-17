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

// The payment picked on the invoice form is attached by the save itself, so it
// is attached whichever button saved (Save, Preview, Receipt, Send) — it used to
// be a second request made only by some of them. The same attach as the ledger
// uses: same customer, not on another invoice, no more than is owed; the invoice
// status then follows the ledger. If it is refused the invoice is still saved
// and the reason comes back as payment_error for the form to show.
const MAY_ATTACH = ['Admin', 'Manager', 'Sales']   // as POST /payment-links/apply

async function attachPicked(paymentId, invoice, user) {
  if (!paymentId || !invoice?.id) return invoice
  if (!MAY_ATTACH.includes(user?.role)) return { ...invoice, payment_error: 'Your role cannot attach payments to invoices.' }
  const { query } = require('../../config/db')
  const { rows } = await query(`SELECT invoice_id FROM payments WHERE id = $1`, [paymentId])
  if (rows[0]?.invoice_id === invoice.id) return invoice
  try {
    await require('../stripe/stripe.recorder').attachPaymentToInvoice(paymentId, invoice.id)
    return { ...(await service.getById(invoice.id)), _action: invoice._action, payment_attached: true }
  } catch (err) {
    return { ...invoice, payment_error: err.message }
  }
}

// Several payments picked together (Multiple Payments) are linked the same way,
// with their total checked against the invoice's.
async function attachAll(paymentIds, invoice, user) {
  if (!paymentIds?.length || !invoice?.id) return invoice
  if (!MAY_ATTACH.includes(user?.role)) return { ...invoice, payment_error: 'Your role cannot attach payments to invoices.' }
  try {
    const linked = await require('./invoice.payments').linkPayments(invoice.id, paymentIds, user.id)
    return { ...(await service.getById(invoice.id)), _action: invoice._action, payments_linked: linked.linked }
  } catch (err) {
    return { ...invoice, payment_error: err.message }
  }
}

const attachFromBody = (paymentId, paymentIds, invoice, user) => (paymentIds?.length
  ? attachAll([...new Set([...paymentIds, paymentId].filter(Boolean))], invoice, user)
  : attachPicked(paymentId, invoice, user))

async function create(req, res, next) {
  try {
    const { payment_id, payment_ids, ...body } = req.body
    const inv = await attachFromBody(payment_id, payment_ids, await service.create({ ...body, created_by: req.user.id }), req.user)
    return created(res, inv, inv?._action === 'updated' ? 'Invoice updated' : 'Invoice created')
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const { payment_id, payment_ids, ...body } = req.body
    // Attaching payments on their own is a save too, with nothing else to write.
    const invoice = Object.keys(body).length || !(payment_id || payment_ids?.length)
      ? await service.update(req.params.id, body)
      : await service.getById(req.params.id)
    return success(res, await attachFromBody(payment_id, payment_ids, invoice, req.user), 'Invoice updated')
  } catch (err) { next(err) }
}

async function linkPayments(req, res, next) {
  try {
    const result = await require('./invoice.payments').linkPayments(req.params.id, req.body.payment_ids, req.user.id)
    return success(res, result, `${result.linked.length} payment${result.linked.length === 1 ? '' : 's'} linked`)
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

module.exports = { list, exportCsv, getOne, create, update, updateStatus, recordPayment, remove, bulkRemove, convertToOrder, linkPayments }
