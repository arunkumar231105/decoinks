/**
 * Turning a successful Stripe charge into a row in the ledger.
 *
 * This is the only place a Stripe payment becomes real. The customer's browser
 * reaching a success screen does not settle anything — the customer can close
 * the tab, lose signal, or never come back, and the money still has to land in
 * the books. Stripe's server-to-server call is what we act on.
 *
 * Everything here is written to be run more than once with the same event.
 * Stripe retries on any non-2xx and re-delivers when its own delivery is
 * uncertain, so a redelivery must be a no-op rather than a second payment. Two
 * things guarantee that: `stripe_events` records the event ids we have seen,
 * and `payments.transaction_id` is uniquely indexed so the same PaymentIntent
 * can never produce two ledger rows even if the first defence were bypassed.
 */

const db = require('../../config/db')
const paymentsService = require('../payments/payments.service')
const paylinks = require('./paylinks.service')
const logger = require('../../utils/logger')

/** The `payment_accounts` row Stripe money lands in, seeded by migration 124. */
async function stripeAccountId() {
  const { rows } = await db.query(
    `SELECT id FROM payment_accounts WHERE account_type = 'stripe' AND is_active ORDER BY created_at LIMIT 1`)
  return rows[0]?.id || null
}

/**
 * Stripe's fee, in dollars, for a PaymentIntent — read from the balance
 * transaction rather than estimated, so `payments.fee_amount` matches the
 * payout rather than a guess at 2.9% + 30c.
 */
function feeFromIntent(intent) {
  const txn = intent?.latest_charge?.balance_transaction
  if (!txn || typeof txn.fee !== 'number') return 0
  return +(txn.fee / 100).toFixed(2)
}

function dollars(cents) {
  return +(Number(cents) / 100).toFixed(2)
}

/**
 * Recompute an invoice's status from the ledger.
 *
 * Deliberately derived from SUM(payments) rather than from the amount we just
 * inserted, so running this twice cannot inflate anything and a manually
 * entered payment recorded in between is taken into account.
 */
async function reconcileInvoice(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT i.total,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
            i.status
       FROM invoices i WHERE i.id = $1`, [invoiceId])
  if (!rows[0]) return null

  const total = Number(rows[0].total)
  const paid = Number(rows[0].paid)
  const balance = +(Math.max(0, total - paid)).toFixed(2)

  const status = balance <= 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : rows[0].status

  await client.query(
    `UPDATE invoices
        SET status = $2::invoice_status,
            paid_at = CASE WHEN $2::text = 'Paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [invoiceId, status])

  return { status, balance }
}

/** The order carries its own payment flag, which the invoice trigger does not set. */
async function reconcileOrder(client, orderId) {
  if (!orderId) return
  await client.query(
    `UPDATE orders o
        SET payment_status = CASE
              WHEN paid.total >= o.total THEN 'Paid'::payment_status
              WHEN paid.total > 0        THEN 'Partial'::payment_status
              ELSE o.payment_status END,
            amount_paid = paid.total,
            payment_date = COALESCE(o.payment_date, CURRENT_DATE),
            payment_method = COALESCE(o.payment_method, 'Stripe'),
            updated_at = NOW()
       FROM (SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = $1) paid
      WHERE o.id = $1`, [orderId])
}

/**
 * Record a succeeded PaymentIntent.
 *
 * Returns { payment, created } — `created: false` means this intent was already
 * in the ledger and only the derived statuses were re-checked.
 */
