/**
 * The UPS export, read back into the shipments the shop already has.
 *
 * Two things it carries that nothing here knew. First, what each parcel
 * actually was — the service it went by, its weight and size, what it cost to
 * send, whether it was insured — none of which the shop had ever recorded.
 * Second, the real tracking numbers: two shipments were written down under the
 * batch id of the label run rather than the number the courier scans, so they
 * could never have been tracked at all.
 *
 * A row already known by its tracking number is filled in. A row that is not
 * is matched to an order by surname and date, and only when exactly one order
 * fits — anything ambiguous is printed and left alone rather than guessed.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')
const fs = require('fs')

const FILE = `${__dirname}/data/shippo-export-2026-09-01.tsv`
const WINDOW_DAYS = 7

// Names as the courier has them are not always the names the shop has.
const ALIAS = { 'e paguio': 'paguio', 'milangella navarro fernandez': 'navarro' }

const plain = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const surnameOf = name => {
  const key = plain(name)
  if (ALIAS[key]) return ALIAS[key]
  const words = key.split(' ')
  return words.length === 1 ? words[0] : words[words.length - 1]
}

// The courier's own word for where the parcel is.
const statusFrom = s => (s === 'DELIVERED' ? 'Delivered' : s === 'TRANSIT' ? 'In Transit' : 'Label Created')

async function main() {
  const apply = process.argv.includes('--apply')
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n')
  const head = lines[0].split('\t')
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))

  const known = new Map((await query(
    `SELECT id, BTRIM(tracking_number) AS t, order_id FROM shipments
      WHERE deleted_at IS NULL AND NULLIF(BTRIM(tracking_number),'') IS NOT NULL`)).rows.map(r => [r.t, r]))

  const enrich = [], attach = [], unclear = []

  for (const r of rows) {
    const hit = known.get(r.tracking)
    if (hit) { enrich.push({ ...r, shipmentId: hit.id }); continue }

    // Surname alone is not enough — this book holds three Garcias and two
    // Farrars — so the whole name is tried first, and a surname only decides
    // when one order is plainly nearer the shipping date than the rest.
    const surname = surnameOf(r.to_name)
    const { rows: cand } = await query(
      `SELECT o.id, o.order_number, o.order_date, c.name AS customer,
              (SELECT id FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL LIMIT 1) AS shipment_id,
              (SELECT BTRIM(tracking_number) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL LIMIT 1) AS shipment_tracking
         FROM orders o JOIN customers c ON c.id = o.customer_id
        -- A free job is parked out of the sales book but the parcel still went,
        -- so it keeps its shipment. The D- rows are leftovers from renumbering
        -- and stand for nothing.
        WHERE (o.deleted_at IS NULL OR o.order_number LIKE 'FREE-%')
          AND lower(regexp_replace(translate(c.name,
                'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'), '[^A-Za-z0-9 ]', ' ', 'g'))
              LIKE '%' || $1 || '%'
          AND abs(o.order_date - $2::date) <= $3
          AND (NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL)
               OR EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL
                           AND s.tracking_number LIKE 'batch\\_%'))
        ORDER BY abs(o.order_date - $2::date)`,
      [surname, r.created.slice(0, 10), WINDOW_DAYS])

    const day = d => Math.abs((new Date(d) - new Date(r.created.slice(0, 10))) / 86400000)
    const full = plain(r.to_name)
    const exact = cand.filter(o => plain(o.customer) === full)
    const pool_ = exact.length ? exact : cand

    let chosen = null
    if (pool_.length === 1) chosen = pool_[0]
    else if (pool_.length > 1) {
      const sorted = [...pool_].sort((a, b) => day(a.order_date) - day(b.order_date))
      // Only when the nearest is unambiguously nearer than the next.
      if (day(sorted[0].order_date) < day(sorted[1].order_date)) chosen = sorted[0]
    }
    if (chosen) attach.push({ ...r, order: chosen })
    else unclear.push({ ...r, count: cand.length, cand })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  export rows                                   ${rows.length}`)
  console.log(`  1. pehle se maujood — tafseel bharenge        ${enrich.length}`)
  console.log(`  2. order se jorenge / tracking theek karenge  ${attach.length}`)
  console.log(`  — saaf nahi, chhor rahe hain                  ${unclear.length}`)
  if (attach.length) {
    console.log('\n  JORE JAYENGE:')
    for (const a of attach)
      console.log(`    ${a.created.slice(0,10)}  ${a.tracking}  ${a.to_name.padEnd(28)} -> ` +
                  `${a.order.order_number} ${a.order.customer}` +
                  (a.order.shipment_tracking?.startsWith('batch_') ? '  (batch id ki jagah)' : ''))
  }
  if (unclear.length) {
    console.log('\n  SAAF NAHI:')
    for (const u of unclear)
      console.log(`    ${u.created.slice(0,10)}  ${u.tracking}  ${u.to_name.padEnd(28)} ${u.count} candidate`)
  }
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  const lb = (w, unit) => unit === 'kg' ? +(Number(w) * 2.20462).toFixed(2) : Number(w)

  await query('BEGIN')
  try {
    for (const e of enrich) {
      await query(
        `UPDATE shipments SET carrier = $2, service_type = $3, weight_lbs = $4,
                shipping_cost = $5, status = $6::shipment_status, tracking_status = $7,
                delivered_date = CASE WHEN $8::text = 'DELIVERED' THEN COALESCE(delivered_date, $9::date) ELSE delivered_date END,
                ship_date = COALESCE(ship_date, $9::date), updated_at = NOW()
          WHERE id = $1`,
        [e.shipmentId, e.provider, e.service, lb(e.weight, e.mass_unit), Number(e.rate),
         statusFrom(e.status), e.status, e.status, e.created.slice(0, 10)])
    }

    for (const a of attach) {
      const shipDate = a.created.slice(0, 10)
      if (a.order.shipment_id) {
        // The batch id of the label run, replaced by the number UPS scans.
        await query(
          `UPDATE shipments SET tracking_number = $2, carrier = $3, service_type = $4,
                  weight_lbs = $5, shipping_cost = $6, status = $7::shipment_status, tracking_status = $8,
                  delivered_date = CASE WHEN $9::text = 'DELIVERED' THEN $10::date ELSE NULL END,
                  ship_date = $10::date, updated_at = NOW()
            WHERE id = $1`,
          [a.order.shipment_id, a.tracking, a.provider, a.service, lb(a.weight, a.mass_unit),
           Number(a.rate), statusFrom(a.status), a.status, a.status, shipDate])
      } else {
        const { rows: n } = await query(
          `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number,'-',3),'')::INT),0)+1 AS n
             FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`)
        await query(
          `INSERT INTO shipments (shipment_number, order_id, customer_name, carrier, service_type,
                                  tracking_number, status, tracking_status, ship_date, delivered_date,
                                  weight_lbs, shipping_cost, recipient_name, address,
                                  ship_to_city, ship_to_state, ship_to_postal_code,
                                  ship_source, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::shipment_status,$8,$9::date,
                   CASE WHEN $18::text = 'DELIVERED' THEN $9::date ELSE NULL END,
                   $10,$11,$12,$13,$14,$15,$16,'Decoinks Fulfillment',$17,NOW(),NOW())`,
          [`SHP-2026-${String(n[0].n).padStart(4, '0')}`, a.order.id, a.order.customer,
           a.provider, a.service, a.tracking, statusFrom(a.status), a.status, shipDate,
           lb(a.weight, a.mass_unit), Number(a.rate), a.to_name,
           `${a.to_street}, ${a.to_city}, ${a.to_state}, ${a.to_zip}, United States`,
           a.to_city, a.to_state, a.to_zip, 'From the UPS export of 2026-09-01', a.status])
      }
      // The order should say what the courier says.
      await query(
        `UPDATE orders SET courier = $2, tracking_number = $3,
                shipped_at = COALESCE(shipped_at, $4::date),
                status = CASE WHEN $5::text = 'DELIVERED' THEN 'Delivered'::order_status ELSE 'Shipped'::order_status END,
                process_status = CASE WHEN $5::text = 'DELIVERED' THEN 'Delivered' ELSE 'Shipped' END,
                updated_at = NOW()
          WHERE id = $1`,
        [a.order.id, a.provider, a.tracking, shipDate, a.status])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\nho gaya\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
