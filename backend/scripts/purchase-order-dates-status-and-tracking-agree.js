/**
 * Purchase order data that disagrees with itself or with its parcels, put right
 * where the right answer is certain. The owner, 16 Sep 2026, on the PO export:
 * "entry date missing, expected date nahi — data shi hona chayia".
 *
 *   1. Entry date missing (14, all raised by a script on 9–11 Sep): the day the
 *      PO was entered, created_at.
 *   2. TSI Transfers expected date missing or before the PO date: TSI dispatches
 *      transfers the day they are ordered — 81 of its POs carry exactly that — so
 *      the expected date is the PO date. The three dated before their PO (sheet
 *      typos: "07-May" on a PO of 26 May) take the same.
 *   3. A tracking number on a PO that belongs to another order's parcel: cleared
 *      from the PO (PO-2026-0067, a free reprint that never had a parcel, carried
 *      ORD-2026-0064's UPS number).
 *   4. Status behind its parcel: a PO whose parcel is delivered is Closed, in
 *      transit is Shipped, labelled and waiting for scan is In Production. Only
 *      ever moved forward, never back; each move is written to po_status_history.
 *
 * Not touched, waiting for the owner: DIGI's expected dates (no DIGI PO has ever
 * carried one, so there is no turnaround to go by), supplier contacts (none on
 * file for DIGI or TSI), and PO-2026-0158 dated before its sales order.
 *
 * Proves before committing that no PO's money, supplier, order or type changed.
 *
 *   node scripts/purchase-order-dates-status-and-tracking-agree.js           dry run
 *   node scripts/purchase-order-dates-status-and-tracking-agree.js --apply   write
 */
require('dotenv').config()
const { getClient, pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const UNTOUCHED = `SELECT md5(string_agg(concat_ws('|', id, po_number, order_date, supplier_id, order_id, po_type, subtotal, total,
                    grand_total, freight_charges, supplier_total_cost, customer_id, deleted_at), ',' ORDER BY id)) AS h FROM purchase_orders`
const ORDER = ['Draft', 'Pending Approval', 'Approved', 'Sent', 'Accepted', 'In Production', 'Shipped', 'Partially Received', 'Received', 'Closed']
const d = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v)

