/**
 * Payment links.
 *
 * A link is a promise made in advance: this invoice, this customer, this exact
 * amount, payable once. Both ways of paying go through one — the customer who
 * signs into the portal and presses Pay Now gets a link minted for them on the
 * spot, and the customer who is sent a URL gets the same thing by email or
 * WhatsApp. That is deliberate: the pay page will eventually live on a
 * different host (pay.decoinks.com), where the portal's session cookie and
 * token do not reach it, so the link *has* to carry its own identity.
 *
 * The amount is fixed here, at creation, from the invoice's outstanding
 * balance. It is never read from the request when the charge is made.
 */

const crypto = require('crypto')
const db = require('../../config/db')

const TOKEN_BYTES = 32

// Links do not expire.
//
// A 14-day life was the original caution, and it was wrong for this business:
// an unpaid invoice is still owed on day 15, so a link that has died by then
// only means a customer who wants to pay cannot, and money sits uncollected.
// The exposure a timer would have limited is small — whoever holds the URL can
// see one invoice's number and amount, and the only thing they can *do* is pay
// it. Set a value explicitly if a particular link should ever lapse.
const DEFAULT_TTL_DAYS = null

// Issued, owing, and not yet settled. Draft is excluded on purpose: a draft
// invoice has not been confirmed by staff, and letting a customer pay one would
// collect money against pricing nobody has signed off. Moving Draft -> Sent is
// the admin's confirmation step.
const PAYABLE_STATUSES = ['Sent', 'Overdue']

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex')

/**
 * The token is kept as well as hashed, encrypted with a key of its own.
 *
 * Hashing alone made the URL unrecoverable, which forced the Customer Portal to
 * mint a competing link every time someone pressed Pay Now — voiding the one an
 * agent had already sent. Encrypting instead keeps one link per invoice
 * showable in both places, while a stolen copy of the table is still not a bag
 * of working links: the key lives in `settings`, not in this table.
 */
let keyCache = null
async function encryptionKey() {
  if (keyCache) return keyCache
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'paylink_encryption_key'`)
  let raw = rows[0]?.value
  if (!raw) {
    raw = crypto.randomBytes(32).toString('base64')
    // ON CONFLICT DO NOTHING, then re-read: two workers starting together must
    // not end up holding different keys and writing links the other cannot open.
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('paylink_encryption_key', $1, NOW())
       ON CONFLICT (key) DO NOTHING`, [raw])
    const { rows: again } = await db.query(`SELECT value FROM settings WHERE key = 'paylink_encryption_key'`)
    raw = again[0].value
  }
  keyCache = Buffer.from(raw, 'base64')
  return keyCache
}

async function encryptToken(token) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', await encryptionKey(), iv)
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

