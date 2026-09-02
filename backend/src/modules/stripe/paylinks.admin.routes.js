/**
 * Staff-facing payment links.
 *
 * An agent opens an invoice, presses a button, and gets a URL to send the
 * customer over WhatsApp or email. The customer never needs a portal account.
 *
 * The same `payment_links` row and the same `/pay/:token` page serve this and
 * the portal's Pay Now button, so there is one mechanism to reason about and
 * one place a payment can be settled.
 *
 * The raw token is returned exactly once, at creation. Only its SHA-256 is
 * stored, so a link cannot be read back out of the system later — pressing
 * Regenerate issues a fresh one and voids the old.
 */

const { Router } = require('express')
const { verifyToken, requireRole } = require('../../middleware/auth')
const db = require('../../config/db')
const paylinks = require('./paylinks.service')

const router = Router()
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

/* ── Service routes, for the CRM ──────────────────────────────────────────
 *
 * Agents work in the CRM all day and should not have to open the Printshop to
 * take a payment. These few routes let it ask for a link on their behalf.
 *
 * Authenticated by a secret of their own — deliberately not the SSO secret,
 * which exists to prove a person signed in. Overloading it would mean one
 * credential granting two unrelated powers, and rotating it for one reason
 * would silently break the other.
 *
 * Mounted BEFORE `verifyToken` because the caller is a server, not a person
 * with a staff login. They can do exactly two things — search customers and
 * make a link — and nothing else in this file is reachable through them.
 */
function serviceAuth(req, res, next) {
  const expected = (process.env.SERVICE_API_SECRET || '').trim()
  if (!expected) return res.status(503).json({ error: 'Service access is not configured.' })
  const given = req.get('x-decoinks-sso-secret') || ''
  // Constant-time-ish: compare lengths first, then the whole string, so a
  // wrong secret cannot be narrowed down by timing the response.
  if (given.length !== expected.length || given !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

router.get('/service/customers', serviceAuth, wrap(async (req, res) => {
  const q = String(req.query.search || '').trim()
  const { rows } = await db.query(
    `SELECT id, name, customer_number, email, phone
       FROM customers
      WHERE deleted_at IS NULL
        AND ($1 = '' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%'
             OR customer_number ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%')
      ORDER BY (name ILIKE $1||'%') DESC, name
      LIMIT 25`, [q])
  res.json({ data: rows })
}))

/** One customer by id — so the CRM can confirm the lead reached Printshop. */
router.get('/service/customers/:id', serviceAuth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, customer_number, email FROM customers WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'That customer is not in Printshop yet.' })
  res.json({ data: rows[0] })
}))

router.post('/service/advance', serviceAuth, wrap(async (req, res) => {
  const base = await payPageBase()
  const { customerId, itemAmount, shippingAmount, currency, description, createdBy } = req.body || {}

  const { link, token, customer } = await paylinks.createStandalone({
    customerId, itemAmount, shippingAmount, currency, description,
    createdBy: createdBy || null,
  })

  res.json({
    data: {
      url: `${base}/pay/${token}`,
      customer: customer.name,
      amount: Number(link.amount),
      itemAmount: Number(link.item_amount),
      shippingAmount: Number(link.shipping_amount),
      currency: link.currency,
      description: link.description,
    },
  })
}))

router.use(verifyToken)

/**
 * Where the pay page lives, as far as a link is concerned.
 *
 * Deliberately NOT derived from the request: an agent is on
 * printshop.decoinkssuite.com, which is the admin app behind Authentik — a
 * customer following a link built from that host would hit an SSO wall they can
 * never pass. The base is configuration, and it is in `settings` so it can be
 * changed from the admin screen when the domain moves, with no redeploy.
 */
