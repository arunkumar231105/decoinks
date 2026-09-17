/**
 * Refresh digi_orders from the DIGI API — the data behind Printshop's Supplier
 * Order Management page. Read-only towards DIGI. Runs every two minutes from
 * cron (scripts/cron/digi-orders.sh). Dry run by default; --apply writes.
 */
const { pool } = require('../src/config/db')
const { syncDigiOrders } = require('../src/modules/supplier-orders/digi.sync')

syncDigiOrders({ apply: process.argv.includes('--apply') })
  .then(async () => { await pool.end() })
  .catch(async (err) => { console.error('[digi-sync] failed:', err.message); await pool.end(); process.exit(1) })
