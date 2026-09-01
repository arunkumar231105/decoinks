/**
 * The public pay page's API. No login.
 *
 * A payment link is its own credential: whoever holds the URL may see that one
 * invoice's number, customer name and amount, and may pay it. Nothing else is
 * reachable — no list, no other invoice, no order contents, no artwork.
 *
 * The amount is never accepted from the request. It is read from the link row
 * that staff created, which is what makes the customer unable to change what
 * they are charged no matter what they send us.
 */

const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const db = require('../../config/db')
const paylinks = require('./paylinks.service')
const stripeClient = require('./stripe.client')
const logger = require('../../utils/logger')

const router = Router()
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

// A token is 32 random bytes, so guessing one is not a realistic attack. The
// limit is here to keep someone from using the endpoint as a probe, and to keep
// a stuck page from hammering Stripe.
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
})
router.use(limiter)

/** What the pay page needs to render itself. */
router.get('/:token', wrap(async (req, res) => {
  const { link, invoice } = await paylinks.resolveByToken(req.params.token)
  const stripeConfig = await stripeClient.getPublicConfig()

  res.json({
    data: {
      ...(await paylinks.publicView(link, invoice)),
      publishableKey: stripeConfig.publishableKey,
      testMode: stripeConfig.testMode,
    },
  })
}))

/**
 * Hand the browser a PaymentIntent to complete.
 *
 * The intent is reused when the customer comes back to a link they abandoned,
 * rather than leaving a trail of half-finished intents on the Stripe account
 * for every reload.
 */
router.post('/:token/intent', wrap(async (req, res) => {
  const { link, invoice } = await paylinks.resolveByToken(req.params.token)
  const stripe = await stripeClient.getStripe()

  const amountInCents = Math.round(Number(link.amount) * 100)
  const currency = (link.currency || 'USD').toLowerCase()

  if (link.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(link.stripe_payment_intent_id)
      const reusable = ['requires_payment_method', 'requires_confirmation', 'requires_action']
      if (reusable.includes(existing.status) && existing.amount === amountInCents) {
        return res.json({ data: { clientSecret: existing.client_secret } })
      }
      if (existing.status === 'succeeded') {
        return res.status(409).json({ error: 'This invoice has already been paid. Thank you!' })
      }
    } catch (err) {
      // A intent that Stripe no longer knows about is not a reason to refuse a
      // payment — fall through and make a new one.
      logger.warn({ err: err.message, intent: link.stripe_payment_intent_id }, 'Could not reuse PaymentIntent')
    }
  }

  // A standalone link is money taken before any invoice exists, so there is no
  // invoice number to put on the customer's card statement or receipt — the
  // description staff typed stands in for it.
  const label = invoice
    ? `Invoice ${invoice.invoice_number}${invoice.order_number ? ` — Order ${invoice.order_number}` : ''}`
    : (link.description || 'Decoinks payment')

  let receiptEmail = invoice?.billing_email || invoice?.customer_email || undefined
  if (!receiptEmail && link.customer_id) {
    const { rows } = await db.query(`SELECT email FROM customers WHERE id = $1`, [link.customer_id])
    receiptEmail = rows[0]?.email || undefined
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency,
    // Lets Stripe offer whatever the customer's device and country support —
    // card, Apple Pay, Google Pay, Link — without us maintaining that list.
    automatic_payment_methods: { enabled: true },
    description: label,
    statement_descriptor_suffix: 'DECOINKS',
    // Stripe emails the receipt itself, which is how the customer gets a
    // confirmation without this project having any mail transport of its own.
    receipt_email: receiptEmail,
    metadata: {
      invoice_id: invoice?.id || '',
      invoice_number: invoice?.invoice_number || '',
      order_id: invoice?.order_id || '',
      order_number: invoice?.order_number || '',
      customer_id: invoice?.customer_id || link.customer_id || '',
      payment_link_id: link.id,
      link_description: link.description || '',
      source: invoice ? 'decoinks_invoice_link' : 'decoinks_advance_link',
    },
  }, {
    // If the browser sends this twice — a double click, a retried request — the
    // second call returns the first intent instead of creating another.
    idempotencyKey: `paylink_${link.id}_${amountInCents}`,
  })

  await paylinks.attachPaymentIntent(link.id, intent.id)
  res.json({ data: { clientSecret: intent.client_secret } })
}))

/**
 * Has the payment actually landed in our books?
 *
 * The success screen polls this rather than believing itself. Stripe tells the
 * browser the card went through, but the invoice is only paid once our webhook
 * has run — usually a second or two later. Showing "paid" before that would be
 * showing the customer something we have not recorded.
 */
router.get('/:token/status', wrap(async (req, res) => {
  const found = await paylinks.peekByToken(req.params.token)
  if (!found) return res.status(404).json({ error: 'This payment link is not valid.' })

  const { link, invoice } = found
  res.json({
    data: {
      // A standalone link has no invoice, so its own status is the answer.
      paid: link.status === 'paid' || (Boolean(link.invoice_id) && invoice?.status === 'Paid'),
      linkStatus: link.status,
      invoiceNumber: invoice?.invoice_number || null,
      description: link.description || null,
      amount: Number(link.amount),
      currency: link.currency || 'USD',
      paidAt: link.paid_at,
    },
  })
}))

module.exports = router
