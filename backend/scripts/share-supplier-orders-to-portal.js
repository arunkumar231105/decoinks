#!/usr/bin/env node
/**
 * Share a supplier's orders with the Fulfillment Portal.
 *
 * The portal deliberately shows a vendor nothing until an order is published to
 * them — portal_order_visibility is that gate. It was empty, so every vendor saw
 * an empty dashboard. This publishes exactly the orders that already sit behind
 * that supplier's own purchase orders; no other customer's work is exposed.
 *
 * Idempotent: an order already shared with this supplier is re-activated rather
 * than duplicated.
 *
 * Usage:
 *   node backend/scripts/share-supplier-orders-to-portal.js <supplierId>            (dry-run)
 *   node backend/scripts/share-supplier-orders-to-portal.js <supplierId> --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const supplierId = process.argv.find(a => /^[0-9a-f-]{36}$/i.test(a))
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  if (!supplierId) throw new Error('Pass the supplier id as an argument')
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [supplier] } = await client.query('SELECT name FROM suppliers WHERE id = $1', [supplierId])
    if (!supplier) throw new Error('No such supplier')

    // Orders reachable through this supplier's purchase orders.
    const { rows: orders } = await client.query(
      `SELECT DISTINCT o.id, o.order_number, o.status::text AS status, o.order_date,
              (SELECT count(*) FROM portal_order_visibility v
                WHERE v.order_id = o.id AND v.supplier_id = $1 AND v.is_visible)::int AS already
         FROM purchase_orders pu
         JOIN orders o ON o.id = pu.order_id
        WHERE pu.supplier_id = $1 AND o.deleted_at IS NULL
        ORDER BY o.order_date DESC NULLS LAST`,
      [supplierId]
    )

    const fresh = orders.filter(o => !o.already)
    console.log(`Supplier: ${supplier.name}`)
    console.log(`Orders behind their POs: ${orders.length} — already shared: ${orders.length - fresh.length}, to share: ${fresh.length}`)
    fresh.slice(0, 10).forEach(o => console.log(`  + ${o.order_number}  ${o.status}`))
    if (fresh.length > 10) console.log(`  … and ${fresh.length - 10} more`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    // The importing user is only needed for provenance on the visibility row.
    const { rows: [actor] } = await client.query(
      `SELECT id FROM users WHERE is_active AND role = 'Admin' ORDER BY created_at LIMIT 1`)

    await client.query('BEGIN')
    let shared = 0
    for (const o of orders) {
      const { rowCount } = await client.query(
        `UPDATE portal_order_visibility
            SET is_visible = TRUE, sent_at = COALESCE(sent_at, NOW())
          WHERE order_id = $1 AND supplier_id = $2`,
        [o.id, supplierId]
      )
      if (!rowCount) {
        await client.query(
          `INSERT INTO portal_order_visibility (order_id, supplier_id, sent_by, sent_at, is_visible)
           VALUES ($1, $2, $3, NOW(), TRUE)`,
          [o.id, supplierId, actor?.id ?? null]
        )
      }
      shared++
    }
    await client.query('COMMIT')
    console.log(`\nShared ${shared} order(s) with ${supplier.name}.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
