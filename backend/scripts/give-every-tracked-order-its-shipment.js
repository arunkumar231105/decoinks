/**
 * An order whose parcel went out carries the courier and tracking number on its
 * own row, but the Shipments module only knows what is in the shipments table —
 * and the hourly Shippo sync reads that table. So a tracked order with no
 * shipment record is invisible to the sync: its status can never advance on its
 * own, however many times the parcel is scanned.
 *
 * Two passes:
 *   1. LINK   — a shipment that names no order, whose tracking number is on an
 *               order, belongs to that order. Only an exact tracking match; a
 *               guess by name and date would attach the wrong parcel.
 *   2. CREATE — a tracked order with no shipment gets one, built from what the
 *               order already says: courier, tracking, recipient and address.
 *
 * Nothing is invented. An order with no tracking number is left alone, because
 * a shipment without a tracking number tells the sync nothing.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

// What the shipment says about itself, given where the order has got to.
const statusForOrder = orderStatus => (
  orderStatus === 'Delivered' ? 'Delivered'
  : orderStatus === 'Shipped' ? 'In Transit'
  : 'Label Created')

async function main() {
  const apply = process.argv.includes('--apply')

  const toLink = (await query(
    `SELECT s.id, s.shipment_number, s.tracking_number, o.id AS order_id, o.order_number,
            COALESCE(NULLIF(c.company_name,''), c.name) AS customer
       FROM shipments s
       JOIN orders o ON o.deleted_at IS NULL
                    AND BTRIM(o.tracking_number) = BTRIM(s.tracking_number)
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE s.deleted_at IS NULL AND s.order_id IS NULL
        AND NULLIF(BTRIM(s.tracking_number),'') IS NOT NULL`)).rows

  const toCreate = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.status::text AS status,
            BTRIM(o.tracking_number) AS tracking,
            NULLIF(BTRIM(o.courier),'') AS courier,
            NULLIF(BTRIM(o.shipping_name),'') AS recipient,
            NULLIF(BTRIM(o.shipping_address),'') AS address,
            o.shipped_at, COALESCE(NULLIF(c.company_name,''), c.name) AS customer
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL
        AND NULLIF(BTRIM(o.tracking_number),'') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM shipments s
                         WHERE s.order_id = o.id AND s.deleted_at IS NULL)
      ORDER BY o.order_date`)).rows

  // An order about to receive one of the orphans must not also be given a new
  // one — the link happens first, so it would end up with the parcel twice.
  const linkedOrders = new Set(toLink.map(l => l.order_id))
  const toCreateFinal = toCreate.filter(o => !linkedOrders.has(o.id))

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  1. JORE JAYENGE (orphan shipment -> order)  ${toLink.length}`)
  for (const l of toLink)
    console.log(`     ${l.shipment_number} ${l.tracking_number} -> ${l.order_number} (${l.customer})`)
  console.log(`  2. NAYE SHIPMENT BANENGE                     ${toCreateFinal.length}`)
  for (const o of toCreateFinal)
    console.log(`     ${o.order_number}  ${String(o.status).padEnd(13)} ${(o.courier || '—').padEnd(5)} ${o.tracking}  ${o.customer}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const l of toLink)
      await query(`UPDATE shipments SET order_id = $2, updated_at = NOW() WHERE id = $1`, [l.id, l.order_id])

    // Numbered from the highest already taken, counting deleted rows so a
    // reissued number can never collide with one.
    const { rows: top } = await query(
      `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number,'-',3),'')::INT), 0) AS n
         FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`)
    let next = Number(top[0].n)

    for (const o of toCreateFinal) {
      next += 1
      await query(
        `INSERT INTO shipments
           (shipment_number, order_id, customer_name, carrier, tracking_number, status,
            ship_date, recipient_name, address, ship_source, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,
                 COALESCE($7::date, $8::date), $9, $10, 'Decoinks Fulfillment',
                 'Raised from ' || $11 || ', which already carried this tracking number',
                 NOW(), NOW())`,
        [`SHP-2026-${String(next).padStart(4, '0')}`, o.id, o.customer, o.courier,
         o.tracking, statusForOrder(o.status), o.shipped_at, o.order_date,
         o.recipient, o.address, o.order_number])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\nhogaya\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
