/**
 * Ask the courier where every live parcel is, and write back what it says.
 *
 * The shipment record already knows how to refresh itself — shipments.service
 * refreshTracking() calls Shippo, maps the reply and moves the shipment's own
 * status. What was missing was anything to call it, so a parcel that left the
 * shop as "Label Created" stayed "Label Created" long after it arrived.
 *
 * Two things this adds on top of a plain refresh:
 *   - it skips parcels that are finished. A delivered parcel is not going to
 *     change again, and Shippo charges attention for every lookup.
 *   - when a parcel lands, the sales order follows it to Delivered. That is the
 *     step nobody was doing by hand.
 *
 * Meant to run on a schedule (hourly is plenty — couriers scan a few times a
 * day). Dry run by default; pass --apply to write.
 */
const { query, pool } = require('../src/config/db')
const shipments = require('../src/modules/shipments/shipments.service')
const shippo = require('../src/utils/shippo')

// A parcel in one of these has finished its journey; asking again is waste.
const SETTLED = ['Delivered', 'Returned', 'Cancelled']
// Nor is there any point chasing a label that was made months ago and never
// scanned — those are labels that were bought and never used.
const STALE_AFTER_DAYS = 90
const GAP_MS = 350

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const apply = process.argv.includes('--apply')
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]

  if (!shippo.isConfigured()) {
    console.error('SHIPPO_API_KEY nahi mili — tracking sync nahi chal sakti.')
    process.exit(1)
  }

  const { rows: due } = await query(
    `SELECT s.id, s.tracking_number, s.carrier, s.status::text AS status,
            s.tracking_status, s.tracking_synced_at,
            o.id AS order_id, o.order_number, o.status::text AS order_status
       FROM shipments s
       LEFT JOIN orders o ON o.id = s.order_id AND o.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
        AND NULLIF(s.tracking_number, '') IS NOT NULL
        AND s.status::text <> ALL($1)
        AND COALESCE(s.ship_date, s.created_at::date) > CURRENT_DATE - $2::int
        AND ($3::text IS NULL OR s.tracking_number = $3)
      ORDER BY s.tracking_synced_at NULLS FIRST, s.created_at DESC`,
    [SETTLED, STALE_AFTER_DAYS, only || null])

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}`)
  console.log(`${due.length} parcels jinka haal poochhna hai\n`)
  if (!due.length) { await pool.end(); return }

  let changed = 0, delivered = 0, ordersMoved = 0, failed = 0
  for (const s of due) {
    try {
      if (!apply) {
        // Ask, but write nothing — so a dry run still shows what would move.
        const t = await shippo.fetchTracking(s.carrier, s.tracking_number)
        const now = t?.tracking_status || '(koi jawab nahi)'
        const moves = now && now.toUpperCase() !== String(s.tracking_status || '').toUpperCase()
        if (moves) changed++
        console.log(`  ${s.tracking_number.padEnd(24)} ${String(s.status).padEnd(14)} ${s.tracking_status || '—'} -> ${now}${moves ? '   BADLEGA' : ''}`)
        await sleep(GAP_MS)
        continue
      }

      const updated = await shipments.refreshTracking(s.id)
      const nowStatus = updated?.status ?? s.status
      const moved = nowStatus !== s.status
      if (moved) changed++

      // The parcel arrived, so the order it belongs to has been delivered.
      if (String(nowStatus).toLowerCase().includes('deliver')) {
        delivered++
        if (s.order_id && s.order_status !== 'Delivered') {
          await query(`UPDATE orders SET status = 'Delivered', updated_at = NOW() WHERE id = $1`, [s.order_id])
          ordersMoved++
          console.log(`  ${s.tracking_number.padEnd(24)} ${s.status} -> ${nowStatus}   ${s.order_number} bhi Delivered`)
        } else {
          console.log(`  ${s.tracking_number.padEnd(24)} ${s.status} -> ${nowStatus}`)
        }
      } else if (moved) {
        console.log(`  ${s.tracking_number.padEnd(24)} ${s.status} -> ${nowStatus}`)
      }
      await sleep(GAP_MS)
    } catch (e) {
      failed++
      console.log(`  ${s.tracking_number.padEnd(24)} NAKAAM — ${e.message}`)
    }
  }

  console.log(`\npoochhe ${due.length}   badle ${changed}   pahunche ${delivered}   orders Delivered hue ${ordersMoved}   nakaam ${failed}\n`)
  await pool.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
