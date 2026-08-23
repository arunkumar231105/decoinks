#!/usr/bin/env node
/**
 * Do the payment fields come back the way they went in?
 *
 * The shop reported that choosing Paid on an order, saving, and reopening it
 * showed Due on Receipt again. The cause was in the form, which rewrote 'Paid'
 * to 'Due on Receipt' on its way out — but "the API must be dropping it" is the
 * first thing anyone assumes, and it was not. This settles that question in one
 * run, for every field on the payment card, on the way in and on an edit after.
 *
 * It sends exactly the payload the order form builds, reads the row back from
 * the database rather than from the API's own reply, edits it the way the form
 * does — resending everything with one value changed — and reads it again.
 *
 * Usage (inside the backend container):
 *   SMOKE_BASE=http://localhost:8001/api node scripts/payment-fields-roundtrip-test.js
 */
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')

const BASE = process.env.SMOKE_BASE || 'http://localhost:8001/api'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const FIELDS = ['payment_terms', 'payment_method', 'payment_status', 'currency',
  'payment_reference', 'payment_date', 'amount_paid']
let passed = 0
const fails = []

async function main() {
  const { rows: [u] } = await pool.query(
    `SELECT id, email, role::text AS role FROM users WHERE is_active AND role='Admin' ORDER BY created_at LIMIT 1`)
  const TOKEN = jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  const { rows: [db] } = await pool.query('SELECT current_database() AS name')
  const { rows: [c] } = await pool.query(
    `SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)
  console.log(`API ${BASE}   database ${db.name}\n`)

  // Every term the dropdown offers, including the one that was being rewritten.
  const TERMS = ['Advance', 'Due on Receipt', 'Net 15', 'Net 30', 'Net 60', 'Paid']
  const METHODS = ['zelle', 'cashapp', 'bank_transfer', 'cash']

  for (let i = 0; i < TERMS.length; i++) {
    const term = TERMS[i]
    const settled = term === 'Paid'
    const sent = {
      customer_id: c.id, order_type: 'apparel', order_date: '2026-08-23',
      items: [{ item: 'Tee', description: 'Tee', qty: 5, unit_price: 14 }],
      payment_terms: term,
      payment_method: METHODS[i % METHODS.length],
      payment_status: settled ? 'Paid' : 'Unpaid',
      amount_paid: settled ? 70 : 0,
      currency: 'USD',
      payment_reference: `REF-${i}`,
      payment_date: settled ? '2026-08-23' : null,
    }
    const made = await (await fetch(`${BASE}/orders`, { method: 'POST', headers: H, body: JSON.stringify(sent) })).json()
    const id = (made.data ?? made).id
    if (!id) {
      fails.push({ f: `order with terms "${term}" is created`, d: JSON.stringify(made).slice(0, 160) })
      continue
    }

    const read = async () => (await pool.query(
      `SELECT payment_terms, payment_method, payment_status::text AS payment_status, currency,
              payment_reference, payment_date::text AS payment_date, amount_paid::float8 AS amount_paid,
              total::float8 AS total FROM orders WHERE id=$1`, [id])).rows[0]

    const compare = (stage, row) => {
      for (const f of FIELDS) {
        const same = String(sent[f] ?? '') === String(row[f] ?? '')
        if (same) passed++
        else fails.push({ f: `${stage}: ${f} on a "${term}" order`, d: `sent ${JSON.stringify(sent[f])}, stored ${JSON.stringify(row[f])}` })
      }
      if (settled) {
        const ok = Number(row.amount_paid) === Number(row.total)
        if (ok) passed++
        else fails.push({ f: `${stage}: a Paid order shows the full amount received`, d: `paid ${row.amount_paid} of ${row.total}` })
      }
    }
    compare('on save', await read())

    // The form resends the whole card on an edit; change one value and check
    // that the others are not lost along the way.
    sent.payment_reference = `REF-${i}-edited`
    const upd = await fetch(`${BASE}/orders/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(sent) })
    if (upd.status >= 400) fails.push({ f: `editing a "${term}" order is accepted`, d: `HTTP ${upd.status}` })
    else compare('after an edit', await read())

    await fetch(`${BASE}/orders/${id}`, { method: 'DELETE', headers: H })
    await pool.query('DELETE FROM order_items_apparel WHERE order_id=$1', [id]).catch(() => {})
    await pool.query('DELETE FROM orders WHERE id=$1', [id])
  }

  console.log(fails.length
    ? `${passed} passed, ${fails.length} FAILED:\n` + fails.map(x => `  ✗ ${x.f}\n      ${x.d}`).join('\n')
    : `ALL ${passed} PAYMENT FIELD CHECKS PASSED — every term, on save and after an edit.`)
  await pool.end()
  process.exitCode = fails.length ? 1 : 0
}

main().catch(async e => { console.error(e.message); try { await pool.end() } catch {} ; process.exit(1) })
