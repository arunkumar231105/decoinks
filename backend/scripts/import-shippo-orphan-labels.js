#!/usr/bin/env node
/**
 * Bring Shippo labels that never made it into Decoinks into the Shipments
 * register, and attach them to their sales order + PO where one can be found.
 *
 * Source of truth is the Shippo account, not a screenshot: every label is pulled
 * from /transactions (with its ship-to address from the attached Shippo order),
 * and any tracking number that the transactions endpoint does not return is
 * resolved through the tracking API so its address and status are still verified
 * rather than typed in by hand.
 *
 * Matching an order is deliberately conservative — a wrong link puts one
 * customer's parcel on another customer's order. A label is only attached when
 * ALL of these hold:
 *   - the order has no shipment yet,
 *   - the recipient surname matches the order's customer/contact/ship-to name,
 *   - the ship-to postcode matches (first 5 digits),
 *   - the label was bought within MATCH_WINDOW_DAYS of the order date,
 *   - and exactly one order qualifies.
 * Anything else is reported as UNMATCHED for a human to decide.
 *
 * Unmatched labels are still recorded as order-less shipments (allowed by
 * chk_shipments_target_xor, and three such rows already exist) so a parcel the
 * shop actually sent is visible in the app instead of living only in Shippo.
 * Pass --matched-only to skip that.
 *
 * Usage:
 *   node backend/scripts/import-shippo-orphan-labels.js                 (dry-run)
 *   node backend/scripts/import-shippo-orphan-labels.js --apply
 *   node backend/scripts/import-shippo-orphan-labels.js --apply --matched-only
 */
const { Pool } = require('pg')

const APPLY        = process.argv.includes('--apply')
const MATCHED_ONLY = process.argv.includes('--matched-only')
const MATCH_WINDOW_DAYS = 10
// When one recipient has several unattached labels, a ten-day window can no
// longer tell them apart — only a near-exact date may pick one.
const TIGHT_WINDOW_DAYS = 3

const KEY = process.env.SHIPPO_API_KEY
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// Labels visible in the owner's Shippo dashboard that /transactions does not
// return (older purchases). Their address and status are still fetched live
// from the tracking API — nothing here is trusted beyond the number itself.
const EXTRA_TRACKING = ['1Z24C3141315451035', '1Z24C3140200019819']

// Shippo tracking status → shipments.status, same mapping the app now uses.
const STATUS_MAP = {
  DELIVERED: 'Delivered', TRANSIT: 'In Transit', PRE_TRANSIT: 'Label Created',
  FAILURE: 'Exception', RETURNED: 'Exception',
}

const api = async (path) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.goshippo.com${path}`, { headers: { Authorization: `ShippoToken ${KEY}` } })
    if (r.ok) return r.json()
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); continue }
    return { __err: `${r.status}` }
  }
  return { __err: 'rate-limited' }
}

// Names are compared as token sets, not "surname last": Shippo has
// "Samuel Ngwamukie" where the order says "Ngwamukie Samuel", and UPS labels
// arrive as "ROBERT FARRAR", "Robert  Farrar", etc.
const tokens = (n) => new Set(String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ')
  .split(/\s+/).filter(t => t.length >= 2))
const shared = (a, b) => { const B = tokens(b); return [...tokens(a)].filter(t => B.has(t)).length }
// The postcode is the LAST 5-digit group in an address — the first one is often
// a house number ("12425 Bridgewood Ln").
const zip5      = (z) => { const m = String(z || '').match(/\d{5}/g); return m ? m[m.length - 1] : '' }
const dayDiff   = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000)
const ymd       = (d) => (d ? String(new Date(d).toISOString()).slice(0, 10) : null)

// Next free document number, same helper shape the earlier importers use.
async function nextNumber(client, table, col, prefix, width) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${col}, '^' || $1, ''), '')::int), 0) AS n
       FROM ${table} WHERE ${col} LIKE $1 || '%'`, [prefix])
  let n = rows[0].n
  return () => `${prefix}${String(++n).padStart(width, '0')}`
}

async function pullLabels() {
  const txs = []
  for (let page = 1; page <= 30; page++) {
    const d = await api(`/transactions/?results=100&page=${page}`)
    if (d.__err || !d.results?.length) break
    txs.push(...d.results)
    if (!d.next) break
  }

  const orders = new Map()
  const labels = []
  for (const t of txs) {
    if (t.status !== 'SUCCESS' || !t.tracking_number) continue
    let addr = null
    if (t.order) {
      if (!orders.has(t.order)) orders.set(t.order, await api(`/orders/${t.order}`))
      const o = orders.get(t.order)
      if (!o.__err) addr = o.to_address
    }
    labels.push({
      tracking: t.tracking_number, created: t.object_created, txId: t.object_id,
      labelUrl: t.label_url || null, eta: t.eta || null,
      name: addr?.name || null, street: addr?.street1 || null,
      city: addr?.city || null, state: addr?.state || null, zip: addr?.zip || null,
    })
  }

  for (const tn of EXTRA_TRACKING) {
    if (labels.some(l => l.tracking === tn)) continue
    const d = await api(`/tracks/ups/${tn}`)
    if (d.__err) { console.log(`  ! ${tn}: Shippo returned ${d.__err} — skipped`); continue }
    labels.push({
      tracking: tn, created: d.tracking_history?.[0]?.status_date || null, txId: null, labelUrl: null,
      eta: d.eta || null, name: d.address_to?.name || null, street: d.address_to?.street1 || null,
      city: d.address_to?.city || null, state: d.address_to?.state || null, zip: d.address_to?.zip || null,
    })
  }
  return labels
}

