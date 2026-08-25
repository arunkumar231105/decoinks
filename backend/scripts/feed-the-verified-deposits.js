/**
 * Reconcile the payments table against the deposits verified from the shop's
 * own mailbox (PayPal, Zelle and Stripe notifications through 2026-08-24).
 *
 * Two kinds of row in that list are NOT customer payments and are deliberately
 * left out — counting them would inflate revenue:
 *   Stripe "Bank payout"  — money already recorded as customer payments, now
 *                           moving to the bank. The sheet warns about this.
 *   Muhammad Usama        — marked "Internal transfer — verify separately".
 *
 * A deposit already in the system is left alone. Matching is by amount plus
 * payer name plus a date within three days, because a bank's posting date and
 * the notification date often differ by a day.
 *
 * Dry run by default. Pass --apply to write.
 */
const fs = require('fs')
const { query, pool } = require('../src/config/db')

const SKIP_PAYER = /muhammad usama/i
const SKIP_TYPE = /bank payout/i

const STOP = new Set(['llc', 'inc', 'ltd', 'co', 'corp', 'the', 'and', 'intl', 'international', 'jr', 'sr'])
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w))
const namesAgree = (a, b) => {
  const x = words(a), y = words(b)
  return x.length && y.length && x.some(w => y.includes(w))
}
const METHOD = provider => /paypal/i.test(provider) ? 'PayPal'
                       : /zelle|bank of america/i.test(provider) ? 'Zelle'
                       : /stripe/i.test(provider) ? 'other' : 'other'
const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = fs.readFileSync(`${__dirname}/data/verified-deposits.tsv`, 'utf8')
    .split('\n').filter(Boolean).map(l => {
      const [date, provider, type, payer, amount, fee] = l.split('\t')
      return { date, provider, type, payer, amount: Number(amount), fee: Number(fee) }
    })

  const existing = (await query(
    `SELECT id, payment_number, payment_date, amount, received_from_name, customer_name
       FROM payments`)).rows

  const skipped = [], already = [], missing = []
  const claimed = new Set()

  for (const r of rows) {
    const notCustomer = SKIP_TYPE.test(r.type) || SKIP_PAYER.test(r.payer)
    if (notCustomer && !process.argv.includes('--all')) {
      skipped.push([r, SKIP_TYPE.test(r.type) ? 'Stripe bank payout — customer payment nahi' : 'internal transfer — customer payment nahi'])
      continue
    }
    r.notCustomer = notCustomer

    const hit = existing.find(e => {
      if (claimed.has(e.id)) return false
      if (Math.abs(Number(e.amount) - r.amount) >= 0.005) return false
      const days = Math.abs((new Date(e.payment_date) - new Date(r.date)) / 86400000)
      const nm = e.received_from_name || e.customer_name
      const sameName = nm && namesAgree(nm, r.payer)
      // An eCheck clears a week after it is sent, and the mailbox reports the
      // clearing date while the system holds the sending date. With the amount
      // and the payer both matching, that wider gap is still the same payment.
      if (days > (sameName ? 14 : 3)) return false
      return !nm || sameName
    })
    if (hit) { claimed.add(hit.id); already.push({ r, hit }); continue }
    missing.push(r)
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`list mein            ${rows.length}`)
  console.log(`chhore gaye          ${skipped.length}  (Stripe payouts + internal transfers)`)
  console.log(`pehle se maujood     ${already.length}`)
  console.log(`DAALNE HAIN          ${missing.length}   ${money(missing.reduce((s, m) => s + m.amount, 0))}\n`)

  if (skipped.length) {
    console.log('CHHORE GAYE:')
    for (const [r, why] of skipped) console.log(`  ${r.date}  ${money(r.amount).padStart(10)}  ${String(r.payer).padEnd(24)} ${why}`)
    console.log()
  }
  if (missing.length) {
    console.log('NAYI ENTRIES:')
    for (const m of missing) console.log(`  ${m.date}  ${money(m.amount).padStart(10)}  ${String(m.payer).padEnd(30)} ${m.provider}`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!missing.length) { console.log('\nKuch daalna nahi hai.\n'); await pool.end(); return }

  await query('BEGIN')
  let n = 0
  try {
    for (const m of missing) {
      // Number from the same high-water rule the app uses, so it can never
      // collide with one the app hands out next.
      const next = (await query(
        `SELECT 'PAY-2026-' || lpad((COALESCE(MAX(NULLIF(split_part(payment_number,'-',3),'')::INT), 0) + 1)::text, 4, '0') AS n
           FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)).rows[0].n
      await query(
        // net_amount is generated from amount and fee — the database works it out.
        `INSERT INTO payments (payment_number, payment_date, amount, fee_amount,
                               payment_method, received_from_name, status, notes, created_at, updated_at)
         VALUES ($1, $2::date, $3, $4, $5, $6, 'Received',
                 $7, NOW(), NOW())`,
        [next, m.date, m.amount, m.fee, METHOD(m.provider), m.payer,
         m.notCustomer
           ? 'Mailbox deposit — customer payment NAHI (Stripe payout / internal transfer)'
           : 'Mailbox se tasdeeq shuda deposit'])
      n++
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${n} nayi payments daal di gayin.\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
