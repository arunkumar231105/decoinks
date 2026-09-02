/**
 * A completed PayPal capture becomes a row in the ledger.
 *
 * Deliberately the same shape as the Stripe recorder, and reusing its
 * reconciliation: whichever way a customer paid, the invoice is recomputed from
 * `payments` rather than asserted, and the same link is closed out. The only
 * thing that differs is where the money came from.
 *
 * Safe to run twice. `payments.transaction_id` is uniquely indexed and holds
 * the PayPal capture id, so a retry — or the webhook arriving after the
 * browser-driven capture already recorded it — finds the existing row and only
 * re-checks the derived statuses.
 */

const db = require('../../config/db')
const paymentsService = require('../payments/payments.service')
const paylinks = require('../stripe/paylinks.service')
const stripeRecorder = require('../stripe/stripe.recorder')
const logger = require('../../utils/logger')

/** The `payment_accounts` row PayPal money lands in. */
async function paypalAccountId() {
  const { rows } = await db.query(
    `SELECT id FROM payment_accounts WHERE account_type = 'paypal' AND is_active ORDER BY created_at LIMIT 1`)
  return rows[0]?.id || null
}

/** Pull the one capture out of PayPal's nested order response. */
function firstCapture(order) {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] || null
}

/**
 * Record a completed capture.
 *
 * `linkId` comes from the route, which resolved it from the URL token; the
 * capture's own `custom_id` is preferred when present, so a webhook arriving
 * with no context still lands on the right link.
 */
async function recordCapture(order, linkId = null) {
  const capture = firstCapture(order)
  if (!capture?.id) {
    logger.error({ orderId: order?.id }, 'PayPal capture had no capture id — not recorded')
    return { payment: null, created: false, skipped: 'no_capture' }
  }

  const id = capture.id
  const { rows: existing } = await db.query(
    `SELECT * FROM payments WHERE transaction_id = $1 LIMIT 1`, [id])
  if (existing[0]) {
    await settle(existing[0], id, linkId)
    return { payment: existing[0], created: false }
  }

  const unit = order.purchase_units?.[0] || {}
  const resolvedLinkId = unit.custom_id || linkId
  if (!resolvedLinkId) {
    logger.warn({ captureId: id }, 'PayPal capture with no link reference — not recorded')
    return { payment: null, created: false, skipped: 'no_link' }
  }

  const { rows: links } = await db.query(`SELECT * FROM payment_links WHERE id = $1`, [resolvedLinkId])
  const link = links[0]
  if (!link) {
    logger.error({ captureId: id, resolvedLinkId }, 'PayPal capture references a link that no longer exists')
    return { payment: null, created: false, skipped: 'link_missing' }
  }

  const invoice = link.invoice_id ? await paylinks.getInvoice(link.invoice_id) : null

  let payerName = invoice?.customer_record_name || invoice?.customer_name || null
  if (!payerName && link.customer_id) {
    const { rows } = await db.query(`SELECT name FROM customers WHERE id = $1`, [link.customer_id])
    payerName = rows[0]?.name || null
  }
  // Who actually paid, as PayPal reports them. Often not the customer: a
  // colleague, a spouse, or a company account settles the bill. `customer_name`
  // is who the money is FOR; this is who it came FROM, and conflating them made
  // the Payments list credit every payment to the customer on the invoice.
  const paidBy = [order?.payer?.name?.given_name, order?.payer?.name?.surname]
    .filter(Boolean).join(' ').trim() || null

  const gross = Number(capture.amount?.value || 0)
  // PayPal reports its fee on the capture, so `fee_amount` is the real figure
  // rather than an estimate — the same standard the Stripe side holds to.
  const breakdown = capture.seller_receivable_breakdown || {}
  const fee = Number(breakdown.paypal_fee?.value || 0)

  const payment = await paymentsService.create({
    amount: gross,
    fee_amount: fee,
    payment_method: 'PayPal',
    status: 'Completed',
    transaction_id: id,
    reference_no: invoice?.invoice_number || (link.description ? link.description.slice(0, 100) : null),
    invoice_id: invoice?.id || null,
    order_id: invoice?.order_id || null,
    customer_id: invoice?.customer_id || link.customer_id || null,
    customer_name: payerName || paidBy || null,
    received_into_account_id: await paypalAccountId(),
    // The payer first, the customer only when PayPal names nobody.
    received_from_name: paidBy || payerName || null,
    notes: invoice
      ? `Online payment via PayPal (${id})`
      : `Advance payment via PayPal before invoicing${link.description ? ` — ${link.description}` : ''} (${id})`,
  })

  await settle(payment, id, link.id)
  logger.info({ captureId: id, paymentId: payment.id, invoice: invoice?.invoice_number || '(advance)' },
    'PayPal payment recorded')
  return { payment, created: true }
}

/** Invoice, order and link — all derived, all safe to redo. */
async function settle(payment, captureId, linkId) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    if (payment.invoice_id) await stripeRecorder.reconcileInvoice(client, payment.invoice_id)
    await stripeRecorder.reconcileOrder(client, payment.order_id)

    const { rows } = await client.query(
      `SELECT id FROM payment_links
        WHERE id = $1::uuid
           OR ($2::uuid IS NOT NULL AND invoice_id = $2::uuid AND status = 'active')
        LIMIT 1`,
      [linkId, payment.invoice_id])
    if (rows[0]) await paylinks.markPaid(rows[0].id, { paymentId: payment.id }, client)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error({ err: err.message, captureId }, 'PayPal settle failed')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { recordCapture, paypalAccountId }