async function recordSucceededIntent(intent) {
  const intentId = intent.id

  // Already booked? Then this is a redelivery. Reconcile and leave.
  const { rows: existing } = await db.query(
    `SELECT * FROM payments WHERE transaction_id = $1 LIMIT 1`, [intentId])

  if (existing[0]) {
    await settleDerived(existing[0], intentId)
    return { payment: existing[0], created: false }
  }

  const linkId = intent.metadata?.payment_link_id || null
  const invoiceId = intent.metadata?.invoice_id || null
  const metaCustomerId = intent.metadata?.customer_id || null

  // Money taken before any invoice existed. It is booked against the customer
  // and waits there until an invoice claims it — which is the shop's actual
  // habit: collect first, write the paperwork after.
  const isAdvance = !invoiceId && Boolean(metaCustomerId)

  if (!invoiceId && !isAdvance) {
    // A PaymentIntent created outside this application — someone charging a
    // card from the Stripe dashboard, say. Not ours to book; booking it against
    // a guessed invoice would be worse than leaving it for a human.
    logger.warn({ intentId }, 'Stripe intent succeeded with neither invoice nor customer in metadata — not recorded')
    return { payment: null, created: false, skipped: 'no_metadata' }
  }

  const invoice = invoiceId ? await paylinks.getInvoice(invoiceId) : null
  if (invoiceId && !invoice) {
    logger.error({ intentId, invoiceId }, 'Stripe intent references an invoice that no longer exists')
    return { payment: null, created: false, skipped: 'invoice_missing' }
  }

  let payerName = invoice?.customer_record_name || invoice?.customer_name || null
  if (!payerName && metaCustomerId) {
    const { rows } = await db.query(`SELECT name FROM customers WHERE id = $1`, [metaCustomerId])
    payerName = rows[0]?.name || null
  }
  const label = intent.metadata?.link_description || null

  const payment = await paymentsService.create({
    amount: dollars(intent.amount_received ?? intent.amount),
    fee_amount: feeFromIntent(intent),
    payment_method: 'Stripe',
    status: 'Completed',
    transaction_id: intentId,
    reference_no: invoice?.invoice_number || (label ? label.slice(0, 100) : null),
    invoice_id: invoice?.id || null,
    order_id: invoice?.order_id || null,
    customer_id: invoice?.customer_id || metaCustomerId || null,
    customer_name: payerName,
    received_into_account_id: await stripeAccountId(),
    received_from_name: payerName,
    notes: invoice
      ? `Online card payment via Stripe (${intentId})`
      : `Advance payment via Stripe before invoicing${label ? ` — ${label}` : ''} (${intentId})`,
    // recorded_by stays null: no member of staff recorded this, the customer did.
  })

  await settleDerived(payment, intentId, linkId)
  logger.info({ intentId, paymentId: payment.id, invoice: invoice?.invoice_number || '(advance)' },
    'Stripe payment recorded')
  return { payment, created: true }
}

/** Invoice status, order status and the link — all derived, all safe to redo. */
async function settleDerived(payment, intentId, linkIdHint = null) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    if (payment.invoice_id) await reconcileInvoice(client, payment.invoice_id)
    await reconcileOrder(client, payment.order_id)

    // Find the link by its intent rather than trusting metadata alone, so a
    // link is still closed out if the metadata was lost. The invoice clause is
    // skipped for an advance payment, which has no invoice to match on.
    const { rows } = await client.query(
      `SELECT id FROM payment_links
        WHERE stripe_payment_intent_id = $1
           OR id = $2::uuid
           OR ($3::uuid IS NOT NULL AND invoice_id = $3::uuid AND status = 'active')
        LIMIT 1`,
      [intentId, linkIdHint, payment.invoice_id])
    if (rows[0]) await paylinks.markPaid(rows[0].id, { paymentId: payment.id }, client)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Fill in Stripe's fee once it is known.
 *
 * Only ever writes a fee onto a row that has none, so a figure corrected by
 * hand is never overwritten by a late webhook. `net_amount` is a generated
 * column and recomputes itself.
 */
