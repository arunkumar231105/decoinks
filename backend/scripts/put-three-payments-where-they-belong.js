/**
 * Three payments sitting in the wrong place, each with an unambiguous home.
 *
 *   PAY-2026-0038  $1,913.00  sits on ORD-2026-0052, a FREE order totalling $0,
 *                  while Jac Jean's ORD-2026-0030 — subtotal exactly $1,913 —
 *                  has no payment at all.
 *   PAY-2026-0001  $534.25    is Robert Farrar's, dated the same day as his
 *                  ORD-2026-0086 and equal to it to the cent. That order is
 *                  currently holding PAY-2026-0010 ($71.50), which matches none
 *                  of his orders, so it is released back to the unmatched pool
 *                  rather than left claiming an order it did not pay for.
 *   PAY-2026-0104  $109.00    equals the subtotal of his ORD-2026-0109, which
 *                  has no payment.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const MOVES = [
  { pay: 'PAY-2026-0038', to: 'ORD-2026-0030', why: 'free order se hata kar $1,913 wale order par' },
  { pay: 'PAY-2026-0001', to: 'ORD-2026-0086', why: 'usi din, total bilkul barabar' },
  { pay: 'PAY-2026-0104', to: 'ORD-2026-0109', why: 'subtotal bilkul barabar' },
]
const RELEASE = [{ pay: 'PAY-2026-0010', why: 'kisi Robert Farrar order se nahi milti — khali chhori ja rahi hai' }]

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  const plan = []
  for (const m of MOVES) {
    const p = (await query(`SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number=$1`, [m.pay])).rows[0]
    const o = (await query(
      `SELECT o.id, o.order_number, o.total, COALESCE(o.subtotal,0) AS subtotal, o.customer_id,
              COALESCE(NULLIF(c.company_name,''), c.name) AS customer
         FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [m.to])).rows[0]
    if (!p || !o) { console.log(`  ${m.pay} -> ${m.to}  NAHI MILA — chhora`); continue }
    const from = p.order_id
      ? (await query(`SELECT order_number FROM orders WHERE id=$1`, [p.order_id])).rows[0]?.order_number
      : '(khali)'
    const ok = Math.abs(Number(p.amount) - Number(o.total)) < 0.005
            || (Number(o.subtotal) > 0 && Math.abs(Number(p.amount) - Number(o.subtotal)) < 0.005)
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(10)}   ${String(from).padEnd(15)} -> ${o.order_number}  ${String(o.customer).padEnd(16)} ${ok ? '✓' : '⚠ raqam nahi milti'}`)
    console.log(`      ${m.why}`)
    if (ok) plan.push({ p, o })
  }

  const rel = []
  for (const r of RELEASE) {
    const p = (await query(`SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number=$1`, [r.pay])).rows[0]
    if (!p || !p.order_id) continue
    const from = (await query(`SELECT order_number FROM orders WHERE id=$1`, [p.order_id])).rows[0]?.order_number
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(10)}   ${String(from).padEnd(15)} -> (khali)`)
    console.log(`      ${r.why}`)
    rel.push(p)
  }

  console.log(`\nmove: ${plan.length}   khali: ${rel.length}`)
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    // Released first, so the order it leaves is empty before its real payment
    // arrives and the two never sit on it together.
    for (const p of rel) await query(`UPDATE payments SET order_id = NULL, updated_at = NOW() WHERE id = $1`, [p.id])
    for (const { p, o } of plan) {
      await query(`UPDATE payments SET order_id = $2, customer_id = COALESCE(customer_id, $3), updated_at = NOW()
                     WHERE id = $1`, [p.id, o.id, o.customer_id])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${plan.length} payments apni jagah par, ${rel.length} khali.\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
