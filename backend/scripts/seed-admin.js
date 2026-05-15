'use strict'

/**
 * Creates the first Admin user in the database.
 * Usage:
 *   node scripts/seed-admin.js
 *   ADMIN_NAME="Arun" ADMIN_EMAIL="arun@decoinks.com" ADMIN_PASSWORD="mypassword" node scripts/seed-admin.js
 */

require('dotenv').config()
const readline = require('readline')
const bcrypt   = require('bcryptjs')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n=== Decoinks — First Admin Setup ===\n')

  const { rows } = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'Admin'`)
  const adminCount = parseInt(rows[0].count, 10)
  if (adminCount > 0) {
    console.log(`An Admin account already exists (${adminCount} found). Exiting.\n`)
    await pool.end()
    rl.close()
    process.exit(0)
  }

  const name     = process.env.ADMIN_NAME     || await ask(rl, 'Full name:     ')
  const email    = process.env.ADMIN_EMAIL    || await ask(rl, 'Email address: ')
  const password = process.env.ADMIN_PASSWORD || await ask(rl, 'Password (min 8 chars): ')

  if (!name.trim() || !email.trim() || password.length < 8) {
    console.error('\nError: All fields are required and password must be at least 8 characters.')
    await pool.end()
    rl.close()
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 10)

  await pool.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'Admin')
     ON CONFLICT (email) DO UPDATE
       SET password = EXCLUDED.password,
           role     = 'Admin',
           is_active = TRUE`,
    [name.trim(), email.trim().toLowerCase(), hash]
  )

  console.log(`\nAdmin account created successfully!`)
  console.log(`  Email: ${email.trim().toLowerCase()}`)
  console.log(`  Role:  Admin\n`)

  await pool.end()
  rl.close()
}

main().catch((err) => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
