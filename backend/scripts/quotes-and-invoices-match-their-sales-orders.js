#!/usr/bin/env node
'use strict'

/**
 * Every quote and invoice says what its sales order says.
 *
 * The Quotations list read $663 more than the sales orders, for three reasons:
 *
 *   Jody Roy $780 and Brooke Wylie $750 — each job was ordered on the DIGI store
 *   as three orders. The orders were folded into one, but two of the three
 *   quotes were left standing on their own and the surviving quote still said
 *   one third of the job. The invoice said the right total over one line only,
 *   its other two lines left on the folded invoices. Now the quote and invoice
 *   carry all three lines, priced as the order prices them.
 *
 *   Walby Vellon — the quote kept the $103 the invoice was corrected from: every
 *   line carried $93 as its amount. Its lines now match ORD-2026-0019's, $93.
 *
 *   Ricardo Malia — ORD-2026-0125 went to $90 ($20 shipping) and its quote
 *   stayed at $85. A second $80 draft quote duplicated the job that Q-2026-0145
 *   already quotes, invoices and orders; it is retired.
 *
 * What is left above the sales orders is only the quotes and invoices of jobs
 * with no order yet. Retired rows are soft-deleted with their numbers parked.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v).toFixed(2))
const park = col => `'D-' || ${col} || '-' || left(replace(id::text, '-', ''), 4)`

const DIGI = [
  { who: 'Jody Roy', order: 'ORD-2026-0126', quote: 'Q-2026-0133', fold: ['Q-2026-0125', 'Q-2026-0127'] },
  { who: 'Brooke Wylie', order: 'ORD-2026-0127', quote: 'Q-2026-0132', fold: ['Q-2026-0129', 'Q-2026-0130'] },
]

async function one(client, sql, params, what) {
  const { rows } = await client.query(sql, params)
  if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`)
  return rows[0]
}

async function append(client, table, fk, from, to) {
  const { rowCount } = await client.query(
    `UPDATE ${table}
        SET ${fk} = $2,
            sort_order = sort_order + (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${table} WHERE ${fk} = $2)
      WHERE ${fk} = $1`, [from, to])
  return rowCount
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // ── Jody Roy and Brooke Wylie ─────────────────────────────────────────
    for (const j of DIGI) {
      const o = await one(client, `SELECT * FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [j.order], j.order)
      const q = await one(client, `SELECT * FROM quotations WHERE quote_number = $1 AND deleted_at IS NULL`, [j.quote], j.quote)
      const inv = await one(client, `SELECT * FROM invoices WHERE id = $1 AND deleted_at IS NULL`, [o.invoice_id], `${j.order} invoice`)
      if (o.quotation_id !== q.id || inv.quote_id !== q.id) throw new Error(`${j.who}: order, quote and invoice are not one chain`)
      console.log(`${j.who}  ${o.order_number} $${o.total}  ${inv.invoice_number} $${inv.total}  ${q.quote_number} $${q.total}`)

      for (const n of j.fold) {
        const fq = await one(client, `SELECT * FROM quotations WHERE quote_number = $1 AND deleted_at IS NULL`, [n], n)
        if (fq.customer_id !== o.customer_id) throw new Error(`${n} is another customer's`)
        const { rows: live } = await client.query(
          `SELECT 1 FROM orders WHERE quotation_id = $1 AND deleted_at IS NULL
           UNION ALL SELECT 1 FROM invoices WHERE quote_id = $1 AND deleted_at IS NULL`, [fq.id])
        if (live.length) throw new Error(`${n} still has a live order or invoice`)
        const qLines = await append(client, 'quotation_items', 'quotation_id', fq.id, q.id)
        // The folded job's invoice was retired with its order; its line comes across.
        const { rows: deadInv } = await client.query(
          `SELECT id, invoice_number FROM invoices WHERE quote_id = $1 AND deleted_at IS NOT NULL`, [fq.id])
        let iLines = 0
        for (const d of deadInv) iLines += await append(client, 'invoice_items', 'invoice_id', d.id, inv.id)
        await client.query(
          `UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')},
                  notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW() WHERE id = $1`,
          [fq.id, `Folded into ${q.quote_number} — one job the DIGI store took as three orders.`])
        console.log(`   ${n} $${fq.total} folded in: ${qLines} quote line(s), ${iLines} invoice line(s) from ${deadInv.map(d => d.invoice_number).join(', ') || '—'}`)
      }

      // Price every quote and invoice line as the order prices it.
      const { rows: oLines } = await client.query(
        `SELECT item, qty, unit_price, amount FROM order_items_apparel WHERE order_id = $1`, [o.id])
      for (const [table, fk, id] of [['quotation_items', 'quotation_id', q.id], ['invoice_items', 'invoice_id', inv.id]]) {
        const { rows: lines } = await client.query(`SELECT id, description, qty FROM ${table} WHERE ${fk} = $1`, [id])
        if (lines.length !== oLines.length) throw new Error(`${j.who}: ${table} has ${lines.length} lines, the order ${oLines.length}`)
        for (const l of lines) {
          const m = oLines.find(x => x.item === l.description && Number(x.qty) === Number(l.qty))
          if (!m) throw new Error(`${j.who}: ${table} line "${l.description}" x ${l.qty} has no match on the order`)
          await client.query(`UPDATE ${table} SET unit_price = $2::numeric, amount = $3::numeric WHERE id = $1`,
            [l.id, m.unit_price, m.amount])
        }
      }
      await client.query(
        `UPDATE quotations SET subtotal = $2::numeric, estimated_shipping = $3::numeric, total = $4::numeric, updated_at = NOW()
          WHERE id = $1`, [q.id, o.subtotal, o.shipping_charges, o.total])
    }

    // ── Walby Vellon ──────────────────────────────────────────────────────
    {
      const o = await one(client, `SELECT * FROM orders WHERE order_number = 'ORD-2026-0019' AND deleted_at IS NULL`, [], 'ORD-2026-0019')
      const q = await one(client, `SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL`, [o.quotation_id], 'Walby quote')
      if (money(q.total) !== 103 || money(o.total) !== 93) throw new Error(`Walby: quote ${q.total}, order ${o.total}`)
      const { rows: oLines } = await client.query(
        `SELECT sort_order, qty, unit_price, amount FROM order_items_dtf WHERE order_id = $1 ORDER BY sort_order`, [o.id])
      for (const l of oLines) {
        const a = await client.query(
          `UPDATE quotation_items SET unit_price = $4::numeric, amount = $5::numeric
            WHERE quotation_id = $1 AND sort_order = $2 AND qty = $3`, [q.id, l.sort_order, l.qty, l.unit_price, l.amount])
        const b = await client.query(
          `UPDATE quotation_items_dtf SET unit_rate = $4::numeric, line_amount = $5::numeric
            WHERE quotation_id = $1 AND sort_order = $2 AND quantity = $3`, [q.id, l.sort_order, l.qty, l.unit_price, l.amount])
        if (a.rowCount !== 1 || b.rowCount !== 1) throw new Error(`Walby: line ${l.sort_order} did not match`)
      }
      await client.query(
        `UPDATE quotations SET subtotal = $2::numeric, estimated_shipping = $3::numeric, total = $4::numeric, updated_at = NOW()
          WHERE id = $1`, [q.id, o.subtotal, o.shipping_charges, o.total])
      console.log(`\nWalby Vellon  ${q.quote_number} $${q.total} -> $${o.total}  (lines as ORD-2026-0019's)`)
    }

    // ── Ricardo Malia ─────────────────────────────────────────────────────
    {
      const o = await one(client, `SELECT * FROM orders WHERE order_number = 'ORD-2026-0125' AND deleted_at IS NULL`, [], 'ORD-2026-0125')
      const q = await one(client, `SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL`, [o.quotation_id], 'Ricardo quote')
      if (money(q.total) !== 85 || money(o.total) !== 90 || money(q.subtotal) !== money(o.subtotal)) throw new Error('Ricardo: not 85 vs 90')
      await client.query(
        `UPDATE quotations SET estimated_shipping = $2::numeric, total = $3::numeric, updated_at = NOW() WHERE id = $1`,
        [q.id, o.shipping_charges, o.total])
      console.log(`Ricardo Malia  ${q.quote_number} $85 -> $90  (shipping $${o.shipping_charges}, as the order)`)

      const dup = await one(client,
        `SELECT q.* FROM quotations q JOIN customers c ON c.id = q.customer_id
          WHERE c.name = 'Ricardo Malia' AND q.deleted_at IS NULL AND q.total = 80 AND q.status = 'Draft'
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id AND o.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quote_id = q.id AND i.deleted_at IS NULL)`, [], 'Ricardo duplicate')
      await one(client,
        `SELECT q.id FROM quotations q JOIN orders o ON o.quotation_id = q.id AND o.deleted_at IS NULL
          WHERE q.customer_id = $1 AND q.deleted_at IS NULL AND q.total = 80`, [dup.customer_id], 'Ricardo $80 job with an order')
      await client.query(
        `UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')},
                notes = COALESCE(notes || ' | ', '') || 'Duplicate draft of a job already quoted, invoiced and ordered.',
                updated_at = NOW() WHERE id = $1`, [dup.id])
      console.log(`   ${dup.quote_number} $80 draft retired (duplicate)`)
    }

    // ── Proof ─────────────────────────────────────────────────────────────
    const { rows: [c] } = await client.query(
      `SELECT to_char((SELECT SUM(total) FROM orders WHERE deleted_at IS NULL), 'FM999,999.00') AS so,
              to_char((SELECT SUM(total) FROM invoices WHERE deleted_at IS NULL), 'FM999,999.00') AS inv,
              to_char((SELECT SUM(total) FROM quotations WHERE deleted_at IS NULL), 'FM999,999.00') AS quotes,
              (SELECT COUNT(*) FROM orders o JOIN quotations q ON q.id = o.quotation_id
                WHERE o.deleted_at IS NULL AND q.total <> o.total)::int AS quote_ne_so,
              (SELECT COUNT(*) FROM orders o JOIN invoices i ON i.id = o.invoice_id
                WHERE o.deleted_at IS NULL AND i.total <> o.total)::int AS inv_ne_so,
              (SELECT string_agg(q.quote_number || ' $' || q.total, ', ') FROM quotations q WHERE q.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.deleted_at IS NULL AND o.quotation_id = q.id)
                  AND NOT EXISTS (SELECT 1 FROM orders o JOIN invoices i ON i.id = o.invoice_id
                                   WHERE o.deleted_at IS NULL AND i.quote_id = q.id)) AS quotes_without_so,
              (SELECT string_agg(i.invoice_number || ' $' || i.total, ', ') FROM invoices i WHERE i.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.deleted_at IS NULL AND o.invoice_id = i.id)) AS invoices_without_so,
              (SELECT COUNT(*) FROM quotations q WHERE q.deleted_at IS NULL AND abs(q.subtotal - (
                  SELECT COALESCE(SUM(amount), 0) FROM quotation_items x WHERE x.quotation_id = q.id)) > 0.01
                  AND q.quote_number = ANY($1))::int AS quote_lines_off,
              (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.invoice_id = i.id AND o.deleted_at IS NULL
                WHERE i.deleted_at IS NULL AND o.order_number IN ('ORD-2026-0126', 'ORD-2026-0127') AND abs(i.subtotal - (
                  SELECT COALESCE(SUM(amount), 0) FROM invoice_items x WHERE x.invoice_id = i.id)) > 0.01)::int AS inv_lines_off`,
      [DIGI.map(j => j.quote)])
    console.log(`\n   SOs $${c.so}   invoices $${c.inv}   quotes $${c.quotes}`)
    console.log(`   quote ≠ its SO ${c.quote_ne_so}   invoice ≠ its SO ${c.inv_ne_so}   lines off ${c.quote_lines_off + c.inv_lines_off}`)
    console.log(`   quotes with no SO yet:   ${c.quotes_without_so}`)
    console.log(`   invoices with no SO yet: ${c.invoices_without_so}`)
    if (c.quote_ne_so || c.inv_ne_so || c.quote_lines_off || c.inv_lines_off || c.quotes !== c.inv) {
      throw new Error('quotes, invoices and sales orders still disagree — rolled back')
    }

    if (APPLY) { await client.query('COMMIT'); console.log('\nWritten.') }
    else { await client.query('ROLLBACK'); console.log('\nNothing written. Re-run with --apply.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
