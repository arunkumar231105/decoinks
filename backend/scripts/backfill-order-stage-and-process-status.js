#!/usr/bin/env node
/**
 * Backfill orders.order_stage and orders.process_status from the combined
 * orders.status, for every row written before migration 103.
 *
 * The mapping is the same one orders.service.js uses, so a row backfilled here
 * and a row written by the service afterwards agree:
 *
 *   status          order_stage   process_status
 *   Draft           Draft         (none — nothing has gone to the floor yet)
 *   Confirmed       Sent          Pushed
 *   In Production   Sent          In Production
 *   QC              Sent          QC
 *   Ready to Ship   Sent          Completed
 *   Shipped         Sent          Shipped
 *   Delivered       Sent          Delivered
 *   Cancelled       Sent          Cancelled
 *
 * Confirmed → Pushed and Ready to Ship → Completed are the only two that are a
 * rename rather than a copy; owner-approved. Neither value is in use on any
 * current row, so both are for orders written from here on.
 *
 * `orders.status` is not touched — it stays the column the state machine drives.
 * Only rows where the split columns are still empty are written, so a re-run is
 * a no-op and a hand-set stage is never overwritten.
 *
 * Usage:
 *   node backend/scripts/backfill-order-stage-and-process-status.js            (dry-run)
 *   node backend/scripts/backfill-order-stage-and-process-status.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

const SET_STAGE = `CASE WHEN status = 'Draft' THEN 'Draft' ELSE 'Sent' END`
const SET_PROCESS = `CASE status::text
    WHEN 'Draft'         THEN NULL
    WHEN 'Confirmed'     THEN 'Pushed'
    WHEN 'Ready to Ship' THEN 'Completed'
    ELSE status::text
  END`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: before } = await client.query(
      `SELECT status::text AS status, COUNT(*)::int AS n
         FROM orders
        WHERE deleted_at IS NULL AND (order_stage IS NULL OR (process_status IS NULL AND status <> 'Draft'))
        GROUP BY 1 ORDER BY 1`)

    const { rowCount } = await client.query(
      `UPDATE orders
          SET order_stage    = COALESCE(order_stage, ${SET_STAGE}),
              process_status = COALESCE(process_status, ${SET_PROCESS}),
              updated_at     = NOW()
        WHERE deleted_at IS NULL
          AND (order_stage IS NULL OR (process_status IS NULL AND status <> 'Draft'))`)

    const { rows: after } = await client.query(
      `SELECT COALESCE(order_stage,'(none)') AS stage,
              COALESCE(process_status,'(none)') AS process,
              COUNT(*)::int AS n
         FROM orders WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log('Rows needing a backfill, by current status:')
    for (const r of before) console.log(`  ${r.status.padEnd(16)} ${r.n}`)
    if (!before.length) console.log('  (none)')
    console.log(`\nRows written: ${rowCount}`)
    console.log('\nResulting split, all orders:')
    for (const r of after) console.log(`  ${r.stage.padEnd(8)} / ${r.process.padEnd(15)} ${r.n}`)

    if (APPLY) {
      await client.query('COMMIT')
      console.log('\nCommitted.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nRolled back. Re-run with --apply to keep these changes.')
    }
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
