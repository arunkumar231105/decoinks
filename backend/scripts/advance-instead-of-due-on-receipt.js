#!/usr/bin/env node
'use strict'

/**
 * Due on Receipt is retired; the shop's terms are Advance.
 *
 * The owner's word: this shop is paid before the work starts, so no document
 * should say the money is due when the goods arrive. "Due on Receipt" was only
 * ever the default the forms and the services filled in, never a term anyone
 * chose. Invoices, sales orders and quotations that carry it are moved to
 * Advance; Net 15 / Net 30 / Paid are left as they are.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
// Customer records are not touched: chk_customers_payment_terms does not allow
// Advance, and widening it is a schema change for the owner to approve.
const TABLES = ['invoices', 'orders', 'quotations']

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')
    for (const t of TABLES) {
      const { rowCount } = await client.query(
        `UPDATE ${t} SET payment_terms = 'Advance', updated_at = NOW()
          WHERE payment_terms = 'Due on Receipt' AND deleted_at IS NULL`)
      console.log(`   ${t.padEnd(11)} ${rowCount} -> Advance`)
    }
    if (APPLY) { await client.query('COMMIT'); console.log('\nWritten.') }
    else { await client.query('ROLLBACK'); console.log('\nNothing written. Re-run with --apply.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
