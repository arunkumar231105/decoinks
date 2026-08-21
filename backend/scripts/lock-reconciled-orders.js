#!/usr/bin/env node
/**
 * Seal the reconciled TSI batch: 97 sales orders and 97 purchase orders.
 *
 * These have been checked line by line against the owner's two sheets — 88 DTF
 * transfer orders from the TSI sheet and 9 custom apparel orders from the TS-PA
 * sheet — with their money, tracking, statuses and payments reconciled. Locking
 * them stops a later edit quietly undoing that work, which matters now that
 * DIGI orders are about to land in the same tables.
 *
 * WHAT LOCKING DOES. `locked_at` is set, and orders.service.update() and
 * po.service.update() refuse to write to a locked record (HTTP 423) — amounts,
 * items, addresses and customer become read-only. Status is deliberately NOT
 * blocked: these are live jobs that still have to move In Production → Shipped
 * → Delivered, and those go through updateStatus() and the state machine.
 *
 * It also stamps sales_channel = 'TSI', so the two intake routes can be told
 * apart on screen and in the export once DIGI orders exist alongside them.
 * order_type cannot do this — both channels carry apparel — and source_system
 * cannot either, being a different per-import string on every batch.
 *
 * Unlocking is a deliberate act: --unlock reverses it for the same records.
 * There is no database trigger behind this, so a reviewed data script can still
 * correct a locked row when that is genuinely intended.
 *
 * Idempotent. One transaction, dry-run by default.
 *
 * Usage:
 *   node backend/scripts/lock-reconciled-orders.js            (dry-run)
 *   node backend/scripts/lock-reconciled-orders.js --apply
 *   node backend/scripts/lock-reconciled-orders.js --unlock --apply
 */
const { Pool } = require('pg')

const APPLY  = process.argv.includes('--apply')
const UNLOCK = process.argv.includes('--unlock')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// The reconciled batch: DTF orders, plus the apparel ones carrying a TS-PA
// reference. coalesce() matters — `NULL LIKE` is NULL, not false.
const ORDER_SCOPE = `deleted_at IS NULL
  AND (order_type = 'dtf' OR COALESCE(source_po_number,'') LIKE 'TS-PA-%')`
const PO_SCOPE = `deleted_at IS NULL
  AND (po_type = 'gangsheet' OR COALESCE(source_po_number,'') LIKE 'TS-PA-%')`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [actor] } = await client.query(
      `SELECT id FROM users WHERE email = 'info@technocas.com' LIMIT 1`)

    let orders, pos, channel = 0
    if (UNLOCK) {
      ;({ rows: orders } = await client.query(
        `UPDATE orders SET locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE ${ORDER_SCOPE} AND locked_at IS NOT NULL RETURNING order_number`))
      ;({ rows: pos } = await client.query(
        `UPDATE purchase_orders SET locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE ${PO_SCOPE} AND locked_at IS NOT NULL RETURNING po_number`))
    } else {
      ;({ rows: orders } = await client.query(
        `UPDATE orders SET locked_at = NOW(), locked_by = $1, updated_at = NOW()
          WHERE ${ORDER_SCOPE} AND locked_at IS NULL RETURNING order_number`,
        [actor ? actor.id : null]))
      ;({ rows: pos } = await client.query(
        `UPDATE purchase_orders SET locked_at = NOW(), locked_by = $1, updated_at = NOW()
          WHERE ${PO_SCOPE} AND locked_at IS NULL RETURNING po_number`,
        [actor ? actor.id : null]))
      const { rowCount } = await client.query(
        `UPDATE orders SET sales_channel = 'TSI', updated_at = NOW()
          WHERE ${ORDER_SCOPE} AND sales_channel IS DISTINCT FROM 'TSI'`)
      channel = rowCount
    }

    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::int AS locked,
              COUNT(*) FILTER (WHERE sales_channel = 'TSI')::int AS tsi,
              COUNT(*) FILTER (WHERE sales_channel IS NULL)::int AS no_channel
         FROM orders WHERE deleted_at IS NULL`)
    const { rows: [p] } = await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::int AS locked
         FROM purchase_orders WHERE deleted_at IS NULL`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') +
                (UNLOCK ? '  (UNLOCK)' : '') + '\n')
    console.log(`  Sales orders ${UNLOCK ? 'unlocked' : 'locked'}:    ${orders.length}`)
    console.log(`  Purchase orders ${UNLOCK ? 'unlocked' : 'locked'}: ${pos.length}`)
    if (channel) console.log(`  Marked sales_channel = TSI:   ${channel}`)
    console.log('\nResulting state')
    console.log(`  Sales orders     ${c.total}, of which ${c.locked} locked, ${c.tsi} on the TSI channel`)
    console.log(`  Purchase orders  ${p.total}, of which ${p.locked} locked`)
    if (c.no_channel) console.log(`  Orders with no channel yet: ${c.no_channel}  (DIGI orders, once imported)`)

    if (APPLY) { await client.query('COMMIT'); console.log('\nCommitted.') }
    else { await client.query('ROLLBACK'); console.log('\nRolled back. Re-run with --apply to keep these changes.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
