#!/usr/bin/env node
/**
 * Two field-level gaps the owner asked to close on sales orders.
 *
 * 1. DUE DATE BEFORE THE ORDER DATE
 *    Three orders carry a due date earlier than the day the order was placed,
 *    which cannot happen. The owner's instruction: put the order date in.
 *
 * 2. MISSING SHIPPING ADDRESS
 *    Seven orders have no ship-to address, or the placeholder "United States".
 *    The address is rebuilt from what the business already knows about that
 *    customer — never invented:
 *      street  = the address on the parcel that actually shipped for this order
 *                (it is the cleanest form, e.g. "17003 Jeanette Ave"); if that
 *                is not a street, the customer's address_line1 is used with the
 *                trailing city/state/zip trimmed off.
 *      city / state / zip = the customer record's structured fields.
 *    An order whose customer has no address at all is reported, not guessed.
 *
 * Neither section touches money, status, or any other column.
 *
 * Usage:
 *   node backend/scripts/fix-order-field-gaps.js            (dry-run)
 *   node backend/scripts/fix-order-field-gaps.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

// Trim a trailing ", City ST 12345" (in any spacing) off a free-text line.
function streetOnly(line1, city, state, zip) {
  let s = clean(line1)
  if (!s) return ''
  for (const part of [city, state, zip].filter(Boolean)) {
    const i = s.toLowerCase().indexOf(clean(part).toLowerCase())
    if (i > 0) s = s.slice(0, i)
  }
  return s.replace(/[\s,]+$/, '')
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // ─── 1. Due date earlier than the order date ──────────────────────
    const { rows: dueRows } = await client.query(
      `SELECT order_number, order_date, due_date FROM orders
        WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date < order_date
        ORDER BY order_number`)
    console.log(`Due date before the order date: ${dueRows.length}`)
    for (const r of dueRows) {
      console.log(`  ${r.order_number}  ${String(r.due_date).slice(0, 15)} → ${String(r.order_date).slice(0, 15)} (order date)`)
    }

    // ─── 2. Missing / placeholder shipping address ────────────────────
    const { rows: addrRows } = await client.query(
      `SELECT o.id, o.order_number, o.shipping_address, o.contact_name,
              c.name AS customer, c.address_line1, c.city, c.state, c.zip,
              (SELECT s.address FROM shipments s
                WHERE s.deleted_at IS NULL
                  AND (s.order_id = o.id
                       OR EXISTS (SELECT 1 FROM shipment_orders so
                                   WHERE so.shipment_id = s.id AND so.order_id = o.id))
                ORDER BY s.created_at LIMIT 1) AS shipment_address
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.deleted_at IS NULL
          AND (NULLIF(TRIM(o.shipping_address), '') IS NULL
               OR TRIM(o.shipping_address) IN ('United States', 'USA', 'US'))
        ORDER BY o.order_number`)

    const fixable = [], reportOnly = []
    for (const r of addrRows) {
      const parcel = clean(r.shipment_address)
      const street = /^\d/.test(parcel) ? parcel : streetOnly(r.address_line1, r.city, r.state, r.zip)
      const tail = [clean(r.city), [clean(r.state), clean(r.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      const built = [street, tail].filter(Boolean).join(', ')
      if (street && tail) fixable.push({ ...r, built })
      else reportOnly.push(r)
    }

    console.log(`\nMissing shipping address: ${addrRows.length} — rebuildable: ${fixable.length}, no source: ${reportOnly.length}`)
    for (const r of fixable) {
      console.log(`  ${r.order_number}  ${String(r.customer || r.contact_name).padEnd(18)} → ${r.built}`)
    }
    for (const r of reportOnly) {
      console.log(`  ${r.order_number}  ${String(r.customer || r.contact_name).padEnd(18)} → NO ADDRESS ON THE CUSTOMER RECORD — needs the owner`)
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    const due = await client.query(
      `UPDATE orders SET due_date = order_date, updated_at = NOW()
        WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date < order_date`)
    for (const r of fixable) {
      await client.query(
        `UPDATE orders SET shipping_address = $1, updated_at = NOW() WHERE id = $2`,
        [r.built, r.id])
    }
    await client.query('COMMIT')
    console.log(`\nDue dates corrected: ${due.rowCount}. Shipping addresses filled: ${fixable.length}.`)
    if (reportOnly.length) {
      console.log(`Still blank (no customer address): ${reportOnly.map(r => r.order_number).join(', ')}`)
    }
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
