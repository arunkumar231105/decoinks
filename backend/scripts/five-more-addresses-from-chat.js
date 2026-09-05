/**
 * Paanch customers ke pate, jo unhone chat mein khud likhe the.
 *
 * 91 customers mein se 11 ka address adhoora ya khali hai. In paanch ke pate
 * Chatwoot mein saaf mil gaye — har ek staff ke poochhne par diya gaya:
 *
 *   Blanca Mosqueda   conv 929,  21 Aug  "Shipped to ..... 3546 lila st Riverside Ca 92504"
 *   Kenny Jones       conv 565,  17 Aug  "3343 biscay drive / San Diego Ca. 92154"
 *   Brooke Wylie      conv 1169, 31 Aug  staff: "provide your full address along with
 *                                        street" → "2575 Swanson rd Crouse NC 28033".
 *                                        29 Aug ko usne pehle P.O. Box 282 diya tha, wo
 *                                        sirf shipping ka andaza lagane ke liye tha; street
 *                                        wala baad ka aur khaas maanga hua hai.
 *   Michaelene Brown  conv 1325, 3 Sep   "P.O. Box 1627 Sacaton Az 85147"
 *   Valerie Carder    conv 1299, 2 aur 4 Sep  "229 Shuler Rd. Cleveland, GA 30528" (do baar)
 *
 * Pata teen jagah jata hai, wahi tarteeb jo bhare hue customers par hai:
 *   1. customers.address_line1 / city / state / zip / country
 *   2. customer_addresses mein ek default shipping row
 *   3. us customer ke un orders par jinka shipping_address khali hai
 *
 * Jo khana pehle se bhara ho usay haath nahi lagaya jata — chat purani ho sakti
 * hai aur baad ka pata zyada durust.
 *
 * JAAN BUJH KAR CHHORE GAYE (baqi 6):
 *   Matthew Carl — uske do orders do alag pate par gaye (700 Cassel Rd,
 *     Manchester PA aur 20231 Brightwood Court, Yorba Linda CA). Dono bhijwai
 *     ke pate hain; us ka apna kaun sa hai, chat se tay nahi hota.
 *   Victor Spates (CUST-CRM-D4D0F068E6) — yeh CUST-2026-0028 ka duplicate hai
 *     jo CRM bridge se bana. Us par pata mojood hai, bas poora line1 mein
 *     thusa hua hai. Asal record (4 orders wala) pehle se theek hai.
 *   Jenny, Hassaan Anis, Lashanniya, Muhammad hassan — chat mein koi pata nahi.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'customer_addresses_backup_20260905'

const ROWS = [
  { cust: 'CUST-2026-0086', name: 'Blanca Mosqueda',  line1: '3546 Lila St',     city: 'Riverside', state: 'CA', zip: '92504',
    said: 'conv 929, 21 Aug: "Shipped to ..... 3546 lila st Riverside Ca 92504"' },
  { cust: 'CUST-2026-0052', name: 'Kenny Jones',      line1: '3343 Biscay Drive', city: 'San Diego', state: 'CA', zip: '92154',
    said: 'conv 565, 17 Aug: "3343 biscay drive / San Diego Ca. 92154"' },
  { cust: 'CUST-2026-0101', name: 'Brooke Wylie',     line1: '2575 Swanson Rd',   city: 'Crouse',    state: 'NC', zip: '28033',
    said: 'conv 1169, 31 Aug: staff ne street maanga → "2575 Swanson rd Crouse NC 28033"' },
  { cust: 'CUST-2026-0100', name: 'Michaelene Brown', line1: 'P.O. Box 1627',     city: 'Sacaton',   state: 'AZ', zip: '85147',
    said: 'conv 1325, 3 Sep: "P.O. Box 1627 Sacaton Az 85147"' },
  { cust: 'CUST-2026-0098', name: 'Valerie Carder',   line1: '229 Shuler Rd',     city: 'Cleveland', state: 'GA', zip: '30528',
    said: 'conv 1299, 2 aur 4 Sep: "229 Shuler Rd. Cleveland, GA 30528"' },
]

const oneLine = r => `${r.line1}, ${r.city}, ${r.state} ${r.zip}, United States`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skipped = []

  for (const r of ROWS) {
    const c = await one(
      `SELECT id, customer_number, name, address_line1, city, state, zip
         FROM customers WHERE customer_number=$1 AND deleted_at IS NULL`, [r.cust])
    if (!c) { skipped.push([r.cust, 'customer nahi mila']); continue }
    if (c.name.trim().toLowerCase() !== r.name.trim().toLowerCase()) {
      skipped.push([r.cust, `naam "${c.name}" hai, "${r.name}" nahi — ruk raha hoon`]); continue
    }
    const already = [c.address_line1, c.city, c.state, c.zip].some(x => x)
    const addrRows = (await query(`SELECT id FROM customer_addresses WHERE customer_id=$1`, [c.id])).rows
    const orders = (await query(
      `SELECT id, order_number, order_date::date AS d FROM orders
        WHERE customer_id=$1 AND deleted_at IS NULL
          AND COALESCE(shipping_address,'') IN ('', 'United States')
        ORDER BY order_date`, [c.id])).rows
    plan.push({ ...r, c, already, hasBook: addrRows.length > 0, orders })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.c.customer_number}  ${p.c.name}`)
    console.log(`   ${p.said}`)
    console.log(`   pata: ${oneLine(p)}`)
    console.log(`   customer record: ${p.already ? 'pehle se bhara — chhora jayega' : 'khali → bharega'}`)
    console.log(`   address book:    ${p.hasBook ? 'pehle se hai — chhora jayega' : 'khali → shipping row banegi'}`)
    if (p.orders.length) for (const o of p.orders) console.log(`   ${o.order_number}  ${o.d}   shipping_address khali → bharega`)
    else console.log(`   (koi aisa order nahi jiska shipping_address khali ho)`)
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

  let nCust = 0, nOrders = 0, nBook = 0
  for (const p of plan) {
    if (!p.already) {
      await save('customer', p.c.customer_number, `SELECT to_jsonb(x) AS j FROM customers x WHERE x.id=$1`, [p.c.id])
      await query(
        `UPDATE customers SET address_line1=$2, city=$3, state=$4, zip=$5, country='United States', updated_at=NOW()
          WHERE id=$1`, [p.c.id, p.line1, p.city, p.state, p.zip])
      nCust++
    }
    if (!p.hasBook) {
      await query(
        `INSERT INTO customer_addresses (customer_id, address_type, line1, city, state, zipcode, country, is_default, contact_person, created_at)
         VALUES ($1,'shipping',$2,$3,$4,$5,'United States',true,$6,NOW())`,
        [p.c.id, p.line1, p.city, p.state, p.zip, p.c.name])
      nBook++
    }
    for (const o of p.orders) {
      await save('order', o.order_number, `SELECT to_jsonb(x) AS j FROM orders x WHERE x.id=$1`, [o.id])
      await query(`UPDATE orders SET shipping_address=$2, shipping_name=COALESCE(NULLIF(shipping_name,''),$3), updated_at=NOW()
                    WHERE id=$1`, [o.id, oneLine(p), p.c.name])
      nOrders++
    }
    console.log(`   ${p.c.customer_number}  ${p.c.name}  →  ${oneLine(p)}`)
  }

  const left = await one(`SELECT COUNT(*) AS n FROM customers
                           WHERE deleted_at IS NULL AND (COALESCE(address_line1,'')='' OR COALESCE(city,'')='')`)
  console.log(`\nho gaya. ${nCust} customer records, ${nBook} address book rows, ${nOrders} orders.`)
  console.log(`ab bhi bina address: ${left.n} customers.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
