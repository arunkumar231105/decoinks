/**
 * A Zelle payment the bank emailed about becomes a row in the ledger.
 *
 * The shop's Zelle money lands at Bank of America, and the only live signal of
 * it is BoA's alert email — "Ricardo Malia sent you $90.00", an optional memo
 * line, and nothing else. No confirmation number, no account digits. n8n
 * watches the inbox and posts each such email here within seconds of arrival.
 *
 * Three rules, because this writes money:
 *
 * 1. Only the bank may create a payment. The email must come from
 *    bankofamerica.com AND carry the receiving server's dkim=pass for a
 *    bankofamerica.com signature. Anyone can send a message that says
 *    "sent you $500"; only BoA can sign one.
 *
 * 2. The same email never records twice. Its Message-ID is kept in the notes
 *    as [zelle-email:<id>] and checked first, under an advisory lock, so an n8n
 *    retry or a replayed trigger finds the row it already wrote.
 *
 * 3. A payment staff already typed in is adopted, not doubled. Until now every
 *    Zelle was keyed in by hand from this same alert. A hand-entered row with
 *    the same amount, a matching payer name, no transaction ID and a date
 *    within three days is that payment: the alert is attached to it and only
 *    its blanks are filled.
 *
 * Like paypal.recorder's unlinked payments, nothing here guesses an order or
 * invoice. The customer is linked only when exactly one customer is named the
 * same as the payer, or staff have already tied this payer's earlier payments
 * to exactly one customer.
 */

const db = require('../../config/db')
const paymentsService = require('./payments.service')
const logger = require('../../utils/logger')

const LOCK_KEY = 'zelle-email-recorder'
const MATCH_WINDOW_DAYS = 3
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()

function stripHtml(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&reg;|&#174;/gi, '®').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}

function senderAddress(from) {
  const m = String(from || '').match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i)
  return m ? { address: m[0].toLowerCase(), domain: m[1].toLowerCase() } : { address: '', domain: '' }
}

const isBankDomain = domain => /(^|\.)bankofamerica\.com$/.test(domain)

/**
 * The receiving server's verdict. Hostinger stamps its own
 * Authentication-Results on top of every delivered message; a forged header
 * lower down never reaches index 0, which is the one n8n forwards.
 */
function bankSigned(authResults) {
  const header = clean(authResults)
  if (!/^[a-z0-9.-]*hostinger\.io\s*;/i.test(header)) return false
  return header.split(';').some(clause =>
    /\bdkim=pass\b/i.test(clause) && /header\.d=([a-z0-9-]+\.)*bankofamerica\.com\b/i.test(clause))
}

// Payments are dated on shop time: the day it was in Pakistan when the bank
// sent the alert. A Zelle that arrives at 10:00 on the 16th in Pakistan is a
// payment of the 16th, even though it was still the 15th in the US.
const { shopDate } = require('../../utils/shopTime')

/** The calendar day in Pakistan when the bank sent the alert. */
function localDate(dateHeader) {
  const s = String(dateHeader || '')
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return shopDate(d)
  // A header JavaScript cannot read as a moment: keep the day it names.
  const m = s.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i)
  if (m) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// Not anchored at the end: if the bank ever appends "with Zelle®" or similar,
// the alert must still be read rather than silently ignored.
const SENT_YOU = /^\s*(.+?)\s+sent you\s+\$\s*([\d,]+(?:\.\d{1,2})?)(?![\d,])/i
const NOT_MEMO = /^(view your balance|please allow|money to deposit|zelle®? and the zelle)/i

/**
 * Read one BoA alert. Returns { ok: true, ...fields } or { ok: false, reason }.
 * Pure — no database — so the rules above can be tested on real alert text.
 */
