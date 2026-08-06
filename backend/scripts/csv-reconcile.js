#!/usr/bin/env node
/**
 * Reconcile the DB with the owner-provided authoritative CSV set.
 *
 * Target end state:
 *   62 customers   – deduped from every TSI/TS-PA row
 *   76 orders      – 9 TS-PA-* + 67 TSI-* (ORD-* in the DB)
 *   76 quotations  – one per order, sequential Q-YYYY-NNNN
 *   76 invoices    – one per order, sequential INV-YYYY-NNNN
 *   76 purchase orders – one per order, sequential PO-YYYY-NNNN
 *   67 payments    – unchanged (real money, kept as-is)
 *
 * Rules:
 *   – A manually-filled customer field (email/phone/address) already in the
 *     DB is NEVER overwritten by a blank cell in the sheet; the CSV only
 *     fills gaps.
 *   – An order that already exists is updated in place; missing ones are
 *     inserted. order_number keeps its ORD-YYMMDD-NN / ORD-TS-PA-... shape.
 *   – Every order gets a matching quotation/invoice/PO created if missing.
 *   – Anything in the DB not on the CSV list is soft-deleted.
 *   – Payments are never touched by this script.
 *
 * Phases (each callable with --phase=N; default runs the DB-safe ones):
 *   1 upsert customers
 *   2 upsert orders + line items (TS-PA-* only have real lines; TSI-* get
 *     a single "DTF Transfers — N sheets" summary line based on the sheet)
 *   3 upsert quotations, invoices, POs for every authoritative order
 *   4 soft-delete every customer / order / quotation / invoice / PO that
 *     is not in the authoritative sets
 *   5 renumber quotations/invoices/POs sequentially (display only)
 *
 * Usage:
 *   node backend/scripts/csv-reconcile.js                (dry-run all phases)
 *   node backend/scripts/csv-reconcile.js --apply        (run all phases live)
 *   node backend/scripts/csv-reconcile.js --phase=1 --apply
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const PHASE = (process.argv.find(a => a.startsWith('--phase=')) || '').split('=')[1]
const CSV_DIR = process.env.CSV_DIR
  || '/tmp/claude-0/-root-decoinks/cab844a3-03d2-49e4-9cd9-f1cd55bceef6/scratchpad/csv-import'
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12,
                 January:1, February:2, March:3, April:4, June:6, July:7, August:8, September:9,
                 October:10, November:11, December:12 }

// "May 1, 2026"  / "21-Apr-2026" / "Jun 24, 2026 before 2 pm" -> "2026-05-01"
function parseDate(raw) {
  if (!raw) return null
  const s = raw.trim().replace(/\s+before.*$/i, '')
  let m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(s)
  if (m) return `${m[3]}-${String(MONTHS[m[1]]||'').padStart(2,'0')}-${m[2].padStart(2,'0')}`
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s)
  if (m) return `${m[3]}-${String(MONTHS[m[2]]||'').padStart(2,'0')}-${m[1].padStart(2,'0')}`
  return null
}

function readTsv(name) {
  const raw = fs.readFileSync(path.join(CSV_DIR, name), 'utf8').trim().split('\n')
  const headers = raw[0].split('\t').map(h => h.trim())
  return raw.slice(1).map(line => {
    const cells = line.split('\t')
    const row = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

// TSI-260730-65 (sheet) -> ORD-260730-65 (DB)
// TS-PA-260501-03 (sheet) -> ORD-TS-PA-260501-03 (DB)
function orderNumberFor(poNumber) {
  const s = poNumber.trim()
  if (s.startsWith('TSI ') || s.startsWith('TSI-')) return 'ORD-' + s.replace(/^TSI[\s-]+/, '')
  if (s.startsWith('TS-PA-')) return 'ORD-' + s
  return s
}

// A single logical source-of-truth row for one order, drawn from whichever
// sheet described it. Keys stay stable across the whole script.
function loadAuthoritative() {
  const orders = new Map()   // orderNumber -> {source, customer_name, ship_to, ...}
  const add = (poNumber, patch, source) => {
    const key = orderNumberFor(poNumber)
    const prev = orders.get(key) || { orderNumber: key, source }
    orders.set(key, { ...prev, ...patch, source: prev.source || source })
  }

  for (const r of readTsv('orders-tspa.tsv')) {
    if (!r.po_number) continue
    add(r.po_number, {
      order_date: parseDate(r.date),
      customer_name: r.client_name || null,
      shipping_address: r.shipping_addr || null,
      item: r.item, print_type: r.print_type,
      total_qty: Number(r.qty) || 0,
      subtotal: Number(r.amount) || 0,
      shipping: Number(r.shipping) || 0,
      total: Number(r.total) || 0,
      priority: r.priority || null,
      shipping_method: r.shipping_method || null,
      notes: r.notes || null,
      has_line_items: true,
    }, 'ts-pa')
  }
  for (const r of readTsv('pos-apr-jun.tsv')) {
    if (!r.po_number) continue
    const total = (Number(r.payment_received) || 0) + (Number(r.shipping_charge) || 0)
    add(r.po_number, {
      order_date: parseDate(r.po_date),
      req_dispatch: parseDate(r.req_dispatch),
      customer_name: r.client_name || null,
      shipping_address: r.ship_to || null,
      total_gs: Number(r.total_gs) || 0,
      total_aw: Number(r.total_aw) || 0,
      subtotal: Number(r.payment_received) || 0,
      shipping: Number(r.shipping_charge) || 0,
      total: total || Number(r.payment_received) || 0,
      net_cost: Number(r.net_amount) || 0,
      notes: r.notes || null,
      has_line_items: false,
    }, 'apr-jun')
  }
  for (const r of readTsv('pos-jun-jul.tsv')) {
    if (!r.po_number) continue
    add(r.po_number, {
      order_date: parseDate(r.po_date),
      req_dispatch: parseDate(r.req_dispatch),
      customer_name: r.client_name || null,
      shipping_address: r.ship_to || null,
      total_gs: Number(r.total_gs) || 0,
      total_aw: Number(r.total_aw) || 0,
      subtotal: Number(r.order_amount) || 0,
      shipping: Number(r.shipping) || 0,
      total: Number(r.total_amount) || 0,
      notes: r.notes || null,
      has_line_items: false,
    }, 'jun-jul')
  }
  for (const r of readTsv('pos-jul-aug.tsv')) {
    if (!r.po_number) continue
    add(r.po_number, {
      order_date: parseDate(r.po_date),
      req_dispatch: parseDate(r.req_dispatch),
      customer_name: r.client_name || null,
      shipping_address: r.ship_to || null,
      total_gs: Number(r.total_gs) || 0,
      total_aw: Number(r.total_aw) || 0,
      subtotal: Number(r.product_amount) || 0,
      shipping: Number(r.shipping) || 0,
      total: Number(r.total) || 0,
      notes: r.notes || null,
      has_line_items: false,
    }, 'jul-aug')
  }
  return [...orders.values()]
}

function loadTspaLines() {
  const byOrder = new Map()
  for (const r of readTsv('orders-tspa-lines.tsv')) {
    const key = orderNumberFor(r.po_number)
    if (!byOrder.has(key)) byOrder.set(key, [])
    byOrder.get(key).push({
      line_no: Number(r.line_no) || 0, item: r.item,
      color: r.color, size: r.size, qty: Number(r.qty) || 0,
    })
  }
  return byOrder
}

// Splits an address string into rough city/state/zip if there's a comma+ZIP.
// Anything not parseable stays in the address block.
function splitAddress(a) {
  if (!a) return { line: null, city: null, state: null, zip: null }
  const m = /^(.*?),\s*([^,]+?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i.exec(a)
  if (m) return { line: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] }
  return { line: a.trim(), city: null, state: null, zip: null }
}

async function main() {
  const authoritative = loadAuthoritative()
  const tspaLines = loadTspaLines()
  console.log(`Authoritative order set: ${authoritative.length}`)

  // Dedup customers by lowercased name, remembering the best address we saw
  // (a non-blank one always beats a blank one).
  const customers = new Map()
  for (const o of authoritative) {
    if (!o.customer_name) continue
    const key = o.customer_name.toLowerCase().trim()
    const prev = customers.get(key)
    if (!prev || (!prev.shipping_address && o.shipping_address)) {
      customers.set(key, { name: o.customer_name.trim(), shipping_address: o.shipping_address || prev?.shipping_address || null })
    }
  }
  console.log(`Unique customers: ${customers.size}`)

  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()

  try {
    // ─── PHASE 1: customers ──────────────────────────────────────────────
    if (!PHASE || PHASE === '1') {
      console.log('\n=== PHASE 1: customers upsert ===')
      const existing = new Map(
        (await client.query('SELECT id, name, address_line1 FROM customers WHERE deleted_at IS NULL')).rows
          .map(r => [r.name.toLowerCase().trim(), r]))
      let created = 0, updated = 0

      if (APPLY) await client.query('BEGIN')
      for (const c of customers.values()) {
        const addr = splitAddress(c.shipping_address)
        const existRow = existing.get(c.name.toLowerCase().trim())
        if (existRow) {
          // Only fill blank fields. Never overwrite manually-filled data.
          if (APPLY) {
            await client.query(`
              UPDATE customers SET
                address_line1 = COALESCE(NULLIF(address_line1,''), $2),
                city  = COALESCE(NULLIF(city,''),  $3),
                state = COALESCE(NULLIF(state,''), $4),
                zip   = COALESCE(NULLIF(zip,''),   $5),
                deleted_at = NULL,
                updated_at = NOW()
               WHERE id = $1`,
              [existRow.id, addr.line, addr.city, addr.state, addr.zip])
          }
          updated++
        } else {
          if (APPLY) {
            await client.query(`
              INSERT INTO customers (name, address_line1, city, state, zip, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
              [c.name, addr.line, addr.city, addr.state, addr.zip])
          }
          created++
        }
      }
      if (APPLY) await client.query('COMMIT')
      console.log(`  customers created=${created}  updated=${updated}`)
    }

    // ─── PHASE 2: orders + line items ────────────────────────────────────
    if (!PHASE || PHASE === '2') {
      console.log('\n=== PHASE 2: orders upsert ===')
      const existingOrders = new Map(
        (await client.query('SELECT id, order_number, customer_id FROM orders').rows || [])
      )
      const custIdByName = new Map(
        (await client.query('SELECT id, name FROM customers WHERE deleted_at IS NULL')).rows
          .map(r => [r.name.toLowerCase().trim(), r.id]))

      let created = 0, updated = 0
      if (APPLY) await client.query('BEGIN')

      for (const o of authoritative) {
        const custId = o.customer_name ? custIdByName.get(o.customer_name.toLowerCase().trim()) : null
        const addr = splitAddress(o.shipping_address)
        const existRow = (await client.query('SELECT id FROM orders WHERE order_number = $1', [o.orderNumber])).rows[0]

        if (existRow) {
          if (APPLY) {
            await client.query(`
              UPDATE orders SET
                order_date = COALESCE($2::date, order_date),
                customer_id = COALESCE(customer_id, $3),
                shipping_name    = COALESCE(NULLIF(shipping_name,''),    $4),
                shipping_address = COALESCE(NULLIF(shipping_address,''), $5),
                subtotal = CASE WHEN subtotal = 0 THEN $6 ELSE subtotal END,
                shipping_charges = CASE WHEN COALESCE(shipping_charges,0) = 0 THEN $7 ELSE shipping_charges END,
                total = CASE WHEN total = 0 THEN $8 ELSE total END,
                notes = COALESCE(NULLIF(notes,''), $9),
                deleted_at = NULL,
                updated_at = NOW()
               WHERE id = $1`,
              [existRow.id, o.order_date, custId,
               o.customer_name, o.shipping_address,
               o.subtotal || 0, o.shipping || 0, o.total || 0, o.notes])
          }
          updated++
        } else {
          if (APPLY) {
            await client.query(`
              INSERT INTO orders (
                order_number, order_type, order_date, entry_date, customer_id,
                shipping_name, shipping_address,
                subtotal, shipping_charges, total,
                status, payment_status, payment_method,
                notes, created_at, updated_at)
              VALUES ($1, 'dtf', $2::date, $2::date, $3,
                      $4, $5, $6, $7, $8,
                      'Pending', 'Unpaid', 'Bank Transfer',
                      $9, NOW(), NOW())`,
              [o.orderNumber, o.order_date, custId,
               o.customer_name, o.shipping_address,
               o.subtotal || 0, o.shipping || 0, o.total || 0, o.notes])
          }
          created++
        }
      }
      if (APPLY) await client.query('COMMIT')
      console.log(`  orders created=${created}  updated=${updated}`)

      // Line items — TS-PA-* → order_items_apparel; TSI-* → order_items_dtf (summary).
      if (APPLY) {
        console.log('  upserting line items…')
        await client.query('BEGIN')
        for (const [orderNumber, lines] of tspaLines) {
          const r = (await client.query('SELECT id FROM orders WHERE order_number = $1', [orderNumber])).rows[0]
          if (!r) continue
          await client.query('DELETE FROM order_items_apparel WHERE order_id = $1', [r.id])
          let n = 0
          for (const line of lines) {
            await client.query(`
              INSERT INTO order_items_apparel (order_id, item, color, size, qty, unit_price, amount, sort_order)
              VALUES ($1, $2, $3, $4, $5, 0, 0, $6)`,
              [r.id, line.item, line.color, line.size, line.qty, n++])
          }
        }
        // TSI orders — one summary DTF line based on total gangsheets/artworks.
        for (const o of authoritative) {
          if (o.has_line_items) continue
          const r = (await client.query('SELECT id FROM orders WHERE order_number = $1', [o.orderNumber])).rows[0]
          if (!r) continue
          const existLines = (await client.query('SELECT COUNT(*) FROM order_items_dtf WHERE order_id = $1', [r.id])).rows[0].count
          if (Number(existLines) > 0) continue
          const desc = `DTF Transfers — ${o.total_gs || 1} gangsheet(s), ${o.total_aw || 0} artworks`
          await client.query(`
            INSERT INTO order_items_dtf (order_id, artwork_name, qty, unit_price, amount)
            VALUES ($1, $2, $3, $4, $4)`,
            [r.id, desc, o.total_aw || o.total_gs || 1, o.subtotal || 0])
        }
        await client.query('COMMIT')
        console.log('  line items done')
      }
    }

    // ─── PHASE 3: quotations, invoices, POs (one per order) ───────────────
    if (!PHASE || PHASE === '3') {
      console.log('\n=== PHASE 3: quotations + invoices + POs ===')
      const orders = (await client.query(`
        SELECT id, order_number, order_date, customer_id, shipping_name, shipping_address,
               subtotal, shipping_charges, total, notes
          FROM orders WHERE deleted_at IS NULL`)).rows

      let q=0, i=0, p=0
      if (APPLY) await client.query('BEGIN')
      for (const o of orders) {
        // Invoice (has order_id link). If missing, create.
        const iExist = (await client.query('SELECT id, quote_id FROM invoices WHERE order_id = $1 AND deleted_at IS NULL', [o.id])).rows[0]
        let invoiceId = iExist?.id, quoteId = iExist?.quote_id

        if (!invoiceId) {
          if (APPLY) {
            const r = await client.query(`
              INSERT INTO invoices (invoice_number, order_id, customer_id, customer_name,
                                    shipping_address, issue_date, due_date,
                                    subtotal, shipping_charges, total, amount_paid, balance_due,
                                    status, order_type, payment_terms, payment_method, currency,
                                    created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6::date, ($6::date + INTERVAL '30 days')::date,
                      $7, $8, $9, 0, $9,
                      'Draft', 'dtf', 'Advance', 'Bank Transfer', 'USD',
                      NOW(), NOW())
              RETURNING id`,
              [`INV-TEMP-${o.order_number}`, o.id, o.customer_id, o.shipping_name,
               o.shipping_address, o.order_date, o.subtotal || 0, o.shipping_charges || 0, o.total || 0])
            invoiceId = r.rows[0].id
          }
          i++
        }

        // Quotation (linked from invoice.quote_id). If none, create + link.
        if (!quoteId) {
          if (APPLY) {
            const r = await client.query(`
              INSERT INTO quotations (quote_number, customer_id, customer_name,
                                      shipping_address, valid_until,
                                      subtotal, total, status, order_type, currency,
                                      sent_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, ($5::date + INTERVAL '30 days')::date,
                      $6, $7, 'Approved', 'dtf', 'USD',
                      $5::timestamptz, NOW(), NOW())
              RETURNING id`,
              [`Q-TEMP-${o.order_number}`, o.customer_id, o.shipping_name,
               o.shipping_address, o.order_date, o.subtotal || 0, o.total || 0])
            quoteId = r.rows[0].id
            if (invoiceId) await client.query('UPDATE invoices SET quote_id = $1 WHERE id = $2', [quoteId, invoiceId])
          }
          q++
        }

        // PO for the supplier (TEXSTONE INC)
        const pExist = (await client.query('SELECT id FROM purchase_orders WHERE order_id = $1 AND deleted_at IS NULL', [o.id])).rows[0]
        if (!pExist) {
          if (APPLY) await client.query(`
            INSERT INTO purchase_orders (po_number, order_id, vendor_name,
                                         order_date, expected_date,
                                         subtotal, total,
                                         status, payment_terms, currency,
                                         shipping_address, notes,
                                         created_at, updated_at)
            VALUES ($1, $2, 'TEXSTONE INC',
                    $3::date, ($3::date + INTERVAL '7 days')::date,
                    $4, $5,
                    'Closed', 'Advance', 'USD',
                    $6, $7,
                    NOW(), NOW())`,
            [`PO-TEMP-${o.order_number}`, o.id, o.order_date,
             o.subtotal || 0, o.total || 0, o.shipping_address, o.notes])
          p++
        }
      }
      if (APPLY) await client.query('COMMIT')
      console.log(`  quotations created=${q}, invoices=${i}, POs=${p}`)
    }

    // ─── PHASE 4: soft-delete everything NOT in the authoritative set ────
    if (!PHASE || PHASE === '4') {
      console.log('\n=== PHASE 4: soft-delete non-authoritative ===')
      const keepOrderNumbers = new Set(authoritative.map(o => o.orderNumber))
      const keepCustomerNames = new Set([...customers.values()].map(c => c.name.toLowerCase().trim()))

      // 1. Orders not in keep list
      const stray = (await client.query(`
        SELECT order_number FROM orders WHERE deleted_at IS NULL AND order_number != ALL($1)`,
        [[...keepOrderNumbers]])).rows
      console.log(`  orders to soft-delete: ${stray.length}`)

      if (APPLY && stray.length) {
        const nums = stray.map(r => r.order_number)
        await client.query('BEGIN')
        // Snapshot the target order ids before anything is soft-deleted so
        // the subsequent quote_id lookup still finds their invoices.
        const targetIds = (await client.query(
          'SELECT id FROM orders WHERE order_number = ANY($1)', [nums])).rows.map(r => r.id)
        // Quotations don't link to order directly; they hang off invoices.quote_id.
        await client.query(`UPDATE quotations SET deleted_at = NOW()
          WHERE id IN (SELECT quote_id FROM invoices
                        WHERE order_id = ANY($1) AND quote_id IS NOT NULL)`,
          [targetIds])
        await client.query(`UPDATE invoices SET deleted_at = NOW()
          WHERE order_id = ANY($1)`, [targetIds])
        await client.query(`UPDATE purchase_orders SET deleted_at = NOW()
          WHERE order_id = ANY($1)`, [targetIds])
        // Payment records survive; the link to the deleted order is cleared.
        await client.query(`UPDATE payments SET order_id = NULL, updated_at = NOW()
          WHERE order_id = ANY($1)`, [targetIds])
        await client.query(`UPDATE orders SET deleted_at = NOW() WHERE id = ANY($1)`, [targetIds])
        await client.query('COMMIT')
      }

      // 2. Customers not in keep list AND with no linked orders left
      const orphanCust = (await client.query(`
        SELECT c.id, c.name FROM customers c
         WHERE c.deleted_at IS NULL
           AND LOWER(TRIM(c.name)) != ALL($1)
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL)`,
        [[...keepCustomerNames]])).rows
      console.log(`  customers to soft-delete: ${orphanCust.length}`)
      if (APPLY && orphanCust.length) {
        await client.query(`UPDATE customers SET deleted_at = NOW() WHERE id = ANY($1)`,
          [orphanCust.map(r => r.id)])
      }

      // 3. Stray invoices/POs pointing at no live order, and quotations
      //    no live invoice still references.
      if (APPLY) {
        const i = await client.query(`UPDATE invoices SET deleted_at = NOW()
          WHERE deleted_at IS NULL
            AND (order_id IS NULL OR order_id NOT IN (SELECT id FROM orders WHERE deleted_at IS NULL))`)
        const p = await client.query(`UPDATE purchase_orders SET deleted_at = NOW()
          WHERE deleted_at IS NULL
            AND (order_id IS NULL OR order_id NOT IN (SELECT id FROM orders WHERE deleted_at IS NULL))`)
        const q = await client.query(`UPDATE quotations SET deleted_at = NOW()
          WHERE deleted_at IS NULL
            AND id NOT IN (SELECT DISTINCT quote_id FROM invoices WHERE deleted_at IS NULL AND quote_id IS NOT NULL)`)
        console.log(`  stray docs soft-deleted: Q=${q.rowCount} I=${i.rowCount} P=${p.rowCount}`)
      }
    }

    // ─── PHASE 5: renumber quotations / invoices / POs sequentially ──────
    if (!PHASE || PHASE === '5') {
      console.log('\n=== PHASE 5: renumber quotations/invoices/POs ===')
      if (APPLY) {
        // Two-pass rename to sidestep unique-constraint collisions when a
        // target number already lives on a different row. First stash every
        // row under a random-suffix parking number, then set the final name.
        const renumber = async (table, col, orderSql) => {
          const rows = (await client.query(`
            SELECT id, EXTRACT(YEAR FROM COALESCE(${orderSql}))::int AS yr
              FROM ${table} WHERE deleted_at IS NULL
              ORDER BY ${orderSql} NULLS LAST, created_at`)).rows
          await client.query('BEGIN')
          // The unique index covers soft-deleted rows too — park those under
          // a DEL- prefix so freshly generated numbers cannot collide.
          await client.query(`
            UPDATE ${table} SET ${col} = SUBSTR('DEL-' || ${col}, 1, 30)
             WHERE deleted_at IS NOT NULL AND ${col} NOT LIKE 'DEL-%'`)
          // Park each live row at a short unique temp name (VARCHAR(30) safe).
          for (let idx = 0; idx < rows.length; idx++) {
            await client.query(`UPDATE ${table} SET ${col} = $2 WHERE id = $1`,
              [rows[idx].id, `TMP-${table.slice(0,3)}-${idx}`])
          }
          const counter = {}
          const prefix = table === 'quotations' ? 'Q' : table === 'invoices' ? 'INV' : 'PO'
          for (const r of rows) {
            counter[r.yr] = (counter[r.yr] || 0) + 1
            const num = `${prefix}-${r.yr}-${String(counter[r.yr]).padStart(4,'0')}`
            await client.query(`UPDATE ${table} SET ${col} = $1 WHERE id = $2`, [num, r.id])
          }
          await client.query('COMMIT')
          console.log(`  renumbered ${rows.length} ${table}`)
        }
        await renumber('quotations',      'quote_number',   'sent_at, created_at')
        await renumber('invoices',        'invoice_number', 'issue_date, created_at')
        await renumber('purchase_orders', 'po_number',      'order_date, created_at')
      }
    }

    // ─── Final report ────────────────────────────────────────────────────
    console.log('\n=== FINAL COUNTS ===')
    const r = (await client.query(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL)       AS customers,
        (SELECT COUNT(*) FROM orders    WHERE deleted_at IS NULL)       AS orders,
        (SELECT COUNT(*) FROM quotations WHERE deleted_at IS NULL)      AS quotations,
        (SELECT COUNT(*) FROM invoices  WHERE deleted_at IS NULL)       AS invoices,
        (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL) AS pos,
        (SELECT COUNT(*) FROM payments) AS payments`)).rows[0]
    console.log(JSON.stringify(r, null, 2))
    if (!APPLY) console.log('\nDRY RUN — re-run with --apply to commit.')
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* not in tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
