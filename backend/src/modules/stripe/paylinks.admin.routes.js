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

/** Kill the live link without issuing a replacement. */
router.delete('/invoices/:id', requireRole('Admin', 'Manager'), wrap(async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE payment_links SET status = 'void', voided_at = NOW(), updated_at = NOW()
      WHERE invoice_id = $1 AND status = 'active'`, [req.params.id])
  if (!rowCount) return res.status(404).json({ error: 'There is no active link on this invoice' })
  res.json({ data: { disabled: true } })
}))

module.exports = router
