#!/usr/bin/env node
'use strict'

/**
 * Put every loose parcel on its sales order, and on its purchase order.
 *
 * Runs on the ten-minute courier cycle, right after new labels are pulled, so
 * a shipment bought the day after its order joins that order by itself. Safe to
 * run as often as you like: it only ever looks at parcels that are not attached.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')
const { attachLooseShipments, DAYS_AFTER, DAYS_BEFORE } = require('../src/modules/shipments/attach.service')

const APPLY = process.argv.includes('--apply')

async function main() {
  const { attached, skipped } = await attachLooseShipments({ apply: APPLY })

  console.log(`${APPLY ? 'ATTACHING' : `DRY RUN (window ${DAYS_BEFORE} days before to ${DAYS_AFTER} after the order) — add --apply to write`}`)
  console.log(`  parcels joined to an order   ${attached.length}`)
  console.log(`  left loose                   ${skipped.length}`)

  for (const a of attached) {
    console.log(`    ${a.shipment_number}  ${String(a.tracking_number ?? '—').padEnd(24)} ` +
                `${String(a.who).padEnd(22)} -> ${a.order_number} (${a.day_gap}d)` +
                `${a.po_numbers?.length ? `  seen on ${a.po_numbers.join(', ')}` : ''}`)
  }
  for (const s of skipped) {
    console.log(`    ${s.shipment_number}  ${String(s.tracking_number ?? '—').padEnd(24)} ` +
                `${String(s.who ?? '?').padEnd(22)} — ${s.why}`)
  }

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
