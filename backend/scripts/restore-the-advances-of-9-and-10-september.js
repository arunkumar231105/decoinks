#!/usr/bin/env node
'use strict'

/**
 * Brings back the five sales orders that undo-the-advances-of-9-and-10-september.js
 * took away. The owner's word: they were right, keep them.
 *
 * The rows were soft-deleted, not destroyed, so this restores the very same
 * orders, invoices and quotations — line items and all — rather than writing
 * new ones. Orders and invoices get their own numbers back when those numbers
 * are still free. Quotations were renumbered after the undo, so theirs may now
 * belong to someone else; they return at the end of the series and the
 * quotation renumber puts everything back in date order.
 *
 * Each payment is re-attached to its order and invoice. Tim BlackDragon's
 * parcel SHP-2026-0171 goes back on his order if it is still loose. Valeria
 * Battle's quotation — which existed before any of this — is approved again.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

const RESTORE = [
  { order: 'ORD-2026-0146', invoice: 'EBR-0153', payment: 'PAY-2026-0152', customer: 'CUST-2026-0114' },
  { order: 'ORD-2026-0147', invoice: 'TBL-0154', payment: 'PAY-2026-0149', customer: 'CUST-2026-0110', parcel: 'SHP-2026-0171' },
  { order: 'ORD-2026-0148', invoice: 'JTR-0155', payment: 'PAY-2026-0150', customer: 'CUST-2026-0111' },
  { order: 'ORD-2026-0149', invoice: 'VCA-0156', payment: 'PAY-2026-0148', customer: 'CUST-2026-0084' },
  { order: 'ORD-2026-0150', invoice: 'VBA-0157', payment: 'PAY-2026-0153', customer: 'CUST-2026-0113' },
]

const REMOVED_NOTE = " | Removed on the owner's instruction — created without being asked."

async function numberFree(client, table, column, value) {
  const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value])
  return rows.length === 0
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    for (const r of RESTORE) {
      // The parked row: 'D-' + original number + '-' + four characters of its id.
      const { rows: ord } = await client.query(
        `SELECT o.id, o.order_number, o.invoice_id, o.quotation_id, o.total, o.notes,
                c.customer_number, c.name
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.deleted_at IS NOT NULL AND o.order_number LIKE $1`, [`D-${r.order}-%`])
      if (ord.length !== 1) throw new Error(`expected one parked ${r.order}, found ${ord.length}`)
      const o = ord[0]
      if (o.customer_number !== r.customer) throw new Error(`${r.order} belongs to ${o.customer_number} — refusing`)

      const orderFree = await numberFree(client, 'orders', 'order_number', r.order)
      const invFree = await numberFree(client, 'invoices', 'invoice_number', r.invoice)
      if (!orderFree) throw new Error(`${r.order} has been taken since — refusing rather than renumbering it`)
      if (!invFree) throw new Error(`${r.invoice} has been taken since — refusing rather than renumbering it`)

      const { rows: inv } = await client.query(
        `SELECT id, invoice_number, deleted_at IS NOT NULL AS parked FROM invoices WHERE id = $1`, [o.invoice_id])
      const { rows: quo } = await client.query(
        `SELECT id, quote_number, status, deleted_at IS NOT NULL AS parked FROM quotations WHERE id = $1`, [o.quotation_id])
      const { rows: pay } = await client.query(
        `SELECT id, payment_number, amount, order_id FROM payments WHERE payment_number = $1`, [r.payment])
      if (!pay[0]) throw new Error(`${r.payment} not found`)
      if (pay[0].order_id) throw new Error(`${r.payment} is on another order now — refusing`)

      console.log(`${r.order}  ${o.name}  $${o.total}`)
      console.log(`   order     ${o.order_number} -> ${r.order}`)
      console.log(`   invoice   ${inv[0]?.invoice_number ?? '—'} -> ${r.invoice}`)
      console.log(`   quotation ${quo[0]?.quote_number ?? '—'} -> ${quo[0]?.parked ? 'restored at the end of the series' : 'approved again'}`)
      console.log(`   payment   ${r.payment} $${pay[0].amount} -> back on the order`)

      let parcelNote = null
      if (r.parcel) {
        const { rows: sh } = await client.query(
          `SELECT id, order_id FROM shipments WHERE shipment_number = $1 AND deleted_at IS NULL`, [r.parcel])
        parcelNote = !sh[0] ? 'not found' : sh[0].order_id ? 'already on another order — left' : 'back on the order'
        console.log(`   parcel    ${r.parcel} -> ${parcelNote}`)
      }

      if (!APPLY) { console.log(); continue }

      await client.query(
        `UPDATE orders SET deleted_at = NULL, order_number = $2,
                           notes = replace(notes, $3, ''), updated_at = NOW()
          WHERE id = $1`, [o.id, r.order, REMOVED_NOTE])
      await client.query(
        `UPDATE invoices SET deleted_at = NULL, invoice_number = $2, updated_at = NOW() WHERE id = $1`,
        [o.invoice_id, r.invoice])

      if (quo[0]?.parked) {
        const { rows: n } = await client.query(
          `SELECT COALESCE(MAX(NULLIF(split_part(quote_number, '-', 3), '')::INT), 0) + 1 AS n
             FROM quotations WHERE quote_number LIKE 'Q-2026-%'`)
        await client.query(
          `UPDATE quotations SET deleted_at = NULL, quote_number = $2, updated_at = NOW() WHERE id = $1`,
          [quo[0].id, `Q-2026-${String(n[0].n).padStart(4, '0')}`])
      } else if (quo[0]) {
        await client.query(`UPDATE quotations SET status = 'Approved', updated_at = NOW() WHERE id = $1`, [quo[0].id])
      }

      await client.query(
        `UPDATE payments SET order_id = $2, invoice_id = $3, updated_at = NOW() WHERE id = $1`,
        [pay[0].id, o.id, o.invoice_id])

      if (r.parcel && parcelNote === 'back on the order') {
        await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW()
            WHERE shipment_number = $1 AND order_id IS NULL AND deleted_at IS NULL`, [r.parcel, o.id])
      }
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
