/**
 * Har silsile ke number ko lagataar karna — 1, 2, 3, bina naghe ke.
 *
 * Jaanch ke baad chaar silsilon mein naghe (gaps) nikle. Nagha wahan bana jahan
 * koi record hataya gaya aur uska number khali reh gaya:
 *
 *   customers   15 naghe   (30, 53, 58, 64, 65, 80-84, 89, 91, 95, 96, 103)
 *   payments     4 naghe   (128, 129, 130, 136)
 *   quotations   1 nagha   (127)
 *   invoices     1 nagha   (127)
 *
 * orders, purchase orders aur shipments pehle se lagataar hain — unhein haath
 * nahi lagta.
 *
 * TARTEEB NAHI BADALTI. Har record apni maujooda tarteeb mein hi rehta hai, bas
 * number neeche khisak jata hai. Jo pehla tha wo pehla hi rahega.
 *
 * TEEN BAATON KA KHAAS KHAYAL:
 *
 * 1. Unique index hataye hue rows par bhi lagta hai. Is liye agar koi hataya
 *    hua record us number par baitha ho jahan zinda record aana hai, to pehle
 *    usay "-VOID" laga kar raaste se hataya jata hai. Filhal aisa ek hi hai:
 *    Q-2026-0127.
 *
 * 2. Do marhale mein badla jata hai — pehle har badalne wale ko aarzi naam,
 *    phir asal naam. Warna beech mein do rows ek hi number par takra jayengi.
 *
 * 3. Purane number kuch jagah likhe hue bhi hain. Wo saath saath badalte hain,
 *    warna wo kisi aur ki taraf ishara karne lagenge:
 *       activity_logs.description   79 rows CUST-, 2 rows Q-
 *       purchase_orders.notes       22 rows PAY-
 *       payments.notes               5 rows PAY-
 *       invoices.notes              38 rows <ABC>-NNNN
 *    Text bhi do marhale mein badalta hai — pehle ek aisi nishani jo kisi asli
 *    likhai mein aa hi nahi sakti, phir naya number. Seedha badalne par
 *    "0031 → 0030" ke baad agla qadam usi 0030 ko dobara badal deta.
 *
 * ORDER COUNTER: ORD-2026 counter 131 par hai magar sab se bara zinda order
 * 0125 hai. Beech ka ORD-2026-0131 ($25, 4 September) doosre session ne hata
 * diya tha. Us hataye hue ko -VOID kar ke counter 125 par laya jata hai, taake
 * agla naya order 0126 bane, 0132 nahi.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'renumber_backup_20260905'
const pad = n => String(n).padStart(4, '0')
// Nishani aisi ho jo kisi asli note mein na aa sake — warna aadha badla text
// dobara badal jayega.
const mark = i => `@@RENUM${i}@@`

async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }
async function all(sql, p) { const { rows } = await query(sql, p); return rows }

// Har silsila: zinda rows kaise chunni hain, aur naya number kaise banta hai.
const SERIES = [
  { key: 'customers', table: 'customers', col: 'customer_number', counter: 'CUST-2026',
    live: `deleted_at IS NULL AND customer_number ~ '^CUST-2026-[0-9]{4}$'`,
    any:  `customer_number ~ '^CUST-2026-[0-9]{4}$'`,
    make: (row, n) => `CUST-2026-${pad(n)}` },
  { key: 'payments', table: 'payments', col: 'payment_number', counter: 'PAY-2026',
    live: `payment_number ~ '^PAY-2026-[0-9]{4}$'`,          // payments soft-delete nahi hoti
    any:  `payment_number ~ '^PAY-2026-[0-9]{4}$'`,
    make: (row, n) => `PAY-2026-${pad(n)}` },
  { key: 'quotations', table: 'quotations', col: 'quote_number', counter: 'Q-2026',
    live: `deleted_at IS NULL AND quote_number ~ '^Q-2026-[0-9]{4}$'`,
    any:  `quote_number ~ '^Q-2026-[0-9]{4}$'`,
    make: (row, n) => `Q-2026-${pad(n)}` },
  // Invoice number <TEEN HAROOF>-<NNNN> hai: haroof customer ke naam se aate
  // hain aur wahi rehte hain, sirf number ka hissa khisakta hai.
  { key: 'invoices', table: 'invoices', col: 'invoice_number', counter: 'INV',
    live: `deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]{4}$'`,
    any:  `invoice_number ~ '^[A-Z]{3}-[0-9]{4}$'`,
    make: (row, n) => `${row.num.slice(0, 3)}-${pad(n)}` },
]

// Jahan jahan purane number likhe hue hain.
const CITATIONS = [
  { table: 'activity_logs',   col: 'description', series: ['customers', 'quotations'] },
  { table: 'purchase_orders', col: 'notes',       series: ['payments'] },
  { table: 'payments',        col: 'notes',       series: ['payments'] },
  { table: 'invoices',        col: 'notes',       series: ['invoices'] },
]

async function planSeries(s) {
  const rows = await all(
    `SELECT id, ${s.col} AS num, substring(${s.col} from '([0-9]{4})$')::int AS seq
       FROM ${s.table} WHERE ${s.live} ORDER BY seq`)
  const moves = []
  rows.forEach((row, i) => {
    const to = s.make(row, i + 1)
    if (to !== row.num) moves.push({ id: row.id, from: row.num, to })
  })
  const targets = new Set(moves.map(m => m.to))
  const blockers = (await all(
    `SELECT id, ${s.col} AS num FROM ${s.table} WHERE ${s.any} AND NOT (${s.live})`))
    .filter(b => targets.has(b.num))
  return { ...s, total: rows.length, moves, blockers }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const plans = []
  for (const s of SERIES) plans.push(await planSeries(s))

  const ordMaxLive = await one(
    `SELECT MAX(substring(order_number from '([0-9]{4})$')::int) AS n FROM orders
      WHERE deleted_at IS NULL AND order_number ~ '^ORD-2026-[0-9]{4}$'`)
  const ordAbove = await all(
    `SELECT id, order_number FROM orders
      WHERE deleted_at IS NOT NULL AND order_number ~ '^ORD-2026-[0-9]{4}$'
        AND substring(order_number from '([0-9]{4})$')::int > $1`, [ordMaxLive.n])
  const ordCounter = await one(`SELECT last_value FROM counters WHERE scope='ORD-2026'`)

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plans) {
    console.log(`${p.key}: ${p.total} zinda, ${p.moves.length} ka number badlega, counter -> ${p.total}`)
    for (const b of p.blockers) console.log(`   raaste mein hataya hua ${b.num} -> ${b.num}-VOID`)
    for (const m of p.moves.slice(0, 3)) console.log(`   ${m.from} -> ${m.to}`)
    if (p.moves.length > 3) console.log(`   ... aur ${p.moves.length - 3}`)
  }
  console.log(`\norders: counter ${ordCounter.last_value}, sab se bara zinda ORD-2026-${pad(ordMaxLive.n)}`)
  for (const o of ordAbove) console.log(`   hataya hua ${o.order_number} -> ${o.order_number}-VOID`)
  console.log(`   counter -> ${ordMaxLive.n}`)

  const maps = {}
  for (const p of plans) maps[p.key] = p.moves

  console.log('\nlikhe hue purane number bhi badlenge:')
  for (const c of CITATIONS) {
    const moves = c.series.flatMap(k => maps[k])
    if (!moves.length) continue
    const n = await one(`SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.col} LIKE ANY($1)`,
      [moves.map(m => `%${m.from}%`)])
    console.log(`   ${c.table}.${c.col}  ${n.n} rows`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)

  await query('BEGIN')
  try {
    for (const p of plans) {
      if (!p.moves.length && !p.blockers.length) { console.log(`${p.key}: pehle se lagataar`); continue }
      for (const b of p.blockers) {
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`, [b.id, `${b.num}-VOID`])
        await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,$2,$3)`,
          [`${p.key}-void`, b.num, JSON.stringify({ id: b.id, from: b.num, to: `${b.num}-VOID` })])
      }
      for (let i = 0; i < p.moves.length; i++)
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`,
          [p.moves[i].id, `TMP-${p.key.slice(0, 3)}-${i}`])
      for (const m of p.moves)
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`, [m.id, m.to])
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,'moves',$2)`,
        [p.key, JSON.stringify(p.moves)])
      await query(`UPDATE counters SET last_value=$2, updated_at=NOW() WHERE scope=$1`, [p.counter, p.total])
      console.log(`${p.key}: ${p.moves.length} numbers badle, counter ${p.total}`)
    }

    for (const c of CITATIONS) {
      const moves = c.series.flatMap(k => maps[k])
      if (!moves.length) continue
      await query(
        `INSERT INTO ${BACKUP} (what, ref, row_data)
         SELECT 'citation', $1, jsonb_build_object('id', id, 'text', ${c.col})
           FROM ${c.table} WHERE ${c.col} LIKE ANY($2)`,
        [`${c.table}.${c.col}`, moves.map(m => `%${m.from}%`)])
      for (let i = 0; i < moves.length; i++)
        await query(`UPDATE ${c.table} SET ${c.col}=REPLACE(${c.col}, $1, $2)
                      WHERE ${c.col} LIKE '%' || $1 || '%'`, [moves[i].from, mark(i)])
      let touched = 0
      for (let i = 0; i < moves.length; i++) {
        const r = await query(`UPDATE ${c.table} SET ${c.col}=REPLACE(${c.col}, $1, $2)
                                WHERE ${c.col} LIKE '%' || $1 || '%'`, [mark(i), moves[i].to])
        touched += r.rowCount
      }
      const leftOver = await one(
        `SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.col} LIKE '%@@RENUM%'`)
      if (Number(leftOver.n)) throw new Error(`${c.table}.${c.col} mein ${leftOver.n} nishani reh gayi`)
      console.log(`${c.table}.${c.col}: ${touched} jagah number badla`)
    }

    for (const o of ordAbove)
      await query(`UPDATE orders SET order_number=$2 WHERE id=$1`, [o.id, `${o.order_number}-VOID`])
    await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='ORD-2026'`, [ordMaxLive.n])
    console.log(`orders: counter ${ordCounter.last_value} -> ${ordMaxLive.n}`)

    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log(`\npurani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