function parseZelleEmail(input = {}) {
  const subject = clean(input.subject)
  const text = String(input.text || '').length > 40 ? String(input.text) : stripHtml(input.html || input.text)
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean)
  const messageId = clean(input.message_id).replace(/^<|>$/g, '')

  const { address, domain } = senderAddress(input.from)
  if (!isBankDomain(domain)) {
    return { ok: false, reason: `Not from Bank of America (${address || 'no sender'}) — not recorded` }
  }
  if (!bankSigned(input.authentication_results)) {
    return { ok: false, reason: 'Bank of America signature (DKIM) did not verify — not recorded' }
  }
  if (!messageId) return { ok: false, reason: 'Email has no Message-ID — not recorded' }

  const bodyIndex = lines.findIndex(l => SENT_YOU.test(l))
  const m = subject.match(SENT_YOU) || (bodyIndex >= 0 ? lines[bodyIndex].match(SENT_YOU) : null)
  if (!m) return { ok: false, reason: 'Not an incoming Zelle alert ("… sent you $…")', ignorable: true }

  const payer = clean(m[1]).slice(0, 160)
  const amount = Number(m[2].replace(/,/g, ''))
  if (!(amount > 0) || !/\p{L}.*\p{L}/u.test(payer)) {
    return { ok: false, reason: 'Could not read the payer or amount from the alert' }
  }

  let memo = null
  if (bodyIndex >= 0) {
    const next = lines[bodyIndex + 1]
    if (next && !NOT_MEMO.test(next) && next.length <= 200) memo = next
  }

  const paymentDate = localDate(input.date) || shopDate()
  return { ok: true, payer, amount: +amount.toFixed(2), memo, payment_date: paymentDate, message_id: messageId, sender: address }
}

/* ── Names ─────────────────────────────────────────────────────────────────── */

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'mr', 'mrs', 'ms', 'dr'])

function nameTokens(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 1 && !SUFFIXES.has(t))
}

/** Exact: the same words, in any order ("Ngwamukie Samuel" = "Samuel Ngwamukie"). */
function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b)
  if (!x.length || x.length !== y.length) return false
  const set = new Set(y)
  return x.every(t => set.has(t))
}

/** Loose enough for a hand-typed record: every word of the shorter name (two or more) is in the longer. */
function namesMatch(a, b) {
  const x = nameTokens(a), y = nameTokens(b)
  if (!x.length || !y.length) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length < 2) return short[0] === long[0] && long.length === 1
  const set = new Set(long)
  return short.every(t => set.has(t))
}

/* ── Ledger ────────────────────────────────────────────────────────────────── */

const marker = messageId => `[zelle-email:${messageId}]`

async function zelleAccountId() {
  const { rows } = await db.query(
    `SELECT id FROM payment_accounts WHERE account_type = 'zelle' AND is_active ORDER BY created_at LIMIT 1`)
  return rows[0]?.id || null
}

/** Exactly one customer, or none. */
async function resolveCustomer(payer) {
  const found = new Map()
  const { rows: earlier } = await db.query(
    `SELECT DISTINCT p.received_from_name, c.id, c.name, c.customer_number
       FROM payments p JOIN customers c ON c.id = p.customer_id AND c.deleted_at IS NULL
      WHERE p.received_from_name IS NOT NULL`)
  for (const r of earlier) if (sameName(r.received_from_name, payer)) found.set(r.id, r)
  const { rows: customers } = await db.query(
    `SELECT id, name, customer_number FROM customers WHERE deleted_at IS NULL`)
  for (const c of customers) if (sameName(c.name, payer)) found.set(c.id, c)
  if (found.size !== 1) return null
  const c = [...found.values()][0]
  return { id: c.id, name: c.name, customer_number: c.customer_number }
}

