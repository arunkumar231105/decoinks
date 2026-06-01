require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function runMigrations() {
  const migrationsDir = path.join(__dirname)
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.includes('_down'))
    .sort()

  if (!files.length) {
    console.log('No migration files found.')
    process.exit(0)
  }

  const client = await pool.connect()
  try {
    // migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    for (const file of files) {
      const { rows } = await client.query(
        `SELECT filename FROM _migrations WHERE filename = $1`, [file]
      )
      if (rows.length) {
        console.log(`  SKIP  ${file} (already applied)`)
        continue
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [file])
        await client.query('COMMIT')
        console.log(`  OK    ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`  FAIL  ${file}: ${err.message}`)
        process.exit(1)
      }
    }

    console.log('\nAll migrations complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

runMigrations().catch((err) => {
  console.error('Migration runner error:', err.message)
  process.exit(1)
})
