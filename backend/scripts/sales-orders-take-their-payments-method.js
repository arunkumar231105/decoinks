/**
 * Every sales order takes the payment method of the payment that pays it.
 *
 * The reconciliation of 15 Sep 2026 found 115 paid sales orders whose method
 * differed from their payment's — 46 only in spelling ("zelle" / "Zelle"), 53
 * reading "other" or blank, the rest naming another method outright. The owner:
 * the method on the payment is right, and the order carries the same.
 *
 * Needs migration 137 (order_payment_method_of and its triggers), so run it
 * after the backend is deployed. Orders with no payment are left as they are.
 *
 *   node scripts/sales-orders-take-their-payments-method.js           dry run
 *   node scripts/sales-orders-take-their-payments-method.js --apply   write
 */
require('dotenv').config()
const { getClient, pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

;(async () => {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: [ready] } = await client.query(
      `SELECT to_regprocedure('public.order_payment_method_of(uuid)') IS NOT NULL AS ok`)
    if (!ready.ok) throw new Error('migration 137 has not run yet — deploy the backend first')

    const { rows } = await client.query(`
      SELECT o.id, o.order_number, o.payment_method AS was, public.order_payment_method_of(o.id) AS becomes
        FROM orders o
       WHERE o.deleted_at IS NULL
       ORDER BY o.order_number`)
    const change = rows.filter(r => r.becomes !== null && r.was !== r.becomes)
    const unpaid = rows.filter(r => r.becomes === null)

    console.log(APPLY ? '\n-- APPLYING --\n' : '\n-- DRY RUN (add --apply to write) --\n')
    const tally = new Map()
    for (const r of change) {
      const key = `${r.was ?? '(blank)'} → ${r.becomes}`
      tally.set(key, (tally.get(key) || 0) + 1)
    }
    console.log(`   ${change.length} of ${rows.length} sales orders change:`)
    for (const [key, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}  ${key}`)
    console.log('')
    for (const r of change) {
      console.log(`     ${r.order_number}  ${r.was ?? '(blank)'} → ${r.becomes}`)
      await client.query(`UPDATE orders SET payment_method = $1 WHERE id = $2`, [r.becomes, r.id])
    }
    console.log(`\n   left as they are (no payment): ${unpaid.map(r => `${r.order_number} ${r.was ?? '(blank)'}`).join(', ') || 'none'}`)

    // Proof 1: nothing still differs.
    const { rows: [left] } = await client.query(`
      SELECT count(*)::int AS n FROM orders o
       WHERE o.deleted_at IS NULL AND public.order_payment_method_of(o.id) IS NOT NULL
         AND o.payment_method IS DISTINCT FROM public.order_payment_method_of(o.id)`)
    if (left.n !== 0) throw new Error(`${left.n} sales orders still differ from their payment`)

    // Proof 2: the triggers hold, tried inside a savepoint that is undone.
    const { rows: [probe] } = await client.query(`
      SELECT o.id AS order_id, o.order_number, p.id AS payment_id, p.payment_number, p.payment_method
        FROM orders o JOIN payments p ON p.order_id = o.id
       WHERE o.deleted_at IS NULL ORDER BY o.order_number LIMIT 1`)
    await client.query('SAVEPOINT probe')
    const { rows: [typed] } = await client.query(
      `UPDATE orders SET payment_method = 'Wrong Method' WHERE id = $1 RETURNING payment_method`, [probe.order_id])
    if (typed.payment_method !== probe.payment_method) throw new Error('an order accepted a method its payment does not have')
    await client.query(`UPDATE payments SET payment_method = 'Venmo' WHERE id = $1`, [probe.payment_id])
    const { rows: [carried] } = await client.query(`SELECT payment_method FROM orders WHERE id = $1`, [probe.order_id])
    if (carried.payment_method !== 'Venmo') throw new Error('a payment method change did not reach its order')
    await client.query('ROLLBACK TO SAVEPOINT probe')
    console.log(`\n   triggers: ${probe.order_number} refused "Wrong Method" and kept ${probe.payment_method};` +
      ` changing ${probe.payment_number} to Venmo moved the order with it (tried and undone)`)

    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK')
    console.log(APPLY ? '\nWritten.' : '\nNothing written.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`\nFAILED: ${err.message} — rolled back`)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
})()
