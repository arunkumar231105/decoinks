/**
 * The 27 orders whose line amounts were all zero, priced from the owner's sheet.
 *
 * FREE means the work was given away — that is now recorded as orders.is_free,
 * so it can never again be mistaken for a price nobody entered.
 *
 * Where the sheet left the item column at 0 but named a total, the subtotal is
 * taken as total - shipping: arithmetic, not a guess. Rows that do not reconcile
 * are reported and skipped rather than forced.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const F = 'FREE'
// order_number, item subtotal, shipping, total
const ROWS = [
  ['ORD-2026-0121', 0, 0, 390],
  ['ORD-2026-0104', 0, 0, 0],
  ['ORD-2026-0103', 0, 0, 0],
  ['ORD-2026-0102', 0, 0, 240],
  ['ORD-2026-0100', 0, 0, 0],
  ['ORD-2026-0091', 165, 26, 186],
  ['ORD-2026-0067', 0, 0, 0],
  ['ORD-2026-0066', 0, 0, 0],
  ['ORD-2026-0051', F, F, F],
  ['ORD-2026-0050', F, F, F],
  ['ORD-2026-0115', F, F, F],
  ['ORD-2026-0082', 210, 35, 245],
  ['ORD-2026-0070', 0, 16, 16],
  ['ORD-2026-0068', F, F, F],
  ['ORD-2026-0052', F, F, F],
  ['ORD-2026-0029', F, F, F],
  ['ORD-2026-0025', F, 10, 10],
  ['ORD-2026-0021', F, F, F],
  ['ORD-2026-0014', F, F, F],
  ['ORD-2026-0118', 415.25, 45, 460.25],
  ['ORD-2026-0031', 262.5, 15, 277.5],
  ['ORD-2026-0030', 0, 15, 1928],
  ['ORD-2026-0024', 150, 15, 165],
  ['ORD-2026-0020', 25, 10, 35],
  ['ORD-2026-0017', 230, 15, 245],
  ['ORD-2026-0011', 265, 15, 280],
  ['ORD-2026-0010', 49, 15, 64],
]

const money = n => `$${Number(n).toFixed(2)}`
const num = v => (v === F ? 0 : Number(v))

async function main() {
  const apply = process.argv.includes('--apply')
  const planned = [], skipped = [], derived = []

  for (const [number, rawItems, rawShip, rawTotal] of ROWS) {
    const { rows } = await query(
      `SELECT o.id, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total, o.is_free,
              (SELECT count(*) FROM order_items_apparel WHERE order_id=o.id)
             +(SELECT count(*) FROM order_items_dtf     WHERE order_id=o.id)
             +(SELECT count(*) FROM order_items_gangsheet WHERE order_id=o.id) AS lines
         FROM orders o WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [number])
    if (!rows.length) { skipped.push([number, 'order nahi mila']); continue }
    const o = rows[0]

    const free = rawItems === F
    const shipping = num(rawShip)
    const total = num(rawTotal)
    let subtotal = num(rawItems)

    // The sheet sometimes named a total without splitting out the items.
    if (subtotal === 0 && total > shipping) {
      subtotal = +(total - shipping).toFixed(2)
      derived.push([number, subtotal, total, shipping])
    }
    const reconciles = Math.abs(subtotal + shipping - total) < 0.005
    if (!reconciles) {
      skipped.push([number, `${money(subtotal)} + ${money(shipping)} = ${money(subtotal + shipping)}, magar total ${money(total)}`])
      continue
    }
    planned.push({ id: o.id, number, subtotal, shipping, total, free, lines: Number(o.lines),
                   was: { subtotal: Number(o.subtotal), shipping: Number(o.shipping), total: Number(o.total), free: o.is_free } })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('order          lines  subtotal      shipping    total        free')
  console.log('-'.repeat(72))
  for (const p of planned) {
    console.log(`${p.number}  ${String(p.lines).padStart(3)}   ${money(p.was.subtotal).padStart(9)}→${money(p.subtotal).padStart(9)} ${money(p.shipping).padStart(8)} ${money(p.total).padStart(10)}   ${p.free ? 'HAAN' : ''}`)
  }
  if (derived.length) {
    console.log(`\nSheet mein item ka khaana khaali tha, total se nikala (total - shipping):`)
    for (const [n, s, t, sh] of derived) console.log(`  ${n}  ${money(t)} - ${money(sh)} = ${money(s)}`)
  }
  if (skipped.length) {
    console.log(`\nCHHORE GAYE — hisaab nahi baith raha, andaza nahi lagaya:`)
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  const free = planned.filter(p => p.free)
  console.log(`\nlagne wale: ${planned.length}   free: ${free.length}   chhore gaye: ${skipped.length}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  let done = 0
  for (const p of planned) {
    await query(
      `UPDATE orders SET subtotal = $2, shipping_charges = $3, total = $4, is_free = $5,
              updated_at = NOW()
         WHERE id = $1`, [p.id, p.subtotal, p.shipping, p.total, p.free])
    // Only where a single line owns the whole amount — splitting an aggregate
    // across several lines would be invention.
    if (p.lines === 1 && p.subtotal > 0) {
      for (const t of ['order_items_apparel', 'order_items_dtf', 'order_items_gangsheet']) {
        await query(`UPDATE ${t} SET amount = $2 WHERE order_id = $1`, [p.id, p.subtotal])
      }
    }
    done++
  }
  console.log(`\n${done} orders update ho gaye.\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
