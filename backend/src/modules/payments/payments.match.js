// Which received payment a new invoice or sales order most likely belongs to.
//
// Money arrives before the paperwork, so when staff raise an invoice from a quote
// (or a sales order) the payment is usually already in the ledger, waiting. Each
// waiting payment is scored on what staff would check by eye — whose it is, how
// much it is, when it came in, how it was paid — and the reasons are returned
// with the score, so the person confirming the suggestion sees why it was made.
//
// This only reads. Nothing is linked here; the invoice or order save does that
// once someone has looked at the suggestion.
const { query } = require('../../config/db')

const CENTS = 0.01
const DAY = 24 * 60 * 60 * 1000

const words = value => String(value ?? '')
  .toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(w => w.length > 1 && !['jr', 'sr', 'ii', 'iii', 'llc', 'inc', 'co', 'the', 'and'].includes(w))

// How well two names name the same person: 1 same, 0.8 same first and last
// name (middle name or initial aside), 0.6 one name inside the other, 0.3 same
// surname only, 0 otherwise.
function nameMatch(a, b) {
  const x = words(a), y = words(b)
  if (!x.length || !y.length) return 0
  if (x.join(' ') === y.join(' ')) return 1
  if (x[0] === y[0] && x.at(-1) === y.at(-1)) return 0.8
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 2 && short.every(w => long.includes(w))) return 0.6
  if (x.length >= 2 && y.length >= 2 && x.at(-1) === y.at(-1)) return 0.3
  return 0
}

const money = n => `$${Number(n).toFixed(2)}`

/**
 * @param {object} p
 * @param {'invoice'|'order'} p.purpose  what the payment would be attached to
 * @param {string} [p.customerId]
 * @param {string} [p.customerName]
 * @param {number} [p.amount]            the invoice's / order's total
 * @param {number} [p.otherAmount]       e.g. the quote's total, when it differs
 * @param {string} [p.date]              when the work was quoted / ordered
 * @param {string} [p.method]
 */
