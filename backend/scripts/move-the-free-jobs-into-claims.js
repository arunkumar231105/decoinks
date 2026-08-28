/**
 * Free work is not a sale, it is a claim already settled.
 *
 * Eleven orders were printed and shipped at no charge — reprints, replacements,
 * goodwill. They sat in the sales book at $0, dragging every average down and
 * making the order count say more business was done than was. Each becomes a
 * claim, closed, with Replacement as the resolution, and the order leaves the
 * sales book.
 *
 * The purchase orders stay. The shop really did buy that stock from the
 * supplier and really did pay for it — that cost is true whatever the customer
 * was charged.
 *
 * Nothing is destroyed: the orders are soft-deleted, so every one of them can
 * be brought back, and each new claim points straight at the order it came from.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const CATEGORY = 'Other'
const SUB_ISSUE = 'Free Reprint / Replacement'
const NOTE = 'Order was produced and shipped at no charge. Moved out of the sales '
           + 'book and recorded here as a settled claim.'

async function main() {
  const apply = process.argv.includes('--apply')

  const free = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.customer_id, o.invoice_id,
            COALESCE(o.shipping_charges, 0) AS shipping,
            COALESCE(NULLIF(c.company_name,''), c.name) AS customer,
            (SELECT p.id FROM purchase_orders p
              WHERE p.order_id = o.id AND p.deleted_at IS NULL LIMIT 1) AS po_id,
            (SELECT p.po_number FROM purchase_orders p
              WHERE p.order_id = o.id AND p.deleted_at IS NULL LIMIT 1) AS po_number,
            (SELECT s.id FROM shipments s
              WHERE s.order_id = o.id AND s.deleted_at IS NULL LIMIT 1) AS shipment_id,
            (SELECT p.total FROM purchase_orders p
              WHERE p.order_id = o.id AND p.deleted_at IS NULL LIMIT 1) AS po_cost,
            COALESCE((SELECT SUM(qty) FROM (
               SELECT qty FROM order_items_apparel   WHERE order_id = o.id
               UNION ALL SELECT qty FROM order_items_dtf       WHERE order_id = o.id
               UNION ALL SELECT qty FROM order_items_gangsheet WHERE order_id = o.id) z), 0)::INT AS qty
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL AND o.is_free
      ORDER BY o.order_date`)).rows

  // A payment on a free order would mean it was not free, and would be lost by
  // removing the order. Nothing may leave while one is attached.
  const paid = (await query(
    `SELECT o.order_number, count(p.*)::INT AS n FROM orders o
       JOIN payments p ON p.order_id = o.id
      WHERE o.is_free AND o.deleted_at IS NULL GROUP BY o.order_number`)).rows

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log('order          customer            qty   shipping   PO (rahega)    supplier ko diya')
  console.log('-'.repeat(84))
  for (const f of free)
    console.log(`${f.order_number}  ${String(f.customer).padEnd(18)} ${String(f.qty).padStart(4)}   ${('$' + Number(f.shipping).toFixed(2)).padStart(8)}   ${String(f.po_number ?? '—').padEnd(14)} ${'$' + Number(f.po_cost ?? 0).toFixed(2)}`)

  const cost = free.reduce((s, f) => s + Number(f.po_cost ?? 0), 0)
  console.log(`\n${free.length} free orders — supplier ko kul $${cost.toFixed(2)} diya gaya`)
  if (paid.length) {
    console.log('\nRUK GAYA — in par payment lagi hui hai, pehle wo hatayein:')
    for (const p of paid) console.log(`  ${p.order_number}  ${p.n} payment(s)`)
    await pool.end(); process.exit(1)
  }

  const orders = (await query(`SELECT count(*)::INT AS n FROM orders WHERE deleted_at IS NULL`)).rows[0].n
  const pos = (await query(`SELECT count(*)::INT AS n FROM purchase_orders WHERE deleted_at IS NULL`)).rows[0].n
  console.log(`\nabhi: ${orders} sales orders, ${pos} POs`)
  console.log(`baad mein: ${orders - free.length} sales orders, ${pos} POs (POs waise hi rahenge)\n`)

  if (!apply) { console.log('Likhne ke liye --apply lagayein.\n'); await pool.end(); return }

  const admin = (await query(`SELECT id FROM users WHERE role = 'Admin' LIMIT 1`)).rows[0]
  await query('BEGIN')
  try {
    for (const f of free) {
      const number = (await query(
        `SELECT 'CLM-2026-' || lpad(
           (COALESCE(MAX(NULLIF(split_part(claim_number,'-',3),'')::INT), 0) + 1)::text, 4, '0') AS n
           FROM claims WHERE claim_number LIKE 'CLM-2026-%'`)).rows[0].n

      // Closed, because the replacement already happened — that free print was
      // the resolution. Recording it as open would ask someone to act on
      // something finished months ago.
      const { rows } = await query(
        `INSERT INTO claims (claim_number, customer_id, order_id, purchase_order_id, invoice_id,
                             shipment_id, claim_category, sub_issue, quantity_affected,
                             claimed_amount, requested_amount, approved_amount,
                             preferred_resolution, resolution_type, decision, status,
                             description, review_notes, responsible_admin_id, approval_date,
                             created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,0,
                 ARRAY['Replacement'],'Replacement','Approve','Closed',
                 $10,$11,$12,$13::date,$12,$13::date,NOW())
         RETURNING id`,
        [number, f.customer_id, f.id, f.po_id, f.invoice_id, f.shipment_id,
         CATEGORY, SUB_ISSUE, f.qty,
         `${f.order_number} — ${f.qty} pieces produced free of charge for ${f.customer}.`
           + (Number(f.shipping) > 0 ? ` Shipping of $${Number(f.shipping).toFixed(2)} was charged.` : ''),
         NOTE, admin?.id ?? null, f.order_date])

      // Both ends of the trail: how the claim arose, and that it is settled.
      await query(
        `INSERT INTO claim_status_history (claim_id, status, changed_by, changed_at, notes)
         VALUES ($1,'Raised',$2,$3::date,$4), ($1,'Closed',$2,$3::date,'Replacement delivered free of charge')`,
        [rows[0].id, admin?.id ?? null, f.order_date, NOTE])

      await query(`UPDATE orders SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [f.id])
      console.log(`  ${f.order_number} -> ${number}   (PO ${f.po_number ?? '—'} rahega)`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT (SELECT count(*)::INT FROM orders WHERE deleted_at IS NULL) AS orders,
            (SELECT count(*)::INT FROM purchase_orders WHERE deleted_at IS NULL) AS pos,
            (SELECT count(*)::INT FROM claims WHERE deleted_at IS NULL) AS claims`)).rows[0]
  console.log(`\nab: ${after.orders} sales orders, ${after.pos} POs, ${after.claims} claims\n`)
  await pool.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
