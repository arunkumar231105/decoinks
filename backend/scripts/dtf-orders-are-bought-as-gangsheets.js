#!/usr/bin/env node
'use strict'

/**
 * A DTF sales order is bought from the factory as a gangsheet purchase order.
 *
 * A purchase order has two kinds, and they are the two ways this shop buys:
 * apparel (blank or printed garments) and gangsheet (DTF transfers, printed on
 * gangsheets). So a DTF order and a gangsheet PO are the same job seen from
 * each side — 89 POs already pair that way.
 *
 * Nine did not: DTF orders whose TSI Transfers PO was filed as apparel. None of
 * them has an apparel line or a gangsheet fragment, so changing the kind moves
 * nothing but the form the PO opens in. They become gangsheet POs.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      SELECT p.id, p.po_number, p.order_date, p.vendor_name, p.status::text AS status, p.total,
             o.order_number, o.order_type::text AS order_type,
             (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = p.id)::int AS items,
             (SELECT COUNT(*) FROM po_gangsheet_fragments f WHERE f.po_id = p.id)::int AS fragments
        FROM purchase_orders p
        JOIN orders o ON o.id = p.order_id AND o.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND o.order_type = 'dtf' AND p.po_type <> 'gangsheet'
       ORDER BY p.po_number`)
    for (const r of rows) {
      if (r.items || r.fragments) throw new Error(`${r.po_number} has ${r.items} line(s) / ${r.fragments} fragment(s) — refusing`)
      console.log(`  ${r.po_number}  ${String(r.order_date).slice(0, 10)}  ${r.order_number}  ${r.vendor_name}  ${r.status}  $${r.total}   apparel -> gangsheet`)
    }
    if (rows.length) {
      await client.query(
        `UPDATE purchase_orders SET po_type = 'gangsheet', updated_at = NOW() WHERE id = ANY($1)`, [rows.map(r => r.id)])
    }

    const { rows: [c] } = await client.query(`
      SELECT COUNT(*) FILTER (WHERE o.order_type = 'dtf' AND p.po_type = 'gangsheet')::int AS dtf_ok,
             COUNT(*) FILTER (WHERE o.order_type = 'apparel' AND p.po_type = 'apparel')::int AS apparel_ok,
             COUNT(*) FILTER (WHERE NOT ((o.order_type = 'dtf' AND p.po_type = 'gangsheet')
                                      OR (o.order_type = 'apparel' AND p.po_type = 'apparel')))::int AS wrong
        FROM purchase_orders p JOIN orders o ON o.id = p.order_id AND o.deleted_at IS NULL
       WHERE p.deleted_at IS NULL`)
    console.log(`\n   ${rows.length} PO(s) moved.  DTF order + gangsheet PO ${c.dtf_ok}   apparel + apparel ${c.apparel_ok}   still mismatched ${c.wrong}`)
    if (c.wrong) throw new Error('mismatches remain — rolled back')

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
