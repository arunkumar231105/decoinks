/**
 * Attach the payments whose payer name AND amount both point at one order, and
 * only those. Everything weaker is left for a person to judge — a payment on
 * the wrong order moves money to the wrong customer, and nobody finds it later.
 *
 * The amount may equal the order total or its subtotal: customers here pay for
 * the goods and settle postage separately, so both are a real match.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

// payment, order — every pair verified by name and amount in the matching report
const PAIRS = [
  ['PAY-2026-0037', 'ORD-2026-0031'],
  ['PAY-2026-0031', 'ORD-2026-0045'],
  ['PAY-2026-0019', 'ORD-2026-0071'],
  ['PAY-2026-0018', 'ORD-2026-0075'],
  ['PAY-2026-0007', 'ORD-2026-0083'],
  ['PAY-2026-0009', 'ORD-2026-0091'],
  ['PAY-2026-0003', 'ORD-2026-0089'],
  ['PAY-2026-0101', 'ORD-2026-0095'],
  ['PAY-2026-0103', 'ORD-2026-0116'],
  ['PAY-2026-0105', 'ORD-2026-0110'],
  ['PAY-2026-0098', 'ORD-2026-0123'],
  // Second round, after the owner corrected these three order amounts
  ['PAY-2026-0041', 'ORD-2026-0023'],
  ['PAY-2026-0008', 'ORD-2026-0084'],
  ['PAY-2026-0091', 'ORD-2026-0108'],
  // Third round, from the deposits fed in off the mailbox list
  ['PAY-2026-0112', 'ORD-2026-0121'],
  ['PAY-2026-0109', 'ORD-2026-0048'],
]

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  const plan = [], skip = []
  for (const [payNo, ordNo] of PAIRS) {
    const p = (await query(
      `SELECT id, payment_number, amount, received_from_name, order_id, invoice_id, customer_id
         FROM payments WHERE payment_number = $1`, [payNo])).rows[0]
    const o = (await query(
      `SELECT o.id, o.order_number, o.total, COALESCE(o.subtotal,0) AS subtotal, o.customer_id, o.invoice_id,
              COALESCE(NULLIF(c.company_name,''), c.name) AS customer
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [ordNo])).rows[0]
    if (!p) { skip.push([payNo, 'payment nahi mili']); continue }
    if (!o) { skip.push([ordNo, 'order nahi mila']); continue }
    if (p.order_id) { skip.push([payNo, 'pehle se kisi order se judi hai']); continue }
    // Re-check here rather than trusting the list: the figures may have moved
    // since the report was written.
    const ok = Math.abs(Number(p.amount) - Number(o.total)) < 0.005
            || (Number(o.subtotal) > 0 && Math.abs(Number(p.amount) - Number(o.subtotal)) < 0.005)
    if (!ok) { skip.push([payNo, `raqam ab nahi milti — payment ${money(p.amount)}, order ${money(o.total)} / subtotal ${money(o.subtotal)}`]); continue }
    plan.push({ p, o })
    console.log(`  ${p.payment_number}  ${money(p.amount).padStart(9)}  ${String(p.received_from_name).padEnd(24)} -> ${o.order_number}  ${o.customer}`)
  }

  if (skip.length) {
    console.log(`\nCHHORE GAYE:`)
    for (const [what, why] of skip) console.log(`  ${what}  ${why}`)
  }
  console.log(`\njurenge: ${plan.length}   chhore gaye: ${skip.length}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const { p, o } of plan) {
      // The customer comes from the order, so a payment can never end up filed
      // under someone the order does not belong to.
      await query(
        `UPDATE payments SET order_id = $2, customer_id = COALESCE(customer_id, $3), updated_at = NOW()
           WHERE id = $1`, [p.id, o.id, o.customer_id])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${plan.length} payments jur gayin.\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
