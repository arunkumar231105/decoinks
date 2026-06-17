/**
 * ensure-baseline.js
 *
 * Runs before migrations/run.js on every container start.
 * Handles two scenarios:
 *
 *  A) Docker-init database (fresh volume):
 *     The Postgres init scripts (01_init.sql → 03_supplier_rename.sql)
 *     already created the full schema through migration ~017.  The
 *     _migrations tracking table does NOT exist yet.  We create it and
 *     mark 001–017 as already applied so run.js only applies 018+.
 *
 *  B) Existing database where run.js was previously used:
 *     _migrations already has rows → we leave it alone and let run.js
 *     handle anything missing.
 *
 * In both cases we always mark 001_setup.sql as applied because it is
 * a test-only monolith that conflicts with the incremental sequence
 * (it creates the suppliers table directly, clashing with 015_supplier_rename
 * which expects a customers table to rename).
 */

require('dotenv').config()
const { Pool } = require('pg')

// Migrations applied by the Docker init SQL files (not by run.js).
// These will be pre-seeded into _migrations so run.js skips them.
const DOCKER_INIT_MIGRATIONS = [
  '001_extensions_enums.sql',
  '002_create_tables.sql',
  '003_artwork_status.sql',
  '004_leads_pipeline_columns.sql',
  '005_quotations_revision_fields.sql',
  '006_invoices_pipeline_columns.sql',
  '007_orders_pipeline_columns.sql',
  '008_purchase_orders_enhance.sql',
  '009_create_vendors_table.sql',
  '010_create_payments_table.sql',
  '011_create_pipeline_events_table.sql',
  // NOTE: 013_refresh_tokens.sql is intentionally NOT listed here.
  // db/init.sql does not create refresh_tokens, so migration 013 must
  // run via run.js to actually create the table.
  '014_quotations_order_type.sql',
  '015_supplier_rename.sql',
]

// Always skip this file regardless — it's a test helper that creates the
// full schema in one shot and conflicts with the incremental sequence.
const TEST_ONLY_FILE = '001_setup.sql'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const client = await pool.connect()
  try {
    // ── 1. Ensure the tracking table exists ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    // ── 2. Always mark 001_setup.sql as applied (test-only, skip forever) ───
    await client.query(
      `INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
      [TEST_ONLY_FILE]
    )

    // ── 3. Detect whether this is a Docker-init database ────────────────────
    //    Condition: _migrations has only the test-only row we just inserted
    //    (i.e. it was empty before) AND the suppliers table exists.
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM _migrations WHERE filename != $1`,
      [TEST_ONLY_FILE]
    )

    if (rows[0].n > 0) {
      console.log('[ensure-baseline] _migrations already populated — skipping pre-seed')
      return
    }

    const res = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'suppliers'`
    )

    if (res.rows.length === 0) {
      // Truly fresh (empty) database — run.js will apply everything from scratch
      console.log('[ensure-baseline] Empty database detected — run.js will apply all migrations')
      return
    }

    // ── 4. Docker-init database: pre-seed 001–017 ────────────────────────────
    for (const filename of DOCKER_INIT_MIGRATIONS) {
      await client.query(
        `INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [filename]
      )
    }
    console.log(
      `[ensure-baseline] Docker-init database detected — pre-seeded ${DOCKER_INIT_MIGRATIONS.length} baseline migrations`
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[ensure-baseline] Fatal:', err.message)
  process.exit(1)
})
