#!/usr/bin/env node
/**
 * Seed the payments table from the owner-provided cash-in sheet
 * (scratchpad/payments/raw.tsv).
 *
 * Match rules:
 *   * order_id: TSI 260730-65 in the sheet == ORD-260730-65 in the DB.
 *     Anything the sheet marks "No PO match found" is inserted with no order.
 *   * customer_id: whichever customer owns that order (falls back to a
 *     shipping_name match if the row has no PO). Customers can safely stay
 *     null if we cannot find one — the payment still records what came in.
 *
 * Idempotent: rows with a transaction id are matched on that; rows without
 * one (many Zelle transfers) are matched on
 * (payment_date, amount, payment_method, customer_name) so re-running does
 * not create duplicates.
 *
 * Never touches shipments, orders, invoices, or anything outside `payments`.
 *
 * Usage:
 *   node backend/scripts/seed-payments.js            (dry-run)
 *   node backend/scripts/seed-payments.js --apply
 */
const fs = require('fs')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const TSV = process.env.PAYMENTS_TSV
  || '/tmp/claude-0/-root-decoinks/cab844a3-03d2-49e4-9cd9-f1cd55bceef6/scratchpad/payments/raw.tsv'
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }

/** "31-Jul-2026 20:23" -> { date: "2026-07-31", paid_at: "2026-07-31 20:23:00+00" } */
function parseDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s.trim())
  if (!m) throw new Error(`Bad date: ${s}`)
  const [, d, mon, y, hh, mm] = m
  const month = MONTHS[mon]
  if (!month) throw new Error(`Bad month: ${mon}`)
  const iso = `${y}-${String(month).padStart(2,'0')}-${d.padStart(2,'0')}`
  const paid = hh ? `${iso} ${hh.padStart(2,'0')}:${mm}:00+00` : `${iso} 12:00:00+00`
  return { date: iso, paid_at: paid }
}

function loadRows() {
  const [header, ...lines] = fs.readFileSync(TSV, 'utf8').trim().split('\n')
  const cols = header.split('\t').map(c => c.trim())
  return lines.filter(l => l.trim()).map(l => {
    const cells = l.split('\t')
    const row = {}
    cols.forEach((c, i) => { row[c] = (cells[i] ?? '').trim() })
    return row
  })
}

async function main() {
  const rows = loadRows()
  console.log(`Loaded ${rows.length} rows from ${TSV}`)

  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // Pre-load orders indexed by order_number + shipping_name for fast lookup.
    const orders = (await client.query(
      `SELECT id, order_number, customer_id, shipping_name FROM orders WHERE deleted_at IS NULL`
    )).rows
    const orderByNumber = new Map(orders.map(o => [o.order_number, o]))

    // Customers keyed by lowercased name for the no-PO-match fallback.
    const customers = (await client.query(
      `SELECT id, name FROM customers WHERE deleted_at IS NULL`
    )).rows
    const customerByName = new Map(customers.map(c => [c.name.toLowerCase().trim(), c]))

    let planned = 0, alreadyThere = 0, noOrder = 0, noCustomer = 0
    const inserts = []
    const totals = { gross: 0, fee: 0, net: 0 }

    for (const r of rows) {
      const { date, paid_at } = parseDate(r['Payment Date'])
      const gross = Number(r['Payment Amount'])
      const fee = Number(r['Fee Deduction']) || 0
      const method = r['Payment Method']
      const txn = r['Transaction ID'] || null
      const clientName = r['Client Name']
      const senderName = r['Sender Name'] || clientName
      const flag = r['Flag'] || null

      // Sheet-to-DB order number translation. Blanks stay blank.
      let orderNumber = null, orderRow = null
      if (r['PO Number']) {
        orderNumber = r['PO Number'].replace(/^TSI\s+/, 'ORD-')
        orderRow = orderByNumber.get(orderNumber) || null
        if (!orderRow) noOrder++
      }

      // Customer preference: whoever owns the matched order, else name match.
      let customerId = orderRow?.customer_id || null
      if (!customerId) {
        const c = customerByName.get(clientName.toLowerCase().trim())
        if (c) customerId = c.id; else noCustomer++
      }

      // Idempotency probe: transaction id first, then a natural key on the
      // row's identifying fields. Zelle without a txn id is common.
      const existing = txn
        ? (await client.query('SELECT id FROM payments WHERE transaction_id = $1', [txn])).rows[0]
        : (await client.query(
            `SELECT id FROM payments
               WHERE payment_date = $1 AND amount = $2 AND payment_method = $3
                 AND COALESCE(customer_name,'') = $4`,
            [date, gross, method, clientName])).rows[0]
      if (existing) { alreadyThere++; continue }

      planned++
      totals.gross += gross; totals.fee += fee; totals.net += (gross - fee)
      inserts.push({
        transaction_id: txn, payment_date: date, paid_at, amount: gross, fee_amount: fee,
        payment_method: method, customer_id: customerId, order_id: orderRow?.id || null,
        customer_name: clientName, received_from_name: senderName,
        notes: flag || null, order_number: orderNumber,
      })
    }

    console.log(`\nRows to insert: ${planned}`)
    console.log(`Already present (skipped): ${alreadyThere}`)
    console.log(`Rows with PO but no matching order: ${noOrder}`)
    console.log(`Rows with no customer match: ${noCustomer}`)
    console.log(`Totals — gross $${totals.gross.toFixed(2)}, fees $${totals.fee.toFixed(2)}, net $${totals.net.toFixed(2)}`)

    if (!APPLY) {
      console.log('\nFirst 5 planned:')
      inserts.slice(0, 5).forEach(i =>
        console.log(`  ${i.payment_date}  ${i.customer_name.padEnd(24)}  $${i.amount.toFixed(2).padStart(8)}  ${i.payment_method.padEnd(6)}  ${i.order_number || '(no order)'}  txn=${i.transaction_id || '—'}`))
      console.log('\nDRY RUN — re-run with --apply to insert.')
      return
    }

    await client.query('BEGIN')
    // Grab a batch of payment numbers up front so the trigger/counter is hit
    // once per row and we stay serialisable within the transaction.
    for (const p of inserts) {
      const numberRes = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(payment_number, '^PAY-\\d{4}-', ''), '')::int), 0) + 1 AS n
           FROM payments WHERE payment_number ~ ('^PAY-' || to_char($1::date, 'YYYY') || '-')`,
        [p.payment_date])
      const paymentNumber = `PAY-${p.payment_date.slice(0,4)}-${String(numberRes.rows[0].n).padStart(4,'0')}`
      await client.query(
        `INSERT INTO payments
           (payment_number, payment_date, paid_at, amount, fee_amount, transaction_id,
            payment_method, status, customer_id, order_id, customer_name,
            received_from_name, notes)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, 'Completed', $8, $9, $10, $11, $12)`,
        [paymentNumber, p.payment_date, p.paid_at, p.amount, p.fee_amount, p.transaction_id,
         p.payment_method, p.customer_id, p.order_id, p.customer_name, p.received_from_name, p.notes])
    }
    await client.query('COMMIT')
    console.log(`\nInserted ${inserts.length} payments.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* not in tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
