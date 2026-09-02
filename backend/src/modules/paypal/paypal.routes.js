/**
 * Paying a link with PayPal. Public, no login — same rules as the card route.
 *
 * The amount is read from the link the shop created and never from the request,
 * so a customer choosing PayPal is charged exactly what a customer choosing a
 * card would be.
 *
 * Two steps, because that is how PayPal works: the browser asks for an order,
 * the buyer approves it in PayPal's own window, and the browser then asks us to
 * capture it. The capture happens **here**, server-side — the browser only says
 * "the buyer approved", and we go and confirm that with PayPal ourselves before
 * a single row is written.
 */

const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const paylinks = require('../stripe/paylinks.service')
const paypal = require('./paypal.client')
const recorder = require('./paypal.recorder')
const logger = require('../../utils/logger')

const router = Router()
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

router.use(rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
}))

/** Create the PayPal order the buyer will approve. */
router.post('/:token/order', wrap(async (req, res) => {
  const { link, invoice } = await paylinks.resolveByToken(req.params.token)

  const label = invoice
    ? `Invoice ${invoice.invoice_number}`
    : (link.description || 'Decoinks payment')

  const order = await paypal.api('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        // PayPal echoes this back on the webhook, and it is how a capture is
        // tied to the right link without trusting anything the browser sends.
        custom_id: link.id,
        invoice_id: `${link.id}`.slice(0, 127),
        description: label.slice(0, 127),
        amount: {
          currency_code: (link.currency || 'USD').toUpperCase(),
          value: Number(link.amount).toFixed(2),
        },
      }],
      application_context: {
        brand_name: 'Decoinks',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    },
    headers: {
      // A double-click must not create two PayPal orders for one link.
      'PayPal-Request-Id': `paylink-${link.id}-${Math.round(Number(link.amount) * 100)}`,
    },
  })

  logger.info({ linkId: link.id, orderId: order.id }, 'PayPal order created')
  res.json({ data: { orderId: order.id } })
}))

/**
 * Capture, then record.
 *
 * The browser telling us the buyer approved is not evidence. We capture through
 * PayPal's API and act only on what PayPal itself returns — the same rule the
 * card side follows, where only the webhook settles anything.
 */
router.post('/:token/capture', wrap(async (req, res) => {
  const { link } = await paylinks.resolveByToken(req.params.token)
  const { orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'Missing the PayPal order.' })

  const captured = await paypal.api(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: {},
    headers: { 'PayPal-Request-Id': `capture-${orderId}` },
  })

  if (captured.status !== 'COMPLETED') {
    logger.warn({ orderId, status: captured.status }, 'PayPal capture did not complete')
    return res.status(409).json({ error: `PayPal did not complete this payment (${captured.status}).` })
  }

  await recorder.recordCapture(captured, link.id)
  res.json({ data: { status: 'COMPLETED' } })
}))

module.exports = router
