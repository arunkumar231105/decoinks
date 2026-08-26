/**
 * Match the unlinked payments to the orders they paid for.
 *
 * Two pieces of evidence, and the report says which one carried each match:
 *   NAME   — the payer's name and the customer's name share a real word.
 *            Bank and PayPal names drift ("Jacques Jean" pays for "Jac Jean",
 *            "Wilfredo Vazquez" for "Fred Vazquez"), so a shared surname counts
 *            while an initial does not.
 *   AMOUNT — the payment equals the order total to the cent.
 *
 * Both agreeing is a match worth writing. Only one agreeing is reported for a
 * human to judge, never linked: a payment on the wrong order is money moved to
 * the wrong customer, and nobody finds it later.
 *
 * Where the name matches but the amount does not, the gap is printed — that is
 * usually the order total being wrong, not the payment.
 *
 * Read-only. Writes nothing; --apply lives in the linking script.
 */
const { query, pool } = require('../src/config/db')

const STOP = new Set(['llc', 'inc', 'ltd', 'co', 'corp', 'the', 'and', 'intl', 'international',
                      'jr', 'sr', 'ii', 'iii', 'mr', 'mrs', 'ms', 'dr'])
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w))

// A shared word is evidence; a shared first name alone is weak, so a surname
// (the last word of either name) counts for more.
function nameScore(payer, customer) {
  const a = words(payer), b = words(customer)
  if (!a.length || !b.length) return 0
  const shared = a.filter(w => b.includes(w))
  if (!shared.length) return 0
  const lastA = a[a.length - 1], lastB = b[b.length - 1]
  const surnameShared = shared.includes(lastA) || shared.includes(lastB)
  return surnameShared ? 2 : 1
}

async function main() {
  const payments = (await query(
    `SELECT p.id, p.payment_number, p.payment_date, p.amount, p.received_from_name, p.customer_id
       FROM payments p
      WHERE p.order_id IS NULL AND p.invoice_id IS NULL
      ORDER BY p.payment_date`)).rows

  const orders = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.total, COALESCE(o.subtotal,0) AS subtotal,
            COALESCE(o.shipping_charges,0) AS shipping, o.customer_id,
            COALESCE(NULLIF(c.company_name,''), NULLIF(c.name,''), '') AS customer
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = o.id)
      ORDER BY o.order_date`)).rows

  const strong = [], nameOnly = [], amountOnly = [], nothing = []

  for (const p of payments) {
    const cands = orders.map(o => {
      const ns = p.customer_id && o.customer_id === p.customer_id ? 3 : nameScore(p.received_from_name, o.customer)
      const hitsTotal = Math.abs(Number(o.total) - Number(p.amount)) < 0.005
      const hitsSubtotal = Number(o.subtotal) > 0 && Math.abs(Number(o.subtotal) - Number(p.amount)) < 0.005
      const amountEq = hitsTotal || hitsSubtotal
      const days = Math.round((new Date(p.payment_date) - new Date(o.order_date)) / 86400000)
      return { o, ns, amountEq, days, hitsTotal, hitsSubtotal,
               gap: +(Number(p.amount) - Number(o.total)).toFixed(2) }
    }).filter(c => c.ns > 0 || c.amountEq)

    const both = cands.filter(c => c.ns > 0 && c.amountEq).sort((a, b) => b.ns - a.ns || Math.abs(a.days) - Math.abs(b.days))
    if (both.length === 1) { strong.push({ p, c: both[0] }); continue }
    if (both.length > 1)   { nameOnly.push({ p, cands: both, why: `${both.length} orders sab par poora milta hai` }); continue }

    const byName = cands.filter(c => c.ns > 0).sort((a, b) => b.ns - a.ns || Math.abs(a.days) - Math.abs(b.days))
    if (byName.length) { nameOnly.push({ p, cands: byName.slice(0, 3) }); continue }

    const byAmount = cands.filter(c => c.amountEq).sort((a, b) => Math.abs(a.days) - Math.abs(b.days))
    if (byAmount.length) { amountOnly.push({ p, cands: byAmount.slice(0, 3) }); continue }

    nothing.push({ p })
  }

  const money = n => `$${Number(n).toFixed(2)}`
  console.log(`\n${payments.length} payments bina jude, ${orders.length} orders bina payment ke\n`)

  console.log(`=== 1. NAAM + RAQAM DONO MILTE HAIN — ${strong.length} (jorne layak) ===`)
  for (const { p, c } of strong)
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(9)}  ${String(p.received_from_name).padEnd(26)} -> ${c.o.order_number}  ${String(c.o.customer).padEnd(24)}  ${c.hitsTotal ? 'total se' : 'subtotal se (shipping ' + money(c.o.shipping) + ' alag)'}`)

  console.log(`\n=== 2. NAAM MILTA HAI, RAQAM NAHI — ${nameOnly.length} (aap dekhein) ===`)
  for (const { p, cands, why } of nameOnly) {
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(9)}  ${p.received_from_name}${why ? '   [' + why + ']' : ''}`)
    for (const c of cands)
      console.log(`      ${c.o.order_number}  ${c.o.customer.padEnd(24)} order ${money(c.o.total).padStart(9)}   farq ${money(c.gap).padStart(9)}   ${c.days} din baad`)
  }

  console.log(`\n=== 3. RAQAM MILTI HAI, NAAM NAHI — ${amountOnly.length} (kamzor — na jorein bina tasdeeq) ===`)
  for (const { p, cands } of amountOnly) {
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(9)}  ${p.received_from_name}`)
    for (const c of cands)
      console.log(`      ${c.o.order_number}  ${c.o.customer.padEnd(24)} ${c.days} din baad`)
  }

  console.log(`\n=== 4. KUCH NAHI MILA — ${nothing.length} ===`)
  for (const { p } of nothing)
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(9)}  ${p.received_from_name}  (${String(p.payment_date).slice(0,10)})`)

  console.log(`\nkhulasa: pakka ${strong.length}   dekhna hai ${nameOnly.length}   kamzor ${amountOnly.length}   kuch nahi ${nothing.length}\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
