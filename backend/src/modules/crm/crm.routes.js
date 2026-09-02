/**
 * The CRM's door into Printshop.
 *
 * Agents live in the CRM inbox all day. Asking them to leave the chat, open
 * Printshop and re-type a customer and a quotation loses the thread and gets
 * things typed twice, so the CRM shows Printshop's own forms inside the lead
 * panel and posts the result here.
 *
 * Printshop stays the system of record. These routes do not hold a second copy
 * of the rules: each one calls the very same service the Printshop screens call,
 * so numbering, revisions, totals, duplicate checks and pipeline events are
 * whatever Printshop does today and stay that way when Printshop changes.
 *
 * Reachable only with the service secret (see middleware/serviceAuth), and only
 * these few things are reachable through it.
 */

const { Router } = require('express')
const { serviceAuth } = require('../../middleware/serviceAuth')
const db = require('../../config/db')
const { validate } = require('../../middleware/validate')
const customersSvc = require('../customers/customers.service')
const quotationsSvc = require('../quotations/quotations.service')
const invoicesSvc = require('../invoices/invoices.service')
// The very schemas the Printshop screens post through, so a payload arriving
// from the CRM is checked exactly as one typed into Printshop would be.
const { createSchema: customerCreateSchema } = require('../customers/customers.routes')
const { createSchema: quotationCreateSchema } = require('../quotations/quotations.routes')
const { createSchema: invoiceCreateSchema } = require('../invoices/invoices.routes')

// `agent_email` is ours, not Printshop's — the schemas would strip it, and the
// route needs it to decide who the record belongs to, so it is read before
// validation runs and removed from what the schema sees.
const withoutAgent = (schema) => (req, res, next) => {
  req.agentEmail = req.body?.agent_email || ''
  if (req.body) delete req.body.agent_email
  return validate(schema)(req, res, next)
}

const router = Router()
router.use(serviceAuth)

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

/**
 * Who to record as the author.
 *
 * A CRM agent and a Printshop user are two accounts; the only thing they share
 * is an email address, so that is what we match on. The quote's printed "Sales
 * Agent" is its created_by, so an unmatched agent would otherwise print as
 * nobody. Falling back to the CRM's own Printshop account (CRM_ACTOR_EMAIL,
 * info@technocas.com by default) says truthfully that the CRM made this record,
 * rather than attributing it to whoever happens to be first in the user table.
 */
async function resolveActor(email) {
  const tried = [String(email || '').trim(), (process.env.CRM_ACTOR_EMAIL || 'info@technocas.com').trim()]
  for (const candidate of tried) {
    if (!candidate) continue
    const { rows } = await db.query(
      `SELECT id, name, email, role FROM users WHERE lower(email) = lower($1) AND is_active LIMIT 1`,
      [candidate]
    )
    if (rows[0]) return rows[0]
  }
  return null   // created_by is nullable; a quote is still worth more than no quote
}

/* ── Customers ───────────────────────────────────────────────────────────── */

/** The customer picker on the CRM's quote form. */
router.get('/customers', wrap(async (req, res) => {
  const q = String(req.query.search || '').trim()
  const { rows } = await db.query(
    `SELECT id, name, customer_number, company_name, email, phone, mobile_number
       FROM customers
      WHERE deleted_at IS NULL
        AND ($1 = '' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%'
             OR customer_number ILIKE '%'||$1||'%' OR company_name ILIKE '%'||$1||'%'
             OR phone ILIKE '%'||$1||'%' OR mobile_number ILIKE '%'||$1||'%')
      ORDER BY (name ILIKE $1||'%') DESC, name
      LIMIT 25`, [q])
  res.json({ data: rows })
}))

/**
 * One customer in full — addresses and contacts included.
 *
 * The quote form fills City/State/ZIP/Country from the default shipping address
 * in this array, not from flat columns, which is why the list route above is not
 * enough to auto-populate a quote.
 */
router.get('/customers/:id', wrap(async (req, res) => {
  res.json({ data: await customersSvc.getById(req.params.id) })
}))

/** Lead becomes a customer. Same call the Printshop New Customer screen makes. */
router.post('/customers', withoutAgent(customerCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const payload = req.body
  const customer = await customersSvc.create({
    ...payload,
    source: payload.source || 'Technocas CRM',
    created_by: actor?.id ?? null,
  })
  res.status(201).json({ data: customer })
}))

/* ── Quotations ──────────────────────────────────────────────────────────── */