;(async () => {
  const client = await getClient()
  const q = (sql, params) => client.query(sql, params).then(r => r.rows)
  try {
    await client.query('BEGIN')
    console.log(APPLY ? '\n-- APPLYING --\n' : '\n-- DRY RUN (add --apply to write) --\n')
    const [{ h: before }] = await q(UNTOUCHED)

    // 1. Entry date
    const entry = await q(`UPDATE purchase_orders SET entry_date = created_at::date
       WHERE deleted_at IS NULL AND entry_date IS NULL RETURNING po_number, entry_date`)
    console.log(`1. entry date filled: ${entry.length}  (${entry.map(r => `${r.po_number} ${d(r.entry_date)}`).join(', ')})`)

    // 2. TSI Transfers expected date
    const tsi = await q(`
      UPDATE purchase_orders po SET expected_date = po.order_date
        FROM suppliers s
       WHERE s.id = po.supplier_id AND s.name = 'TSI Transfers' AND po.deleted_at IS NULL AND po.order_date IS NOT NULL
         AND (po.expected_date IS NULL OR po.expected_date < po.order_date)
      RETURNING po.po_number, po.order_date`)
    console.log(`2. TSI Transfers expected date = PO date: ${tsi.length}  (${tsi.map(r => r.po_number.slice(-4)).join(', ')})`)

    // 3. Tracking that belongs to another order's parcel
    const wrong = await q(`
      SELECT po.id, po.po_number, po.tracking_number, sh.shipment_number, o.order_number
        FROM purchase_orders po
        JOIN shipments sh ON sh.deleted_at IS NULL AND sh.tracking_number = po.tracking_number
        LEFT JOIN orders o ON o.id = sh.order_id
       WHERE po.deleted_at IS NULL AND NULLIF(BTRIM(po.tracking_number), '') IS NOT NULL
         AND sh.order_id IS DISTINCT FROM po.order_id
         AND sh.from_po_id IS DISTINCT FROM po.id AND sh.po_id IS DISTINCT FROM po.id
         AND NOT EXISTS (SELECT 1 FROM po_orders x WHERE x.po_id = po.id AND x.order_id = sh.order_id)
         AND NOT EXISTS (SELECT 1 FROM shipments own WHERE own.deleted_at IS NULL AND own.tracking_number = po.tracking_number
                           AND (own.order_id = po.order_id OR own.from_po_id = po.id OR own.po_id = po.id))`)
    for (const w of wrong) {
      await q(`UPDATE purchase_orders SET tracking_number = NULL, carrier = NULL WHERE id = $1`, [w.id])
    }
    console.log(`3. tracking cleared (belongs to another order's parcel): ${wrong.length}  (${wrong.map(w => `${w.po_number} had ${w.tracking_number}, parcel ${w.shipment_number} of ${w.order_number}`).join('; ')})`)
    if (wrong.length > 3) throw new Error(`expected at most a few wrong tracking numbers, found ${wrong.length}`)

    // 4. Status behind its parcel — the furthest parcel of the PO itself, else of its orders
    const behind = await q(`
      WITH parcel AS (
        SELECT po.id, po.po_number, po.status::text AS status,
               max(CASE UPPER(COALESCE(NULLIF(BTRIM(sh.tracking_status), ''), sh.status::text))
                     WHEN 'DELIVERED' THEN 4 WHEN 'TRANSIT' THEN 3 WHEN 'IN TRANSIT' THEN 3
                     WHEN 'PRE_TRANSIT' THEN 2 WHEN 'LABEL CREATED' THEN 2 ELSE 0 END) AS rank
          FROM purchase_orders po
          JOIN LATERAL (
            SELECT x.* FROM shipments x
             WHERE x.deleted_at IS NULL
               AND (x.from_po_id = po.id OR x.po_id = po.id
                    OR (NOT EXISTS (SELECT 1 FROM shipments y WHERE y.deleted_at IS NULL AND (y.from_po_id = po.id OR y.po_id = po.id))
                        AND (x.order_id = po.order_id OR x.order_id IN (SELECT order_id FROM po_orders WHERE po_id = po.id))))
          ) sh ON TRUE
         WHERE po.deleted_at IS NULL AND po.status::text NOT IN ('Cancelled', 'Closed')
         GROUP BY po.id, po.po_number, po.status)
      SELECT id, po_number, status, CASE rank WHEN 4 THEN 'Closed' WHEN 3 THEN 'Shipped' WHEN 2 THEN 'In Production' END AS target
        FROM parcel WHERE rank >= 2 ORDER BY po_number`)
    const moves = behind.filter(r => ORDER.indexOf(r.target) > ORDER.indexOf(r.status))
    for (const m of moves) {
      await q(`UPDATE purchase_orders SET status = $2::po_status WHERE id = $1`, [m.id, m.target])
      await q(`INSERT INTO po_status_history (po_id, from_status, to_status, changed_by, comment)
               VALUES ($1, $2, $3, NULL, 'Matched to its parcel (data check, 16 Sep 2026)')`, [m.id, m.status, m.target])
    }
    const tally = moves.reduce((t, m) => ({ ...t, [`${m.status} → ${m.target}`]: (t[`${m.status} → ${m.target}`] || 0) + 1 }), {})
    console.log(`4. status moved to match the parcel: ${moves.length}  ${JSON.stringify(tally)}`)
    moves.forEach(m => console.log(`     ${m.po_number}  ${m.status} → ${m.target}`))

    // Proof
    const [{ h: after }] = await q(UNTOUCHED)
    if (before !== after) throw new Error('a PO changed beyond dates, status or tracking — rolled back')
    const [left] = await q(`
      SELECT count(*) FILTER (WHERE po.entry_date IS NULL)::int AS entry_missing,
             count(*) FILTER (WHERE po.expected_date IS NULL AND s.name = 'TSI Transfers')::int AS tsi_expected_missing,
             count(*) FILTER (WHERE po.expected_date < po.order_date)::int AS expected_before_po,
             count(*) FILTER (WHERE po.expected_date IS NULL AND s.name = 'DIGI')::int AS digi_expected_missing_waiting_owner
        FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.deleted_at IS NULL`)
    console.log(`\n   left: ${JSON.stringify(left)}`)
    console.log('   money check: no PO\'s amounts, supplier, order, type or date changed')

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
