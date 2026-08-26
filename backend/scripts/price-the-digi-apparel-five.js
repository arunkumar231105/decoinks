/**
 * The five DIGI apparel orders that shipped without a price, from the owner's
 * verified breakdown.
 *
 * Shipping was charged once per buyer, not once per order, so the two pairs
 * (Christine Calhoun's, Matthew Carl's) carry it "combined". Until that figure
 * is given, their totals are the item money alone — stated, not invented.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

// order, qty, rate, subtotal, shipping (null = combined, still to come), item
const PRICED = [
  ['ORD-2026-0066', 6, 12, 72, null, 'T-shirt — print both sides'],
  ['ORD-2026-0067', 2, 20, 40, null, 'Pullover hoodie'],
  ['ORD-2026-0097', 6, 10, 60, 13,   'DIGI apparel'],
  ['ORD-2026-0101', 4, 10, 40, null, 'XL black t-shirt'],
  ['ORD-2026-0100', 1, 10, 10, null, 'XL black t-shirt'],
]

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('order          qty  rate     subtotal   shipping    total      item')
  console.log('-'.repeat(80))

  const plan = []
  for (const [number, qty, rate, subtotal, shipping, item] of PRICED) {
    const { rows } = await query(
      `SELECT o.id, o.total, o.subtotal AS old_subtotal
         FROM orders o WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [number])
    if (!rows.length) { console.log(`${number}  NAHI MILA`); continue }
    const ship = shipping ?? 0
    const total = +(subtotal + ship).toFixed(2)
    console.log(`${number}  ${String(qty).padStart(3)}  ${money(rate).padStart(6)}  ${money(subtotal).padStart(9)}  ${(shipping === null ? 'combined' : money(ship)).padStart(9)}  ${money(total).padStart(9)}  ${item}`)
    plan.push({ id: rows[0].id, number, qty, rate, subtotal, ship, total, item, combined: shipping === null })
  }

  const pending = plan.filter(p => p.combined)
  console.log(`\nitem ka paisa kul: ${money(plan.reduce((s, p) => s + p.subtotal, 0))}`)
  if (pending.length) console.log(`shipping abhi baqi: ${pending.map(p => p.number).join(', ')}  — bataye jaane par lagegi`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const p of plan) {
      await query(
        `UPDATE orders SET subtotal = $2, shipping_charges = $3, total = $4, updated_at = NOW()
           WHERE id = $1`, [p.id, p.subtotal, p.ship, p.total])
      // Every one of these carries a single apparel line, so the whole amount
      // belongs to it — nothing has to be split.
      await query(
        `UPDATE order_items_apparel SET qty = $2, unit_price = $3, amount = $4, item = $5
           WHERE order_id = $1`, [p.id, p.qty, p.rate, p.subtotal, p.item])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${plan.length} orders par daam lag gaye.\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