async function decryptToken(blob) {
  if (!blob) return null
  try {
    const buf = Buffer.from(blob, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', await encryptionKey(), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    // A link from before this column existed, or a rotated key. The caller
    // regenerates rather than showing a URL that would not open.
    return null
  }
}

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

/**
 * An invoice with everything the pay page and the ledger need, joined to the
 * customer through whichever link the record happens to carry.
 *
 * Both paths are needed: 160 of the 203 invoices in this database carry
 * customer_id and 174 carry order_id, and neither set contains the other. A
 * query using only one of them silently hides invoices from the customer they
 * belong to.
 */
const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.status, i.issue_date, i.due_date,
         i.subtotal, i.discount_amt, i.tax_amt, i.rush_services, i.shipping_charges,
         i.total, i.amount_paid, i.balance_due, i.currency,
         i.customer_name, i.billing_email, i.contact_number,
         i.billing_address, i.shipping_address, i.notes, i.payment_terms,
         i.order_id,
         COALESCE(i.customer_id, o.customer_id) AS customer_id,
         o.order_number, o.status AS order_status, o.payment_status AS order_payment_status,
         c.name AS customer_record_name, c.email AS customer_email
    FROM invoices i
    LEFT JOIN orders    o ON o.id = i.order_id
    LEFT JOIN customers c ON c.id = COALESCE(i.customer_id, o.customer_id)`

async function getInvoice(invoiceId, { customerId = null } = {}) {
  const params = [invoiceId]
  let scope = ''
  if (customerId) {
    params.push(customerId)
    scope = ' AND COALESCE(i.customer_id, o.customer_id) = $2'
  }
  const { rows } = await db.query(`${INVOICE_SELECT} WHERE i.id = $1${scope} LIMIT 1`, params)
  return rows[0] || null
}

/** Why this invoice cannot be paid online right now, or null if it can. */
function payableProblem(inv) {
  if (!inv) return fail('Invoice not found', 404, 'not_found')
  if (inv.status === 'Void') return fail('This invoice has been voided.', 409, 'void')
  if (inv.status === 'Paid') return fail('This invoice is already paid.', 409, 'already_paid')
  if (inv.status === 'Draft') {
    return fail('This invoice has not been finalised yet. Our team will send it to you shortly.', 409, 'draft')
  }
  if (!PAYABLE_STATUSES.includes(inv.status)) {
    return fail(`This invoice cannot be paid online (status: ${inv.status}).`, 409, 'not_payable')
  }
  if (!(Number(inv.balance_due) > 0)) return fail('Nothing is outstanding on this invoice.', 409, 'no_balance')
  return null
}

/**
 * A sales order accepts exactly one payment — the rule lives in the database as
 * `uq_payments_one_per_order` and would reject the insert anyway. Checking here
 * means the customer is told before they reach a card form, rather than after
 * Stripe has already taken their money.
 */
async function assertOrderUnsettled(orderId) {
  if (!orderId) return
  const { rows } = await db.query(
    `SELECT p.payment_number, p.amount FROM payments p WHERE p.order_id = $1 LIMIT 1`, [orderId])
  if (rows.length) {
    throw fail('A payment has already been recorded against this order.', 409, 'order_settled')
  }
}

/**
 * Mint a link for an invoice.
 *
 * Re-issuing voids whatever was outstanding, so two URLs never exist that both
 * claim to collect the same money. Use `getOrCreateForInvoice` unless a fresh
 * URL is actually wanted — this one always replaces.
 */
async function createForInvoice(invoiceId, { customerId = null, createdBy = null, ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const inv = await getInvoice(invoiceId, { customerId })
  const problem = payableProblem(inv)
  if (problem) throw problem
  await assertOrderUnsettled(inv.order_id)

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    // Void the previous live link first: the partial unique index allows only
    // one 'active' row per invoice, so this is what makes re-issuing possible.
    await client.query(
      `UPDATE payment_links SET status = 'void', voided_at = NOW(), updated_at = NOW()
        WHERE invoice_id = $1 AND status = 'active'`, [invoiceId])

    const { rows } = await client.query(
      `INSERT INTO payment_links
         (token_hash, token_encrypted, invoice_id, order_id, customer_id, amount, currency, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() + ($8 || ' days')::interval END, $9)
       RETURNING *`,
      [hashToken(token), await encryptToken(token), inv.id, inv.order_id, inv.customer_id,
       Number(inv.balance_due), inv.currency || 'USD', ttlDays === null ? null : String(ttlDays), createdBy]
    )

    await client.query('COMMIT')
    return { link: rows[0], token, invoice: inv }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * The one link for this invoice — the same URL wherever it is asked for.
 *
 * This is what the agent's Copy Link and the customer's Pay Now both call, so
 * the link in a customer's WhatsApp and the link behind the portal button are
 * the same row and the same URL. A new one is minted only when there is no live
 * link, when the amount has moved since it was made, or when the stored token
 * cannot be read back.
 */
async function getOrCreateForInvoice(invoiceId, opts = {}) {
  const existing = await findCurrentForInvoice(invoiceId)
  if (existing) {
    const invoice = await getInvoice(invoiceId, opts.customerId ? { customerId: opts.customerId } : {})
    if (opts.customerId && !invoice) throw fail('Invoice not found', 404, 'not_found')

    const token = await decryptToken(existing.token_encrypted)
    if (token) {
      // If staff edited the invoice, correct the amount on THIS link rather
      // than issuing another. Replacing it would kill a URL a customer may
      // already be holding, and the point of one link per invoice is that the
      // URL never changes under them. The pay route only reuses a Stripe intent
      // whose amount still matches, so the charge follows this figure.
      const owed = Number(invoice.balance_due)
      if (Math.abs(Number(existing.amount) - owed) > 0.005 && owed > 0) {
        const { rows } = await db.query(
          `UPDATE payment_links SET amount = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [existing.id, owed])
        return { link: rows[0], token, invoice, reused: true, amountCorrected: true }
      }

      // Lapsed, by an expiry someone set deliberately. Bring it back rather
      // than replace it: the invoice is still owed, so this is still its link,
      // and the customer may be holding the URL right now.
      const lapsed = existing.status === 'expired'
        || (existing.expires_at && new Date(existing.expires_at) < new Date())
      if (lapsed) {
        const { rows } = await db.query(
          `UPDATE payment_links
              SET status = 'active', expires_at = NULL, updated_at = NOW()
            WHERE id = $1 RETURNING *`, [existing.id])
        return { link: rows[0], token, invoice, reused: true, revived: true }
      }

      return { link: existing, token, invoice, reused: true }
    }
    // No readable token: a link from before encryption existed. Nothing can
    // show its URL, so a replacement is the only way forward.
  }
  return { ...(await createForInvoice(invoiceId, opts)), reused: false }
}