/** A hand-typed payment this alert is about, nearest date first. */
async function findHandEntered(parsed) {
  const { rows } = await db.query(
    `SELECT p.id, p.payment_number, p.payment_method, p.notes, p.received_from_name, p.customer_name,
            p.received_into_account_id, c.name AS linked_customer,
            COALESCE(p.payment_date, p.paid_at::date) AS day
       FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.amount = $1
        AND p.transaction_id IS NULL
        AND COALESCE(p.payment_date, p.paid_at::date) BETWEEN $2::date - $3::int AND $2::date + $3::int
        AND position('[zelle-email:' in COALESCE(p.notes, '')) = 0
      ORDER BY abs(COALESCE(p.payment_date, p.paid_at::date) - $2::date), p.created_at`,
    [parsed.amount, parsed.payment_date, MATCH_WINDOW_DAYS])
  return rows.find(r => [r.received_from_name, r.customer_name, r.linked_customer]
    .some(n => namesMatch(n, parsed.payer))) || null
}

const summary = (parsed, extra) => ({
  payer: parsed.payer, amount: parsed.amount, payment_date: parsed.payment_date, memo: parsed.memo, ...extra,
})

/**
 * Record one alert. `dryRun` answers what would happen and writes nothing.
 * status: created | matched | duplicate | ignored | rejected
 */
async function recordZelleEmail(input, { dryRun = false } = {}) {
  const parsed = parseZelleEmail(input)
  if (!parsed.ok) {
    if (!parsed.ignorable) logger.warn({ from: input?.from, subject: input?.subject, reason: parsed.reason }, 'Zelle email refused')
    return { status: parsed.ignorable ? 'ignored' : 'rejected', reason: parsed.reason }
  }

  const client = await db.getClient()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY])

    const { rows: seen } = await db.query(
      `SELECT id, payment_number FROM payments WHERE position($1 in COALESCE(notes, '')) > 0 LIMIT 1`,
      [marker(parsed.message_id)])
    if (seen[0]) {
      return summary(parsed, { status: 'duplicate', payment_id: seen[0].id, payment_number: seen[0].payment_number })
    }

    const accountId = await zelleAccountId()
    const existing = await findHandEntered(parsed)
    if (existing) {
      const fields = {
        notes: [existing.notes, `Bank of America Zelle alert from ${parsed.payer}${parsed.memo ? ` — memo "${parsed.memo}"` : ''}. ${marker(parsed.message_id)}`]
          .filter(Boolean).join('\n'),
      }
      if (!existing.received_into_account_id && /zelle/i.test(existing.payment_method || '')) fields.received_into_account_id = accountId
      if (!/\p{L}/u.test(existing.received_from_name || '')) fields.received_from_name = parsed.payer
      if (!dryRun) await paymentsService.update(existing.id, fields)
      logger.info({ paymentNumber: existing.payment_number, payer: parsed.payer, dryRun }, 'Zelle alert matched a hand-entered payment')
      return summary(parsed, {
        status: 'matched', payment_id: existing.id, payment_number: existing.payment_number,
        payment_method: existing.payment_method,
        warning: /zelle/i.test(existing.payment_method || '') ? null
          : `${existing.payment_number} is recorded as ${existing.payment_method}, but the bank says Zelle`,
      })
    }

    const customer = await resolveCustomer(parsed.payer)
    const notes = [
      `Zelle from ${parsed.payer}, recorded automatically from the Bank of America alert.`,
      parsed.memo ? `Memo: "${parsed.memo}".` : null,
      customer ? null : 'Not yet matched to a customer.',
      marker(parsed.message_id),
    ].filter(Boolean).join(' ')

    if (dryRun) return summary(parsed, { status: 'created', dry_run: true, customer })

    const payment = await paymentsService.create({
      amount: parsed.amount,
      fee_amount: 0,
      payment_method: 'Zelle',
      status: 'Completed',
      payment_date: parsed.payment_date,
      transaction_id: null,
      customer_id: customer?.id || null,
      received_from_name: parsed.payer,
      received_into_account_id: accountId,
      notes,
    })
    logger.info({ paymentNumber: payment.payment_number, payer: parsed.payer, amount: parsed.amount }, 'Zelle payment recorded from bank alert')
    return summary(parsed, { status: 'created', payment_id: payment.id, payment_number: payment.payment_number, customer })
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}

module.exports = { recordZelleEmail, parseZelleEmail, bankSigned, localDate, namesMatch, sameName }
