#!/usr/bin/env node
'use strict'

/**
 * Takes back the five sales orders the-advances-of-9-and-10-september.js wrote.
 *
 * They were created without the owner asking. The owner's instruction: remove
 * them. Each order, its invoice and the quotation raised for it are
 * soft-deleted with their numbers parked (the unique indexes cover deleted
 * rows, so a number left on a dead row would block renumbering). Valeria
 * Battle's quotation existed before the script ran, so it is not deleted — it
 * goes back to Draft, which is what it was. The five payments are released back
 * to having no order and no invoice, exactly as they arrived. No payment row is
 * touched beyond that.
 *
 * It refuses to touch an order that has picked up a purchase order or a parcel
 * since — that would mean someone has started acting on it.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const UNDO = [
  { order: 'ORD-2026-0146', payment: 'PAY-2026-0152', customer: 'CUST-2026-0114' },
  { order: 'ORD-2026-0147', payment: 'PAY-2026-0149', customer: 'CUST-2026-0110' },
  { order: 'ORD-2026-0148', payment: 'PAY-2026-0150', customer: 'CUST-2026-0111' },
  { order: 'ORD-2026-0149', payment: 'PAY-2026-0148', customer: 'CUST-2026-0084' },
  { order: 'ORD-2026-0150', payment: 'PAY-2026-0153', customer: 'CUST-2026-0113' },
]

const park = col => `'D-' || ${col} || '-' || left(replace(id::text, '-', ''), 4)`

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    for (const u of UNDO) {
      const { rows } = await client.query(
        `SELECT o.id, o.order_number, o.total, o.invoice_id, o.quotation_id, o.created_at,
                c.customer_number, c.name,
                i.invoice_number, q.quote_number, q.notes AS quote_notes, q.status AS quote_status,
                (SELECT COUNT(*) FROM purchase_orders po WHERE po.order_id = o.id AND po.deleted_at IS NULL) AS pos,
                (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS parcels
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           LEFT JOIN invoices i ON i.id = o.invoice_id
           LEFT JOIN quotations q ON q.id = o.quotation_id
          WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [u.order])
      const o = rows[0]
      if (!o) throw new Error(`${u.order} not found`)
      if (o.customer_number !== u.customer) throw new Error(`${u.order} belongs to ${o.customer_number}, not ${u.customer} — refusing`)
      // A purchase order means a person has placed the job with a factory.
      if (Number(o.pos) > 0) {
        throw new Error(`${u.order} has ${o.pos} purchase order(s) now — someone is acting on it, refusing`)
      }
      // A parcel is different. One that was already on the book before this
      // order existed was loose, and the ten-minute attach pass joined it to
      // the order by name and date — Tim BlackDragon's SHP-2026-0171 is exactly
      // that. It goes back to loose, as it was. A parcel created after the
      // order would mean someone shipped against it, so that still stops.
      const { rows: parcels } = await client.query(
        `SELECT id, shipment_number, created_at < $2 AS was_loose_before
           FROM shipments WHERE order_id = $1 AND deleted_at IS NULL`, [o.id, o.created_at])
      const madeAfter = parcels.filter(p => !p.was_loose_before)
      if (madeAfter.length) {
        throw new Error(`${u.order} has a parcel made after it (${madeAfter.map(p => p.shipment_number).join(', ')}) — refusing`)
      }

      const quoteIsMine = o.quote_notes === `Raised from ${o.order_number}`
      console.log(`${o.order_number}  ${o.name}  $${o.total}`)
      console.log(`   invoice   ${o.invoice_number}  -> removed`)
      console.log(`   quotation ${o.quote_number ?? '—'}  -> ${quoteIsMine ? 'removed' : `kept, back to Draft (was ${o.quote_status})`}`)
      console.log(`   payment   ${u.payment}  -> released, no order`)
      for (const p of parcels) console.log(`   parcel    ${p.shipment_number}  -> back to loose (auto-attached)`)

      if (!APPLY) { console.log(); continue }

      await client.query(
        `UPDATE shipments SET order_id = NULL, updated_at = NOW()
          WHERE order_id = $1 AND deleted_at IS NULL`, [o.id])
      await client.query(
        `UPDATE payments SET order_id = NULL,
                             invoice_id = CASE WHEN invoice_id = $2 THEN NULL ELSE invoice_id END,
                             updated_at = NOW()
          WHERE payment_number = $1`, [u.payment, o.invoice_id])

      if (o.invoice_id) {
        await client.query(
          `UPDATE invoices SET deleted_at = NOW(), invoice_number = ${park('invoice_number')}, updated_at = NOW()
            WHERE id = $1`, [o.invoice_id])
      }
      if (o.quotation_id) {
        if (quoteIsMine) {
          await client.query(
            `UPDATE quotations SET deleted_at = NOW(), quote_number = ${park('quote_number')}, updated_at = NOW()
              WHERE id = $1`, [o.quotation_id])
        } else {
          await client.query(
            `UPDATE quotations SET status = 'Draft', updated_at = NOW() WHERE id = $1`, [o.quotation_id])
        }
      }
      await client.query(
        `UPDATE orders SET deleted_at = NOW(), order_number = ${park('order_number')},
                           notes = COALESCE(notes || ' | ', '') || 'Removed on the owner''s instruction — created without being asked.',
                           updated_at = NOW()
          WHERE id = $1`, [o.id])
      console.log()
    }

    if (APPLY) { await client.query('COMMIT'); console.log('Written.') }
    else { await client.query('ROLLBACK'); console.log('Nothing written. Re-run with --apply.') }
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
