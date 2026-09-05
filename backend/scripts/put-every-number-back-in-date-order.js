/**
 * Har silsile ke number ko tareekh ki tarteeb par lana — 1 sab se purana,
 * aakhri number sab se naya.
 *
 * Pehle sirf naghe band kiye the, tarteeb wahi rakhi thi jo pehle se thi. Us
 * waqt tak to theek tha, magar September ka data daalte hi tarteeb toot gayi:
 * naye order sheet ki tarteeb mein number le gaye, tareekh ki tarteeb mein
 * nahi. Nateeja yeh nikla ke ORD-2026-0135 3 September par baitha hai aur
 * ORD-2026-0130 5 September par — list kholte hi number ulte nazar aate hain.
 *
 * Ab har silsila apni tareekh par sajta hai:
 *
 *   orders            order_date
 *   purchase orders   order_date
 *   quotations        entry_date (na ho to created_at)
 *   invoices          issue_date
 *   payments          payment_date
 *   shipments         ship_date (na ho to created_at)
 *   customers         created_at
 *
 * Ek hi din ke kai record hon to jo pehle bana wo pehle — created_at, aur wo
 * bhi barabar ho to maujooda number.
 *
 * TAREEKHEIN PEHLE DURUST HOTI HAIN. List mein "Quote Date" asal mein
 * created_at hai. Jo quotations aur invoices aaj banayi gayin unka created_at
 * aaj ka par gaya, jabke kaam 1 se 4 September ka hai — is liye list mein sab
 * ek hi din ki lagti hain aur tarteeb bekaar ho jati hai. Aaj bani hui aisi har
 * row ka created_at uske apne dastavez ki tareekh par le jaya jata hai. Jo row
 * aaj ki hai hi (5 September ka kaam) usay haath nahi lagta.
 *
 * Do marhale mein — pehle aarzi naam, phir asal — warna beech mein do rows ek
 * hi number par takra jayengi. Hataye hue record jo raaste mein khare hon,
 * unhein "-VOID" laga diya jata hai, kyunke unique index un par bhi lagta hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'date_order_backup_20260905'
const TODAY  = '2026-09-05'
const pad4 = n => String(n).padStart(4, '0')
async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }
async function all(sql, p) { const { rows } = await query(sql, p); return rows }

const SERIES = [
  { key: 'customers', table: 'customers', col: 'customer_number', counter: 'CUST-2026', soft: true,
    date: 'created_at', live: `deleted_at IS NULL AND customer_number ~ '^CUST-2026-[0-9]{4}$'`,
    make: (row, n) => `CUST-2026-${pad4(n)}` },

  { key: 'quotations', table: 'quotations', col: 'quote_number', counter: 'Q-2026', soft: true,
    date: 'COALESCE(entry_date, created_at::date)', live: `deleted_at IS NULL AND quote_number ~ '^Q-2026-[0-9]{4}$'`,
    make: (row, n) => `Q-2026-${pad4(n)}` },

  { key: 'orders', table: 'orders', col: 'order_number', counter: 'ORD-2026', soft: true,
    date: 'order_date', live: `deleted_at IS NULL AND order_number ~ '^ORD-2026-[0-9]{4}$'`,
    make: (row, n) => `ORD-2026-${pad4(n)}` },

  { key: 'purchase_orders', table: 'purchase_orders', col: 'po_number', counter: 'PO-2026', soft: true,
    date: 'COALESCE(order_date, created_at::date)', live: `deleted_at IS NULL AND po_number ~ '^PO-2026-[0-9]{4}$'`,
    make: (row, n) => `PO-2026-${pad4(n)}` },

  { key: 'invoices', table: 'invoices', col: 'invoice_number', counter: 'INV', soft: true,
    date: 'COALESCE(issue_date, created_at::date)', live: `deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]{4}$'`,
    // Haroof gaahak ke naam ke hain aur wahi rehte hain; sirf number khisakta hai.
    make: (row, n) => `${row.num.slice(0, 3)}-${pad4(n)}` },

  { key: 'payments', table: 'payments', col: 'payment_number', counter: 'PAY-2026', soft: false,
    date: 'COALESCE(payment_date, created_at::date)', live: `payment_number ~ '^PAY-2026-[0-9]{4}$'`,
    make: (row, n) => `PAY-2026-${pad4(n)}` },

  { key: 'shipments', table: 'shipments', col: 'shipment_number', counter: 'SHP-2026', soft: true,
    date: 'COALESCE(ship_date, created_at::date)', live: `deleted_at IS NULL AND shipment_number ~ '^SHP-2026-[0-9]{4}$'`,
    make: (row, n) => `SHP-2026-${pad4(n)}` },
]

// Aaj bani hui wo rows jinka kaam pehle ka hai — created_at unke apne din par.
const BACKDATE = [
  { table: 'quotations',      date: 'COALESCE(entry_date, created_at::date)', soft: true },
  { table: 'invoices',        date: 'COALESCE(issue_date, created_at::date)', soft: true },
  { table: 'purchase_orders', date: 'COALESCE(order_date, created_at::date)', soft: true },
  { table: 'shipments',       date: 'COALESCE(ship_date, created_at::date)',  soft: true },
  { table: 'payments',        date: 'COALESCE(payment_date, created_at::date)', soft: false },
  { table: 'orders',          date: 'order_date',                             soft: true },
]

async function main() {
  const apply = process.argv.includes('--apply')

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  // 1. Tareekhein
  console.log('TAREEKHEIN JO AAJ PAR ATAK GAYI HAIN:')
  const backdate = []
  for (const b of BACKDATE) {
    const n = await one(
      `SELECT COUNT(*) AS n FROM ${b.table}
        WHERE ${b.soft ? 'deleted_at IS NULL AND ' : ''}created_at::date = $1 AND ${b.date} < $1`, [TODAY])
    backdate.push({ ...b, n: Number(n.n) })
    console.log(`   ${String(n.n).padStart(3)}  ${b.table}`)
  }

  if (apply) {
    await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                   saved_at timestamptz NOT NULL DEFAULT NOW())`)
    for (const b of backdate) {
      if (!b.n) continue
      await query(
        `INSERT INTO ${BACKUP} (what, ref, row_data)
         SELECT 'created_at', $2, jsonb_build_object('id', id, 'was', created_at)
           FROM ${b.table} WHERE ${b.soft ? 'deleted_at IS NULL AND ' : ''}created_at::date=$1 AND ${b.date} < $1`,
        [TODAY, b.table])
      // Din wahi jo dastavez ka hai; ghadi wahi jo thi, taake ek hi din ke
      // record apni asal tarteeb mein rahen.
      await query(
        `UPDATE ${b.table} SET created_at = (${b.date})::timestamptz + (created_at - date_trunc('day', created_at))
          WHERE ${b.soft ? 'deleted_at IS NULL AND ' : ''}created_at::date=$1 AND ${b.date} < $1`, [TODAY])
    }
  }

  // 2. Numbering
  console.log('\nNUMBERING (tareekh ki tarteeb par):')
  const plans = []
  for (const s of SERIES) {
    const rows = await all(
      `SELECT id, ${s.col} AS num, ${s.date} AS d FROM ${s.table} WHERE ${s.live}
        ORDER BY ${s.date}, created_at, ${s.col}`)
    const moves = []
    rows.forEach((row, i) => {
      const to = s.make(row, i + 1)
      if (to !== row.num) moves.push({ id: row.id, from: row.num, to })
    })
    const targets = new Set(moves.map(m => m.to))
    const blockers = s.soft
      ? (await all(`SELECT id, ${s.col} AS num FROM ${s.table}
                     WHERE ${s.col} = ANY($1) AND deleted_at IS NOT NULL`, [[...targets]]))
      : []
    plans.push({ ...s, total: rows.length, moves, blockers })
    console.log(`   ${s.key}: ${rows.length} zinda, ${moves.length} ka number badlega` +
                (blockers.length ? `, ${blockers.length} hataye hue raaste se hatenge` : ''))
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  for (const p of plans) {
    if (!p.moves.length && !p.blockers.length) { console.log(`   ${p.key}: pehle se theek`); continue }
    await query('BEGIN')
    try {
      for (const b of p.blockers)
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`, [b.id, `${b.num}-VOID`])
      for (let i = 0; i < p.moves.length; i++)
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`,
          [p.moves[i].id, `TMP-${p.key.slice(0, 3)}-${i}`])
      for (const m of p.moves)
        await query(`UPDATE ${p.table} SET ${p.col}=$2 WHERE id=$1`, [m.id, m.to])
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ($1,'moves',$2)`,
        [p.key, JSON.stringify(p.moves)])
      await query(`UPDATE counters SET last_value=$2, updated_at=NOW() WHERE scope=$1`, [p.counter, p.total])
      await query('COMMIT')
      console.log(`   ${p.key}: ${p.moves.length} numbers badle, counter ${p.total}`)
    } catch (e) { await query('ROLLBACK'); throw e }
  }

  const check = await all(`
    SELECT 'orders' AS s, order_number AS n, order_date AS d FROM orders WHERE deleted_at IS NULL
     ORDER BY order_date DESC, order_number DESC LIMIT 5`)
  console.log('\nsab se naye 5 orders:')
  for (const r of check) console.log(`   ${r.n}  ${String(r.d).slice(0, 10)}`)
  console.log(`\npurani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
