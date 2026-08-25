/**
 * Some customers pay an order in two or three goes — $190 then $1, $240 then $5.
 * Matched one at a time none of those payments equals anything, so they sit in
 * the unmatched pile forever. This looks for SETS of a payer's unlinked
 * payments that together equal one order's total or subtotal.
 *
 * Read-only. Reports; writes nothing.
 */
const { query, pool } = require('../src/config/db')

const STOP = new Set(['llc','inc','ltd','co','corp','the','and','intl','international','jr','sr'])
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g,' ')
  .split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w))
const agree = (a, b) => { const x = words(a), y = words(b); return x.length && y.length && x.some(w => y.includes(w)) }
const money = n => `$${Number(n).toFixed(2)}`

async function main() {
  const pays = (await query(
    `SELECT id, payment_number, payment_date, amount, received_from_name
       FROM payments WHERE order_id IS NULL AND received_from_name IS NOT NULL
         AND received_from_name <> '' ORDER BY payment_date`)).rows
  const orders = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.total, COALESCE(o.subtotal,0) AS subtotal,
            COALESCE(NULLIF(c.company_name,''), NULLIF(c.name,''), '') AS customer
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL AND o.total > 0
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)`)).rows

  // Group a payer's unlinked payments, then try every combination of two and
  // three of them. More than three is not a payment plan, it is a coincidence.
  const byPayer = {}
  for (const p of pays) (byPayer[p.received_from_name] ||= []).push(p)

  const found = []
  for (const [payer, list] of Object.entries(byPayer)) {
    if (list.length < 2) continue
    const cands = orders.filter(o => agree(payer, o.customer))
    if (!cands.length) continue
    const combos = []
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        combos.push([list[i], list[j]])
        for (let k = j + 1; k < list.length; k++) combos.push([list[i], list[j], list[k]])
      }
    for (const set of combos) {
      const sum = +set.reduce((s, p) => s + Number(p.amount), 0).toFixed(2)
      for (const o of cands) {
        const hitsTotal = Math.abs(sum - Number(o.total)) < 0.005
        const hitsSub = Number(o.subtotal) > 0 && Math.abs(sum - Number(o.subtotal)) < 0.005
        if (hitsTotal || hitsSub) found.push({ payer, set, sum, o, kind: hitsTotal ? 'total' : 'subtotal' })
      }
    }
  }

  console.log(`\n${pays.length} bina judi payments (naam ke saath), ${orders.length} orders bina payment ke\n`)
  if (!found.length) { console.log('Koi aisa jora nahi mila.\n'); await pool.end(); return }
  console.log('=== KAI PAYMENTS MIL KAR EK ORDER BANATI HAIN ===')
  for (const f of found) {
    console.log(`  ${f.payer}`)
    console.log(`      ${f.set.map(p => `${p.payment_number} ${money(p.amount)}`).join(' + ')} = ${money(f.sum)}`)
    console.log(`      -> ${f.o.order_number}  ${f.o.customer}  ${f.kind} ${money(f.kind === 'total' ? f.o.total : f.o.subtotal)}`)
  }
  console.log(`\nmile: ${found.length}\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