async function backfillFee(paymentIntentId, feeInDollars) {
  const fee = +Number(feeInDollars).toFixed(2)
  if (!(fee > 0)) return false

  const { rowCount } = await db.query(
    `UPDATE payments
        SET fee_amount = $2, updated_at = NOW()
      WHERE transaction_id = $1 AND fee_amount = 0 AND $2 <= amount`,
    [paymentIntentId, fee])

  if (rowCount) logger.info({ paymentIntentId, fee }, 'Stripe fee backfilled')
  return rowCount > 0
}

/**
 * Claim an advance payment for an invoice written afterwards.
 *
 * The payment already exists and already holds real money; this only says which
 * invoice it settles. Nothing about the money changes, which is why it is safe
 * to do long after the fact.
 *
 * Guarded rather than trusting: the payment must be unallocated, must belong to
 * the same customer, and must not overshoot what the invoice asks for. Each of
 * those, unchecked, would put a real sum against the wrong record.
 */
async function attachPaymentToInvoice(paymentId, invoiceId) {
  const { rows: pay } = await db.query(`SELECT * FROM payments WHERE id = $1`, [paymentId])
  const payment = pay[0]
  if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
  if (payment.invoice_id) {
    throw Object.assign(new Error('That payment is already applied to another invoice.'), { statusCode: 409 })
  }

  const invoice = await paylinks.getInvoice(invoiceId)
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })

  if (payment.customer_id && invoice.customer_id && payment.customer_id !== invoice.customer_id) {
    throw Object.assign(
      new Error('That payment belongs to a different customer.'), { statusCode: 409 })
  }

  const { rows: sum } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1`, [invoiceId])
  const outstanding = +(Number(invoice.total) - Number(sum[0].paid)).toFixed(2)
  if (Number(payment.amount) > outstanding + 0.01) {
    throw Object.assign(new Error(
      `That payment is ${Number(payment.amount).toFixed(2)}, more than the ${outstanding.toFixed(2)} still owed on this invoice.`),
      { statusCode: 422 })
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE payments
          SET invoice_id = $2,
              order_id = COALESCE(order_id, $3),
              customer_id = COALESCE(customer_id, $4),
              updated_at = NOW()
        WHERE id = $1`,
      [paymentId, invoiceId, invoice.order_id || null, invoice.customer_id || null])

    const result = await reconcileInvoice(client, invoiceId)
    await reconcileOrder(client, invoice.order_id)
    await client.query('COMMIT')
    logger.info({ paymentId, invoiceId, status: result?.status }, 'Advance payment applied to invoice')
    return { invoice: invoiceId, status: result?.status, balance: result?.balance }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Payments no invoice has claimed yet.
 *
 * Payments with no customer at all are included alongside the named customer's
 * own. Staff entering a payment by hand often fill in "Received From" and never
 * pick a customer from the list, so those rows carry a payer's name but no
 * `customer_id` — filtering strictly on the id would hide real money from the
 * one screen able to attach it. They are flagged `unassigned` so the UI can say
 * so, and applying one fills the customer in from the invoice.
 */
async function unallocatedPayments(customerId) {
  const { rows } = await db.query(
    `SELECT p.id, p.payment_number, p.amount, p.payment_method, p.payment_date,
            p.paid_at, p.reference_no, p.notes, p.transaction_id,
            COALESCE(NULLIF(p.customer_name, ''), p.received_from_name) AS customer_name,
            (p.customer_id IS NULL) AS unassigned
       FROM payments p
      WHERE p.invoice_id IS NULL
        AND p.status = 'Completed'
        AND ($1::uuid IS NULL
             OR p.customer_id = $1::uuid
             OR p.customer_id IS NULL)
      ORDER BY (p.customer_id = $1::uuid) DESC NULLS LAST,
               COALESCE(p.payment_date, p.paid_at::date) DESC, p.created_at DESC
      LIMIT 100`, [customerId || null])
  return rows
}

module.exports = {
  recordSucceededIntent, reconcileInvoice, reconcileOrder, stripeAccountId, backfillFee,
  attachPaymentToInvoice, unallocatedPayments,
}
