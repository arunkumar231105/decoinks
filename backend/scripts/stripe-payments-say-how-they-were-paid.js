/**
 * Fill paid_via on Stripe payments recorded before migration 138 — Apple Pay, a
 * card, a bank — by reading each PaymentIntent back from Stripe.
 *
 * Reads Stripe only (no charge, refund or change is made there). Writes only
 * payments.paid_via, and only where it is empty. Before committing it proves
 * that no amount, fee, net, method, status, order, invoice or customer on any
 * payment changed. Payments with no PaymentIntent id (keyed in by hand) are
 * listed and left alone.
 *
 *   node scripts/stripe-payments-say-how-they-were-paid.js           dry run
 *   node scripts/stripe-payments-say-how-they-were-paid.js --apply   write
 */
require('dotenv').config()
const { getClient, pool } = require('../src/config/db')
const stripeClient = require('../src/modules/stripe/stripe.client')
const { describePaidVia } = require('../src/modules/stripe/paidVia')

const APPLY = process.argv.includes('--apply')
const MONEY = `md5(string_agg(concat_ws('|', id, amount, fee_amount, net_amount, payment_method, status,
                 order_id, invoice_id, customer_id, transaction_id, received_into_account_id), ',' ORDER BY id))`

;(async () => {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: [col] } = await client.query(
      `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'paid_via'`)
    if (!col) throw new Error('migration 138 has not run yet — deploy the backend first')

    const { rows: [before] } = await client.query(`SELECT ${MONEY} AS h FROM payments`)
    const { rows } = await client.query(
      `SELECT id, payment_number, transaction_id, paid_via, amount FROM payments
        WHERE payment_method ILIKE 'stripe' ORDER BY payment_number`)
    const stripe = await stripeClient.getStripe()
    console.log(APPLY ? '\n-- APPLYING --\n' : '\n-- DRY RUN (add --apply to write) --\n')

    let filled = 0
    for (const p of rows) {
      if (p.paid_via) { console.log(`   ${p.payment_number}  already: ${p.paid_via}`); continue }
      if (!/^pi_/.test(p.transaction_id || '')) { console.log(`   ${p.payment_number}  $${p.amount}  no PaymentIntent id — left as is`); continue }
      let via = null
      try {
        const intent = await stripe.paymentIntents.retrieve(p.transaction_id, { expand: ['latest_charge'] })
        via = describePaidVia(intent.latest_charge)
      } catch (err) {
        console.log(`   ${p.payment_number}  could not read ${p.transaction_id} from Stripe: ${err.message}`)
        continue
      }
      if (!via) { console.log(`   ${p.payment_number}  Stripe gave no method detail`); continue }
      await client.query(`UPDATE payments SET paid_via = $1 WHERE id = $2 AND paid_via IS NULL`, [via, p.id])
      filled++
      console.log(`   ${p.payment_number}  $${p.amount}  → ${via}`)
    }

    const { rows: [after] } = await client.query(`SELECT ${MONEY} AS h FROM payments`)
    if (before.h !== after.h) throw new Error('a payment changed beyond paid_via — rolled back')
    console.log(`\n   ${filled} filled. Money check: amounts, fees, methods, statuses and links identical before and after.`)

    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK')
    console.log(APPLY ? 'Written.' : 'Nothing written.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`\nFAILED: ${err.message}`)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
})()
