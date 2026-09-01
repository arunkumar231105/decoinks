/**
 * David Farrar and Robert Farrar are one buyer, at one address —
 * 748 Alcovy Mill Park, Lawrenceville, GA 30045. The owner says keep Robert.
 *
 * Everything David holds moves across: the job he was invoiced for, its
 * purchase order, quote, invoice and payment, the two loose jobs that never
 * became orders, and 331 artwork files. The documents keep the numbers they
 * were issued under — an invoice the customer already holds does not get
 * renumbered because the file it hangs on changed — but the name written on
 * each is brought into line, or the customer list would say Robert while the
 * invoice list still said David.
 *
 * Two things cannot simply move:
 *   - The address. Robert already holds the same one, so David's copy is
 *     dropped rather than duplicated.
 *   - The portal login. One login per customer is enforced, and Robert has his
 *     own, so David's is switched off rather than moved.
 *
 * MONEY IS NOT TOUCHED. See the note this prints about $45.25.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const KEEP = 'CUST-2026-0042'   // Robert Farrar
const DROP = 'CUST-2026-0030'   // David Farrar

async function main() {
  const apply = process.argv.includes('--apply')

  const keep = (await query(`SELECT id, name FROM customers WHERE customer_number = $1`, [KEEP])).rows[0]
  const drop = (await query(`SELECT id, name FROM customers WHERE customer_number = $1`, [DROP])).rows[0]
  if (!keep || !drop) throw new Error('dono customers nahi mile')

  const MOVES = [
    ['orders',               'customer_id'],
    ['quotations',           'customer_id'],
    ['invoices',             'customer_id'],
    ['purchase_orders',      'customer_id'],
    ['payments',             'customer_id'],
    ['artwork_vault_assets', 'customer_id'],
    ['claims',               'customer_id'],
    ['refunds',              'customer_id'],
    ['payment_links',        'customer_id'],
    ['customer_contacts',    'customer_id'],
    ['leads',                'customer_id'],
    ['leads',                'source_customer_id'],
  ]

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${drop.name} (${DROP})  ->  ${keep.name} (${KEEP})\n`)
  for (const [table, column] of MOVES) {
    const { rows } = await query(`SELECT count(*)::INT AS n FROM ${table} WHERE ${column} = $1`, [drop.id])
    if (rows[0].n) console.log(`    ${String(rows[0].n).padStart(4)}  ${table}.${column}`)
  }

  // The same job on both sides of the merge: one amount, one date, one house.
  const clash = (await query(
    `SELECT p.payment_number, p.amount, p.payment_date, p.payment_method, p.notes
       FROM payments p
      WHERE p.customer_id = $1 AND p.order_id IS NULL
        AND EXISTS (SELECT 1 FROM payments q
                     WHERE q.customer_id = $2 AND q.order_id IS NOT NULL
                       AND q.payment_date = p.payment_date
                       AND ROUND(q.amount,2) = ROUND(p.amount,2))`,
    [drop.id, keep.id])).rows

  if (!apply) {
    if (clash.length) {
      console.log('\n  DEKHEIN — yeh raqam dono taraf hai:')
      for (const c of clash)
        console.log(`    ${c.payment_number}  $${c.amount}  ${String(c.payment_date).slice(0,10)}  ${c.payment_method}`)
    }
    console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return
  }

  await query('BEGIN')
  try {
    for (const [table, column] of MOVES)
      await query(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [drop.id, keep.id])

    // The name each document carries in its own right.
    await query(`UPDATE quotations SET customer_name = $2, updated_at = NOW()
                  WHERE customer_id = $1 AND lower(btrim(COALESCE(customer_name,''))) = lower(btrim($3))`,
      [keep.id, keep.name, drop.name])
    await query(`UPDATE invoices SET customer_name = $2, updated_at = NOW()
                  WHERE customer_id = $1 AND lower(btrim(COALESCE(customer_name,''))) = lower(btrim($3))`,
      [keep.id, keep.name, drop.name])
    await query(`UPDATE orders SET shipping_name = $2, updated_at = NOW()
                  WHERE customer_id = $1 AND lower(btrim(COALESCE(shipping_name,''))) = lower(btrim($3))`,
      [keep.id, keep.name, drop.name])
    await query(`UPDATE payments SET received_from_name = $2, updated_at = NOW()
                  WHERE customer_id = $1 AND lower(btrim(COALESCE(received_from_name,''))) = lower(btrim($3))`,
      [keep.id, keep.name, drop.name])

    // Robert already holds this address; a second copy of it helps nobody.
    await query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [drop.id])
    // One login per customer is enforced, and Robert has his own.
    await query(`UPDATE customer_portal_users SET is_active = FALSE WHERE customer_id = $1`, [drop.id])

    await query(`UPDATE customers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [drop.id])
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const left = (await query(
    `SELECT (SELECT count(*)::INT FROM orders WHERE customer_id=$1 AND deleted_at IS NULL) AS orders,
            (SELECT count(*)::INT FROM invoices WHERE customer_id=$1 AND deleted_at IS NULL) AS invoices,
            (SELECT count(*)::INT FROM quotations WHERE customer_id=$1 AND deleted_at IS NULL) AS quotes,
            (SELECT count(*)::INT FROM payments WHERE customer_id=$1) AS payments,
            (SELECT count(*)::INT FROM artwork_vault_assets WHERE customer_id=$1) AS artwork`,
    [keep.id])).rows[0]
  console.log(`\n  ${keep.name} ke paas ab: ${left.orders} orders, ${left.quotes} quotes, ` +
              `${left.invoices} invoices, ${left.payments} payments, ${left.artwork} artwork files`)
  if (clash.length) {
    console.log('\n  MONEY KO HAATH NAHI LAGAYA — yeh dekhein:')
    for (const c of clash)
      console.log(`    ${c.payment_number}  $${c.amount}  ${String(c.payment_date).slice(0,10)}  ` +
                  `— wahi raqam wahi din us order par bhi darj hai`)
  }
  console.log('')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
