/**
 * Do customers ke pate, jo unhone khud chat mein likhe the.
 *
 * Aaj jab chat se chaar orders banaye gaye the, Blanca Mosqueda aur Milangella
 * Navarro ke pate mil gaye the aur daal diye gaye the. Carl Deibler aur Chris
 * Cox ke reh gaye — un ke orders par shipping address khali hai aur customer
 * record par bhi kuch nahi. Dono ne apna pata chat mein khud likha tha:
 *
 *   conv 846, 18 Aug 16:05  staff: "Send us your address/ Zip code so we can
 *                           calculate shipping"
 *                           Carl: "Carl deibler 3757 Karl rd Allegany ny 14706"
 *                           — usi ke baad $25 shipping laga aur total $155 bana.
 *
 *   conv 266, 20 Aug 15:04  Chris: "Do u need my shipping address" → "yes" →
 *                           "Chris Cox / 33 Weaver Street / Buchanan Ga 30113"
 *
 * Pata teen jagah jata hai, wahi tarteeb jo bhare hue customers par hai
 * (misal CUST-2026-0067 Hector Garcia):
 *   1. orders.shipping_address  — ek line: "line1, city, ST zip, United States"
 *   2. customers.address_line1 / city / state / zip / country
 *   3. customer_addresses mein ek shipping row, is_default
 *
 * Customer ka pehle se koi address ho to chhor diya jata hai — chat purani ho
 * sakti hai aur naya pata zyada durust.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'addresses_from_chat_backup_20260825'

const ROWS = [
  { customer: 'Carl Deibler', line1: '3757 Karl Rd', city: 'Allegany',  state: 'NY', zip: '14706',
    conv: 846, said: '"Carl deibler 3757 Karl rd Allegany ny 14706" — 18 Aug 16:05' },
  { customer: 'Chris Cox',    line1: '33 Weaver Street', city: 'Buchanan', state: 'GA', zip: '30113',
    conv: 266, said: '"Chris Cox / 33 Weaver Street / Buchanan Ga 30113" — 20 Aug 15:04' },
]

const oneLine = r => `${r.line1}, ${r.city}, ${r.state} ${r.zip}, United States`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skipped = []

  for (const r of ROWS) {
    const c = await one(
      `SELECT id, customer_number, name, address_line1, city, state, zip, country
         FROM customers WHERE deleted_at IS NULL AND LOWER(name)=LOWER($1)`, [r.customer])
    if (!c) { skipped.push([r.customer, 'customer nahi mila']); continue }

    const orders = (await query(
      `SELECT id, order_number, order_date::date AS d, COALESCE(shipping_address,'') AS addr
         FROM orders WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY order_date`, [c.id])).rows
    const addrRows = (await query(
      `SELECT id, line1, city, state, zipcode FROM customer_addresses WHERE customer_id=$1`, [c.id])).rows

    plan.push({ ...r, c, orders, addrRows })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.c.customer_number}  ${p.c.name}`)
    console.log(`   chat: ${p.said}   [conv ${p.conv}]`)
    console.log(`   pata: ${oneLine(p)}`)
    const cHas = [p.c.address_line1, p.c.city, p.c.state, p.c.zip].some(x => x)
    console.log(`   customer record: ${cHas ? 'pehle se bhara hua — chhora jayega' : 'khali → bharega'}`)
    console.log(`   address book:    ${p.addrRows.length ? `${p.addrRows.length} pehle se — chhora jayega` : 'khali → ek shipping row banegi'}`)
    for (const o of p.orders)
      console.log(`   ${o.order_number}  ${o.d}   shipping_address: ${o.addr ? 'pehle se bhara — chhora jayega' : 'khali → bharega'}`)
  }
  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`   ${n}  ${why}`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const save = async (what, ref, sql, params) => {
    const { rows } = await query(sql, params)
    for (const r of rows) await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`, [what, ref, r.j])
  }

  let done = 0
  for (const p of plan) {
    const cHas = [p.c.address_line1, p.c.city, p.c.state, p.c.zip].some(x => x)
    if (!cHas) {
      await save('customer', p.c.customer_number, `SELECT to_jsonb(x) AS j FROM customers x WHERE x.id=$1`, [p.c.id])
      await query(
        `UPDATE customers SET address_line1=$2, city=$3, state=$4, zip=$5, country='United States', updated_at=NOW()
          WHERE id=$1`, [p.c.id, p.line1, p.city, p.state, p.zip])
    }
    if (!p.addrRows.length) {
      await query(
        `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, contact_person, created_at)
         VALUES ($1,'shipping',$2,$3,$4,$5,'United States',true,$6,NOW())`,
        [p.c.id, p.line1, p.city, p.state, p.zip, p.c.name])
    }
    for (const o of p.orders) {
      if (o.addr) continue
      await save('order', o.order_number, `SELECT to_jsonb(x) AS j FROM orders x WHERE x.id=$1`, [o.id])
      await query(`UPDATE orders SET shipping_address=$2, shipping_name=$3, updated_at=NOW() WHERE id=$1`,
        [o.id, oneLine(p), p.c.name])
      done++
    }
    console.log(`   ${p.c.customer_number}  ${p.c.name}  →  ${oneLine(p)}`)
  }

  console.log(`\nho gaya. ${plan.length} customers, ${done} orders par pata laga.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
