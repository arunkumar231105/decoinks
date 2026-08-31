/**
 * Stripe's webhook. The single point at which money becomes real here.
 *
 * Three things this route must get right, all of them easy to get wrong:
 *
 * 1. The body must stay raw. Signature verification hashes the exact bytes
 *    Stripe sent, so `express.json()` parsing them first would break every
 *    signature. This router is mounted ahead of the JSON parser in app.js and
 *    uses express.raw() itself.
 *
 * 2. Only signed calls are believed. Without the signature check, anyone who
 *    found this URL could post "payment_intent.succeeded" and mark invoices
 *    paid. The endpoint is public by necessity; the signature is what makes
 *    that safe.
 *
 * 3. Repeats must be harmless. Stripe retries on any non-2xx and re-delivers
 *    when delivery is uncertain, so the same event will arrive twice sooner or
 *    later. Every event id is recorded before it is acted on.
 */

const { Router } = require('express')
const express = require('express')
const db = require('../../config/db')
const stripeClient = require('./stripe.client')
const recorder = require('./stripe.recorder')
const logger = require('../../utils/logger')

const router = Router()

router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  let event

  try {
    const secret = await stripeClient.getWebhookSecret()
    const stripe = await stripeClient.getStripe()
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret)
  } catch (err) {
    // 400, not 500: a bad signature is not a transient fault, and telling
    // Stripe to retry it forever would be pointless.
    logger.warn({ err: err.message }, 'Stripe webhook signature rejected')
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` })
  }

  // Claim the event. ON CONFLICT DO NOTHING makes this the deduplication point:
  // a second delivery inserts nothing, and rowCount tells us it is a repeat.
  const claim = await db.query(
    `INSERT INTO stripe_events (event_id, type, payload)
     VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
    [event.id, event.type, event.data?.object ? JSON.stringify(event.data.object) : null])

  if (claim.rowCount === 0) {
    const { rows } = await db.query(
      `SELECT processed_at FROM stripe_events WHERE event_id = $1`, [event.id])
    if (rows[0]?.processed_at) {
      logger.info({ eventId: event.id, type: event.type }, 'Stripe webhook redelivered — already handled')
      return res.json({ received: true, duplicate: true })
    }
    // Seen but never finished — an earlier attempt died midway. Fall through
    // and handle it; every step below is safe to repeat.
    logger.warn({ eventId: event.id }, 'Stripe webhook retry of an unfinished event')
  }

  try {
    await handle(event)
    await db.query(
      `UPDATE stripe_events SET processed_at = NOW(), error = NULL WHERE event_id = $1`, [event.id])
    res.json({ received: true })
  } catch (err) {
    await db.query(
      `UPDATE stripe_events SET error = $2 WHERE event_id = $1`, [event.id, String(err.message).slice(0, 2000)])
    logger.error({ err: err.message, eventId: event.id, type: event.type }, 'Stripe webhook handler failed')
    // 500 so Stripe retries. The event row keeps the reason for a human.
    res.status(500).json({ error: 'Handler failed' })
  }
})

async function handle(event) {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      // Re-fetch with the balance transaction expanded so `fee_amount` is
      // Stripe's actual fee rather than an estimate. The webhook payload does
      // not carry it.
      //
      // Stripe attaches the balance transaction a moment *after* the charge
      // succeeds, and this webhook arrives inside that moment — the first
      // attempt usually comes back with it still null. Two short retries catch
      // it. If they don't, the payment is still recorded on time with a zero
      // fee and `charge.updated` fills it in below; money in the books is more
      // urgent than knowing what Stripe charged us for it.
      const stripe = await stripeClient.getStripe()
      let intent = event.data.object
      for (const waitMs of [0, 700, 1500]) {
        if (waitMs) await new Promise(r => setTimeout(r, waitMs))
        try {
          const fresh = await stripe.paymentIntents.retrieve(intent.id, {
            expand: ['latest_charge.balance_transaction'],
          })
          intent = fresh
          if (typeof fresh.latest_charge?.balance_transaction?.fee === 'number') break
        } catch (err) {
          logger.warn({ err: err.message, intentId: intent.id }, 'Could not expand charge')
          break
        }
      }
      await recorder.recordSucceededIntent(intent)
      break
    }

    case 'charge.updated': {
      // The safety net for the fee. Stripe emits this once the balance
      // transaction exists, which is exactly the piece the retries above may
      // have been too early for.
      const charge = event.data.object
      if (!charge.payment_intent) break
      const stripe = await stripeClient.getStripe()
      let fee = null
      try {
        const full = await stripe.charges.retrieve(charge.id, { expand: ['balance_transaction'] })
        if (typeof full.balance_transaction?.fee === 'number') fee = full.balance_transaction.fee / 100
      } catch (err) {
        logger.warn({ err: err.message, chargeId: charge.id }, 'Could not read balance transaction')
      }
      if (fee !== null) await recorder.backfillFee(charge.payment_intent, fee)
      break
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object
      logger.info({
        intentId: intent.id,
        invoice: intent.metadata?.invoice_number,
        reason: intent.last_payment_error?.message,
      }, 'Stripe payment failed')
      // Nothing to record: a failed attempt is not a ledger entry, and the link
      // stays active so the customer can try another card.
      break
    }

    case 'charge.refunded': {
      // Refunds are recorded by staff through the refunds module today, so this
      // is logged rather than acted on — a silent automatic write here would
      // race with what they enter by hand.
      const charge = event.data.object
      logger.warn({
        chargeId: charge.id,
        intentId: charge.payment_intent,
        amountRefunded: charge.amount_refunded,
      }, 'Stripe refund seen — record it in the refunds module')
      break
    }

    default:
      logger.debug({ type: event.type }, 'Stripe event ignored')
  }
}

module.exports = router