/** The live link for an invoice, if one is outstanding. */
async function findActiveForInvoice(invoiceId) {
  const { rows } = await db.query(
    `SELECT * FROM payment_links WHERE invoice_id = $1 AND status = 'active' LIMIT 1`, [invoiceId])
  return rows[0] || null
}

/**
 * The link that still stands for this invoice, including a lapsed one.
 *
 * 'expired' is a soft state, unlike 'paid' and 'void': the invoice is still
 * owed, so the link is still the right link and can be brought back. Looking
 * only at 'active' meant that opening a lapsed URL once — which is what flips
 * it to 'expired' — made the next Pay Now mint a replacement and strand the URL
 * the customer was holding.
 */
async function findCurrentForInvoice(invoiceId) {
  const { rows } = await db.query(
    `SELECT * FROM payment_links
      WHERE invoice_id = $1 AND status IN ('active', 'expired')
      ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`, [invoiceId])
  return rows[0] || null
}

/**
 * Turn a URL token back into a link and its invoice.
 *
 * Expiry is settled here rather than by a scheduled job, so a link is dead the
 * moment it is used rather than the next time something happens to run.
 */
async function resolveByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw fail('This payment link is not valid.', 404, 'not_found')
  }
  const { rows } = await db.query(
    `SELECT * FROM payment_links WHERE token_hash = $1 LIMIT 1`, [hashToken(token)])
  const link = rows[0]
  if (!link) throw fail('This payment link is not valid.', 404, 'not_found')

  if (link.status === 'active' && link.expires_at && new Date(link.expires_at) < new Date()) {
    await db.query(
      `UPDATE payment_links SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'active'`,
      [link.id])
    link.status = 'expired'
  }

  const invoice = await getInvoice(link.invoice_id)

  if (link.status === 'paid')    throw fail('This invoice has already been paid. Thank you!', 409, 'already_paid')
  if (link.status === 'expired') throw fail('This payment link has expired. Please ask us for a new one.', 410, 'expired')
  if (link.status === 'void')    throw fail('This payment link is no longer valid. Please ask us for a new one.', 410, 'void')

  // The invoice can be settled by other means — a Zelle transfer entered by
  // staff — after the link was sent. The link's own status would not know.
  const problem = payableProblem(invoice)
  if (problem) throw problem

  if (!link.first_opened_at) {
    await db.query(`UPDATE payment_links SET first_opened_at = NOW() WHERE id = $1`, [link.id])
  }

  return { link, invoice }
}

/**
 * Look a token up without judging it.
 *
 * `resolveByToken` refuses a paid or expired link, which is right for the pay
 * page but wrong for the screen the customer lands on *after* paying — there,
 * "this link is already paid" is the answer we want to show, not an error.
 */
async function peekByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null
  const { rows } = await db.query(
    `SELECT * FROM payment_links WHERE token_hash = $1 LIMIT 1`, [hashToken(token)])
  if (!rows[0]) return null
  return { link: rows[0], invoice: await getInvoice(rows[0].invoice_id) }
}

async function attachPaymentIntent(linkId, paymentIntentId) {
  await db.query(
    `UPDATE payment_links SET stripe_payment_intent_id = $2, updated_at = NOW() WHERE id = $1`,
    [linkId, paymentIntentId])
}

async function markPaid(linkId, { paymentId = null } = {}, client = db) {
  await client.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), payment_id = $2, updated_at = NOW()
      WHERE id = $1`,
    [linkId, paymentId])
}

/** Everything a link's public pay page may know. No ids that aren't needed. */
function publicView(link, invoice) {
  return {
    invoiceNumber: invoice.invoice_number,
    orderNumber: invoice.order_number || null,
    customerName: invoice.customer_record_name || invoice.customer_name || null,
    amount: Number(link.amount),
    currency: link.currency || 'USD',
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    expiresAt: link.expires_at,
  }
}

module.exports = {
  createForInvoice,
  getOrCreateForInvoice,
  decryptToken,
  findActiveForInvoice,
  findCurrentForInvoice,
  resolveByToken,
  peekByToken,
  attachPaymentIntent,
  markPaid,
  getInvoice,
  payableProblem,
  publicView,
  hashToken,
  INVOICE_SELECT,
  PAYABLE_STATUSES,
}