async function recommendPayments({ purpose = 'invoice', customerId, customerName, amount, otherAmount, date, method }) {
  const target = Number(amount) > 0 ? +Number(amount).toFixed(2) : null
  const second = Number(otherAmount) > 0 && Math.abs(Number(otherAmount) - (target ?? -1)) > CENTS
    ? +Number(otherAmount).toFixed(2) : null
  const refDate = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null

  const waiting = purpose === 'order'
    ? `p.order_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)`
    : `p.invoice_id IS NULL`

  const { rows } = await query(
    `SELECT p.id, p.payment_number, p.amount, p.payment_method, p.payment_date, p.paid_at, p.created_at,
            p.customer_id, p.transaction_id, p.reference_no,
            COALESCE(NULLIF(btrim(p.customer_name), ''), c.name) AS customer_name,
            p.received_from_name, c.name AS customer_record_name
       FROM payments p
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE ${waiting}
        AND lower(p.status) IN ('completed', 'received')   -- all three spellings of money in
        AND p.created_at > NOW() - INTERVAL '365 days'`)

  const scored = []
  for (const p of rows) {
    const reasons = []
    let score = 0

    // Whose payment. A payment already filed under another customer cannot be
    // attached (the attach refuses it), so it is never suggested.
    const sameCustomer = customerId && p.customer_id === customerId
    const byName = Math.max(nameMatch(customerName, p.customer_name), nameMatch(customerName, p.received_from_name))
    if (sameCustomer) { score += 45; reasons.push('same customer') }
    else if (p.customer_id && customerId) continue
    else if (byName >= 0.6) { score += Math.round(40 * byName); reasons.push(`name matches "${p.received_from_name || p.customer_name}"`) }
    else continue

    // How much. More than the document is owed cannot be attached to an invoice.
    const paid = Number(p.amount)
    if (target != null) {
      if (Math.abs(paid - target) <= CENTS) { score += 40; reasons.push(`${money(paid)} = the total`) }
      else if (second != null && Math.abs(paid - second) <= CENTS) { score += 30; reasons.push(`${money(paid)} = the quote total`) }
      else if (paid > target + CENTS) {
        if (purpose === 'invoice') continue
        reasons.push(`${money(paid)} is more than the ${money(target)} total`)
      } else if (paid >= target * 0.3) { score += 12; reasons.push(`${money(paid)} deposit on ${money(target)}`) }
      else reasons.push(`${money(paid)} of ${money(target)}`)
    }

    // When. Paid around the time of the quote is the usual pattern.
    const paidOn = p.payment_date || p.paid_at || p.created_at
    if (refDate && paidOn) {
      const days = Math.round((new Date(paidOn) - refDate) / DAY)
      const gap = Math.abs(days)
      if (gap <= 14) { score += 10; reasons.push(gap === 0 ? 'paid the same day' : `paid ${gap} day${gap === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'}`) }
      else if (gap <= 45) score += 5
    }

    if (method && p.payment_method && String(method).toLowerCase().replace(/[\s_-]/g, '') === String(p.payment_method).toLowerCase().replace(/[\s_-]/g, '')) {
      score += 5; reasons.push(`paid by ${p.payment_method}`)
    }

    scored.push({
      id: p.id, payment_number: p.payment_number, amount: paid, payment_method: p.payment_method,
      payment_date: p.payment_date, customer_id: p.customer_id, customer_name: p.customer_name,
      received_from_name: p.received_from_name, transaction_id: p.transaction_id,
      unassigned: !p.customer_id, score, reasons,
    })
  }
  scored.sort((a, b) => b.score - a.score || String(b.payment_date).localeCompare(String(a.payment_date)))

  // Suggested only when it is clearly the one: its customer and amount both
  // agree, and nothing else comes close.
  const [top, next] = scored
  const strong = top && top.score >= 75 && top.reasons.some(r => r.includes('= the'))
  const clear = strong && (!next || top.score - next.score >= 15)
  return {
    recommended: clear ? { ...top, confidence: top.score >= 90 ? 'high' : 'good' } : null,
    recommended_set: target != null ? paymentsThatMakeUp(scored, target) : null,
    candidates: scored.slice(0, 40),
  }
}

// Two to four of the customer's waiting payments that add up to the total to the
// cent — a job paid in parts. Suggested only when exactly one such set exists
// (or one clearly best: all the same customer, paid closest together), so a
// coincidence of amounts is not presented as an answer.
function paymentsThatMakeUp(scored, target) {
  const pool = scored.filter(p => p.amount > 0 && p.amount < target - CENTS).slice(0, 14)
  const sets = []
  const walk = (start, chosen, sum) => {
    if (chosen.length >= 2 && Math.abs(sum - target) <= CENTS) { sets.push([...chosen]); return }
    if (chosen.length === 4 || sum > target + CENTS) return
    for (let i = start; i < pool.length; i++) walk(i + 1, [...chosen, pool[i]], +(sum + pool[i].amount).toFixed(2))
  }
  walk(0, [], 0)
  if (!sets.length) return null

  const spread = set => {
    const days = set.map(p => Date.parse(p.payment_date || '') || 0).filter(Boolean)
    return days.length ? (Math.max(...days) - Math.min(...days)) / DAY : 999
  }
  const rank = set => (set.every(p => p.reasons.includes('same customer')) ? 1000 : 0) - spread(set)
  sets.sort((a, b) => rank(b) - rank(a))
  if (sets.length > 1 && rank(sets[0]) - rank(sets[1]) < 5) return null

  const best = sets[0]
  return {
    ids: best.map(p => p.id),
    payment_numbers: best.map(p => p.payment_number),
    total: +best.reduce((sum, p) => sum + p.amount, 0).toFixed(2),
    reasons: [
      best.every(p => p.reasons.includes('same customer')) ? 'same customer' : 'names match',
      `${best.map(p => money(p.amount)).join(' + ')} = ${money(target)}`,
    ],
  }
}

module.exports = { recommendPayments, nameMatch }