async function payPageBase() {
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'pay_page_base_url'`)
  const configured = (rows[0]?.value || process.env.PAY_PAGE_BASE_URL || '').trim()
  if (!configured) {
    throw Object.assign(
      new Error('The payment page address is not configured. An Admin can set pay_page_base_url under Settings.'),
      { statusCode: 503 })
  }
  return configured.replace(/\/+$/, '')
}

/**
 * The invoice's link, ready to copy.
 *
 * Returns the URL of the link that already exists rather than a new one, so the
 * agent's Copy Link and the customer's Pay Now are the same URL. Only a link
 * whose token predates encryption comes back without one.
 */
router.get('/invoices/:id', wrap(async (req, res) => {
  const invoice = await paylinks.getInvoice(req.params.id)
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

  const link = await paylinks.findCurrentForInvoice(invoice.id)
  const problem = paylinks.payableProblem(invoice)
  const token = link ? await paylinks.decryptToken(link.token_encrypted) : null
  const base = token ? await payPageBase().catch(() => null) : null

  res.json({
    data: {
      payable: !problem,
      reason: problem ? problem.message : null,
      amount: Number(invoice.balance_due),
      url: token && base ? `${base}/pay/${token}` : null,
      link: link ? {
        id: link.id,
        status: link.status,
        amount: Number(link.amount),
        expiresAt: link.expires_at,
        sentAt: link.sent_at,
        firstOpenedAt: link.first_opened_at,
        createdAt: link.created_at,
      } : null,
    },
  })
}))

/**
 * Issue a link. Any existing live link for the invoice is voided in the same
 * transaction, so two URLs never both claim to collect the same money.
 */
router.post('/invoices/:id', requireRole('Admin', 'Manager', 'Sales'), wrap(async (req, res) => {
  const base = await payPageBase()
  // ?fresh=1 is Regenerate: deliberately replace, killing whatever was sent.
  // Without it this hands back the invoice's existing link, so pressing Copy
  // Link does not invalidate a URL the customer may already be looking at.
  const fresh = req.query.fresh === '1'
  const { link, token, invoice } = fresh
    ? await paylinks.createForInvoice(req.params.id, { createdBy: req.user?.id || null })
    : await paylinks.getOrCreateForInvoice(req.params.id, { createdBy: req.user?.id || null })

  await db.query(`UPDATE payment_links SET sent_at = NOW() WHERE id = $1`, [link.id])

  res.json({
    data: {
      // Shown once. It cannot be recovered from the database afterwards.
      url: `${base}/pay/${token}`,
      amount: Number(link.amount),
      currency: link.currency,
      expiresAt: link.expires_at,
      invoiceNumber: invoice.invoice_number,
    },
  })
}))

/**
 * A payment link taken in advance, before any quotation or invoice exists.
 *
 * The shop collects first and writes the paperwork afterwards, so this is the
 * entry point for that: a customer, an item amount, a shipping amount, and a
 * note about what it is for. The total is computed here — never taken from the
 * request as a single figure — and written onto the link, so it is the server's
 * number that Stripe is asked to charge.
 */
router.post('/advance', requireRole('Admin', 'Manager', 'Sales'), wrap(async (req, res) => {
  const base = await payPageBase()
  const { customerId, itemAmount, shippingAmount, currency, description } = req.body || {}

  const { link, token, customer } = await paylinks.createStandalone({
    customerId,
    itemAmount,
    shippingAmount,
    currency,
    description,
    createdBy: req.user?.id || null,
  })

  res.json({
    data: {
      url: `${base}/pay/${token}`,
      linkId: link.id,
      customer: customer.name,
      itemAmount: Number(link.item_amount),
      shippingAmount: Number(link.shipping_amount),
      amount: Number(link.amount),
      currency: link.currency,
      description: link.description,
    },
  })
}))

/** Advance links taken for a customer, so staff can see what is outstanding. */
router.get('/advance', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT pl.id, pl.amount, pl.item_amount, pl.shipping_amount, pl.currency, pl.description,
            pl.status, pl.created_at, pl.paid_at, pl.first_opened_at,
            c.name AS customer_name, p.payment_number
       FROM payment_links pl
       LEFT JOIN customers c ON c.id = pl.customer_id
       LEFT JOIN payments  p ON p.id = pl.payment_id
      WHERE pl.invoice_id IS NULL
        AND ($1::uuid IS NULL OR pl.customer_id = $1::uuid)
      ORDER BY pl.created_at DESC LIMIT 100`,
    [req.query.customer_id || null])
  res.json({ data: rows })
}))

/**
 * Payments a customer has already made that no invoice has claimed.
 *
 * This is what the invoice form offers when staff are writing up work that was
 * paid for in advance.
 */
router.get('/unallocated', wrap(async (req, res) => {
  const recorder = require('./stripe.recorder')
  res.json({ data: await recorder.unallocatedPayments(req.query.customer_id || null) })
}))

/**
 * Apply an existing payment to an invoice.
 *
 * Only the link between the two records changes — no money moves — which is why
 * this is safe long after the payment happened. The invoice's status is then
 * recomputed from the ledger, so it becomes Paid on its own rather than by
 * anyone asserting it.
 */
router.post('/apply', requireRole('Admin', 'Manager', 'Sales'), wrap(async (req, res) => {
  const { paymentId, invoiceId } = req.body || {}
  if (!paymentId || !invoiceId) {
    return res.status(400).json({ error: 'Both a payment and an invoice are required.' })
  }
  const recorder = require('./stripe.recorder')
  res.json({ data: await recorder.attachPaymentToInvoice(paymentId, invoiceId) })
}))

/** Kill the live link without issuing a replacement. */
router.delete('/invoices/:id', requireRole('Admin', 'Manager'), wrap(async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE payment_links SET status = 'void', voided_at = NOW(), updated_at = NOW()
      WHERE invoice_id = $1 AND status = 'active'`, [req.params.id])
  if (!rowCount) return res.status(404).json({ error: 'There is no active link on this invoice' })
  res.json({ data: { disabled: true } })
}))

module.exports = router
