#!/usr/bin/env node
/**
 * Give ten live customers their real number back.
 *
 * When the document series were tidied, deleted rows had their numbers parked
 * under a D- prefix so the renumbering could not collide with them — D- plus a
 * slice of the row's id, which is not a number anyone can read or search. Ten
 * customers who are very much alive are still wearing one: Trina Nez, Enrique
 * Vasquez, Bar Nel, Christine Calhoun, George Rogers, Mark Taylor, Audrey
 * Tapia, Darrel DeBree, Jim Callahan, John Lilly. Every one of them has live
 * orders against their name.
 *
 * They are appended, not inserted. CUST-2026-0001 through 0068 are in use with
 * no holes, so these ten take 0069 to 0078 and not one existing customer's
 * number moves. They are ordered by the day they were created, so the numbers
 * still run in the order the shop met them.
 *
 * customer_number lives in exactly one place — there is no denormalised copy of
 * it anywhere in the database, and nothing joins on it — so this changes what
 * the customer is called and nothing else.
 *
 * Usage:
 *   node backend/scripts/restore-parked-customer-numbers.js            (dry-run)
 *   node backend/scripts/restore-parked-customer-numbers.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows: parked } = await client.query(`
      SELECT c.id, c.customer_number, c.name, c.created_at::date AS created,
             (SELECT count(*) FROM orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL)::int AS orders
        FROM customers c
       WHERE c.deleted_at IS NULL AND c.customer_number LIKE 'D-%'
       ORDER BY c.created_at, c.name`)

    const year = new Date().getFullYear()
    const { rows: [high] } = await client.query(`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(customer_number, '-', 3) AS int)), 0) AS n
        FROM customers WHERE customer_number ~ ('^CUST-' || $1 || '-[0-9]+$')`, [String(year)])

    console.log(`Live customers still parked under a D- number: ${parked.length}`)
    console.log(`Highest number in use: CUST-${year}-${String(high.n).padStart(4, '0')}\n`)

    let next = Number(high.n)
    const plan = parked.map(p => ({ ...p, to: `CUST-${year}-${String(++next).padStart(4, '0')}` }))
    for (const p of plan) {
      console.log(`  ${p.customer_number}  →  ${p.to}   ${p.name}  (joined ${p.created}, ${p.orders} live order${p.orders === 1 ? '' : 's'})`)
    }

    // Nothing may be about to collide.
    const { rows: [clash] } = await client.query(
      `SELECT count(*)::int AS n FROM customers WHERE customer_number = ANY($1)`,
      [plan.map(p => p.to)])
    console.log(`\nNumbers already taken by someone else: ${clash.n}${clash.n ? '   ✗' : '   ✓'}`)
    if (clash.n) throw new Error('One of the new numbers is already in use — nothing was written.')

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!plan.length) { console.log('\nNothing to restore.'); return }

    const before = (await client.query(
      `SELECT count(*)::int AS n FROM customers WHERE deleted_at IS NULL`)).rows[0].n

    await client.query('BEGIN')
    for (const p of plan) {
      await client.query(
        `UPDATE customers SET customer_number = $2, updated_at = NOW() WHERE id = $1`, [p.id, p.to])
    }
    // The counter is a high-water mark; bring it up so the next customer does
    // not try to reuse one of these.
    await client.query(
      `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
       ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(counters.last_value, EXCLUDED.last_value), updated_at = NOW()`,
      [`CUST-${year}`, next])

    const { rows: [after] } = await client.query(`
      SELECT count(*)::int AS live,
             count(*) FILTER (WHERE customer_number LIKE 'D-%')::int AS still_parked,
             count(DISTINCT customer_number)::int AS distinct_numbers
        FROM customers WHERE deleted_at IS NULL`)

    if (after.live !== before || after.still_parked !== 0 || after.distinct_numbers !== after.live) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — customers ${before} → ${after.live}, still parked ${after.still_parked}, ` +
        `distinct numbers ${after.distinct_numbers} of ${after.live}`)
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nRestored ${plan.length} customer number(s).`)
    console.log(`  live customers: ${after.live} (unchanged)`)
    console.log(`  still parked under D-: ${after.still_parked}   ✓`)
    console.log(`  every number unique: ${after.distinct_numbers === after.live ? 'yes' : 'no'}   ✓`)
    console.log(`  counter CUST-${year} now at ${next}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
