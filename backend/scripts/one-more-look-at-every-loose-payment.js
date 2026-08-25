/**
 * A last, wider pass over every payment still not on a sales order.
 *
 * Three things this looks at that the earlier passes did not:
 *   - orders that ALREADY hold a payment but are still short, because a second
 *     instalment belongs there and nowhere else;
 *   - the customer on the payment record, not just the name typed on it, so
 *     "Artistic Tees" finds Robert Farrar's orders;
 *   - near misses of any size, reported with the gap, because the owner would
 *     rather see a $13 difference and judge it than never be shown the pair.
 *
 * Nothing is written. Every row here is for a person to decide.
 */
const { query, pool } = require('../src/config/db')

const STOP = new Set(['llc','inc','ltd','co','corp','the','and','intl','international','jr','sr','mr','mrs'])
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g,' ')
  .split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w))
function nameScore(payer, customer) {
  const a = words(payer), b = words(customer)
  if (!a.length || !b.length) return 0
  const shared = a.filter(w => b.includes(w))
  if (!shared.length) return 0
  return (shared.includes(a[a.length-1]) || shared.includes(b[b.length-1])) ? 2 : 1
}
const money = n => `$${Number(n).toFixed(2)}`

async function main() {
  const pays = (await query(
    `SELECT p.id, COALESCE(NULLIF(p.payment_number,''),'(no number)') AS payment_number,
            p.payment_date, p.amount, p.received_from_name, p.customer_id
       FROM payments p WHERE p.order_id IS NULL ORDER BY p.payment_date DESC`)).rows

  const orders = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.total, COALESCE(o.subtotal,0) AS subtotal,
            COALESCE(o.shipping_charges,0) AS shipping, o.customer_id, o.is_free,
            COALESCE(NULLIF(c.company_name,''), NULLIF(c.name,''), '') AS customer,
            COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.order_id = o.id), 0) AS paid
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL AND NOT o.is_free`)).rows

  let shown = 0, none = 0
  for (const p of pays) {
    const cands = []
    for (const o of orders) {
      const sameCustomer = p.customer_id && o.customer_id === p.customer_id
      const ns = sameCustomer ? 3 : nameScore(p.received_from_name, o.customer)
      const owing = +(Number(o.total) - Number(o.paid)).toFixed(2)
      const gapTotal = +(Number(p.amount) - Number(o.total)).toFixed(2)
      const gapSub   = +(Number(p.amount) - Number(o.subtotal)).toFixed(2)
      const gapOwing = +(Number(p.amount) - owing).toFixed(2)
      const best = [['total', gapTotal], ['subtotal', gapSub], ['baqi raqam', gapOwing]]
        .filter(([k]) => k !== 'subtotal' || Number(o.subtotal) > 0)
        .sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0]
      const days = Math.round((new Date(p.payment_date) - new Date(o.order_date)) / 86400000)
      // Worth showing when the name points here, or the figure lands within a
      // few dollars and the dates are close enough to be the same job.
      if (ns > 0 || (Math.abs(best[1]) <= 5 && Math.abs(days) <= 21))
        cands.push({ o, ns, kind: best[0], gap: best[1], days, owing })
    }
    cands.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap) || b.ns - a.ns || Math.abs(a.days) - Math.abs(b.days))
    const top = cands.slice(0, 3)
    console.log(`\n${p.payment_number}  ${money(p.amount)}  ${String(p.payment_date).slice(0,10)}  ${p.received_from_name || '(naam nahi)'}`)
    if (!top.length) { console.log('    koi mumkin order nahi'); none++; continue }
    shown++
    for (const c of top) {
      const already = Number(c.o.paid) > 0 ? `  [pehle se ${money(c.o.paid)} lagi hai, baqi ${money(c.owing)}]` : ''
      const flag = Math.abs(c.gap) < 0.005 ? 'BILKUL BARABAR' : `farq ${money(c.gap)}`
      console.log(`    ${c.o.order_number}  ${String(c.o.customer).padEnd(24)} ${c.kind} ${money(c.kind === 'total' ? c.o.total : c.kind === 'subtotal' ? c.o.subtotal : c.owing).padStart(10)}   ${flag}   ${c.days} din${already}`)
    }
  }
  console.log(`\n\n${pays.length} loose payments — ${shown} par kuch mumkin mila, ${none} par kuch nahi\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
