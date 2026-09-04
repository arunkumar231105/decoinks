/**
 * Bring back every label the Shippo account has bought.
 *
 * Labels are not only bought from this software. They are bought from Shippo's
 * own dashboard as well, and nothing was reading those back — the parcel went
 * out, the courier scanned it all the way to the door, and the shop's own book
 * never heard of it. The hourly tracking sync could not help: it only refreshes
 * shipments that are already here.
 *
 * A label already known by its tracking number is left alone; the tracking sync
 * owns its status. A label that is new gets a shipment, matched to the order it
 * belongs to by the name it was addressed to and the day it was bought — and
 * only when exactly one order fits. Anything ambiguous is recorded unattached
 * and named in the output, because a parcel on the wrong order is worse than a
 * parcel on none.
 *
 * Dry run by default. Pass --apply to write.
 *   --pages N   stop after N pages of 100 (default 20; the account has far less)
 */
const { query, pool } = require('../src/config/db')
const shippo = require('../src/utils/shippo')

const PAGES = Number((process.argv.find(a => a.startsWith('--pages=')) || '').split('=')[1]) || 20
const WINDOW_DAYS = 7

const plain = s => String(s || '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const surnameOf = name => {
  const w = plain(name).split(' ')
  return w.length === 1 ? w[0] : w[w.length - 1]
}

// The courier's word for where the parcel is, in the shop's own vocabulary.
const statusFrom = s => ({
  DELIVERED: 'Delivered', TRANSIT: 'In Transit', PRE_TRANSIT: 'Label Created',
  RETURNED: 'Exception', FAILURE: 'Exception',
}[String(s || '').toUpperCase()] || 'Label Created')

const lb = (weight, unit) =>
  unit && String(unit).toLowerCase() === 'kg' ? +(Number(weight) * 2.20462).toFixed(2) : Number(weight) || null

async function main() {
  const apply = process.argv.includes('--apply')
  if (!shippo.isConfigured()) throw new Error('SHIPPO_API_KEY set nahi hai')

  const known = new Set((await query(
    `SELECT BTRIM(tracking_number) AS t FROM shipments
      WHERE NULLIF(BTRIM(tracking_number),'') IS NOT NULL`)).rows.map(r => r.t))

  const fresh = []
  const batch = await shippo.listTransactions({ results: 100, maxPages: PAGES })
  const seen = batch.length
  {
    for (const t of batch) {
      // A label that failed to buy is not a parcel, and a test label is not a
      // parcel either.
      if (t.status !== 'SUCCESS' || t.test) continue
      const tracking = String(t.tracking_number || '').trim()
      if (!tracking || known.has(tracking)) continue
      known.add(tracking)                       // the same label can list twice
      fresh.push(t)
    }
  }

  // Only the new ones cost an extra call each.
  for (const t of fresh) {
    try {
      const sh = t.rate?.object_id ? await shippo.shipmentBehindRate(t.rate.object_id) : null
      t._to = sh?.address_to ?? null
      t._parcel = Array.isArray(sh?.parcels) ? sh.parcels[0] : null
    } catch { t._to = null }
  }

  for (const t of fresh) {
    const to = t._to
    const shipDate = String(t.object_created || '').slice(0, 10)
    if (!to?.name) { t._order = null; t._why = 'kis ke naam gaya, maloom nahi'; continue }

    const { rows: cand } = await query(
      `SELECT o.id, o.order_number, o.order_date, c.name AS customer
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE (o.deleted_at IS NULL OR o.order_number LIKE 'FREE-%')
          AND lower(regexp_replace(translate(c.name,
                'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'), '[^A-Za-z0-9 ]', ' ', 'g'))
              LIKE '%' || $1 || '%'
          AND abs(o.order_date - $2::date) <= $3`,
      [surnameOf(to.name), shipDate, WINDOW_DAYS])

    const day = d => Math.abs((new Date(d) - new Date(shipDate)) / 86400000)
    const exact = cand.filter(o => plain(o.customer) === plain(to.name))
    const pool_ = exact.length ? exact : cand
    let chosen = null
    if (pool_.length === 1) chosen = pool_[0]
    else if (pool_.length > 1) {
      const sorted = [...pool_].sort((a, b) => day(a.order_date) - day(b.order_date))
      if (day(sorted[0].order_date) < day(sorted[1].order_date)) chosen = sorted[0]
    }
    t._order = chosen
    if (!chosen) t._why = cand.length ? `${cand.length} orders fit, koi saaf nahi` : 'koi order nahi mila'
  }

  const attached = fresh.filter(t => t._order)
  const loose = fresh.filter(t => !t._order)

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  Shippo par dekhe        ${seen}`)
  console.log(`  pehle se system me      ${seen - fresh.length}`)
  console.log(`  naye                    ${fresh.length}  (${attached.length} order se judenge, ${loose.length} bina order)`)
  for (const t of fresh)
    console.log(`    ${String(t.object_created).slice(0,10)}  ${t.tracking_number}  ` +
                `${String(t._to?.name ?? '?').padEnd(24)} ${(t.rate?.provider ?? '?').padEnd(5)} ` +
                `${t._order ? '-> ' + t._order.order_number : '— ' + t._why}`)
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!fresh.length) { console.log('\nkuch naya nahi\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const t of fresh) {
      const to = t._to ?? {}
      const shipDate = String(t.object_created || '').slice(0, 10)
      const { rows: n } = await query(
        `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number,'-',3),'')::INT),0)+1 AS n
           FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`)
      await query(
        `INSERT INTO shipments (shipment_number, order_id, customer_name, carrier, service_type,
                                tracking_number, status, tracking_status, ship_date, delivered_date,
                                weight_lbs, shipping_cost, recipient_name, address,
                                ship_to_city, ship_to_state, ship_to_postal_code, label_url,
                                ship_source, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::shipment_status,$8,$9::date,
                 CASE WHEN $10::text = 'DELIVERED' THEN $9::date ELSE NULL END,
                 $11,$12,$13,$14,$15,$16,$17,$18,'Decoinks Fulfillment',$19,NOW(),NOW())`,
        [`SHP-2026-${String(n[0].n).padStart(4, '0')}`, t._order?.id ?? null,
         t._order?.customer ?? to.name ?? null, t.rate?.provider ?? null,
         t.rate?.servicelevel_name ?? null, t.tracking_number,
         statusFrom(t.tracking_status), t.tracking_status ?? null, shipDate, t.tracking_status ?? null,
         lb(t._parcel?.weight, t._parcel?.mass_unit), Number(t.rate?.amount) || null,
         to.name ?? null,
         [to.street1, to.city, to.state, to.zip, 'United States'].filter(Boolean).join(', ') || null,
         to.city ?? null, to.state ?? null, to.zip ?? null, t.label_url ?? null,
         t._order ? 'Pulled from the Shippo account' : `Pulled from the Shippo account — ${t._why}`])

      if (t._order) {
        await query(
          `UPDATE orders SET courier = COALESCE(NULLIF(courier,''), $2),
                  tracking_number = COALESCE(NULLIF(BTRIM(tracking_number),''), $3),
                  shipped_at = COALESCE(shipped_at, $4::date), updated_at = NOW()
            WHERE id = $1`,
          [t._order.id, t.rate?.provider ?? null, t.tracking_number, shipDate])
      }
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\n${fresh.length} shipment le aaye\n`)
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
