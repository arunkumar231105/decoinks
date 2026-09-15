/**
 * Rules for a payment keyed in by hand — the payment form (POST and PUT /payments).
 *
 * Only those two routes run them. Payments the system records itself never pass
 * through here: Stripe and PayPal (stripe.recorder / paypal.recorder call
 * payments.service directly) and an invoice's Record Payment. So real money
 * that arrives is never refused for a missing detail — the owner, 15 Sep 2026:
 * that record must always be saved. For the same reason nothing here is a
 * database constraint.
 *
 * On an edit a rule is checked only when a field it reads is being changed, so
 * an older payment with a gap (122 have no receiving account) can still have
 * its notes corrected without first filling in what nobody knows.
 *
 * The form (NewPaymentPage) shows the same rules under each field; these are
 * what hold when the form is bypassed.
 */
const { query } = require('../../config/db')
const service = require('./payments.service')

// The list both forms offer (decoinks-frontend/src/utils/paymentMethods.ts).
const METHODS = ['Zelle', 'PayPal', 'Stripe', 'Shopify', 'Cash App', 'Venmo', 'Apple Pay',
  'Bank Transfer', 'Bank Deposit', 'Credit Card', 'Cash', 'Cheque', 'Other']
// Spelling is not a difference: "Cash App", "cashapp" and "cash_app" agree.
const key = value => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
const methodName = value => METHODS.find(m => key(m) === key(value)) ?? String(value ?? '')

// Where each method's money lands (payment_accounts.account_type). A method
// with no account of the shop's own — Cash App, Venmo, cash — is tied to none.
const ACCOUNT_FOR = { zelle: 'zelle', paypal: 'paypal', stripe: 'stripe', shopify: 'shopify', banktransfer: 'bank', bankdeposit: 'bank' }
// Processors that always issue a transaction ID.
const NEEDS_TRANSACTION_ID = new Set(['stripe', 'paypal', 'shopify'])

const TWO_LETTERS = /\p{L}.*\p{L}/u
const A_LETTER = /\p{L}/u

const blank = v => v === undefined || v === null || String(v).trim() === ''
const asText = v => {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v ?? '').trim()
}
const NUMBER = /^-?\d+(\.\d+)?$/
const same = (a, b) => {
  if (blank(a) && blank(b)) return true
  const x = asText(a), y = asText(b)
  if (NUMBER.test(x) && NUMBER.test(y)) return Number(x) === Number(y)
  if (/^\d{4}-\d{2}-\d{2}/.test(x) && /^\d{4}-\d{2}-\d{2}/.test(y)) return x.slice(0, 10) === y.slice(0, 10)
  return x === y
}

/**
 * The problems with a payment about to be saved, as { field, message } — the
 * same shape the route validator answers with. `existing` is the stored payment
 * when editing, null when recording a new one.
 */