/** Create the quotation the agent filled in inside the chat. */
router.post('/quotations', withoutAgent(quotationCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const quote = await quotationsSvc.create({ ...req.body, created_by: actor?.id ?? null })
  res.status(201).json({ data: { ...quote, created_by_name: actor?.name ?? null } })
}))

/**
 * Every quotation this customer has.
 *
 * One customer places more than one order, so the CRM lists their quotations and
 * starts a new one beside them rather than treating a conversation as having a
 * single quote. Ordered newest first, which is the one an agent means.
 */
router.get('/quotations', wrap(async (req, res) => {
  const customerId = String(req.query.customer_id || '').trim()
  if (!customerId) return res.json({ data: [] })
  const { rows } = await db.query(
    `SELECT q.id, q.quote_number, q.status, q.order_type, q.total, q.currency,
            q.revision_number, q.created_at, q.valid_until,
            u.name AS created_by_name,
            (SELECT i.id FROM invoices i WHERE i.quote_id = q.id ORDER BY i.created_at LIMIT 1) AS invoice_id,
            (SELECT i.invoice_number FROM invoices i WHERE i.quote_id = q.id ORDER BY i.created_at LIMIT 1) AS invoice_number
       FROM quotations q
       LEFT JOIN users u ON u.id = q.created_by
      WHERE q.customer_id = $1 AND q.deleted_at IS NULL
      ORDER BY q.created_at DESC
      LIMIT 50`, [customerId])
  res.json({ data: rows })
}))

/** Read a saved quotation back — this is what the CRM's preview renders. */
router.get('/quotations/:id', wrap(async (req, res) => {
  const quote = await quotationsSvc.getById(req.params.id)
  const { rows } = await db.query(
    `SELECT u.name FROM users u WHERE u.id = $1`, [quote.created_by]
  )
  res.json({ data: { ...quote, created_by_name: rows[0]?.name ?? null } })
}))

/**
 * Mark it Sent, once the agent has actually sent it to the customer's chat.
 *
 * Status changes go through updateStatus rather than an UPDATE of our own,
 * because that is where the quote's own rules live — the pipeline event, the
 * sent_at stamp, and on approval the invoice.
 */
router.patch('/quotations/:id/status', wrap(async (req, res) => {
  // The full user, not just an id: updateStatus reads its role to decide whether
  // this transition is allowed. An unattributed status change would skip that
  // check, so refuse rather than quietly bypass a permission.
  const actor = await resolveActor(req.body.agent_email)
  if (!actor) return res.status(503).json({ error: 'No Printshop user to attribute this change to.' })
  const quote = await quotationsSvc.updateStatus(req.params.id, req.body.status, actor)
  res.json({ data: quote })
}))

/* ── Invoices ────────────────────────────────────────────────────────────── */

/**
 * The quotation becomes an invoice.
 *
 * Straight into Printshop's invoice service, which is what guarantees at most
 * ONE invoice per quotation: it takes a per-quote advisory lock, creates the
 * invoice if there is none, refreshes an untouched draft if there is, and
 * refuses with a 409 naming the invoice once money has been taken or an order
 * raised against it. None of that is re-decided here.
 */
router.post('/invoices', withoutAgent(invoiceCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const invoice = await invoicesSvc.create({ ...req.body, created_by: actor?.id ?? null })
  res.status(201).json({ data: invoice })
}))

/** Read one back — both invoice previews, short and long, render from this. */
router.get('/invoices/:id', wrap(async (req, res) => {
  res.json({ data: await invoicesSvc.getById(req.params.id) })
}))

/** Every invoice this customer has. */
router.get('/invoices', wrap(async (req, res) => {
  const customerId = String(req.query.customer_id || '').trim()
  if (!customerId) return res.json({ data: [] })
  const { rows } = await db.query(
    `SELECT i.id, i.invoice_number, i.status, i.order_type,
            i.total, i.amount_paid, i.balance_due, i.currency, i.issue_date,
            i.due_date, i.created_at, i.quote_id, q.quote_number
       FROM invoices i
       LEFT JOIN quotations q ON q.id = i.quote_id
      WHERE COALESCE(i.customer_id, q.customer_id) = $1 AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 50`, [customerId])
  res.json({ data: rows })
}))

/** Sent, once it has actually gone into the customer's chat. */
router.patch('/invoices/:id/status', wrap(async (req, res) => {
  const actor = await resolveActor(req.body.agent_email)
  if (!actor) return res.status(503).json({ error: 'No Printshop user to attribute this change to.' })
  const invoice = await invoicesSvc.updateStatus(req.params.id, req.body.status, actor)
  res.json({ data: invoice })
}))

module.exports = router
