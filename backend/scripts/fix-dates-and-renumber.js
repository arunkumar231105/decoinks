#!/usr/bin/env node
/**
 * Two coupled fixes across the doc series:
 *
 * 1. DATES
 *    - quotation.sent_at     = its order's order_date
 *    - invoice.issue_date    = its order's order_date
 *    - purchase_order.order_date = its sales order's order_date (already true
 *      in most cases; harmless to reassert)
 *    - order.entry_date, invoice.entry equivalent (updated_at is used for the
 *      Entry Date column) = CURRENT_DATE — "when the row was keyed into the
 *      system" is today, regardless of the business date.
 *
 * 2. SEQUENTIAL NUMBERING
 *    Numbers count with the order date so the newest live row lands at the
 *    highest number and the oldest at 1. Lists sorted date-DESC then show
 *    N, N-1, …, 1 like the owner asked.
 *      customers        CUST-2026-0001 .. NNNN   (by created_at)
 *      orders           ORD-2026-0001  .. NNNN   (by order_date)
 *      quotations       Q-2026-0001    .. NNNN   (same order)
 *      invoices         INV-2026-0001  .. NNNN   (same order)
 *      purchase_orders  PO-2026-0001   .. NNNN   (same order)
 *
 * Renaming order_number is safe because every FK is on the UUID id, not the
 * text number. Soft-deleted rows are parked under a DEL- prefix before
 * renumbering so the unique index cannot collide.
 *
 * Usage:
 *   node backend/scripts/fix-dates-and-renumber.js            (dry-run)
 *   node backend/scripts/fix-dates-and-renumber.js --apply
 *
 * Flags:
 *   --numbers-only     skip parts 1–4 and only renumber. Use when the dates are
 *                      already right and deleted rows have left holes in the
 *                      sequence — re-running the date parts would restamp every
 *                      entry date for no reason.
 *   --skip-customers   leave customer_number alone. Customer numbers are quoted
 *                      to people outside the shop, so they are only renumbered
 *                      when that is explicitly wanted.
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const NUMBERS_ONLY = process.argv.includes('--numbers-only')
const SKIP_CUSTOMERS = process.argv.includes('--skip-customers')
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// What each row's number will become, so a dry run can be checked before it is
// committed. Same ordering the renumber pass uses.
async function preview(client, table, col, orderBySql, prefix) {
  const { rows } = await client.query(
    `SELECT ${col} AS current, EXTRACT(YEAR FROM COALESCE(${orderBySql}))::int AS yr
       FROM ${table} WHERE deleted_at IS NULL ORDER BY ${orderBySql}, created_at`)
  const counter = {}
  const changes = []
  for (const r of rows) {
    counter[r.yr] = (counter[r.yr] || 0) + 1
    const next = `${prefix}-${r.yr}-${String(counter[r.yr]).padStart(4, '0')}`
    if (next !== r.current) changes.push(`${r.current} → ${next}`)
  }
  console.log(`  ${table}: ${rows.length} rows, ${changes.length} would change`)
  changes.forEach(c => console.log(`      ${c}`))
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    if (APPLY) await client.query('BEGIN')

    if (NUMBERS_ONLY) console.log('  --numbers-only: leaving all dates exactly as they are')

    // ─── 1. Quotation sent_at follows the order it belongs to ─────────
    if (!NUMBERS_ONLY) {
    const q1 = await client.query(`
      UPDATE quotations q SET sent_at = o.order_date::timestamptz, updated_at = NOW()
        FROM invoices i JOIN orders o ON o.id = i.order_id
       WHERE i.quote_id = q.id
         AND q.deleted_at IS NULL
         AND o.deleted_at IS NULL
         AND (q.sent_at IS NULL OR q.sent_at::date <> o.order_date::date)
      RETURNING q.id`).catch(err => (APPLY ? Promise.reject(err) : { rowCount: 0 }))
    console.log(`  quotation.sent_at aligned with order_date: ${q1.rowCount} rows`)

    // ─── 2. Invoice issue_date follows its order ──────────────────────
    const q2 = await client.query(`
      UPDATE invoices i SET issue_date = o.order_date, updated_at = NOW()
        FROM orders o
       WHERE i.order_id = o.id
         AND i.deleted_at IS NULL
         AND o.deleted_at IS NULL
         AND (i.issue_date IS NULL OR i.issue_date <> o.order_date)
      RETURNING i.id`).catch(err => (APPLY ? Promise.reject(err) : { rowCount: 0 }))
    console.log(`  invoice.issue_date aligned with order_date: ${q2.rowCount} rows`)

    // ─── 3. Purchase order date follows sales order ───────────────────
    const q3 = await client.query(`
      UPDATE purchase_orders po SET order_date = o.order_date,
             expected_date = COALESCE(expected_date, o.order_date + INTERVAL '7 days'),
             updated_at = NOW()
        FROM orders o
       WHERE po.order_id = o.id
         AND po.deleted_at IS NULL
         AND o.deleted_at IS NULL
         AND (po.order_date IS NULL OR po.order_date <> o.order_date)
      RETURNING po.id`).catch(err => (APPLY ? Promise.reject(err) : { rowCount: 0 }))
    console.log(`  purchase_order.order_date aligned: ${q3.rowCount} rows`)

    // ─── 4. Entry date = today across all four ────────────────────────
    // orders.entry_date is a real column; the other tables use updated_at
    // to drive the "Entry Date" column in the UI.
    const q4 = await client.query(`
      UPDATE orders SET entry_date = CURRENT_DATE, updated_at = NOW()
       WHERE deleted_at IS NULL`).catch(err => (APPLY ? Promise.reject(err) : { rowCount: 0 }))
    console.log(`  order.entry_date set to today: ${q4.rowCount} rows`)
    }

    // ─── 5. Renumber everything sequentially ──────────────────────────
    const renumber = async (table, col, orderBySql, prefix, colWidth) => {
      // Park soft-deleted rows at a guaranteed-unique short name derived
      // from the last chars of the row id so nothing can collide even if
      // the original numbers were long. Kept short — customer_number is
      // VARCHAR(20) and the whole prefixed value has to fit.
      await client.query(`
        UPDATE ${table}
           SET ${col} = 'D-' || RIGHT(id::text, 12)
         WHERE deleted_at IS NOT NULL AND ${col} NOT LIKE 'D-%'`)
      const rows = (await client.query(`
        SELECT id, EXTRACT(YEAR FROM COALESCE(${orderBySql}))::int AS yr
          FROM ${table} WHERE deleted_at IS NULL
          ORDER BY ${orderBySql}, created_at`)).rows
      // Two-pass: park at short TMP-N first so target names cannot collide
      // with rows still holding them.
      for (let i = 0; i < rows.length; i++) {
        await client.query(`UPDATE ${table} SET ${col} = $2 WHERE id = $1`,
          [rows[i].id, `T-${i}`])
      }
      const counter = {}
      for (const r of rows) {
        counter[r.yr] = (counter[r.yr] || 0) + 1
        const num = `${prefix}-${r.yr}-${String(counter[r.yr]).padStart(4,'0')}`
        await client.query(`UPDATE ${table} SET ${col} = $1 WHERE id = $2`, [num, r.id])
      }
      console.log(`  renumbered ${rows.length} ${table} as ${prefix}-YYYY-NNNN`)
    }

    // Column widths per schema — the parking/temp names must fit.
    const series = [
      ['customers',       'customer_number', 'created_at, created_at', 'CUST', 20],
      ['orders',          'order_number',    'order_date, created_at', 'ORD',  30],
      ['quotations',      'quote_number',    'sent_at, created_at',    'Q',    30],
      ['invoices',        'invoice_number',  'issue_date, created_at', 'INV',  30],
      ['purchase_orders', 'po_number',       'order_date, created_at', 'PO',   30],
    ].filter(([table]) => !(SKIP_CUSTOMERS && table === 'customers'))

    if (APPLY) {
      for (const args of series) await renumber(...args)
    } else {
      for (const [table, col, orderBySql, prefix] of series) {
        await preview(client, table, col, orderBySql, prefix)
      }
    }

    if (APPLY) await client.query('COMMIT')

    // ─── Sample the top of each list to prove it worked ───────────────
    if (APPLY) {
      const check = (await client.query(`
        SELECT o.order_number, o.order_date::date, o.entry_date::date,
               i.invoice_number, i.issue_date::date AS inv_date,
               q.quote_number, q.sent_at::date AS quote_date,
               p.po_number, p.order_date::date AS po_date
          FROM orders o
          LEFT JOIN invoices i ON i.order_id = o.id
          LEFT JOIN quotations q ON q.id = i.quote_id
          LEFT JOIN purchase_orders p ON p.order_id = o.id
         WHERE o.deleted_at IS NULL
         ORDER BY o.order_date DESC, o.created_at DESC LIMIT 5`)).rows
      console.log('\nNewest 5 (should count down from the highest number):')
      for (const r of check) {
        console.log(`  ${r.order_number}  ${r.order_date}  ent=${r.entry_date}  |  ${r.invoice_number} ${r.inv_date}  |  ${r.quote_number} ${r.quote_date}  |  ${r.po_number}`)
      }
    } else {
      console.log('\nDRY RUN — re-run with --apply to commit.')
    }
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* not in tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
