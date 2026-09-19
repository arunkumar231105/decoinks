/**
 * Finds what happened in Printshop since the last run and notifies everyone:
 * payments, DIGI shipping, deliveries, stuck parcels, new claims
 * (src/modules/notifications). Runs every minute from host cron
 * (scripts/cron/notifications.sh).
 */
const { pool } = require('../src/config/db')
const { watch } = require('../src/modules/notifications/notifications.service')

watch()
  .then(async () => { await pool.end() })
  .catch(async (err) => { console.error('[notify] failed:', err.message); await pool.end(); process.exit(1) })
