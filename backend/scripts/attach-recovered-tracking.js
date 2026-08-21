#!/usr/bin/env node
/**
 * Attach the tracking numbers recovered from the UPS export (29 Jul – 17 Aug
 * 2026) and from the shipments table, to the jobs that were missing them.
 *
 * Nothing is invented. Every number below is a real UPS label that already
 * exists in this system as a shipment; the work here is joining it to the right
 * sales order and purchase order.
 *
 *   TSI 260808-78   1Z24C3140228384060  Samuel Ngwamukie, 8-Aug
 *                   Already on ORD-2026-0076 and on SHP-2026-0084, missing only
 *                   from PO-2026-0081. Confirmed by the UPS export.
 *
 *   TSI 260815-88   1Z24C3140218192107  Robert Farrar, 17-Aug, 8 lb, $43.09
 *                   The parcel was attached to ORD-2026-0084, which has since
 *                   been removed as off-sheet, so it now hangs off a deleted
 *                   order. It belongs to 260815-88, not 260818-89: it shipped on
 *                   the 17th and PO 89 was not raised until the 18th, and at 8 lb
 *                   it is the heaviest Farrar parcel in the export, matching the
 *                   7-gangsheet / 82-artwork job.
 *
 *   TSI 260730-64   1Z24C3141338464023  Robert Farrar, 31-Jul, 15 lb, $109.76
 *   TSI 260730-65   These three were billed together with TSI 260730-63 and
 *   TSI 260731-67   shipped in the same parcel — it is the only Farrar label in
 *                   the 29–31 July window and more than triple the weight of any
 *                   other, which is why they never had labels of their own. They
 *                   join SHP-2026-0074 through shipment_orders, the join built
 *                   for exactly this case, rather than pretending to be separate
 *                   parcels. This one is an inference from weight, date and the
 *                   combined billing; the owner approved it on that basis.
 *
 *   TSI 260604-21   1Z2B14J80236559156  Mery Garcia, shipped 12-Jun, delivered
 *   (free re-run)   15-Jun. From SHP-2026-0014, not the UPS export. It is
 *                   attached to a duplicate order deleted on 2026-08-06. The
 *                   original 4-Jun order carries a different number, so this is
 *                   the second parcel — the free re-run.
 *
 * Two shipments currently point at deleted orders (SHP-2026-0100 and
 * SHP-2026-0014); repointing them at the live orders fixes that at the same time.
 *
 * Only empty tracking fields are written, so a number already on a record is
 * never overwritten. Idempotent, one transaction, dry-run by default.
 *
 * Usage:
 *   node backend/scripts/attach-recovered-tracking.js            (dry-run)
 *   node backend/scripts/attach-recovered-tracking.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

const CARRIER = 'UPS'

// sheetRef → the parcel, the records that should carry it, and the shipment it
// already exists as. `primary` means this order becomes the shipment's own
// order_id; `share` means it joins an existing parcel through shipment_orders.
const WORK = [
  { ref: 'TSI 260808-78', trk: '1Z24C3140228384060', shipment: 'SHP-2026-0084',
    orders: [], pos: ['PO-2026-0081'], link: null,
    why: 'already on the sales order; only the PO was missing it' },

  { ref: 'TSI 260815-88', trk: '1Z24C3140218192107', shipment: 'SHP-2026-0100',
    orders: ['ORD-2026-0107'], pos: ['PO-2026-0096'], link: 'primary',
    why: 'shipped 17-Aug, before PO 89 existed; 8 lb matches the 82-artwork job' },

  { ref: 'TSI 260730-64', trk: '1Z24C3141338464023', shipment: 'SHP-2026-0074',
    orders: ['ORD-2026-0103'], pos: ['PO-2026-0099'], link: 'share',
    why: 'billed and shipped with TSI 260730-63' },
  { ref: 'TSI 260730-65', trk: '1Z24C3141338464023', shipment: 'SHP-2026-0074',
    orders: ['ORD-2026-0104'], pos: ['PO-2026-0100'], link: 'share',
    why: 'billed and shipped with TSI 260730-63' },
  { ref: 'TSI 260731-67', trk: '1Z24C3141338464023', shipment: 'SHP-2026-0074',
    orders: ['ORD-2026-0105'], pos: ['PO-2026-0101'], link: 'share',
    why: 'billed and shipped with TSI 260730-63' },

  { ref: 'TSI 260604-21 (free re-run)', trk: '1Z2B14J80236559156', shipment: 'SHP-2026-0014',
    orders: ['ORD-2026-0101'], pos: ['PO-2026-0098'], link: 'primary',
    why: 'second Mery Garcia parcel, shipped 12-Jun' },
]

const report = []
const note = (k, s) => report.push(`  [${k}] ${s}`)
const stats = { orders: 0, pos: 0, shipmentsRepointed: 0, parcelsShared: 0 }

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const w of WORK) {
      for (const num of w.orders) {
        const { rowCount } = await client.query(
          `UPDATE orders SET tracking_number = $1,
                  courier = COALESCE(NULLIF(BTRIM(courier), ''), $2), updated_at = NOW()
            WHERE order_number = $3 AND deleted_at IS NULL
              AND COALESCE(BTRIM(tracking_number), '') = ''`, [w.trk, CARRIER, num])
        if (rowCount) { stats.orders++; note('ORDER', `${num} ← ${w.trk}   (${w.ref} — ${w.why})`) }
      }
      for (const num of w.pos) {
        const { rowCount } = await client.query(
          `UPDATE purchase_orders SET tracking_number = $1,
                  carrier = COALESCE(NULLIF(BTRIM(carrier), ''), $2), updated_at = NOW()
            WHERE po_number = $3 AND deleted_at IS NULL
              AND COALESCE(BTRIM(tracking_number), '') = ''`, [w.trk, CARRIER, num])
        if (rowCount) { stats.pos++; note('PO', `${num} ← ${w.trk}   (${w.ref})`) }
      }

      if (!w.link || !w.orders.length) continue
      const { rows: [ship] } = await client.query(
        `SELECT id, order_id FROM shipments WHERE shipment_number = $1 AND deleted_at IS NULL`,
        [w.shipment])
      const { rows: [ord] } = await client.query(
        `SELECT id FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [w.orders[0]])
      if (!ship || !ord) continue

      if (w.link === 'primary') {
        // The parcel currently hangs off an order that has been removed; point
        // it at the live one so the shipment screen stops showing a dead link.
        const { rowCount } = await client.query(
          `UPDATE shipments s SET order_id = $1, updated_at = NOW()
            WHERE s.id = $2
              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.deleted_at IS NULL)`,
          [ord.id, ship.id])
        if (rowCount) { stats.shipmentsRepointed++; note('SHIPMENT', `${w.shipment} repointed to ${w.orders[0]}`) }
      } else {
        // One parcel, several orders — that is what shipment_orders is for.
        const { rowCount } = await client.query(
          `INSERT INTO shipment_orders (shipment_id, order_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`, [ship.id, ord.id])
        if (rowCount) { stats.parcelsShared++; note('SHIPMENT', `${w.orders[0]} added to parcel ${w.shipment}`) }
      }
    }

    // ── Verify ───────────────────────────────────────────────────────────────
    const { rows: stillMissing } = await client.query(
      `SELECT o.source_po_number AS ref, o.order_number,
              COALESCE(p.po_number, '—') AS po_number,
              CASE WHEN COALESCE(BTRIM(o.tracking_number),'') = '' THEN 'order' END AS o_miss,
              CASE WHEN COALESCE(BTRIM(p.tracking_number),'') = '' THEN 'po' END AS p_miss
         FROM orders o
         LEFT JOIN purchase_orders p ON p.deleted_at IS NULL
              AND (p.order_id = o.id OR EXISTS (SELECT 1 FROM po_orders x WHERE x.order_id = o.id AND x.po_id = p.id))
        WHERE o.deleted_at IS NULL
          AND (COALESCE(BTRIM(o.tracking_number),'') = '' OR COALESCE(BTRIM(p.tracking_number),'') = '')
        ORDER BY o.order_date`)
    const { rows: [dead] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM shipments s
        WHERE s.deleted_at IS NULL AND s.order_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.deleted_at IS NULL)`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (nothing to attach)')
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(20)} ${v}`)
    console.log(`\nStill without tracking: ${stillMissing.length}`)
    for (const r of stillMissing) {
      console.log(`  ${(r.ref || '—').padEnd(18)} ${r.order_number}  ${r.po_number}` +
                  `   missing on: ${[r.o_miss, r.p_miss].filter(Boolean).join(' + ')}`)
    }
    console.log(`\nShipments pointing at a deleted order: ${dead.n}`)

    if (APPLY) { await client.query('COMMIT'); console.log('\nCommitted.') }
    else { await client.query('ROLLBACK'); console.log('\nRolled back. Re-run with --apply to keep these changes.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
