/**
 * The factories, under the names the shop actually uses.
 *
 * Two suppliers carry all 156 purchase orders, and neither is named the way
 * anyone here says it. Worse, one of them is really two: TEXSTONE prints DTF
 * transfers on 101 orders and cuts apparel on 9, and a single vendor row for
 * both means the list cannot tell you which factory a job went to.
 *
 *   Xin Fei Yang Factory  46 apparel  ->  DIGI
 *   TEXSTONE INC         101 dtf      ->  TSI Transfers
 *   TEXSTONE INC           9 apparel  ->  TSI Apparel   (a supplier of its own)
 *
 * The split moves purchase orders between suppliers; it writes nothing to the
 * orders behind them, and no PO changes its number.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

async function main() {
  const apply = process.argv.includes('--apply')

  const plan = (await query(
    `SELECT s.name AS vendor, COALESCE(o.order_type::text, '(no order)') AS product,
            count(*)::INT AS pos
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN orders o ON o.id = po.order_id
      WHERE po.deleted_at IS NULL AND s.name IN ('Xin Fei Yang Factory', 'TEXSTONE INC')
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`)).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const r of plan) {
    const to = r.vendor === 'Xin Fei Yang Factory' ? 'DIGI'
      : r.product === 'apparel' ? 'TSI Apparel' : 'TSI Transfers'
    console.log(`  ${r.vendor.padEnd(21)} ${String(r.pos).padStart(3)} ${r.product.padEnd(10)} -> ${to}`)
  }
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    // Renames: the same factory, called what the shop calls it.
    await query(`UPDATE suppliers SET name = 'DIGI', company = 'DIGI', updated_at = NOW()
                  WHERE name = 'Xin Fei Yang Factory'`)
    await query(`UPDATE suppliers SET name = 'TSI Transfers', company = 'TSI Transfers', updated_at = NOW()
                  WHERE name = 'TEXSTONE INC'`)

    // The apparel half becomes its own supplier, built from the row it leaves.
    const { rows: made } = await query(
      `INSERT INTO suppliers (name, company, country, status, notes, created_by, created_at, updated_at)
       SELECT 'TSI Apparel', 'TSI Apparel', country, status,
              'Apparel side of TEXSTONE, split out so a job names the factory that made it',
              created_by, NOW(), NOW()
         FROM suppliers WHERE name = 'TSI Transfers'
       RETURNING id`)
    const apparelSupplier = made[0].id

    // Only the apparel purchase orders move across.
    const { rowCount: moved } = await query(
      `UPDATE purchase_orders po
          SET supplier_id = $1, vendor_name = 'TSI Apparel', updated_at = NOW()
         FROM orders o
        WHERE o.id = po.order_id AND po.deleted_at IS NULL
          AND o.order_type::text = 'apparel'
          AND po.supplier_id = (SELECT id FROM suppliers WHERE name = 'TSI Transfers')`,
      [apparelSupplier])

    // vendor_name is a snapshot on each PO and would otherwise still read the
    // old factory name in the list.
    await query(
      `UPDATE purchase_orders po SET vendor_name = s.name, updated_at = NOW()
         FROM suppliers s
        WHERE s.id = po.supplier_id AND po.deleted_at IS NULL
          AND s.name IN ('DIGI', 'TSI Transfers')
          AND po.vendor_name IS DISTINCT FROM s.name`)

    await query('COMMIT')
    console.log(`\n  TSI Apparel bana, ${moved} apparel PO us par le gaye`)
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT COALESCE(s.name, '(none)') AS vendor, count(*)::INT AS pos
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`)).rows
  console.log('\n  ab:')
  for (const r of after) console.log(`    ${r.vendor.padEnd(16)} ${String(r.pos).padStart(3)} POs`)
  console.log('')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
