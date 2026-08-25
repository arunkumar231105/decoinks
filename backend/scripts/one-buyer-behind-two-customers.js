/**
 * "M.C. Bennett" and "Nathaniel Carl" are not two customers. They are the two
 * addresses Matthew Carl asked one order of XL black tees to be shipped to —
 * Yorba Linda, CA and Manchester, PA. The import read each delivery address as
 * a buyer and invented a customer for it.
 *
 * So Matthew Carl is created once, everything the two shells hold is moved onto
 * him — orders, purchase orders, delivery addresses, portal logins — and the
 * shells are soft-deleted. Nothing is destroyed; the two names survive as the
 * shipping addresses on their own orders, which is what they always were.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const SHELLS = ['CUST-2026-0064', 'CUST-2026-0065']
const REAL_NAME = 'Matthew Carl'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  const { rows: shells } = await query(
    `SELECT id, customer_number, name FROM customers
      WHERE customer_number = ANY($1) AND deleted_at IS NULL`, [SHELLS])
  if (shells.length !== SHELLS.length) throw new Error(`${shells.length} shells mile, ${SHELLS.length} chahiye the`)

  for (const s of shells) {
    const [o, p, a, u] = await Promise.all([
      query(`SELECT order_number FROM orders WHERE customer_id=$1 AND deleted_at IS NULL`, [s.id]),
      query(`SELECT po_number FROM purchase_orders WHERE customer_id=$1 AND deleted_at IS NULL`, [s.id]),
      query(`SELECT city, state FROM customer_addresses WHERE customer_id=$1`, [s.id]),
      query(`SELECT username FROM customer_portal_users WHERE customer_id=$1`, [s.id]),
    ])
    console.log(`${s.customer_number}  ${s.name}`)
    console.log(`   orders    ${o.rows.map(r => r.order_number).join(', ') || '—'}`)
    console.log(`   POs       ${p.rows.map(r => r.po_number).join(', ') || '—'}`)
    console.log(`   addresses ${a.rows.map(r => `${r.city}, ${r.state}`).join(' | ') || '—'}`)
    console.log(`   logins    ${u.rows.map(r => r.username).join(', ') || '—'}`)
  }

  const existing = await query(`SELECT customer_number FROM customers WHERE name = $1 AND deleted_at IS NULL`, [REAL_NAME])
  console.log(`\nBANEGA  ${REAL_NAME}  ${existing.rows.length ? `(pehle se maujood: ${existing.rows[0].customer_number})` : '(naya)'}`)
  console.log(`HATENGE ${shells.map(s => s.customer_number).join(', ')}  (soft delete)\n`)

  if (!apply) { console.log('Likhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    let realId
    if (existing.rows.length) {
      realId = (await query(`SELECT id FROM customers WHERE name=$1 AND deleted_at IS NULL`, [REAL_NAME])).rows[0].id
    } else {
      // Same high-water rule the app uses, so this number can never collide
      // with one the app hands out next.
      const next = (await query(
        `SELECT 'CUST-2026-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(customer_number,'\\D','','g'),'')::INT), 0) + 1)::text, 4, '0') AS n
           FROM customers WHERE customer_number LIKE 'CUST-2026-%'`)).rows[0].n
      realId = (await query(
        `INSERT INTO customers (customer_number, name, first_name, last_name, status, customer_type, created_at, updated_at)
         VALUES ($1, $2, 'Matthew', 'Carl', 'active', 'individual', NOW(), NOW()) RETURNING id`,
        [next, REAL_NAME])).rows[0].id
      console.log(`  ${REAL_NAME} bana: ${next}`)
    }

    for (const s of shells) {
      // One login per customer is enforced by uq_customer_portal_users_customer,
      // and there are two here. The first moves across; the second stays with
      // its shell, deactivated — the row survives, nobody signs in with it, and
      // it can be restored if that person really does need their own access.
      const alreadyHasLogin = (await query(
        `SELECT 1 FROM customer_portal_users WHERE customer_id = $1`, [realId])).rowCount > 0
      if (alreadyHasLogin) {
        const d = await query(
          `UPDATE customer_portal_users SET is_active = FALSE WHERE customer_id = $1`, [s.id])
        if (d.rowCount) console.log(`  ${s.customer_number}: ${d.rowCount} login band kiya (Matthew Carl ka login pehle se hai)`)
      } else {
        const m = await query(
          `UPDATE customer_portal_users SET customer_id = $2 WHERE customer_id = $1`, [s.id, realId])
        if (m.rowCount) console.log(`  ${s.customer_number}: ${m.rowCount} login move hua`)
      }

      for (const [table, col] of [['orders', 'customer_id'], ['purchase_orders', 'customer_id'],
                                  ['invoices', 'customer_id'], ['quotations', 'customer_id'],
                                  ['payments', 'customer_id'], ['customer_addresses', 'customer_id'],
                                  ['leads', 'customer_id']]) {
        const r = await query(`UPDATE ${table} SET ${col} = $2 WHERE ${col} = $1`, [s.id, realId])
        if (r.rowCount) console.log(`  ${s.customer_number}: ${r.rowCount} ${table} move hue`)
      }
      await query(`UPDATE customers SET deleted_at = NOW() WHERE id = $1`, [s.id])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT c.customer_number, c.name,
       (SELECT count(*) FROM orders o WHERE o.customer_id=c.id AND o.deleted_at IS NULL) AS orders,
       (SELECT count(*) FROM purchase_orders p WHERE p.customer_id=c.id AND p.deleted_at IS NULL) AS pos,
       (SELECT count(*) FROM customer_addresses a WHERE a.customer_id=c.id) AS addresses,
       (SELECT count(*) FROM customer_portal_users u WHERE u.customer_id=c.id) AS logins
     FROM customers c WHERE c.name = $1 AND c.deleted_at IS NULL`, [REAL_NAME])).rows[0]
  console.log(`\nHO GAYA. ${after.customer_number} ${after.name} — ${after.orders} orders, ${after.pos} POs, ${after.addresses} addresses, ${after.logins} logins\n`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
