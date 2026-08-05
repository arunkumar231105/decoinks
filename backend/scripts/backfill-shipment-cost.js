#!/usr/bin/env node
/**
 * Backfill shipments.shipping_cost from the two sources the owner already has:
 *
 *   1. The Shippo billing sheet (raw.tsv) — the actual money paid for each
 *      tracking number, and the most accurate source. A tracking number may
 *      appear on more than one line (initial charge + a later "shipping charge
 *      correction" or "additional handling"), so the values are summed.
 *
 *   2. Failing that, the covered orders' shipping_charges. For a combined
 *      parcel this correctly sums every order the parcel carries (e.g. TSI
 *      63/64/65/67 has $75 on order 63 and $0 on the others; the shipment
 *      gets $75).
 *
 * Never overwrites a non-null shipping_cost. Never touches other columns.
 * Idempotent — re-running is a no-op once every shipment has a cost.
 *
 * Usage:
 *   node backend/scripts/backfill-shipment-cost.js            (dry-run)
 *   node backend/scripts/backfill-shipment-cost.js --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const SHIPPO_TSV = process.env.SHIPPO_TSV
  || '/tmp/claude-0/-root-decoinks/cab844a3-03d2-49e4-9cd9-f1cd55bceef6/scratchpad/ship/raw.tsv'
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

function loadShippo() {
  if (!fs.existsSync(SHIPPO_TSV)) return {}
  const [header, ...lines] = fs.readFileSync(SHIPPO_TSV, 'utf8').trim().split('\n')
  const cols = header.split('\t')
  const amountIdx = cols.indexOf('Amount')
  const trackingIdx = cols.indexOf('Tracking Number')
  const sums = {}
  for (const line of lines) {
    const cells = line.split('\t')
    const trk = (cells[trackingIdx] || '').trim()
    const amt = Number(cells[amountIdx])
    if (!trk || !Number.isFinite(amt)) continue
    sums[trk] = +(Number(sums[trk] || 0) + amt).toFixed(2)
  }
  return sums
}

async function main() {
  const shippo = loadShippo()
  console.log(`Shippo sheet: ${Object.keys(shippo).length} unique tracking numbers`)

  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // Every shipment that still has no cost. Include tracking + primary order
    // + the sum of covered orders' shipping charges via the join table so a
    // combined parcel adds every order it carries.
    const { rows } = await client.query(`
      SELECT s.id, s.shipment_number, s.tracking_number, s.order_id,
             o.order_number AS primary_order,
             (SELECT COALESCE(SUM(o2.shipping_charges), 0)::numeric(12,2)
                FROM shipment_orders so
                JOIN orders o2 ON o2.id = so.order_id
               WHERE so.shipment_id = s.id) AS covered_ship_charges,
             (SELECT COALESCE(SUM(o2.shipping_charges), 0)::numeric(12,2)
                FROM orders o2 WHERE o2.id = s.order_id) AS primary_ship_charges
        FROM shipments s
        LEFT JOIN orders o ON o.id = s.order_id
       WHERE s.deleted_at IS NULL AND s.shipping_cost IS NULL
       ORDER BY s.shipment_number`)

    let fromShippo = 0, fromOrder = 0, skipped = 0, updates = []
    for (const r of rows) {
      const shippoAmt = r.tracking_number ? shippo[r.tracking_number] : undefined
      // Prefer the covered-orders sum (right for combined parcels); fall back
      // to just the primary order's charges.
      const orderAmt = Number(r.covered_ship_charges) > 0
        ? Number(r.covered_ship_charges)
        : Number(r.primary_ship_charges)

      let value = null, source = null
      if (typeof shippoAmt === 'number' && shippoAmt > 0) {
        value = shippoAmt; source = 'shippo'; fromShippo++
      } else if (orderAmt > 0) {
        value = orderAmt; source = 'order';  fromOrder++
      } else {
        skipped++
      }

      if (value !== null) {
        updates.push({ id: r.id, num: r.shipment_number, trk: r.tracking_number,
                       ord: r.primary_order, value, source })
      }
    }

    console.log(`\nCandidates: ${rows.length}`)
    console.log(`  from Shippo billing: ${fromShippo}`)
    console.log(`  from order.shipping_charges: ${fromOrder}`)
    console.log(`  skipped (no source): ${skipped}`)
    console.log(`  total planned: ${updates.length}\n`)

    // Show a diff for validation — the owner asked to cross-check both sources.
    for (const u of updates.slice(0, 8)) {
      console.log(`  ${u.num}  ${u.trk || '(no trk)'}  ->  $${u.value.toFixed(2)}  [${u.source}]  (${u.ord || '—'})`)
    }
    if (updates.length > 8) console.log(`  … +${updates.length - 8} more`)

    if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to commit.'); return }

    await client.query('BEGIN')
    for (const u of updates) {
      await client.query(
        'UPDATE shipments SET shipping_cost = $2, updated_at = NOW() WHERE id = $1 AND shipping_cost IS NULL',
        [u.id, u.value])
    }
    await client.query('COMMIT')
    console.log(`\nBackfilled ${updates.length} shipments.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