async function checkPayment(body, existing) {
  const errors = []
  const fail = (field, message) => { if (!errors.some(e => e.field === field)) errors.push({ field, message }) }
  const creating = !existing
  const has = k => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
  const changed = (...keys) => creating || keys.some(k => has(k) && !same(body[k], existing[k]))
  const value = k => (has(k) ? body[k] : existing?.[k])

  if (changed('payment_date')) {
    const day = asText(value('payment_date')).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
      fail('payment_date', 'Enter the date the payment was received')
    } else {
      // A day's grace: the shop's "today" runs ahead of the server's UTC clock
      // for anyone east of Greenwich.
      const latest = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
      if (day > latest) fail('payment_date', 'Payment date cannot be in the future')
    }
  }

  const amount = Number(value('amount'))
  if (changed('amount') && (blank(value('amount')) || !Number.isFinite(amount) || amount <= 0)) {
    fail('amount', 'Enter the amount received — it must be more than 0')
  }
  if (changed('fee_amount', 'amount')) {
    const fee = blank(value('fee_amount')) ? 0 : Number(value('fee_amount'))
    if (!Number.isFinite(fee) || fee < 0) fail('fee_amount', 'Fee cannot be negative')
    else if (Number.isFinite(amount) && amount > 0 && fee >= amount) fail('fee_amount', 'Fee must be less than the amount')
  }

  const method = value('payment_method')
  if (changed('payment_method')) {
    if (blank(method)) fail('payment_method', 'Choose how the money was paid')
    else if (!METHODS.some(m => key(m) === key(method))) fail('payment_method', 'Choose a payment method from the list')
  }

  const txn = asText(value('transaction_id'))
  if (changed('payment_method', 'transaction_id') && NEEDS_TRANSACTION_ID.has(key(method)) && !txn) {
    fail('transaction_id', `Enter the ${methodName(method)} transaction ID`)
  }
  if (changed('transaction_id') && txn) {
    if (/\s/.test(txn)) {
      fail('transaction_id', 'Transaction ID cannot contain spaces')
    } else {
      const { rows } = await query(
        `SELECT payment_number FROM payments
          WHERE lower(transaction_id) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
        [txn, existing?.id ?? null])
      if (rows[0]) fail('transaction_id', `This transaction ID is already on ${rows[0].payment_number}`)
    }
  }

  if (changed('received_from_name')) {
    const from = asText(value('received_from_name'))
    if (!from) fail('received_from_name', 'Enter who sent the money')
    else if (!TWO_LETTERS.test(from)) fail('received_from_name', 'Enter the name of who sent the money — not a number')
  }

  if (changed('payment_method', 'received_into_account_id')) {
    const wanted = ACCOUNT_FOR[key(method)]
    const accountId = value('received_into_account_id')
    const where = wanted === 'bank' ? 'the bank account' : `the ${methodName(method)} account`
    if (wanted && blank(accountId)) {
      fail('received_into_account_id', `Choose the account the money went into — ${where}`)
    } else if (wanted) {
      const { rows } = await query(`SELECT account_name, account_type FROM payment_accounts WHERE id = $1`, [accountId])
      if (!rows[0]) fail('received_into_account_id', 'That account no longer exists — choose another')
      else if (key(rows[0].account_type) !== wanted) {
        fail('received_into_account_id', `A ${methodName(method)} payment must go into ${where}, not ${rows[0].account_name}`)
      }
    }
  }

  if (changed('customer_id')) {
    if (blank(value('customer_id'))) {
      fail('customer_id', 'Choose the customer this payment is from')
    } else if (existing) {
      // A payment already paying a sales order belongs to that order's customer.
      const { rows } = await query(
        `SELECT o.order_number, o.customer_id, c.name
           FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL
            AND (o.id = $1::uuid OR o.id IN (SELECT order_id FROM payment_allocations WHERE payment_id = $2::uuid))
          ORDER BY o.order_number`,
        [existing.order_id ?? null, existing.id])
      const other = rows.find(r => r.customer_id !== value('customer_id'))
      if (other) fail('customer_id', `This payment pays ${other.order_number}, so its customer stays ${other.name}`)
    }
  }

  for (const [field, label] of [['sender_bank_name', 'Sender bank'], ['sender_account_name', 'Account name']]) {
    if (changed(field) && !blank(value(field)) && !A_LETTER.test(asText(value(field)))) {
      fail(field, `${label} must be a name, not only numbers`)
    }
  }
  if (changed('sender_account_last4') && !blank(value('sender_account_last4'))
      && !/^\d{4}$/.test(asText(value('sender_account_last4')))) {
    fail('sender_account_last4', 'Enter exactly the last 4 digits')
  }
  if (changed('notes') && asText(value('notes')).length > 1000) {
    fail('notes', 'Notes can be at most 1000 characters')
  }

  return errors
}

// Route middleware: runs after the schema has shaped the body.
function manualPaymentRules() {
  return async (req, res, next) => {
    try {
      const existing = req.params.id ? await service.getById(req.params.id) : null
      const details = await checkPayment(req.body, existing)
      if (details.length) return res.status(422).json({ success: false, message: 'Validation failed', details })
      next()
    } catch (err) {
      next(err)
    }
  }
}

module.exports = { manualPaymentRules, checkPayment, METHODS }
