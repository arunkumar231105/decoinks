#!/usr/bin/env node
/**
 * Close the four broken links the schema audit found.
 *
 * Each part fixes only what the data determines, counts what it could not, and
 * proves the result before committing. Nothing here guesses which document a
 * payment belongs to or which job a parcel was for.
 *
 *  1  LEADS POINTING AT A CUSTOMER THAT IS GONE. Eighteen rows, every one of
 *     them wrong: the identifiers match no customer, supplier or party, live or
 *     deleted. Nothing is recoverable, so the column is cleared. Migration 118
 *     then puts a foreign key on it so the database refuses the next one.
 *
 *  2  PARCELS BELONGING TO NO JOB. Two of the eight carry a tracking number
 *     that an order also carries — the same string, so there is no judgement
 *     involved. The other six are matched only by a recipient name, and Robert
 *     Farrar alone has twelve orders; a name is not evidence enough to attach a
 *     delivered parcel to one of them. They are listed instead.
 *
 *  3  ORDERS WITH NO INVOICE. Nineteen of the twenty-eight have money on them
 *     and get an invoice raised from the order's own figures, dated to the
 *     order rather than to today, with its lines copied across. The other nine
 *     total $0.00 — they are the unpriced jobs still waiting for prices, and an
 *     invoice for nothing helps nobody.
 *
 *  4  PAYMENTS ATTACHED TO NOTHING. Thirteen of the forty-three match exactly
 *     one unpaid invoice on amount — the total or the subtotal, since a payment
 *     that excludes shipping has been the pattern all along — within thirty
 *     days. Eight match more than one and eight-and-twenty match none; both are
 *     reported. $4,509.30 is at stake and none of it is moved on a maybe.
 *
 * Usage:
 *   node backend/scripts/close-broken-links.js            (dry-run)
 *   node backend/scripts/close-broken-links.js --apply
 *   ... --only=leads,parcels,invoices,payments
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const money = n => `$${Number(n || 0).toFixed(2)}`
const cents = n => Math.round(Number(n || 0) * 100)
const wants = part => !ONLY || ONLY.split(',').map(s => s.trim()).includes(part)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const one = async (sql, p) => (await client.query(sql, p)).rows[0]
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)
    // Six invoices already show more received than they are worth — the
    // misattributed payments, none of this script's doing. The check at the end
    // asks whether that number grew, not whether it is zero.
    const { rows: [was] } = await client.query(`
      SELECT count(*) FILTER (WHERE ROUND(COALESCE(amount_paid,0) + COALESCE(balance_due,0) - total, 2) <> 0)::int AS ledgers_off
        FROM invoices WHERE deleted_at IS NULL`)
    if (APPLY) await client.query('BEGIN')
    const done = {}
    const leftovers = []

    // ── 1. Leads pointing at a customer that is gone ────────────────────
    if (wants('leads')) {
      const before = await one(`
        SELECT count(*)::int AS set_rows,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = l.source_customer_id))::int AS dangling
          FROM leads l WHERE l.source_customer_id IS NOT NULL`)
      console.log(`1  Leads pointing at a customer that is gone`)
      console.log(`     ${before.dangling} of ${before.set_rows} references are wrong` +
        `${before.dangling === before.set_rows ? ' — every one of them' : ''}`)
      if (APPLY) {
        done.leads = (await client.query(`
          UPDATE leads SET source_customer_id = NULL, updated_at = NOW()
           WHERE source_customer_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = leads.source_customer_id)`)).rowCount
      }
    }

    // ── 2. Parcels belonging to no job ──────────────────────────────────
    if (wants('parcels')) {
      // Exactly one order, or none. Two of Robert Farrar's orders carry the
      // same tracking number because they went out in one parcel — which makes
      // that number evidence for neither of them on its own.
      const { rows: sure } = await client.query(`
        SELECT s.id, s.shipment_number, s.tracking_number, o.id AS order_id, o.order_number
          FROM shipments s
          JOIN orders o ON o.deleted_at IS NULL AND o.tracking_number = s.tracking_number
         WHERE s.deleted_at IS NULL AND s.order_id IS NULL AND s.po_id IS NULL
           AND NULLIF(btrim(s.tracking_number), '') IS NOT NULL
           AND (SELECT count(*) FROM orders o2
                 WHERE o2.deleted_at IS NULL AND o2.tracking_number = s.tracking_number) = 1`)
      const { rows: unsure } = await client.query(`
        SELECT s.shipment_number, COALESCE(s.recipient_name, s.customer_name, '—') AS recipient,
               to_char(s.created_at, 'DD Mon YYYY') AS on_date,
               (SELECT count(*) FROM orders o2 WHERE o2.deleted_at IS NULL
                 AND o2.tracking_number = s.tracking_number)::int AS orders_sharing_that_number
          FROM shipments s
         WHERE s.deleted_at IS NULL AND s.order_id IS NULL AND s.po_id IS NULL
           AND (SELECT count(*) FROM orders o2 WHERE o2.deleted_at IS NULL
                 AND o2.tracking_number = s.tracking_number) <> 1
         ORDER BY s.shipment_number`)
      console.log(`\n2  Parcels belonging to no job`)
      sure.forEach(s => console.log(`     ${s.shipment_number} → ${s.order_number}   same tracking number, ${s.tracking_number}`))
      console.log(`     ${sure.length} attached by their tracking number, ${unsure.length} left for you:`)
      unsure.forEach(s => console.log(`        ${s.shipment_number.padEnd(14)} ${(s.recipient || '—').padEnd(16)} ${s.on_date}` +
        (s.orders_sharing_that_number > 1 ? `   its tracking number is on ${s.orders_sharing_that_number} orders` : '')))
      if (unsure.length) leftovers.push(`${unsure.length} parcel(s) whose job is not determinable from the data`)
      if (APPLY && sure.length) {
        for (const s of sure) {
          await client.query(`UPDATE shipments SET order_id = $2, updated_at = NOW() WHERE id = $1`, [s.id, s.order_id])
        }
        done.parcels = sure.length
      }
    }

    // ── 3. Orders with no invoice ───────────────────────────────────────
    if (wants('invoices')) {
      const { rows: need } = await client.query(`
        SELECT o.id, o.order_number, o.order_date, o.due_date, o.customer_id, o.supplier_id,
               o.subtotal, o.discount_amt, o.tax_amt, o.shipping_charges, o.rush_services, o.total,
               o.amount_paid, o.payment_status::text AS payment_status, o.payment_terms, o.payment_method,
               o.currency, o.contact_name, o.contact_email, o.contact_phone,
               o.shipping_address, o.order_type::text AS order_type,
               c.name AS customer
          FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.deleted_at IS NULL AND o.invoice_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.deleted_at IS NULL)
         ORDER BY o.order_date, o.created_at, o.id`)
      const worth = need.filter(o => cents(o.total) > 0)
      const nothing = need.filter(o => cents(o.total) === 0)
      console.log(`\n3  Orders with no invoice`)
      console.log(`     ${worth.length} carry money and get one raised — ${money(worth.reduce((s, o) => s + Number(o.total), 0))}`)
      console.log(`     ${nothing.length} total $0.00 and are left: the unpriced jobs still waiting for prices`)
      if (nothing.length) leftovers.push(`${nothing.length} order(s) with no invoice because they have no price yet`)

      if (APPLY && worth.length) {
        const { buildInvoicePrefix } = require('../src/utils/counter')
        const { rows: [seed] } = await client.query(
          `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number,'-',2) AS int)), 0)::int AS n
             FROM invoices WHERE invoice_number ~ '^[A-Z]{3}-[0-9]+$'`)
        let n = seed.n
        for (const o of worth) {
          const number = `${buildInvoicePrefix(o.customer || o.contact_name || 'Customer')}-${String(++n).padStart(4, '0')}`
          const { rows: [inv] } = await client.query(`
            INSERT INTO invoices
              (invoice_number, order_id, customer_id, supplier_id, status, issue_date, due_date,
               subtotal, discount_amt, tax_amt, shipping_charges, rush_services, total,
               amount_paid, balance_due, paid_at, currency, order_type,
               customer_name, billing_email, contact_number, billing_address, shipping_address,
               payment_terms, payment_method, notes, source_system)
            VALUES ($1,$2,$3,$4,$5::invoice_status,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::order_type,
                    $19,$20,$21,$22,$23,$24,$25,$26,'decoinks_missing_invoice_backfill')
            RETURNING id`,
            [number, o.id, o.customer_id, o.supplier_id,
             o.payment_status === 'Paid' ? 'Paid' : 'Draft',
             o.order_date, o.due_date || o.order_date,
             o.subtotal, o.discount_amt || 0, o.tax_amt || 0, o.shipping_charges || 0, o.rush_services || 0,
             o.total, o.amount_paid || 0, +(Number(o.total) - Number(o.amount_paid || 0)).toFixed(2),
             o.payment_status === 'Paid' ? o.order_date : null,
             o.currency || 'USD', o.order_type,
             o.customer || o.contact_name, o.contact_email, o.contact_phone, o.shipping_address, o.shipping_address,
             o.payment_terms, o.payment_method,
             `Raised to match ${o.order_number}, which had no invoice. Figures mirror the sales order.`])

          await client.query(`UPDATE orders SET invoice_id = $2, updated_at = NOW() WHERE id = $1`, [o.id, inv.id])

          // The lines, from whichever table holds them for this kind of order.
          const src = o.order_type === 'apparel' ? 'order_items_apparel'
            : o.order_type === 'dtf' ? 'order_items_dtf' : 'order_items_gangsheet'
          const desc = o.order_type === 'apparel' ? 'item' : o.order_type === 'dtf' ? 'artwork_name' : 'size'
          const price = o.order_type === 'gangsheet' ? 'price_per_sheet' : 'unit_price'
          await client.query(`
            INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sizes, sort_order)
            SELECT $1, COALESCE(x.${desc}, 'Item'), x.qty, x.${price}, x.amount,
                   ${o.order_type === 'apparel' ? 'x.size' : o.order_type === 'dtf' ? 'x.size' : 'x.size'},
                   COALESCE(x.sort_order, 0)
              FROM ${src} x WHERE x.order_id = $2`, [inv.id, o.id])
        }
        done.invoices = worth.length
      }
    }

    // ── 4. Payments attached to nothing ─────────────────────────────────
    if (wants('payments')) {
      // Only invoices with nothing recorded against them. A trigger recalculates
      // amount_paid as the sum of the payments attached, so hanging one on an
      // invoice already settled without a receipt would replace its full figure
      // with this single amount and reopen a balance that was closed.
      const { rows: cand } = await client.query(`
        SELECT p.id, p.payment_number, p.amount, p.payment_date,
               (SELECT count(*) FROM invoices i WHERE i.deleted_at IS NULL
                  AND (ROUND(i.total,2) = ROUND(p.amount,2) OR ROUND(i.subtotal,2) = ROUND(p.amount,2))
                  AND ABS(i.issue_date - p.payment_date) <= 30
                  AND NOT EXISTS (SELECT 1 FROM payments q WHERE q.invoice_id = i.id)
                  AND ROUND(COALESCE(i.amount_paid, 0), 2) = 0)::int AS matches,
               (SELECT i.id FROM invoices i WHERE i.deleted_at IS NULL
                  AND (ROUND(i.total,2) = ROUND(p.amount,2) OR ROUND(i.subtotal,2) = ROUND(p.amount,2))
                  AND ABS(i.issue_date - p.payment_date) <= 30
                  AND NOT EXISTS (SELECT 1 FROM payments q WHERE q.invoice_id = i.id)
                  AND ROUND(COALESCE(i.amount_paid, 0), 2) = 0 LIMIT 1) AS invoice_id,
               (SELECT i.invoice_number FROM invoices i WHERE i.deleted_at IS NULL
                  AND (ROUND(i.total,2) = ROUND(p.amount,2) OR ROUND(i.subtotal,2) = ROUND(p.amount,2))
                  AND ABS(i.issue_date - p.payment_date) <= 30
                  AND NOT EXISTS (SELECT 1 FROM payments q WHERE q.invoice_id = i.id)
                  AND ROUND(COALESCE(i.amount_paid, 0), 2) = 0 LIMIT 1) AS invoice_number
          FROM payments p WHERE p.invoice_id IS NULL AND p.order_id IS NULL
         ORDER BY p.payment_date`)
      // One invoice per payment is not enough: two payments of $66.00 both
      // matched the same $66.00 invoice, and only one of them paid it. A match
      // counts only when neither side has a rival.
      const claimed = new Map()
      cand.filter(c => c.matches === 1).forEach(c => claimed.set(c.invoice_id, (claimed.get(c.invoice_id) || 0) + 1))
      const sure = cand.filter(c => c.matches === 1 && claimed.get(c.invoice_id) === 1)
      const contested = cand.filter(c => c.matches === 1 && claimed.get(c.invoice_id) > 1)
      const many = cand.filter(c => c.matches > 1)
      const none = cand.filter(c => c.matches === 0)
      console.log(`\n4  Payments attached to nothing`)
      console.log(`     ${sure.length} match exactly one unpaid invoice — ${money(sure.reduce((s, c) => s + Number(c.amount), 0))}`)
      sure.slice(0, 6).forEach(c => console.log(`        ${c.payment_number}  ${money(c.amount)}  → ${c.invoice_number}`))
      if (sure.length > 6) console.log(`        … and ${sure.length - 6} more`)
      const stuck = [...many, ...none, ...contested]
      console.log(`     ${many.length} match more than one invoice, ${contested.length} share an invoice with another payment, ` +
        `${none.length} match none — ${money(stuck.reduce((s, c) => s + Number(c.amount), 0))} left for you`)
      if (stuck.length) leftovers.push(`${stuck.length} payment(s) that cannot be matched from the data`)

      if (APPLY && sure.length) {
        for (const c of sure) {
          await client.query(`UPDATE payments SET invoice_id = $2 WHERE id = $1`, [c.id, c.invoice_id])
        }
        done.payments = sure.length
      }
    }

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }

    // ── Proof ───────────────────────────────────────────────────────────
    const after = await one(`
      SELECT (SELECT count(*) FROM leads l WHERE l.source_customer_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = l.source_customer_id))::int AS bad_leads,
             (SELECT count(*) FROM orders o WHERE o.deleted_at IS NULL AND o.invoice_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.deleted_at IS NULL)
                AND ROUND(o.total,2) > 0)::int AS orders_still_without_an_invoice,
             (SELECT count(*) FROM invoices i WHERE i.deleted_at IS NULL
                AND ROUND(COALESCE(i.amount_paid,0) + COALESCE(i.balance_due,0) - i.total, 2) <> 0)::int AS invoice_ledgers_off,
             (SELECT count(*) FROM invoices WHERE deleted_at IS NULL)::int AS invoices,
             (SELECT count(DISTINCT invoice_number) FROM invoices WHERE deleted_at IS NULL)::int AS distinct_numbers,
             (SELECT count(*) FROM payments p WHERE p.invoice_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id))::int AS payments_pointing_at_nothing,
             (SELECT count(*) FROM shipments s WHERE s.order_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id))::int AS parcels_pointing_at_nothing`)

    const problems = []
    // Each check belongs to the part that was asked to run; a --only run must
    // not fail on work it was told to skip.
    if (wants('leads') && after.bad_leads) problems.push(`${after.bad_leads} lead(s) still point at a customer that is gone`)
    if (wants('invoices') && after.orders_still_without_an_invoice) problems.push(`${after.orders_still_without_an_invoice} priced order(s) still have no invoice`)
    if (after.payments_pointing_at_nothing) problems.push(`${after.payments_pointing_at_nothing} payment(s) now point at nothing`)
    if (after.parcels_pointing_at_nothing) problems.push(`${after.parcels_pointing_at_nothing} parcel(s) now point at nothing`)
    if (after.distinct_numbers !== after.invoices) problems.push(`invoice numbers are not unique: ${after.distinct_numbers} for ${after.invoices}`)
    if (after.invoice_ledgers_off > was.ledgers_off) {
      problems.push(`invoices where paid + owed does not equal the total ${was.ledgers_off} → ${after.invoice_ledgers_off}`)
    }

    if (process.env.DEBUG_LEDGER) {
      console.log(`\n[debug] ledgers_off before ${was.ledgers_off}, after ${after.invoice_ledgers_off}`)
      const { rows: off } = await client.query(`
        SELECT invoice_number, total, amount_paid, balance_due, source_system
          FROM invoices WHERE deleted_at IS NULL
           AND ROUND(COALESCE(amount_paid,0)+COALESCE(balance_due,0)-total,2) <> 0
         ORDER BY invoice_number`)
      off.forEach(r => console.log(`[debug]   ${r.invoice_number}  total ${r.total} paid ${r.amount_paid} owed ${r.balance_due}  ${r.source_system || ''}`))
    }
    if (problems.length) {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written:')
      problems.forEach(p => console.log(`  ✗ ${p}`))
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log('\nDone.')
    if (done.leads)    console.log(`  ${done.leads} lead reference(s) cleared`)
    if (done.parcels)  console.log(`  ${done.parcels} parcel(s) attached to their order`)
    if (done.invoices) console.log(`  ${done.invoices} invoice(s) raised, ${after.invoices} in the book now`)
    if (done.payments) console.log(`  ${done.payments} payment(s) attached to their invoice`)
    console.log(`\n  leads pointing at nothing: ${after.bad_leads}   ✓`)
    console.log(`  priced orders with no invoice: ${after.orders_still_without_an_invoice}   ✓`)
    console.log(`  invoices whose ledger does not add up: ${after.invoice_ledgers_off}` +
      ` (was ${was.ledgers_off} — the misattributed payments, untouched here)`)
    if (leftovers.length) {
      console.log('\nStill needing you:')
      leftovers.forEach(l => console.log(`  · ${l}`))
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
