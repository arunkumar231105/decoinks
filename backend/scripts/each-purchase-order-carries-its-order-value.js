#!/usr/bin/env node
'use strict'

/**
 * A purchase order carries its sales order's value — on the owner's word.
 *
 * Twelve POs disagreed with their order. Ten were raised for the goods alone
 * and left the order's shipping out ($10–$26 each). Walby's PO-2026-0021 kept
 * the $103 the order was corrected from; Ricardo's kept the order's old $15
 * shipping when the order went to $20.
 *
 * Each is set to its order's figures: subtotal, shipping (in shipping_charge,
 * and in freight_charges, which is what the PO form adds up), total and
 * grand_total. Only orders with exactly one PO are touched, and only when the
 * PO still reads what it read when this was written.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = v => Number(Number(v || 0).toFixed(2))

// order -> [PO, the PO's total today]
const PLAN = {
  'ORD-2026-0019': ['PO-2026-0021', 103],
  'ORD-2026-0113': ['PO-2026-0123', 45],
  'ORD-2026-0114': ['PO-2026-0125', 24],
  'ORD-2026-0116': ['PO-2026-0127', 35],
  'ORD-2026-0117': ['PO-2026-0130', 60],
  'ORD-2026-0118': ['PO-2026-0129', 19.25],
  'ORD-2026-0119': ['PO-2026-0132', 45],
  'ORD-2026-0120': ['PO-2026-0133', 218.5],
  'ORD-2026-0121': ['PO-2026-0136', 53.5],
  'ORD-2026-0122': ['PO-2026-0134', 65],
  'ORD-2026-0123': ['PO-2026-0135', 128],
  'ORD-2026-0125': ['PO-2026-0137', 85],
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')
    for (const [orderNumber, [poNumber, was]] of Object.entries(PLAN)) {
      const { rows: [o] } = await client.query(
        `SELECT id, subtotal, shipping_charges, total FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [orderNumber])
      if (!o) throw new Error(`${orderNumber} not found`)
      const { rows: pos } = await client.query(
        `SELECT id, po_number, total, grand_total, total_discount, total_tax, other_charges
           FROM purchase_orders WHERE order_id = $1 AND deleted_at IS NULL`, [o.id])
      if (pos.length !== 1 || pos[0].po_number !== poNumber) {
        throw new Error(`${orderNumber}: expected only ${poNumber}, found ${pos.map(p => p.po_number).join(', ') || 'none'}`)
      }
      const p = pos[0]
      if (money(p.total) !== was) throw new Error(`${poNumber} reads $${p.total}, not $${was} — refusing`)
      if (money(p.total_discount) || money(p.total_tax) || money(p.other_charges)) {
        throw new Error(`${poNumber} carries a discount, tax or other charge — refusing`)
      }
      if (money(Number(o.subtotal) + Number(o.shipping_charges)) !== money(o.total)) {
        throw new Error(`${orderNumber}: ${o.subtotal} + ${o.shipping_charges} is not ${o.total}`)
      }
      console.log(`  ${orderNumber}  ${poNumber}  $${money(p.total).toFixed(2).padStart(7)}  ->  $${money(o.total).toFixed(2).padStart(7)}` +
                  `  ($${money(o.subtotal).toFixed(2)} + $${money(o.shipping_charges).toFixed(2)} shipping)`)
      await client.query(
        `UPDATE purchase_orders
            SET subtotal = $2::numeric, shipping_charge = $3::numeric, freight_charges = $3::numeric,
                total = $4::numeric, grand_total = $4::numeric, updated_at = NOW()
          WHERE id = $1`, [p.id, o.subtotal, o.shipping_charges, o.total])
    }

    const { rows: [c] } = await client.query(`
      SELECT COUNT(*)::int AS off FROM (
        SELECT o.id FROM orders o JOIN purchase_orders p ON p.order_id = o.id AND p.deleted_at IS NULL
         WHERE o.deleted_at IS NULL
         GROUP BY o.id, o.total HAVING abs(SUM(COALESCE(NULLIF(p.grand_total, 0), p.total)) - o.total) > 0.001) x`)
    console.log(`\n   orders whose PO total still differs: ${c.off}`)
    if (c.off) throw new Error('some orders still disagree with their POs — rolled back')

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
