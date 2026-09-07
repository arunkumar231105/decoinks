/**
 * Chaar parcels ko unke sales order par lagana — Robert Farrar ki chat se.
 *
 * 155 shipments mein se 19 kisi order se juri nahi. Un mein se chaar Robert
 * Farrar ki hain, aur unki chat (Chatwoot conversation 23) mein saaf likha hai
 * ke kaun sa parcel kis kaam ka tha:
 *
 *   SHP-2026-0092  3 Aug   1Z24C3141315451035
 *       3 August ki poori guftagu isi baat par hai ke pichli delivery mein
 *       kuch designs kam nikle — "Michael Jackson Glove ordered 17 pc only
 *       received 7", "Malcolm ordered 17 pc received none". 4 August 01:47
 *       par sirf tracking number bheja gaya. Us se pehle jo parcel gaya tha wo
 *       SHP-2026-0074 (30 July) tha, ORD-2026-0073 par. Yeh us kami ka bharai
 *       wala parcel hai — is par shipping cost bhi darj nahi, kyunke muft
 *       bheja gaya.  ->  ORD-2026-0073
 *
 *   SHP-2026-0147  1 Sep   1Z24C3140209260961
 *       "Your package had been shipped yesterday by UPS tracking id
 *       1Z24C3140209260961, second day air" — 2 September ko kaha gaya. Us se
 *       pehle 1 September ko jo order summary bheji gayi wo 31 August ka 29
 *       pcs wala kaam tha. Hisaab bhi milta hai: 29 x $2.75 = $79.75 + $26
 *       shipping = $105.75, yaani bilkul ORD-2026-0124.  ->  ORD-2026-0124
 *
 *   SHP-2026-0145  2 Sep   1Z24C3140213747973
 *       4 September ko customer ne poocha "Got another shipment today ending
 *       in 7973? Is that the lost order?" aur jawab mila "No that is the order
 *       that is been delivered to you". Yaani yeh gum shuda parcel nahi, 2
 *       September wala 75 pcs ka kaam hai: 75 x $2.75 = $206.25 + $26 = $232.25,
 *       yaani ORD-2026-0125.  ->  ORD-2026-0125
 *
 *   SHP-2026-0152  4 Sep   1Z24C3140217505593
 *       28 August wala parcel (SHP-2026-0140, ORD-2026-0120) UPS se gum ho gaya
 *       — uski halat abhi bhi "Exception" hai. 4 September ko tay hua "We have
 *       to go for reprinting option now as there is no update from UPS", aur
 *       raat ko yeh tracking bheji gayi. Yeh usi order ka dobara chhapa hua
 *       maal hai, naya kaam nahi.  ->  ORD-2026-0120
 *
 * Ek order par ek se zyada parcel ja sakta hai — kami ka bharai aur reprint
 * dono isi ki misaal hain. Payments ka qaida (ek order, ek payment) yahan lagu
 * nahi hota.
 *
 * BAQI 15 KO CHHORA JA RAHA HAI. Un mein se 12 aise logon ke naam hain jinka
 * poore system mein ek bhi sales order nahi (Brooke Wylie, Alhelí AR, Alfredo
 * Huiracocha, Rick Cantu, Shaunte Jackson, Tina Grant, aur 3 September ka Jim
 * Callahan wala parcel). Unhein jorne ke liye pehle sales order banana parega,
 * aur order banane ka matlab raqam aur maal gharhna hai — wo owner hi bata
 * sakta hai. Teen Farrar ke apne hain magar unka koi nishan chat mein nahi:
 * SHP-2026-0093 (30 July, sirf label bana, na tracking chat mein gayi na koi
 * kharcha darj), SHP-2026-0099 (15 August, na tracking na halat) aur
 * SHP-2026-0020 / 0028 / 0029 (May ke, jab uska koi order hi nahi tha).
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'shipment_links_backup_20260905'

const LINKS = [
  { shp: 'SHP-2026-0092', ord: 'ORD-2026-0073', why: 'kami ka bharai — 3 Aug ki shikayat, 4 Aug ko tracking' },
  { shp: 'SHP-2026-0147', ord: 'ORD-2026-0124', why: '31 Aug ka 29 pcs ka kaam, 1 Sep ko bheja gaya' },
  { shp: 'SHP-2026-0145', ord: 'ORD-2026-0125', why: '2 Sep ka 75 pcs ka kaam, "ending in 7973"' },
  { shp: 'SHP-2026-0152', ord: 'ORD-2026-0120', why: 'gum shuda 28 Aug wale parcel ka reprint' },
]

async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skip = []

  for (const l of LINKS) {
    const s = await one(
      `SELECT id, shipment_number, ship_date::date AS d, tracking_number, order_id, po_id,
              coalesce(customer_name, recipient_name) AS who
         FROM shipments WHERE shipment_number=$1 AND deleted_at IS NULL`, [l.shp])
    const o = await one(
      `SELECT o.id, o.order_number, o.order_date::date AS d, o.total, c.name AS customer
         FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [l.ord])
    if (!s) { skip.push([l.shp, 'shipment nahi mili']); continue }
    if (!o) { skip.push([l.shp, `${l.ord} nahi mila`]); continue }
    if (s.order_id) { skip.push([l.shp, 'pehle se kisi order par lagi hui hai']); continue }
    // Table ka apna qaida: order ya PO, dono nahi.
    if (s.po_id) { skip.push([l.shp, 'yeh PO par lagi hui hai, order par nahi lag sakti']); continue }
    // Naam mel khana chahiye — warna galat customer ke parcel par lag jayegi.
    const a = String(s.who || '').trim().toLowerCase()
    const b = String(o.customer || '').trim().toLowerCase()
    if (!a || !b || (!a.includes(b.split(' ').pop()) && !b.includes(a.split(' ').pop()))) {
      skip.push([l.shp, `naam mel nahi khata: "${s.who}" aur "${o.customer}"`]); continue
    }
    plan.push({ ...l, s, o })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan)
    console.log(`  ${p.s.shipment_number}  ${p.s.d}  ${p.s.tracking_number || '(bina tracking)'}` +
                `\n     -> ${p.o.order_number}  ${p.o.d}  ${p.o.customer}  $${Number(p.o.total).toFixed(2)}` +
                `\n     ${p.why}\n`)
  for (const [n, w] of skip) console.log(`  ${n}  chhora — ${w}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  await query('BEGIN')
  try {
    for (const p of plan) {
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data)
                   SELECT 'shipment', $2, to_jsonb(x) FROM shipments x WHERE x.id=$1`, [p.s.id, p.shp])
      await query(`UPDATE shipments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [p.s.id, p.o.id])
      // Jorh ki tafseel bhi wahin likhi jati hai jahan API likhti hai. Agar us
      // parcel par pehle se koi primary darj ho to yeh naya usay nahi hatata.
      const hasPrimary = await one(
        `SELECT 1 FROM shipment_orders WHERE shipment_id=$1 AND is_primary`, [p.s.id])
      await query(
        `INSERT INTO shipment_orders (shipment_id, order_id, is_primary) VALUES ($1,$2,$3)
         ON CONFLICT (shipment_id, order_id) DO NOTHING`, [p.s.id, p.o.id, !hasPrimary])
      console.log(`  ${p.shp} -> ${p.ord}`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const left = await one(`SELECT COUNT(*) AS n FROM shipments
                           WHERE deleted_at IS NULL AND order_id IS NULL AND po_id IS NULL`)
  const noShip = await one(`SELECT COUNT(*) AS n FROM orders o WHERE o.deleted_at IS NULL
                             AND NOT EXISTS (SELECT 1 FROM shipments s
                                              WHERE s.order_id=o.id AND s.deleted_at IS NULL)`)
  console.log(`\nho gaya. ab ${left.n} shipments kisi order se juri nahi, aur ${noShip.n} orders bina shipment ke.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