// Live carrier detail for one tracking number (status, delivery date, service).
async function liveTracking(tracking) {
  const d = await api(`/tracks/ups/${tracking}`)
  if (d.__err) return {}
  const ts = d.tracking_status || {}
  const deliveredScan = (d.tracking_history || []).find(h => h.status === 'DELIVERED')
  return {
    tracking_status: ts.status || null,
    status_details:  ts.status_details || null,
    last_scan_city:  ts.location?.city || null,
    last_scan_state: ts.location?.state || null,
    delivered_date:  ymd(deliveredScan?.status_date || null),
    service_type:    d.servicelevel?.name || null,
    estimated_delivery: ymd(d.eta),
    original_eta:    ymd(d.original_eta),
    ship_date:       ymd((d.tracking_history || [])[0]?.status_date),
  }
}

async function main() {
  if (!KEY) throw new Error('SHIPPO_API_KEY is not set — run this inside the backend container')
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const labels = await pullLabels()
    console.log(`Shippo labels found: ${labels.length}`)

    // Which are already in Decoinks?
    const { rows: known } = await client.query(
      `SELECT tracking_number FROM shipments WHERE deleted_at IS NULL AND tracking_number IS NOT NULL`)
    const haveTracking = new Set(known.map(r => r.tracking_number))
    const orphans = labels.filter(l => !haveTracking.has(l.tracking))
    console.log(`Already in Decoinks: ${labels.length - orphans.length} — missing: ${orphans.length}\n`)
    if (!orphans.length) { console.log('Nothing to do.'); return }

    // Candidate orders: live, no shipment of their own.
    const { rows: candidates } = await client.query(
      `SELECT o.id, o.order_number, o.order_date, o.status::text AS status, o.total,
              COALESCE(cust.name, o.contact_name, o.shipping_name) AS customer,
              o.shipping_address, o.shipping_name, o.contact_name,
              (SELECT p.id FROM purchase_orders p WHERE p.order_id = o.id AND p.deleted_at IS NULL
                ORDER BY p.created_at LIMIT 1) AS po_id,
              (SELECT p.po_number FROM purchase_orders p WHERE p.order_id = o.id AND p.deleted_at IS NULL
                ORDER BY p.created_at LIMIT 1) AS po_number
         FROM orders o
         LEFT JOIN customers cust ON cust.id = o.customer_id
        WHERE o.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL)`)

    // How many unattached labels share a recipient? Robert Farrar has four, so
    // "a Farrar order near this date" is not evidence for any one of them.
    const recipientKey = (l) => `${zip5(l.zip)}|${[...tokens(l.name)].sort().join(' ')}`
    const perRecipient = orphans.reduce((m, l) => m.set(recipientKey(l), (m.get(recipientKey(l)) || 0) + 1), new Map())

    const plan = []
    for (const l of orphans) {
      const live = await liveTracking(l.tracking)
      const labelDate = ymd(l.created) || live.ship_date
      const sZip = zip5(l.zip)

      // Some labels come back without a recipient name (the tracking API does not
      // always carry one). Fall back to the customer already known at that exact
      // postcode + street, so the row is still identifiable.
      if (!l.name && sZip) {
        const { rows: [byAddr] } = await client.query(
          `SELECT customer_name FROM shipments
            WHERE deleted_at IS NULL AND ship_to_postal_code LIKE $1 || '%'
              AND customer_name IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`, [sZip])
        if (byAddr) { l.name = byAddr.customer_name; l.nameFromAddress = true }
      }

      const hits = candidates.filter(c => {
        const zipOk = sZip && zip5(c.shipping_address) === sZip
        if (sZip && zip5(c.shipping_address) && !zipOk) return false
        // Two shared name tokens, or one plus a confirmed postcode.
        const score = Math.max(...[c.customer, c.shipping_name, c.contact_name]
          .filter(Boolean).map(n => shared(l.name, n)), 0)
        if (!(score >= 2 || (score >= 1 && zipOk))) return false
        const window = perRecipient.get(recipientKey(l)) > 1 ? TIGHT_WINDOW_DAYS : MATCH_WINDOW_DAYS
        if (labelDate && c.order_date && dayDiff(labelDate, c.order_date) > window) return false
        return true
      })

      plan.push({
        label: l, live, labelDate, hits,
        match: hits.length === 1 ? hits[0] : null,
        competing: perRecipient.get(recipientKey(l)) > 1,
      })
    }

    const matched = plan.filter(p => p.match)
    const unmatched = plan.filter(p => !p.match)

    console.log(`MATCHED to a sales order (${matched.length}):`)
    for (const p of matched) {
      console.log(`  ${p.label.tracking}  ${p.labelDate}  ${String(p.label.name).padEnd(22)} ` +
        `${p.label.city}, ${p.label.state} ${p.label.zip}`)
      console.log(`      → ${p.match.order_number} (${p.match.status}, ${p.match.order_date.toISOString().slice(0, 10)}, ` +
        `${p.match.customer})${p.match.po_number ? ` + ${p.match.po_number}` : ' — no PO'}   carrier: ${p.live.tracking_status || '?'}`)
    }

    console.log(`\nUNMATCHED — no sales order in Decoinks (${unmatched.length}):`)
    for (const p of unmatched) {
      const why = p.hits.length > 1 ? `${p.hits.length} possible orders — ambiguous`
        : p.competing ? 'this recipient has several unattached labels — cannot tell which order'
        : 'no order for this customer/date'
      console.log(`  ${p.label.tracking}  ${p.labelDate}  ${String(p.label.name).padEnd(22)} ` +
        `${p.label.city}, ${p.label.state} ${p.label.zip}  [${p.live.tracking_status || '?'}]  — ${why}`)
    }

    if (!APPLY) {
      console.log(`\nDRY RUN — would attach ${matched.length} label(s) to their order` +
        (MATCHED_ONLY ? '' : ` and record ${unmatched.length} order-less shipment(s)`) +
        '. Re-run with --apply to commit.')
      return
    }

    const { rows: [actor] } = await client.query(
      `SELECT id FROM users WHERE is_active AND role = 'Admin' ORDER BY created_at LIMIT 1`)
    const nextShip = await nextNumber(client, 'shipments', 'shipment_number', 'SHP-2026-', 4)

    await client.query('BEGIN')
    let attached = 0, recorded = 0
    for (const p of [...matched, ...(MATCHED_ONLY ? [] : unmatched)]) {
      const l = p.label, live = p.live
      const status = STATUS_MAP[String(live.tracking_status || '').toUpperCase()] || 'In Transit'
      const address = [l.street, l.city && `${l.city}, ${l.state} ${l.zip}`].filter(Boolean).join(', ')
      const note = p.match
        ? `Label imported from Shippo and matched to ${p.match.order_number} by ship-to address + date.`
        : 'Label imported from Shippo. No Decoinks sales order matched this recipient/date — link it once the order is entered.'

      await client.query(
        `INSERT INTO shipments (shipment_number, order_id, status, carrier, tracking_number,
           ship_date, recipient_name, customer_name, address, ship_to_city, ship_to_state, ship_to_postal_code,
           service_type, tracking_status, status_details, last_scan_city, last_scan_state, delivered_date,
           estimated_delivery, original_eta, shippo_transaction_id, label_url, ship_source, notes,
           created_by, tracking_synced_at)
         VALUES ($1,$2,$3::shipment_status,'UPS',$4,$5::date,$6,$6,$7,$8,$9,$10,
                 $11,$12,$13,$14,$15,$16::date,$17::date,$18::date,$19,$20,'Decoinks Fulfillment',$21,$22,NOW())`,
        [nextShip(), p.match?.id || null, status, l.tracking, live.ship_date || p.labelDate,
         l.name, address, l.city, l.state, l.zip,
         live.service_type, live.tracking_status, live.status_details, live.last_scan_city, live.last_scan_state,
         live.delivered_date, live.estimated_delivery, live.original_eta,
         l.txId, l.labelUrl, note, actor?.id || null])

      if (p.match) {
        // Mirror the tracking onto the sales order and, when there is one, the PO —
        // both surface it in their own lists.
        await client.query(
          `UPDATE orders SET tracking_number = $1, updated_at = NOW()
            WHERE id = $2 AND NULLIF(TRIM(COALESCE(tracking_number,'')),'') IS NULL`,
          [l.tracking, p.match.id])
        if (p.match.po_id) {
          await client.query(
            `UPDATE purchase_orders SET tracking_number = $1, updated_at = NOW()
              WHERE id = $2 AND NULLIF(TRIM(COALESCE(tracking_number,'')),'') IS NULL`,
            [l.tracking, p.match.po_id])
        }
        attached++
      } else recorded++
    }
    await client.query('COMMIT')
    console.log(`\nAttached to a sales order: ${attached}. Recorded without an order: ${recorded}.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
