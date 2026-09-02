/**
 * PayPal's webhook — the safety net under the browser.
 *
 * Without this, a PayPal payment is only recorded because the buyer's browser
 * came back from PayPal and told us to capture. A buyer who pays and then closes
 * the tab, loses signal, or has the page crash leaves the money with PayPal and
 * nothing at all in the ledger: the shop is paid and does not know it, and the
 * invoice still says unpaid.
 *
 * Stripe never had that gap because its webhook was there from the start. This
 * closes the same gap on the PayPal side.
 *
 * Every event is verified with PayPal before it is believed. The endpoint is
 * public by necessity, and without verification anyone who found the URL could
 * post "PAYMENT.CAPTURE.COMPLETED" and mark invoices paid.
 *
 * Repeats are harmless: `payments.transaction_id` holds the capture id and is
 * uniquely indexed, and the recorder reconciles rather than re-inserting. The
 * browser-driven capture and this webhook routinely both arrive for the same
 * payment — that is the point, and only one row results.
 */

const { Router } = require('express')
const db = require('../../config/db')
const paypal = require('./paypal.client')
const recorder = require('./paypal.recorder')
const logger = require('../../utils/logger')

const router = Router()

const HANDLED = new Set([
  'PAYMENT.CAPTURE.COMPLETED',
  'CHECKOUT.ORDER.APPROVED',
])

router.post('/', async (req, res) => {
  const event = req.body
  const id = event?.id

  if (!id) return res.status(400).json({ error: 'Not a PayPal event.' })

  try {
    const { webhookId } = await paypal.readSettings()
    if (!webhookId) {
      logger.error({ id }, 'PayPal webhook received but no webhook id is configured — cannot verify')
      return res.status(503).json({ error: 'Webhook not configured' })
    }

    const check = await paypal.api('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: {
        transmission_id: req.get('paypal-transmission-id'),
        transmission_time: req.get('paypal-transmission-time'),
        cert_url: req.get('paypal-cert-url'),
        auth_algo: req.get('paypal-auth-algo'),
        transmission_sig: req.get('paypal-transmission-sig'),
        webhook_id: webhookId,
        webhook_event: event,
      },
    })

    if (check?.verification_status !== 'SUCCESS') {
      // 400, not 500: a bad signature is not transient and retrying is pointless.
      logger.warn({ id, status: check?.verification_status }, 'PayPal webhook signature rejected')
      return res.status(400).json({ error: 'Signature verification failed' })
    }
  } catch (err) {
    logger.error({ err: err.message, id }, 'PayPal webhook verification errored')
    return res.status(500).json({ error: 'Verification failed' })
  }

  // Claim the event. Reusing `stripe_events` deliberately: it is the table for
  // "processor events we have seen", the deduplication is identical, and a
  // second table with the same shape would be two things to reason about.
  const claim = await db.query(
    `INSERT INTO stripe_events (event_id, type, payload)
     VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
    [id, `paypal:${event.event_type}`, JSON.stringify(event.resource || {})])

  if (claim.rowCount === 0) {
    const { rows } = await db.query(`SELECT processed_at FROM stripe_events WHERE event_id = $1`, [id])
    if (rows[0]?.processed_at) {
      logger.info({ id, type: event.event_type }, 'PayPal webhook redelivered — already handled')
      return res.json({ received: true, duplicate: true })
    }
  }

  try {
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      // The event carries the capture, not the order it belongs to. Fetch the
      // order so the recorder sees the same shape the browser path gives it —
      // one code path for both, so they cannot drift apart.
      const capture = event.resource || {}
      const orderId = capture.supplementary_data?.related_ids?.order_id
      const order = orderId
        ? await paypal.api(`/v2/checkout/orders/${encodeURIComponent(orderId)}`)
        : { id: capture.id, purchase_units: [{ custom_id: capture.custom_id, payments: { captures: [capture] } }] }

      await recorder.recordCapture(order, capture.custom_id || null)
    } else if (!HANDLED.has(event.event_type)) {
      logger.debug({ type: event.event_type }, 'PayPal event ignored')
    }

    await db.query(`UPDATE stripe_events SET processed_at = NOW(), error = NULL WHERE event_id = $1`, [id])
    res.json({ received: true })
  } catch (err) {
    await db.query(`UPDATE stripe_events SET error = $2 WHERE event_id = $1`,
      [id, String(err.message).slice(0, 2000)])
    logger.error({ err: err.message, id, type: event.event_type }, 'PayPal webhook handler failed')
    // 500 so PayPal retries. The row keeps the reason for a human.
    res.status(500).json({ error: 'Handler failed' })
  }
})

module.exports = router
