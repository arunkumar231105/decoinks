#!/usr/bin/env node
/**
 * Data fix — restore the "Same as Shipping Address" tick on customers.
 *
 * Why: `scripts/update-structured-customers.js` hard-set `same_as_shipping=FALSE`
 * for every customer it re-imported, so 39 customers show the billing checkbox
 * unticked even though they have a shipping address and no separate billing
 * address. This script ticks the flag back on for exactly those rows.
 *
 * Scope (deliberately narrow — the flag column only):
 *   customers WHERE deleted_at IS NULL
 *             AND same_as_shipping IS NOT TRUE
 *             AND a shipping address exists (address_line1 non-empty)
 *
 * It never touches billing_address, customer_addresses, or any other column.
 *
 * Usage:
 *   node backend/scripts/fix-customer-same-as-shipping.js --dry-run   (default)
 *   node backend/scripts/fix-customer-same-as-shipping.js --apply
 *
 * A rollback file is written to exports/ before any write.
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SELECT_TARGETS = `
  SELECT id, customer_number, name, same_as_shipping
    FROM customers
   WHERE deleted_at IS NULL
     AND same_as_shipping IS DISTINCT FROM TRUE
     AND NULLIF(TRIM(address_line1), '') IS NOT NULL
   ORDER BY customer_number
`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: targets } = await client.query(SELECT_TARGETS)

    console.log(`Customers to tick "Same as Shipping Address": ${targets.length}`)
    targets.forEach(r => console.log(`  ${r.customer_number.padEnd(22)} ${r.name}`))

    if (!targets.length) { console.log('Nothing to do.'); return }

    if (!APPLY) {
      console.log('\nDRY RUN — no rows written. Re-run with --apply to commit.')
      return
    }

    // Rollback file first (Constitution §6: back up before any bulk data fix).
    const outDir = path.join(__dirname, '..', '..', 'exports')
    fs.mkdirSync(outDir, { recursive: true })
    const rollbackPath = path.join(outDir, 'rollback-same-as-shipping.sql')
    fs.writeFileSync(
      rollbackPath,
      `-- Rollback for fix-customer-same-as-shipping.js\n` +
      `-- Restores same_as_shipping to its pre-fix value for the ${targets.length} affected rows.\n` +
      `BEGIN;\n` +
      targets
        .map(r => `UPDATE customers SET same_as_shipping=${r.same_as_shipping === null ? 'NULL' : r.same_as_shipping} WHERE id='${r.id}'; -- ${r.customer_number}`)
        .join('\n') +
      `\nCOMMIT;\n`
    )
    console.log(`\nRollback written: ${rollbackPath}`)

    await client.query('BEGIN')
    const { rowCount } = await client.query(
      `UPDATE customers
          SET same_as_shipping = TRUE,
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [targets.map(r => r.id)]
    )
    await client.query('COMMIT')
    console.log(`Updated ${rowCount} customers.`)
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* no open tx */ }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
