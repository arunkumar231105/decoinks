#!/usr/bin/env node
/**
 * Data fix — separate the account from the ship-to recipient for the
 * Mamlouk record (CUST-CRM-22DD31C4E0).
 *
 * Current (wrong) state:
 *   name/first/last = "Moutaz Mamlouk"   (the actual customer)
 *   company_name/company = "Bashar Mamlouk"  (NOT a company — he is the
 *                                             person the order ships to)
 * Because display_name = COALESCE(company_name, company, name), the customer
 * wrongly shows as "Bashar Mamlouk" everywhere.
 *
 * Fix:
 *   1. Put "Bashar Mamlouk" into the shipping address contact_person (the new
 *      ship-to / attention field added in migration 080).
 *   2. Clear company_name/company so the account correctly reads as
 *      "Moutaz Mamlouk" (display name + contact person).
 *
 * Requires migration 080 (customer_addresses.contact_person) to be applied.
 *
 * Usage:
 *   node backend/scripts/fix-mamlouk-ship-to-contact.js            (dry-run)
 *   node backend/scripts/fix-mamlouk-ship-to-contact.js --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const CUSTOMER_NUMBER = 'CUST-CRM-22DD31C4E0'
const SHIP_TO = 'Bashar Mamlouk'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, customer_number, name, first_name, last_name, company_name, company
         FROM customers WHERE customer_number = $1 AND deleted_at IS NULL`,
      [CUSTOMER_NUMBER]
    )
    const cust = rows[0]
    if (!cust) { console.log(`Customer ${CUSTOMER_NUMBER} not found — nothing to do.`); return }

    const { rows: addrs } = await client.query(
      `SELECT id, address_type, contact_person, line1, city, state, zipcode
         FROM customer_addresses WHERE customer_id = $1 ORDER BY address_type`,
      [cust.id]
    )
    const shipping = addrs.find(a => a.address_type === 'shipping')

    console.log('Before:')
    console.log(`  name=${cust.name}  company_name=${cust.company_name}  company=${cust.company}`)
    console.log(`  shipping address: ${shipping ? [shipping.line1, shipping.city, shipping.state, shipping.zipcode].filter(Boolean).join(', ') : '(none)'}`)
    console.log(`  shipping contact_person (now): ${shipping?.contact_person ?? '(none)'}`)
    console.log(`\nWill set shipping contact_person = "${SHIP_TO}" and clear company_name/company.`)

    if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to commit.'); return }

    // Backup the current row + addresses before writing.
    const outDir = path.join(__dirname, '..', '..', 'exports')
    fs.mkdirSync(outDir, { recursive: true })
    const rollbackPath = path.join(outDir, 'rollback-mamlouk-ship-to.sql')
    fs.writeFileSync(
      rollbackPath,
      `-- Rollback for fix-mamlouk-ship-to-contact.js\nBEGIN;\n` +
      `UPDATE customers SET company_name=${sqlLit(cust.company_name)}, company=${sqlLit(cust.company)} WHERE id='${cust.id}';\n` +
      (shipping ? `UPDATE customer_addresses SET contact_person=${sqlLit(shipping.contact_person)} WHERE id='${shipping.id}';\n` : '') +
      `COMMIT;\n`
    )
    console.log(`\nRollback written: ${rollbackPath}`)

    await client.query('BEGIN')
    // Ensure a shipping address row exists to hold the contact person.
    if (shipping) {
      await client.query(
        `UPDATE customer_addresses SET contact_person = $1 WHERE id = $2`,
        [SHIP_TO, shipping.id]
      )
    } else {
      await client.query(
        `INSERT INTO customer_addresses (customer_id, address_type, contact_person, is_default)
         VALUES ($1, 'shipping', $2, TRUE)`,
        [cust.id, SHIP_TO]
      )
    }
    await client.query(
      `UPDATE customers SET company_name = NULL, company = NULL, updated_at = NOW() WHERE id = $1`,
      [cust.id]
    )
    await client.query('COMMIT')
    console.log('Applied. Customer now reads as "Moutaz Mamlouk"; ship-to contact = "Bashar Mamlouk".')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* no tx */ }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

function sqlLit(v) { return v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'` }

main().catch(err => { console.error(err); process.exit(1) })
