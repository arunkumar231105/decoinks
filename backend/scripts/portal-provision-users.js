/**
 * Provision a customer-portal login for every customer that has at least one
 * order and no account yet. Idempotent: existing accounts keep their username
 * (password is NOT reset for them). Default password for new accounts is taken
 * from PORTAL_DEFAULT_PASSWORD, else the shop default below.
 *
 * Run:  node scripts/portal-provision-users.js
 */
const bcrypt = require('bcryptjs')
const { query } = require('../src/config/db')

const PASSWORD = process.env.PORTAL_DEFAULT_PASSWORD
if (!PASSWORD) {
  console.error('PORTAL_DEFAULT_PASSWORD is required. The shop default is not kept in source —')
  console.error('it would be published with the repo. Pass it in the environment instead.')
  process.exit(1)
}
const CREATED_BY = process.env.PORTAL_SYNC_USER || 'a26a3675-82b0-4854-aae5-562a03dbe254'

const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'customer'

async function main() {
  const { rows: customers } = await query(`
    SELECT c.id, c.name
      FROM customers c
     WHERE c.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM customer_portal_users u WHERE u.customer_id = c.id)
     ORDER BY c.name`)

  const { rows: taken } = await query(`SELECT lower(username) AS u FROM customer_portal_users`)
  const used = new Set(taken.map(r => r.u))
  const hash = await bcrypt.hash(PASSWORD, 12)

  let created = 0
  for (const c of customers) {
    let base = slug(c.name), username = base, n = 1
    while (used.has(username.toLowerCase())) username = `${base}${++n}`
    used.add(username.toLowerCase())
    try {
      await query(
        `INSERT INTO customer_portal_users (customer_id, username, password_hash, is_active, must_change_pw, created_by)
         VALUES ($1,$2,$3,TRUE,FALSE,$4)
         ON CONFLICT (customer_id) DO NOTHING`,
        [c.id, username, hash, CREATED_BY])
      created++
      console.log(`${c.name.padEnd(26)} -> ${username}`)
    } catch (e) { console.log(`FAIL ${c.name}: ${e.message}`) }
  }
  console.log(`\nProvisioned ${created} new portal accounts with the password you supplied.`)
  process.exit(0)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
